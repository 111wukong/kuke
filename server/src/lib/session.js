/* 会话
 *
 * ── 为什么不用 JWT ──────────────────────────────────────────────
 * JWT 没法即时登出。而本系统有两个刚需：
 *   · 教师「强制下线」某个学生 —— 必须立刻生效
 *   · 教师「重置密码」—— 重置之后旧设备的 cookie 不能还能用
 * 用 JWT 要实现这两条，就得再维护一张黑名单表，等于把会话表又加回来，
 * 还多背一个签名密钥轮换的问题。直接用服务端会话，简单且正确。
 *
 * ── 库里只存 token 的 sha256 ────────────────────────────────────
 * 原文只在 cookie 里存在一次。库被拖走（备份泄露、SQL 注入、误传仓库）
 * 也换不出可用的 cookie —— 攻击者拿到的是一堆哈希。
 * 这里不需要加盐慢哈希（那是为了抗离线爆破低熵口令），
 * 会话 token 是 32 字节密码学随机数，sha256 足够。
 */
import crypto from 'node:crypto';
import { db } from '../db/index.js';

export const COOKIE_NAME = 'kuke_sid';
const TTL_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId, { userAgent = '', ip = '' } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expires = now + TTL_DAYS * 86400000;

  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
    VALUES (?,?,?,?,?,?,?)`).run(
    sha256(token), userId,
    new Date(now).toISOString(), new Date(expires).toISOString(), new Date(now).toISOString(),
    String(userAgent).slice(0, 300), String(ip).slice(0, 60),
  );

  return { token, expiresAt: expires };
}

/* 读会话。★ 这里同时做了三件事，缺一不可：
 *   1. 过期即失效（不看 expires_at 的话 cookie 永久有效）
 *   2. **账号被停用即失效** —— 只靠「停用时删会话」不够，
 *      因为管理员可能直接改库、或停用发生在另一台机器上；
 *      每次请求都核一遍 status 才是真的保证。
 *   3. 滑动续期：last_seen_at 只在超过 1 小时才写，避免每个请求一次写库
 *      （答题页一秒能发好几个请求，每次都写会把 WAL 写爆）。
 */
export function readSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token_hash, s.user_id, s.expires_at, s.last_seen_at,
           u.id, u.email, u.username, u.role, u.status, u.avatar_hue,
           u.real_name, u.student_no, u.note, u.created_at, u.updated_at, u.last_login_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(sha256(token));

  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  if (row.status !== 'active') return null;

  if (Date.now() - Date.parse(row.last_seen_at) > 3600_000) {
    touchSession(row.token_hash);
  }
  return row;
}

export function touchSession(tokenHash) {
  try {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), tokenHash);
  } catch { /* 会话续期失败不该影响业务请求 */ }
}

export function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

export function cleanupSessions() {
  const r = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  return r.changes;
}

export function logAuth(event, { email = '', userId = null, ip = '', userAgent = '' } = {}) {
  try {
    db.prepare('INSERT INTO auth_log (email, user_id, event, ip, user_agent) VALUES (?,?,?,?,?)')
      .run(email, userId, event, String(ip).slice(0, 60), String(userAgent).slice(0, 300));
  } catch { /* 审计是旁路，不能连累主流程 */ }
}

export function cookieOptions(isProd) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: !!isProd,
    maxAge: TTL_DAYS * 86400,
  };
}
