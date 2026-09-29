/* SQL 执行 worker
 *
 * ── 为什么必须跑在 worker 线程里 ────────────────────────────────
 * better-sqlite3 是**同步** API。在主线程上跑一条
 * `SELECT * FROM a, b, c, d, e`（五表笛卡尔积，教学库里每表几百行）
 * 会把整个事件循环钉死几十秒 —— 期间**所有**学生的所有请求都不响应，
 * 包括心跳和登录。一个学生的误操作能把全站打挂。
 *
 * 所以：worker 线程 + 主线程超时后 terminate()。
 * terminate 是唯一能打断同步 C 代码的手段（设 SQLITE_INTERRUPT 需要
 * 从另一个线程调 sqlite3_interrupt，而 better-sqlite3 没暴露这个接口）。
 * 代价是这次执行的工作全丢 —— 但对一个超时查询来说，丢是对的。
 *
 * ── 每次任务都新建内存库 ────────────────────────────────────────
 * 不重用连接。理由不是性能（建一个内存库 + 灌几百行是毫秒级），
 * 是**隔离**：学生 A 的上一条 INSERT 不能影响他这一条 SELECT 的判题结果，
 * 更不能影响别人。用完即弃是最省心的隔离。
 */
import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { splitStatements, checkStatement, analyze } from '../lib/sqlGuard.js';

/** 单条结果集最多回多少行。前端渲染不动更大的表，而且大结果集本身就是答案写错的信号。 */
const MAX_ROWS = 500;

function runTask(task) {
  const { ddl = '', seed = '', sql = '', allowWrite = true, explain = false } = task;
  const t0 = Date.now();

  const pre = analyze(sql, { allowWrite });
  if (pre.errors.length) {
    return { ok: false, phase: 'guard', error: pre.errors[0], errors: pre.errors, warnings: pre.warnings, ms: Date.now() - t0 };
  }

  let db;
  try {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // 先建数据集（DDL + 样本数据）。这两段是我们自己的内容，不走闸门 ——
    // 但出错要能定位，所以分开 try 并带上阶段标记。
    try {
      if (ddl.trim()) db.exec(ddl);
    } catch (e) {
      return { ok: false, phase: 'dataset', error: `数据集建表失败：${e.message}`, ms: Date.now() - t0 };
    }
    try {
      if (seed.trim()) db.exec(seed);
    } catch (e) {
      return { ok: false, phase: 'dataset', error: `数据集样本数据导入失败：${e.message}`, ms: Date.now() - t0 };
    }

    const statements = splitStatements(sql);
    const results = [];
    let lastError = null;

    for (const stmt of statements) {
      const checked = checkStatement(stmt, { allowWrite });
      if (!checked.ok) {
        results.push({ sql: stmt, kind: checked.kind, error: checked.reason, blocked: true });
        lastError = checked.reason;
        break; // 命中闸门就停，后面的语句不再执行
      }

      const text = explain ? `EXPLAIN QUERY PLAN ${stmt}` : stmt;
      try {
        const prepared = db.prepare(text);
        if (prepared.reader) {
          const rows = prepared.all();
          const columns = prepared.columns().map((c) => c.name);
          results.push({
            sql: stmt, kind: checked.kind, columns,
            rows: rows.map((r) => columns.map((c) => r[c])),
            truncated: rows.length > MAX_ROWS,
            rowCount: rows.length,
          });
          if (rows.length > MAX_ROWS) results[results.length - 1].rows = results[results.length - 1].rows.slice(0, MAX_ROWS);
        } else {
          const info = prepared.run();
          results.push({
            sql: stmt, kind: checked.kind, columns: [], rows: [],
            changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid),
          });
        }
      } catch (e) {
        results.push({ sql: stmt, kind: checked.kind, error: e.message });
        lastError = e.message;
        break;
      }
    }

    return {
      ok: !lastError,
      phase: lastError ? 'sql' : 'done',
      error: lastError || '',
      results,
      warnings: pre.warnings,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, phase: 'internal', error: e.message, ms: Date.now() - t0 };
  } finally {
    try { db?.close(); } catch { /* 关不掉也不影响结果，进程退出会回收 */ }
  }
}

parentPort.on('message', (msg) => {
  const { id, task } = msg;
  let payload;
  try {
    payload = runTask(task);
  } catch (e) {
    payload = { ok: false, phase: 'internal', error: String(e?.message || e), ms: 0 };
  }
  parentPort.postMessage({ id, payload });
});
