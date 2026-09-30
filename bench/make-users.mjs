/* 批量造 300 个学生账号，直接写库（绕过注册接口的 IP 限流）。
 *
 * 密码统一 Student#12345，salt/hash 只算一次然后复用 ——
 * 压测关心的是服务端 scrypt 校验的成本，不是注册的成本。
 * 让 300 个账号用同一个盐不影响压测有效性：服务端仍然要对每个登录
 * 完整跑一遍 scrypt。
 *
 * 用法：KUKE_DB=/tmp/kuke-bench/kuke.db node bench/make-users.mjs 300
 */
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const N = Number(process.argv[2] || 300);
const DB = process.env.KUKE_DB || '/tmp/kuke-bench/kuke.db';
const PWD = 'Student#12345';

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(PWD, salt, 64, { N: 16384, r: 8, p: 1 });

const db = new Database(DB);
db.pragma('busy_timeout = 10000');

const ins = db.prepare(`
  INSERT OR IGNORE INTO users (email, username, password_hash, password_salt, avatar_hue, role, status, real_name, student_no)
  VALUES (?,?,?,?,?,'student','active',?,?)
`);
const insSettings = db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)');
const insGame = db.prepare('INSERT OR IGNORE INTO game_state (user_id) VALUES (?)');

const tx = db.transaction(() => {
  for (let i = 1; i <= N; i++) {
    const email = `stu${String(i).padStart(4, '0')}@kuke.test`;
    const info = ins.run(email, `学生${i}`, hash.toString('hex'), salt.toString('hex'),
      i % 360, `学生${i}`, `2023${String(i).padStart(6, '0')}`);
    const id = Number(info.lastInsertRowid);
    if (id) { insSettings.run(id); insGame.run(id); }
  }
});
tx();

const n = db.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n;
console.log(`学生账号总数：${n}`);
console.log(`统一密码：${PWD}`);
