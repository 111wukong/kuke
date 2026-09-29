/* UI 原语
 *
 * ── 为什么集中在一个文件 ────────────────────────────────────────
 * 这些小东西（按钮、卡片、输入框）单独一个文件一个组件的话，
 * 目录会有二十个文件，而它们的实现加起来不到 300 行。
 * 放一起还能强制统一视觉：想改按钮的圆角，改一处。
 *
 * ── 纪律：颜色一律走令牌，不写死 ────────────────────────────────
 * 这个文件里不该出现 # 开头的颜色。写了的话，切到亮色主题就会坏 ——
 * 而且是"看着能跑但其实读不出来"的那种坏。
 */
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Info, XCircle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============ 按钮 ============ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'accent' | 'ghost' | 'outline' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
};

export function Button({
  variant = 'ghost', size = 'md', loading, className, children, disabled, ...rest
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:opacity-45 disabled:cursor-not-allowed select-none';
  const sizes = {
    sm: 'h-7 px-2.5 text-[12.5px]',
    md: 'h-9 px-3.5 text-[13.5px]',
    lg: 'h-11 px-5 text-[15px]',
    icon: 'h-9 w-9',
  };
  const variants = {
    accent: 'btn-accent shadow-lg shadow-cyan/20',
    ghost: 'text-fg-soft hover:text-fg hover:bg-veil/6 border border-transparent',
    outline: 'border border-hairline-strong text-fg-soft hover:text-fg hover:bg-veil/6',
    subtle: 'bg-veil/6 text-fg-soft hover:text-fg hover:bg-veil/10 border border-hairline',
    danger: 'border border-bad/40 text-bad hover:bg-bad/10',
  };
  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ============ 卡片 / 面板 ============ */

export function Card({
  className, children, padded = true, strong,
}: { className?: string; children: ReactNode; padded?: boolean; strong?: boolean }) {
  return (
    <div className={cn('glass rounded-xl', strong && 'glass-strong', padded && 'p-4 sm:p-5', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  title, desc, right, icon,
}: { title: string; desc?: string; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          {icon}
          {title}
        </h2>
        {desc && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-mute">{desc}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* ============ 表单控件 ============ */

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        /* ★ 输入框在暗色主题下要"凹陷"：底色比面板**暗**一点，
         * 而不是亮一点。用 bg-veil 的话暗色下会变亮，看起来像浮起来的按钮。
         * 所以这里用 bg-ink-1000/40 —— 它比面板底更暗。 */
        'h-9 w-full rounded-lg border border-hairline bg-ink-1000/40 px-3 text-[13.5px] text-fg',
        'placeholder:text-fg-faint transition-colors',
        'focus:border-cyan/50 focus:outline-none focus:ring-2 focus:ring-cyan/20',
        'disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-hairline bg-ink-1000/40 px-3 py-2 text-[13.5px] text-fg',
        'placeholder:text-fg-faint transition-colors resize-y',
        'focus:border-cyan/50 focus:outline-none focus:ring-2 focus:ring-cyan/20',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-hairline bg-ink-1000/40 px-2.5 text-[13px] text-fg',
        'focus:border-cyan/50 focus:outline-none focus:ring-2 focus:ring-cyan/20',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({
  label, hint, error, children, required,
}: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-medium text-fg-soft">
        {label}
        {required && <span className="text-bad">*</span>}
        {hint && <span className="font-normal text-fg-faint">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-bad">{error}</span>}
    </label>
  );
}

/* ============ 徽章 / 标签 ============ */

type Tone = 'neutral' | 'ok' | 'bad' | 'warn' | 'info' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-veil/8 text-fg-soft border-hairline',
  ok: 'bg-ok-soft text-ok border-ok/30',
  bad: 'bg-bad-soft text-bad border-bad/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  info: 'bg-blue/12 text-blue border-blue/30',
  accent: 'bg-cyan/12 text-cyan border-cyan/30',
};

export function Badge({
  children, tone = 'neutral', className,
}: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight',
      TONES[tone], className,
    )}>
      {children}
    </span>
  );
}

/** 难度点。用点的个数而不是数字 —— 一眼扫过去就能比大小。 */
export function DifficultyDots({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`难度 ${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn('h-1.5 w-1.5 rounded-full', i < value ? 'bg-cyan' : 'bg-veil/15')}
        />
      ))}
    </span>
  );
}

/* ============ 进度 ============ */

export function Progress({
  value, className, tone = 'accent', showLabel,
}: { value: number; className?: string; tone?: 'accent' | 'ok' | 'warn' | 'bad'; showLabel?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  const color = {
    accent: 'bg-gradient-to-r from-cyan to-blue',
    ok: 'bg-ok',
    warn: 'bg-warn',
    bad: 'bg-bad',
  }[tone];
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-veil/10">
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', color)}
          style={{ width: `${v * 100}%` }}
        />
      </span>
      {showLabel && <span className="w-9 text-right text-[11px] tabular-nums text-fg-mute">{Math.round(v * 100)}%</span>}
    </span>
  );
}

/* ============ 状态块 ============ */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-fg-mute">
      <Loader2 size={18} className="animate-spin" />
      {label && <span className="text-[13px]">{label}</span>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function Empty({
  title, desc, action, icon,
}: { title: string; desc?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="text-fg-faint">{icon || <Info size={26} />}</div>
      <div className="text-[14px] font-medium text-fg-soft">{title}</div>
      {desc && <div className="max-w-md text-[12.5px] leading-relaxed text-fg-mute">{desc}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: any; onRetry?: () => void }) {
  const msg = error?.message || String(error || '未知错误');
  return (
    <div className="rounded-lg border border-bad/30 bg-bad-soft p-3.5">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-bad">出错了</div>
          <div className="mt-0.5 break-words text-[12.5px] text-fg-soft">{msg}</div>
          {error?.detail && (
            <div className="mt-1 break-words font-mono text-[11.5px] text-fg-mute">{String(error.detail)}</div>
          )}
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>重试</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ 统计卡片 ============ */

export function Stat({
  label, value, sub, tone, icon,
}: { label: string; value: ReactNode; sub?: string; tone?: 'ok' | 'bad' | 'warn' | 'accent'; icon?: ReactNode }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad'
    : tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-cyan' : 'text-fg';
  return (
    <div className="glass rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-fg-mute">
        {icon}
        {label}
      </div>
      <div className={cn('mt-1 text-[24px] font-semibold leading-none tabular-nums', color)}>{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-fg-faint">{sub}</div>}
    </div>
  );
}

/* ============ 标签页 ============ */

export function Tabs<T extends string>({
  tabs, value, onChange, className,
}: {
  tabs: { key: T; label: string; count?: number; icon?: ReactNode }[];
  value: T;
  onChange: (k: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1 rounded-lg border border-hairline bg-ink-1000/30 p-1', className)}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-cyan/15 text-cyan shadow-sm'
                : 'text-fg-mute hover:bg-veil/6 hover:text-fg-soft',
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className={cn(
                'rounded px-1 text-[10.5px] tabular-nums',
                active ? 'bg-cyan/20' : 'bg-veil/10',
              )}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============ 列表行 ============ */

export function ListRow({
  title, desc, right, left, onClick, className, tone,
}: {
  title: ReactNode; desc?: ReactNode; right?: ReactNode; left?: ReactNode;
  onClick?: () => void; className?: string; tone?: 'ok' | 'bad' | 'warn';
}) {
  const Comp: any = onClick ? 'button' : 'div';
  const border = tone === 'ok' ? 'border-l-2 border-l-ok' : tone === 'bad' ? 'border-l-2 border-l-bad'
    : tone === 'warn' ? 'border-l-2 border-l-warn' : '';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-hairline bg-veil/3 px-3.5 py-2.5 text-left transition-colors',
        onClick && 'hover:border-hairline-strong hover:bg-veil/6',
        border,
        className,
      )}
    >
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-fg">{title}</div>
        {desc && <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-fg-mute">{desc}</div>}
      </div>
      {right}
      {onClick && <ChevronRight size={15} className="shrink-0 text-fg-faint" />}
    </Comp>
  );
}

/* ============ 提示条 ============ */

export function Callout({
  tone = 'info', title, children, className,
}: { tone?: 'info' | 'ok' | 'warn' | 'bad'; title?: string; children: ReactNode; className?: string }) {
  const map = {
    info: { c: 'border-blue/30 bg-blue/8 text-blue', Icon: Info },
    ok: { c: 'border-ok/30 bg-ok-soft text-ok', Icon: CheckCircle2 },
    warn: { c: 'border-warn/30 bg-warn-soft text-warn', Icon: AlertTriangle },
    bad: { c: 'border-bad/30 bg-bad-soft text-bad', Icon: XCircle },
  }[tone];
  const { Icon } = map;
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border p-3', map.c, className)}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        <div className={cn(title && 'mt-0.5', 'text-fg-soft')}>{children}</div>
      </div>
    </div>
  );
}
