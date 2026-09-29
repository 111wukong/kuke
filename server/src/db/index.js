/* 数据库连接与建表
 *
 * 三件事：建立连接、跑 schema.sql、提供 rebuildStats（从明细重建聚合）。
 *
 * ── 为什么 PRAGMA 要在这里一次性设齐 ──────────────────────────────
 * better-sqlite3 是同步 API，没有连接池，全局就这一个连接。
 * 所以 PRAGMA 设一次就够，但要设对：
 *   foreign_keys = ON   ← 少了它，ON DELETE CASCADE 全部失效。
 *                          删学生不会清掉他的作答/复习卡/会话，
 *                          库里留下一堆指向不存在 user 的孤儿行，
 *                          而且**不会报任何错**。这是最危险的一条。
 *   journal_mode = WAL  ← 读写并发。默认的 delete 模式下一个长查询会
 *                          把整个库锁住，看板页统计一慢，学生答题就写不进去。
 *   busy_timeout        ← WAL 下仍可能撞写锁，给 5 秒重试窗口而不是立刻抛。
 *   synchronous = NORMAL← WAL 下的推荐值。断电最多丢最后几个事务，
 *                          不会损坏库；FULL 会让每次写都 fsync，太慢。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveDbPath } from '../lib/dbPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = resolveDbPath();

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

/** 建表。幂等：schema.sql 全是 IF NOT EXISTS。 */
export function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

/* ---------- 聚合表重建 ----------
 * 明细（attempts）是权威，stats_* 只是加速层。
 * 这个方法在三种场合被调用：
 *   1. 迁移后回填（老库的 stats 可能是空的）
 *   2. 管理员手动「重算统计」（怀疑数字对不上时）
 *   3. 单元测试里构造确定状态
 *
 * ★ 必须包在一个事务里。否则中途失败会留下「一半是新的、一半是旧的」的
 *   聚合表，而它看起来完全正常 —— 只是数字永远对不上明细。
 */
export function rebuildStats(userId = null) {
  const scope = userId == null ? '' : 'WHERE user_id = ?';
  const args = userId == null ? [] : [userId];

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM stats_node ${scope}`).run(...args);
    db.prepare(`DELETE FROM stats_daily ${scope}`).run(...args);

    db.prepare(`
      INSERT INTO stats_node (user_id, kid, n, c, ts)
      SELECT user_id, kid, COUNT(*), SUM(correct), MAX(ts)
      FROM attempts ${scope}
      GROUP BY user_id, kid
    `).run(...args);

    db.prepare(`
      INSERT INTO stats_daily (user_id, date, n, c, minutes)
      SELECT user_id, date, COUNT(*), SUM(correct), 0
      FROM attempts ${scope}
      GROUP BY user_id, date
    `).run(...args);

    /* 分钟数不在 attempts 里（一道题不记时长到分钟粒度），
     * 从 checkins 补回来。两次写入同一个主键，所以用 UPSERT。
     *
     * ★ 那个 `WHERE 1=1` 不是凑数，是必需的。
     *   SQLite 里 `INSERT ... SELECT ... ON CONFLICT` 有一个解析歧义：
     *   解析器看到 SELECT 后面的 `ON` 时，无法判断它是 JOIN 的 ON
     *   还是 upsert 的 ON CONFLICT —— 它会猜前者，然后报语法错。
     *   官方文档给的解法就是「给 SELECT 加一个 WHERE 子句」，
     *   哪怕条件恒真。少了它，报错信息是 `near "ON": syntax error`，
     *   指向的是 ON CONFLICT 那一行，而真正的原因在 SELECT 缺了 WHERE。 */
    const andUser = userId == null ? '' : 'AND user_id = ?';
    db.prepare(`
      INSERT INTO stats_daily (user_id, date, n, c, minutes)
      SELECT user_id, date, 0, 0, minutes FROM checkins WHERE 1=1 ${andUser}
      ON CONFLICT(user_id, date) DO UPDATE SET minutes = excluded.minutes
    `).run(...args);
  });

  run();
}

/** 单用户增量更新。作答流程里调用，和 attempts 的写入同事务。 */
export function bumpStats(userId, kid, date, correct, ts) {
  db.prepare(`
    INSERT INTO stats_node (user_id, kid, n, c, ts) VALUES (?,?,1,?,?)
    ON CONFLICT(user_id, kid) DO UPDATE SET
      n = n + 1, c = c + excluded.c, ts = MAX(ts, excluded.ts)
  `).run(userId, kid, correct, ts);

  db.prepare(`
    INSERT INTO stats_daily (user_id, date, n, c, minutes) VALUES (?,?,1,?,0)
    ON CONFLICT(user_id, date) DO UPDATE SET
      n = n + 1, c = c + excluded.c
  `).run(userId, date, correct);
}

export function health() {
  const one = (sql) => db.prepare(sql).get();
  const tables = one(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).n;
  const users = one('SELECT COUNT(*) n FROM users').n;
  const attempts = one('SELECT COUNT(*) n FROM attempts').n;
  return { ok: true, dbPath: DB_PATH, tables, users, attempts };
}
