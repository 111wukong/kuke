/* 给 300 个学生各发一张会话（直接写库），压测时免去登录开销。
 *
 * 为什么不在压测里现场登录：登录要跑 scrypt，是 CPU 密集的，
 * 会把「业务接口的并发能力」和「登录的计算成本」两件事混在一起。
 * 分开测才能各自定位 —— 登录风暴由 run.mjs login 单独打。
 *
 * cookie 原文只存在这里生成的 tokens.json 里，库里存的仍然是 sha256。
 *
 * 用法：KUKE_DB=/tmp/kuke-bench/kuke.db node bench/make-sessions.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const DB = process.env.KUKE_DB || '/tmp/kuke-bench/kuke.db';
const OUT = process.env.TOKENS_OUT || '/tmp/kuke-bench/tokens.json';

const db = new Database(DB);
db.pragma('busy_timeout = 10000');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const users = db.prepare("SELECT id, email FROM users WHERE role='student' ORDER BY id").all();
const ins = db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
  VALUES (?,?,?,?,?,?,?)`);

const now = new Date();
const exp = new Date(now.getTime() + 30 * 86400000);
const out = [];
const tx = db.transaction(() => {
  for (const u of users) {
    const token = crypto.randomBytes(32).toString('base64url');
    ins.run(sha256(token), u.id, now.toISOString(), exp.toISOString(), now.toISOString(),
      'bench/1.0', '10.0.0.0');
    out.push({ userId: u.id, email: u.email, token });
  }
});
tx();
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`已生成会话：${out.length}（写入 ${OUT}）`);
