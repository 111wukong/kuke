/* 消息提示 + 主题选择器 + 热力图
 *
 * 三个小组件放一起，因为它们都很短，而且都是"到处都在用"的东西。
 */
import { CheckCircle2, AlertTriangle, XCircle, Info, X, Palette } from 'lucide-react';
import { useApp, type ToastKind } from '@/stores/app';
import { useTheme } from '@/stores/theme';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { useState } from 'react';

/* ============ 提示 ============ */

const ICONS: Record<ToastKind, any> = {
  ok: CheckCircle2, warn: AlertTriangle, error: XCircle, info: Info,
};
const TONE: Record<ToastKind, string> = {
  ok: 'border-ok/40 text-ok',
  warn: 'border-warn/40 text-warn',
  error: 'border-bad/40 text-bad',
  info: 'border-blue/40 text-blue',
};

export function Toaster() {
  const { toasts, dismiss, pauseToast, resumeToast } = useApp();
  if (!toasts.length) return null;

  return (
    /* 位置：右下。放顶部会和顶栏挤在一起，
     * 放底部中间会挡住 SQL 编辑器的结果表。
     *
     * ★ aria-live：提示是"异步冒出来"的内容，屏幕阅读器默认不会播报。
     *   加在容器上而不是每条上 —— 每条都加的话，一屏三条会连播三次。 */
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(92vw,380px)] flex-col gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            /* ★ 鼠标移上去暂停倒计时。用户把指针停在提示上，说明他正在读
             *   —— 这时候让它照常消失，等于把用户要看的字抽走了。
             *   移开再从暂停处接着走，不重新计时（否则反复扫过会无限续命）。 */
            onMouseEnter={() => pauseToast(t.id)}
            onMouseLeave={() => resumeToast(t.id)}
            className={cn(
              'glass glass-strong rise-in pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3',
              TONE[t.kind],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-fg">{t.text}</div>
              {t.detail && (
                /* 详情用等宽 + 保留换行：判题反馈里有"少了哪几行"这种
                 * 按行对齐的内容，用普通字体和空白折叠会全糊成一段。 */
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg-soft">
                  {t.detail}
                </pre>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-fg-faint hover:text-fg"
              aria-label="关闭提示"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ============ 主题选择器 ============ */

export function ThemePicker({ compact }: { compact?: boolean }) {
  const { id, set } = useTheme();
  const [open, setOpen] = useState(false);

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12.5px] text-fg-soft hover:bg-veil/6"
        >
          <Palette size={14} />
          主题
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="glass glass-strong absolute right-0 top-9 z-50 max-h-[70vh] w-[300px] overflow-y-auto rounded-xl p-2.5">
              <ThemeGrid value={id} onChange={(v) => { set(v); setOpen(false); }} />
            </div>
          </>
        )}
      </div>
    );
  }

  return <ThemeGrid value={id} onChange={set} />;
}

function ThemeGrid({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const dark = THEMES.filter((t) => t.mode === 'dark');
  const light = THEMES.filter((t) => t.mode === 'light');

  const Group = ({ title, list }: { title: string; list: typeof THEMES }) => (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1.5 px-0.5 text-[12px] font-semibold text-fg-faint">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {list.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              title={t.desc}
              className={cn(
                'flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors',
                active
                  ? 'border-cyan/50 bg-cyan/10'
                  : 'border-hairline hover:border-hairline-strong hover:bg-veil/6',
              )}
            >
              {/* 缩略图色板。手抄的，不跟 CSS 联动 —— 见 lib/themes.ts 的说明。 */}
              <span className="flex shrink-0 overflow-hidden rounded border border-hairline">
                {t.preview.map((c, i) => (
                  <span key={i} style={{ background: c, width: 6, height: 22 }} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                {/* ★ 名字用它**自己的字体**画。
                 *  古风主题在这里就显示楷体，不用套上去才发现。
                 *  fontFamily 走 CSS 变量而不是硬编码家族名 ——
                 *  这样字体栈只有 index.css 一个来源，将来换字体
                 *  （比如自托管的霞鹜文楷换成别的）这里不用跟着改。 */}
                <span
                  className="block truncate text-[12px] font-medium text-fg"
                  style={{ fontFamily: t.font === 'kai' ? 'var(--font-kai)' : undefined }}
                >
                  {t.name}
                </span>
                <span className="block text-[12px] text-fg-faint">
                  {t.mode === 'dark' ? '暗' : '亮'}
                  {t.font === 'kai' && ' · 楷'}
                  {t.fx && ' · 动'}
                  {t.layout === 'console' && ' · 后台'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <Group title="暗色" list={dark} />
      <Group title="亮色" list={light} />
      <p className="mt-1.5 px-0.5 text-[12px] leading-relaxed text-fg-faint">
        主题跟着账号走，换台电脑也是同一套。
      </p>
    </div>
  );
}

/* ============ 热力图 ============ */

/** 28 天活动热力图。
 *
 * ── 用 4 档而不是连续渐变 ──────────────────────────────────────
 * 连续渐变的色差在暗色主题下几乎看不出来，而且读者没法从颜色
 * 反推出数字。4 档能一眼分辨"这天做了不少"和"这天做了一点"。
 */
export function Heatmap({
  data, weeks = 4,
}: { data: { date: string; n: number; c: number }[]; weeks?: number }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const level = (n: number) => {
    if (!n) return 0;
    const r = n / max;
    if (r <= 0.25) return 1;
    if (r <= 0.5) return 2;
    if (r <= 0.75) return 3;
    return 4;
  };
  const COLORS = [
    'var(--color-veil)',
    'color-mix(in srgb, var(--color-cyan) 25%, transparent)',
    'color-mix(in srgb, var(--color-cyan) 45%, transparent)',
    'color-mix(in srgb, var(--color-cyan) 68%, transparent)',
    'var(--color-cyan)',
  ];

  const cells = data.slice(-weeks * 7);
  // 首列前面补空位，让每一列对应一周（周日到周六）
  const pad = cells.length ? new Date(`${cells[0].date}T00:00:00`).getDay() : 0;
  const grid: (typeof cells[number] | null)[] = [...Array(pad).fill(null), ...cells];

  return (
    <div>
      <div className="flex gap-1">
        {Array.from({ length: Math.ceil(grid.length / 7) }, (_, w) => (
          <div key={w} className="flex flex-col gap-1">
            {Array.from({ length: 7 }, (_, d) => {
              const cell = grid[w * 7 + d];
              if (!cell) return <span key={d} className="h-3 w-3" />;
              return (
                <span
                  key={d}
                  title={`${cell.date}：${cell.n} 题`}
                  className="h-3 w-3 rounded-[3px] border border-hairline"
                  style={{ background: COLORS[level(cell.n)] }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-fg-faint">
        <span>少</span>
        {COLORS.map((c, i) => (
          <span key={i} className="h-2.5 w-2.5 rounded-[3px] border border-hairline" style={{ background: c }} />
        ))}
        <span>多</span>
        <span className="ml-auto">最近 {weeks} 周</span>
      </div>
    </div>
  );
}
