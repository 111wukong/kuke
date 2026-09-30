/* 重置某个账号的密码
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────────
 * 引导账号的密码**只打印一次**，之后就再也取不出来了（库里只有 scrypt 哈希）。
 * 忘了密码时，官方姿势是「删号重建」——但那会把这个人所有的作答记录、
 * 复习卡、作业一起带走。
 *
 * 所以留一个只改密码、不动别的东西的口子。
 *
 * 用法：
 *   node scripts/reset-password.mjs <邮箱> <新密码>
 *   node scripts/reset-password.mjs <邮箱> --random     # 随机生成并打印
 *
 * 走的是和注册/登录完全相同的 hashPassword()——
 * **不要在这里另写一套哈希**，否则重置完反而登不上。
 */

import { db } from '../server/src/db/index.js';
import { hashPassword, checkPasswordStrength } from '../server/src/lib/password.js';

const [email, ...rest] = process.argv.slice(2);
const wantRandom = rest.includes('--random');
const password = wantRandom ? null : rest.filter((a) => a !== '--random')[0];

if (!email) {
  console.error('用法：node scripts/reset-password.mjs <邮箱> <新密码|--random>');
  process.exit(1);
}

const user = db.prepare('SELECT id, email, username, role FROM users WHERE email = ?').get(email);
if (!user) {
  const all = db.prepare('SELECT email, username, role FROM users').all();
  console.error(`没有这个账号：${email}`);
  if (all.length) {
    console.error('现有账号：');
    for (const u of all) console.error(`  ${u.email}  ${u.username}  (${u.role})`);
  }
  process.exit(1);
}

const pw = password || (await import('../server/src/lib/password.js')).generatePassword(14);

/* ★ 强度检查在**重置**这条路上更该做 ——
 *   重置往往是临时起意（「先设成 123456 回头再改」），然后就没有回头了。 */
const weak = checkPasswordStrength(pw);
if (weak && !wantRandom) {
  console.error(`密码不合要求：${weak}`);
  process.exit(1);
}

const { hash, salt } = await hashPassword(pw);
db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?")
  .run(hash, salt, user.id);

/* ★ 顺手清掉这个人的所有会话。
 *   不改密码就登出旧会话的话，重置密码挡不住已经登录的人 ——
 *   而「重置密码」这个动作在用户心里就是「把别人踢出去」。 */
const killed = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;

console.log(`已重置 ${user.email}（${user.username} · ${user.role}）的密码`);
console.log(`新密码：${pw}`);
if (killed) console.log(`已注销其 ${killed} 个登录会话`);
if (wantRandom) console.log('（随机生成的，请立刻记下来）');
