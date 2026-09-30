/* 库课 · 数据库备份
 *
 * ── 为什么不能直接 cp ────────────────────────────────────────────
 * 库用的是 WAL 模式（见 db/index.js）。WAL 下最新的写入可能还在
 * `kuke.db-wal` 里没合并回主库 —— 这时候 `cp kuke.db` 拿到的是
 * **一个缺了最近若干次提交的、看起来完全正常的库**。
 * 这种备份最危险的地方在于它是静默的：恢复时才发现少了数据，
 * 而那时已经晚了。
 *
 * 正确做法是让 SQLite 自己导出一份一致的副本。这里用 `VACUUM INTO`：
 *   · 事务一致 —— 导出的是某个时间点的完整快照
 *   · 顺带整理 —— 产物没有碎片、体积通常更小
 *   · 在线执行 —— 不需要停服务
 *
 * ── 为什么备份完还要打开验一遍 ──────────────────────────────────
 * 「文件存在且大小不为 0」证明不了任何事。磁盘写满、进程被杀、
 * 权限不对，都可能留下一个半截文件。所以这里真的打开它、
 * 跑一次 `PRAGMA integrity_check` 并数一下表 ——
 * 备份脚本最大的失败模式不是「没备份」，是「备份了但没人知道它是坏的」。
 *
 * 用法：
 *   node scripts/backup.mjs                      # 备份到 ./backups/
 *   node scripts/backup.mjs --out /mnt/nas/kuke  # 指定目录
 *   node scripts/backup.mjs --keep 30            # 保留最近 30 份（默认 14）
 *
 * cron（每天 3:17，避开整点的任务高峰）：
 *   17 3 * * * cd /opt/kuke && /usr/bin/node scripts/backup.mjs --keep 30 >> /var/log/kuke-backup.log 2>&1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveDbPath } from '../server/src/lib/dbPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const OUT_DIR = path.resolve(arg('out', path.join(ROOT, 'backups')));
const KEEP = Number(arg('keep', 14));

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const SRC = resolveDbPath();
const DEST = path.join(OUT_DIR, `kuke-${stamp}.db`);

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SRC)) die(`找不到数据库：${SRC}`);

fs.mkdirSync(OUT_DIR, { recursive: true });

if (fs.existsSync(DEST)) die(`目标已存在：${DEST}`);

const sizeBefore = fs.statSync(SRC).size;

/* ---------- 导出 ---------- */
/* SQL 字符串里的单引号要转义。路径来自命令行参数，
 * 虽然是自己人用，但拼 SQL 就该按拼 SQL 的规矩来。 */
const escaped = DEST.replace(/'/g, "''");

let db;
try {
  db = new Database(SRC);
  db.pragma('busy_timeout = 10000');
  db.exec(`VACUUM INTO '${escaped}'`);
} catch (e) {
  die(`导出失败：${e.message}`);
} finally {
  try { db?.close(); } catch { /* 关不掉不影响结果 */ }
}

/* ---------- 校验 ---------- */
/* 这一步不是形式主义：它是「备份能不能用」的唯一证据。 */
let tables = 0;
let users = 0;
try {
  const check = new Database(DEST, { readonly: true });
  const integrity = check.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') die(`备份完整性检查未通过：${integrity}`);
  tables = check.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
  users = check.prepare('SELECT COUNT(*) n FROM users').get().n;
  check.close();
} catch (e) {
  /* 校验失败就把这个坏文件删掉 —— 留着一个坏备份比没有备份更糟，
   * 因为它会让人以为「有备份」。 */
  try { fs.unlinkSync(DEST); } catch { /* 删不掉就留着，但已经报错了 */ }
  die(`备份校验失败（已删除产物）：${e.message}`);
}

const sizeAfter = fs.statSync(DEST).size;
const mb = (n) => (n / 1024 / 1024).toFixed(2);

console.log(`✓ 备份完成 ${DEST}`);
console.log(`  源库 ${mb(sizeBefore)} MB · 备份 ${mb(sizeAfter)} MB · ${tables} 张表 · ${users} 个账号`);

/* ---------- 轮转 ---------- */
const files = fs.readdirSync(OUT_DIR)
  .filter((f) => /^kuke-\d{8}-\d{6}\.db$/.test(f))
  .sort()            // 文件名带时间戳，字典序即时间序
  .map((f) => path.join(OUT_DIR, f));

const excess = files.length - KEEP;
if (excess > 0) {
  for (const f of files.slice(0, excess)) {
    try {
      fs.unlinkSync(f);
      console.log(`  已清理旧备份 ${path.basename(f)}`);
    } catch (e) {
      console.warn(`  ! 清理失败 ${path.basename(f)}：${e.message}`);
    }
  }
}
console.log(`  当前保留 ${Math.min(files.length, KEEP)} 份（上限 ${KEEP}）`);
