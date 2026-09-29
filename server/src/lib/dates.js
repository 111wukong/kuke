/* 本地日期工具
 *
 * ── 为什么日期不能直接用 new Date().toISOString().slice(0,10) ──────
 * 那是 **UTC 日期**。北京时间 2026-10-01 早上 07:00 时，UTC 还是 09-30，
 * 于是「今天做的题」会被记到昨天头上：连续打卡断掉、每日目标重置、
 * 教师看的日报少一天。这个 bug 只在 00:00–08:00 之间出现，
 * 而凌晨恰好是这个用户（夜猫子）的主力时段。
 *
 * 所以全站统一：业务口径的「今天」= 服务器本地时区的 YYYY-MM-DD。
 * 审计用 epoch ms，两者并存、互不推导。
 */

/** 本地时区的 YYYY-MM-DD */
export function todayLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 把 'YYYY-MM-DD' 按**本地时区**解析成 Date（不经过 UTC）。 */
export function parseLocalDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(dateStr, n) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return todayLocal(d);
}

export function diffDays(a, b) {
  const ms = parseLocalDate(a).getTime() - parseLocalDate(b).getTime();
  return Math.round(ms / 86400000);
}

/** 最近 n 天的日期数组（含今天），升序。看板热力图用。 */
export function lastDays(n, endStr = todayLocal()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(endStr, -i));
  return out;
}

export const nowIso = () => new Date().toISOString();
export const nowMs = () => Date.now();
