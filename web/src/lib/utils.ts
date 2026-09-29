/* 小工具 */

/** 类名拼接。clsx 的 30 行版本。 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 读一个 CSS 变量在当前主题下的值。
 *  canvas / SVG 里画东西时必须用它 —— 那里的颜色不能走 CSS 变量，
 *  必须拿到真实值。这也是「canvas 上的东西 DOM 断言看不见」那个坑的来源。 */
export function cssVar(name: string, fallback = '#888'): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function formatDate(ts: number | string | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y === now.getFullYear() ? `${m}-${day}` : `${y}-${m}-${day}`;
}

export function formatDateTime(ts: number | string | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** 把 0..1 的掌握度映射到颜色。
 *  ★ 用「涨红跌绿」以外的语义色：这里是掌握度不是涨跌，
 *  所以用 红(差) → 黄(中) → 绿(好) 的直觉顺序，
 *  而不是股市配色。 */
export function masteryColor(m: number): string {
  if (m >= 0.85) return 'var(--color-ok)';
  if (m >= 0.7) return 'var(--color-emerald)';
  if (m >= 0.5) return 'var(--color-warn)';
  if (m >= 0.3) return 'var(--color-amber)';
  return 'var(--color-bad)';
}

export function masteryLabel(m: number): string {
  if (m >= 0.85) return '熟练';
  if (m >= 0.7) return '掌握';
  if (m >= 0.5) return '半熟';
  if (m >= 0.3) return '薄弱';
  return '未掌握';
}

/** 头像渐变色：从 hue 生成一对同色系颜色。 */
export function avatarStyle(hue: number) {
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 66% 44%))`,
  };
}

/** 简易防抖。搜索框用。 */
export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** 复制到剪贴板。失败时返回 false 而不是抛错 ——
 *  剪贴板在非 HTTPS 下会被浏览器拒绝，这不是致命错误。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
