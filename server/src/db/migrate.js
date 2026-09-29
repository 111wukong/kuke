/* 结构迁移
 *
 * ── 为什么必须存在 ──────────────────────────────────────────────
 * schema.sql 全是 CREATE TABLE IF NOT EXISTS。表已存在时**整条语句被跳过** ——
 * 也就是说「往已有表里加一列」它做不到。
 * 所以凡是后加的列，都必须走 ALTER TABLE，在这里补。
 *
 * ── 为什么索引也要放这里 ────────────────────────────────────────
 * schema.sql 是整段 exec 的。在老库上 users 表已存在 → 那条 CREATE TABLE
 * 被跳过 → 此刻 role 列还不存在（它靠下面的 ALTER TABLE 补）。
 * 如果 schema.sql 里写了 `CREATE INDEX ... ON users(role)`，
 * 它会在这里之前执行并抛「no such column: role」，
 * 把整个 initSchema 打断，服务根本起不来 ——
 * 而报错点会指到 index.js 的 initSchema，看着像建表脚本坏了。
 * 所以凡是依赖新增列的索引，一律放 migrate() 里。
 *
 * 加一列要改两处：下面的 ADD_COLUMNS 加一条，schema.sql 的 CREATE TABLE 里也加一条。
 * 只改一处的结果是「新库有列、老库没有」或反过来，两种都会在生产上咬人。
 */
import { db } from './index.js';
import { hashPassword, generatePassword } from '../lib/password.js';

/* [表, 列, 列定义] —— 加列往这里追加，顺序无所谓，重复执行安全。 */
const ADD_COLUMNS = [
  ['users', 'role', "TEXT NOT NULL DEFAULT 'student'"],
  ['users', 'status', "TEXT NOT NULL DEFAULT 'active'"],
  ['users', 'note', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'real_name', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'student_no', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'created_by', 'INTEGER'],
  ['user_settings', 'daily_goal', 'INTEGER NOT NULL DEFAULT 20'],
  ['user_settings', 'sql_dialect', "TEXT NOT NULL DEFAULT 'sqlite'"],
  ['user_settings', 'editor_font', 'INTEGER NOT NULL DEFAULT 14'],
  ['sql_levels', 'require_columns', 'INTEGER NOT NULL DEFAULT 0'],
  ['labs', 'kid', "TEXT NOT NULL DEFAULT ''"],
  ['attempts', 'score', 'INTEGER NOT NULL DEFAULT 0'],
  ['attempts', 'duration_ms', 'INTEGER NOT NULL DEFAULT 0'],
  ['submissions', 'graded_by', 'INTEGER'],
];

export function migrate() {
  const done = [];

  for (const [table, column, def] of ADD_COLUMNS) {
    const exists = db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column);
    if (exists) continue;
    // 表本身可能还不存在（比如老库没有 submissions），那就跳过 —— 建表交给 schema.sql
    const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!tableExists) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    done.push(`${table}.${column}`);
  }

  /* 依赖新增列的索引。放在这里，理由见文件头。 */
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
    CREATE INDEX IF NOT EXISTS idx_levels_require_cols ON sql_levels(require_columns);
  `);

  return done;
}

/* ---------- 引导管理员 / 教师 ----------
 * ── 为什么密码是现场随机生成、只打印一次 ────────────────────────
 * 公开仓库里躺着能用的凭据是不能接受的：口令会被人在别处复用，
 * 邮箱会被爬。所以源码里不能有任何可用的默认凭据。
 * 随机密码只在创建那一刻出现一次，之后库里只有 scrypt 哈希。
 *
 * ── 这个系统的引导对象是「教师」而不是「管理员」 ────────────────
 * 因为本系统是给老师和学生用的：第一个账号应该是老师，
 * 他要能立刻建班、建号、布置作业。管理员是后来才需要的能力，
 * 所以默认角色是 teacher，需要时用环境变量指定 admin。
 */
export async function ensureBootstrapAccount() {
  const role = ['admin', 'teacher'].includes(process.env.KUKE_BOOTSTRAP_ROLE)
    ? process.env.KUKE_BOOTSTRAP_ROLE
    : 'teacher';

  const email = (process.env.KUKE_EMAIL || 'teacher@localhost').trim().toLowerCase();
  const username = process.env.KUKE_USERNAME || '任课教师';

  const existing = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
  if (existing) {
    /* 已存在就**不动它**。之前这里写过「提权 + 重置密码」的逻辑，
     * 那会在每次启动时把教师自己改过的密码重置掉 ——
     * 一个「启动服务」的动作不应该有副作用到这种程度。 */
    return { action: 'exists', email: existing.email, id: existing.id, role: existing.role, generated: false };
  }

  const password = process.env.KUKE_PASSWORD || generatePassword(12);
  const generated = !process.env.KUKE_PASSWORD;
  const { hash, salt } = await hashPassword(password);

  const info = db.prepare(`
    INSERT INTO users (email, username, password_hash, password_salt, avatar_hue, role, real_name)
    VALUES (?,?,?,?,?,?,?)
  `).run(email, username, hash, salt, Math.floor(Math.random() * 360), role, username);

  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
  db.prepare('INSERT OR IGNORE INTO game_state (user_id) VALUES (?)').run(id);

  return { action: 'created', email, id, role, password, generated };
}
