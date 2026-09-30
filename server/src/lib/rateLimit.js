/* 限流键策略 —— 为什么不能只看 IP
 *
 * ── 问题 ────────────────────────────────────────────────────────
 * 库课的部署形态是「一个学校 / 一个机房一套服务」。
 * 300 个学生从同一个出口 IP 出去 —— 机房在 NAT 后面，
 * 对服务端而言 req.ip 全是同一个值。
 *
 * 按 IP 计数的限流在这种拓扑下等于「给全班发一张配额卡」：
 *   · 判题 40 次/分钟 ÷ 300 人 = 每人每 7 分钟才能提交一次
 *   · 登录 12 次/10 分钟 = 第 13 个学生就登不进来
 *   · 全局 300 次/分钟 = 一次页面加载（8~10 个请求）就吃掉 3%
 * 这不是「限流偏严」，是「功能不可用」—— 而且是**上线第一天就会发生**的那种。
 *
 * ── 做法 ────────────────────────────────────────────────────────
 * 键按「谁」取，而不是按「从哪来」：
 *
 *   已登录  → 会话 token 的 sha256 前 16 位。一个学生一份配额，互不干扰。
 *             不查库：token 本身就是唯一标识，哈希一次的成本可忽略。
 *   未登录  → IP。登录页 / 注册页这类匿名流量仍按来源计。
 *
 * 该拦的一样拦得住：
 *   · 单账号爆破 → 登录接口按「邮箱」计数（12 次/10 分钟）
 *   · 单 IP 扫号 → 登录接口额外挂一层 IP 桶（见 routes/auth.js）
 *   · 匿名 DoS   → 未登录流量仍按 IP 计
 *
 * 唯一放宽的是「已登录用户伪造 cookie 换桶」。代价可接受：
 * 伪造的 cookie 过不了鉴权，拿不到任何数据；而且每个伪造桶各自计数，
 * 想靠换桶刷量需要真发那么多请求，仍受底层 IP 桶约束。
 *
 * ── 为什么 per-route 不用逐个改 ─────────────────────────────────
 * @fastify/rate-limit 的 onRoute 会把 `config.rateLimit` 与全局配置 merge
 * （见 node_modules/@fastify/rate-limit/index.js:176）。
 * 所以路由只写 max / timeWindow 时，keyGenerator 自动继承这里这一份 ——
 * 14 处限流配置一次性从「按 IP」变成「按人」。
 */
import crypto from 'node:crypto';
import { COOKIE_NAME } from './session.js';

/* 压测 / 回归测试用的倍率。默认 1 —— 生产行为不变。
 *
 * 为什么需要它：浏览器冒烟测试一次加载 30+ 个页面，
 * 压测要打 300 并发。没有这个口子就只能去改源码，改完还得记得改回来。
 * 设 KUKE_RL_SCALE=1000 等价于「解除限流」，用于测架构本身的容量。 */
const SCALE = (() => {
  const raw = Number(process.env.KUKE_RL_SCALE);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

/** 构造一条限流配置。max 会被 KUKE_RL_SCALE 放大。 */
export function rl(max, timeWindow) {
  return { max: Math.max(1, Math.round(max * SCALE)), timeWindow };
}

export const rateLimitScale = SCALE;

/** 会话 token → 短哈希。只用于分桶，不用于鉴权。 */
function tokenKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

/**
 * 默认分桶：已登录按人，未登录按 IP。
 *
 * 注意这个函数在 onRequest 阶段执行 —— 那时 body 还没解析，
 * 所以只能依赖 cookie 和 ip，**不能读 req.body**。
 * 需要按请求体分桶的（登录按邮箱）必须把 hook 改成 preHandler，
 * 见 routes/auth.js 的登录路由。
 */
export function userOrIpKey(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) return `u:${tokenKey(token)}`;
  return `ip:${req.ip}`;
}

/** 纯 IP 桶。用于「同一出口不能刷」这类场景。 */
export const ipKey = (req) => `ip:${req.ip}`;

/** 按邮箱分桶。**只在 hook: 'preHandler' 下可用**（那时 body 已解析）。 */
export function emailKey(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return `anon:${req.ip}`;
  return `acct:${email}`;
}
