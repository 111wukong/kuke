/* 登录失败计数
 *
 * ── 为什么不直接用 @fastify/rate-limit 的桶 ──────────────────────
 * 它按「请求」计数，而登录请求分两种，语义完全相反：
 *
 *   机房 300 个学生登录  = 300 次**成功**的请求 → 应该全部放行
 *   有人在扫号          = 大量**失败**的请求   → 应该尽快拦住
 *
 * 按请求计数会把前者一起拦掉：IP 桶 12 次/10 分钟时，
 * 第 13 个学生就登不进来 —— 这不是「限流偏严」，是功能不可用。
 * 而如果为了放行学生把 IP 桶放宽到 600，扫号防护又形同虚设。
 *
 * 按**失败**计数两个目标同时成立：
 *   · 正常的登录不计入任何桶，机房来多少人都不受影响
 *   · 异常尝试快速累积，12 次就锁死那个账号
 *
 * ── 两个桶，作用不同 ────────────────────────────────────────────
 *   邮箱桶（12 次失败 / 10 分钟）—— 防「盯着一个账号试密码」
 *     ★ 登录成功后**清零**：本人输错几次再输对，不该留下案底。
 *   IP 桶（30 次失败 / 10 分钟）—— 防「一个出口横扫一堆账号」
 *     ★ 登录成功**不清零**：这个 IP 上有人成功，不代表它清白 ——
 *       机房 NAT 后面几百号人共用一个出口，一个人成功登录
 *       不能给整台机器上的攻击者开绿灯。
 *
 * ── 为什么是内存而不是库表 ──────────────────────────────────────
 * 计数的生命周期只有 10 分钟，丢了最多让攻击者多试几次；
 * 而每次登录失败都写一次库，等于给攻击者提供了一个廉价的写放大通道。
 * 代价是重启后计数清零 —— 可以接受（重启本身就不是攻击者能触发的）。
 * 真要跨实例共享，把 Map 换成 Redis 即可，接口不用动。
 */

const WINDOW_MS = 10 * 60 * 1000;   // 10 分钟
const EMAIL_MAX = 12;               // 单账号允许的连续失败次数
const IP_MAX = 30;                  // 单 IP 允许的失败次数（见文件头：不清零）

/** key -> { n, resetAt } */
const fails = new Map();

function bump(key, now) {
  const cur = fails.get(key);
  if (!cur || cur.resetAt <= now) {
    fails.set(key, { n: 1, resetAt: now + WINDOW_MS });
    return;
  }
  cur.n++;
}

function count(key, now) {
  const cur = fails.get(key);
  if (!cur) return 0;
  if (cur.resetAt <= now) {
    fails.delete(key);
    return 0;
  }
  return cur.n;
}

const emailKeyOf = (email) => `e:${String(email || '').trim().toLowerCase()}`;
const ipKeyOf = (ip) => `i:${ip}`;

/**
 * 这个登录请求还能不能试。
 * 返回 null 表示放行；否则返回 { scope, retryAfterSec, left }。
 *
 * 放在业务逻辑之前调用 —— 别等 scrypt 算完了才发现该拦，
 * 那等于把 CPU 送给了攻击者。
 */
export function loginGuardCheck({ email, ip }) {
  const now = Date.now();

  const en = count(emailKeyOf(email), now);
  if (en >= EMAIL_MAX) {
    const { resetAt } = fails.get(emailKeyOf(email));
    return { scope: 'account', retryAfterSec: Math.ceil((resetAt - now) / 1000), limit: EMAIL_MAX };
  }

  const inn = count(ipKeyOf(ip), now);
  if (inn >= IP_MAX) {
    const { resetAt } = fails.get(ipKeyOf(ip));
    return { scope: 'ip', retryAfterSec: Math.ceil((resetAt - now) / 1000), limit: IP_MAX };
  }

  return null;
}

/** 记一次登录失败。邮箱和 IP 两个桶都记。 */
export function loginGuardFail({ email, ip }) {
  const now = Date.now();
  bump(emailKeyOf(email), now);
  bump(ipKeyOf(ip), now);
}

/** 登录成功 —— 只清邮箱桶。理由见文件头。 */
export function loginGuardSuccess({ email }) {
  fails.delete(emailKeyOf(email));
}

/** 给管理台/健康检查看的快照。 */
export function loginGuardStats() {
  const now = Date.now();
  let active = 0;
  for (const [, v] of fails) if (v.resetAt > now) active++;
  return { tracked: active, emailMax: EMAIL_MAX, ipMax: IP_MAX, windowMs: WINDOW_MS };
}

/** 测试用：清空全部计数。 */
export function loginGuardReset() {
  fails.clear();
}

/* 定期清理过期条目。
 * 没有这个，一个被扫过的服务会永久持有几万个 key —— 每个只有几十字节，
 * 但这是纯粹的泄漏，没有任何理由留着。 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k);
}, 60_000);
sweeper.unref();

export { EMAIL_MAX, IP_MAX, WINDOW_MS };
