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
import { useCountUp } from '@/lib/hooks';

/* ============ 按钮 ============ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'accent' | 'ghost' | 'outline' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
};

export function Button({
  variant = 'ghost', size = 'md', loading, className, children, disabled, ...rest
}: ButtonProps) {
  /* ★ 圆角从 8px 收到 6px；主按钮不再带投影和光晕。
   *   `shadow-lg shadow-cyan/20` 是"发光按钮"的来源 —— 一屏三个发光按钮
   *   等于三个都在喊"看我"。见 styles/index.css 的 .btn-accent 注释。 */
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all disabled:opacity-45 disabled:cursor-not-allowed select-none';
  const sizes = {
    sm: 'h-7 px-2.5 text-[12.5px]',
    md: 'h-9 px-3.5 text-[13.5px]',
    lg: 'h-11 px-5 text-[15px]',
    icon: 'h-9 w-9',
  };
  const variants = {
    accent: 'btn-accent',
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
  className, children, padded = true, strong, hover, grad, noise, style,
}: {
  className?: string;
  children: ReactNode;
  padded?: boolean;
  strong?: boolean;
  /** 可点击的卡片：悬停时描边变亮 + 1px 抬升 */
  hover?: boolean;
  /** 需要被强调的那一张（首屏主卡、当前选中项）。
   *  ★ 现在渲染成「实色面 + 强调色左边框」—— 原来是渐变描边 + 玻璃面。
   *    渐变描边在说"看我"，却没说"我为什么重要"，一屏出现两张就互相抵消。 */
  grad?: boolean;
  /** @deprecated 噪点叠层已全局关闭（实色面不需要它压色带）。保留参数避免改动 63 处调用。 */
  noise?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        /* ★ 从 `glass`（半透明 + blur + 四层叠加）改成 `panel`（实色 + 1px 边框）。
         *   理由见 styles/index.css 里「组件层」那一段的长注释：
         *   每张卡都浮着 = 没有卡浮着。 */
        grad ? 'card-grad' : 'panel',
        /* 圆角从 12px 收到 8px。大圆角是"消费级 App"的语言，
         * 数据密集的工具界面用 6–8px：同样的面积里能多放一行信息。 */
        'rounded-lg',
        strong && !grad && 'border-hairline-strong',
        hover && 'card-hover',
        noise && 'noise',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title, desc, right, icon, accent,
}: {
  title: string; desc?: string; right?: ReactNode;
  /**
   * 章节图标。
   * ★ 颜色**会被忽略**，一律按弱化色渲染。
   *
   * 原来每个卡片标题前都挂一个不同颜色的图标（外观=青、学习偏好=紫、
   * 账号=蓝……），这是"模板批量生成"最明显的信号之一：
   * 颜色在真实产品里是有语义的（危险=红、成功=绿、当前项=强调色），
   * 拿它给纯装饰分类，等于把语义稀释掉。
   *
   * 所以图标留着（它确实帮助扫读），颜色收掉。
   * 调用处那些 `className="text-cyan"` 不用改 —— 这里用
   * `[&>svg]:text-fg-faint` 覆盖（选择器权重更高），
   * 免得为了改一个颜色去动 63 处调用点。
   */
  icon?: ReactNode;
  /** 给标题加一道强调色竖条。用在页面的主要区块上，和次级区块区分开 */
  accent?: boolean;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 gap-2.5">
        {accent && (
          <span
            className="mt-[3px] h-[18px] w-[3px] shrink-0 rounded-full"
            style={{ background: 'var(--color-cyan)' }}
          />
        )}
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            {icon && (
              <span className="shrink-0 [&>svg]:text-fg-faint" aria-hidden="true">{icon}</span>
            )}
            {title}
          </h2>
          {desc && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-mute">{desc}</p>}
        </div>
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

/** 难度点。用点的个数 **加颜色梯度** 双重编码。
 *
 * 原来只有个数、而且亮起的点一律是青色。5 个点里数出「亮了 3 个」
 * 需要停顿一下 —— 而列表页扫视时最缺的就是停顿。
 * 加上颜色分档之后，绿/黄/红一眼就能分出难易，不用数。 */
export function DifficultyDots({ value, max = 5 }: { value: number; max?: number }) {
  const ratio = max > 0 ? value / max : 0;
  const fill = ratio <= 0.4 ? 'bg-ok' : ratio <= 0.7 ? 'bg-warn' : 'bg-bad';
  const label = ratio <= 0.4 ? '入门' : ratio <= 0.7 ? '进阶' : '挑战';

  return (
    <span className="inline-flex items-center gap-0.5" title={`难度 ${value}/${max}（${label}）`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn('h-1.5 w-1.5 rounded-full', i < value ? fill : 'bg-veil/15')}
        />
      ))}
    </span>
  );
}

/* ============ 进度 ============ */

export function Progress({
  value, className, tone = 'accent', showLabel, flowing,
}: {
  value: number;
  className?: string;
  tone?: 'accent' | 'ok' | 'warn' | 'bad';
  showLabel?: boolean;
  /** 进行中：加一层流光。**完成态不要开** ——
   *  完成了还在流动会让人以为还没结束。 */
  flowing?: boolean;
}) {
  const v = Math.max(0, Math.min(1, value));
  const grad = {
    accent: 'linear-gradient(90deg, var(--color-cyan), var(--color-blue))',
    ok: 'linear-gradient(90deg, var(--color-emerald), var(--color-cyan))',
    warn: 'linear-gradient(90deg, var(--color-amber), var(--color-rose))',
    bad: 'var(--grad-bad)',
  }[tone];

  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-veil/10">
        <span
          className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-700"
          style={{ width: `${v * 100}%`, backgroundImage: grad, transitionTimingFunction: 'var(--ease-out-expo)' }}
        >
          {flowing && v < 1 && <span className="flow absolute inset-0" />}
        </span>
      </span>
      {showLabel && (
        <span className="w-9 text-right text-[11px] tabular-nums text-fg-mute">
          {Math.round(v * 100)}%
        </span>
      )}
    </span>
  );
}

/* ============ 统计卡片 ============ */

export function Stat({
  label, value, sub, tone, icon, grad, sparkline, trend,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: 'ok' | 'bad' | 'warn' | 'accent';
  icon?: ReactNode;
  /** 数值用渐变文字。用在首屏最重要的那一两个数字上 */
  grad?: boolean;
  /** 右下角的迷你趋势线（0..1 的数组） */
  sparkline?: number[];
  /** 环比变化百分比。正数向上、负数向下，0 或不传则不显示。 */
  trend?: number;
}) {
  const toneColor = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad'
    : tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-cyan' : 'text-fg';

  return (
    <div className="panel card-hover relative overflow-hidden rounded-lg p-3.5">
      {/* ★ 这里原本是 `uppercase tracking-wide`。
       *
       * 那是英文界面的写法：小号大写 + 加字距，用来把标签和正文区分开。
       * 但这两个属性**都是为拉丁字母设计的**：
       *   · uppercase 对汉字完全无效（不是错，是白写）
       *   · letter-spacing 会把汉字一个个撑开，看起来像「坏掉的间距」，
       *     而不是强调 —— 汉字是方块字，字距一加就散架
       *
       * 中文的层次靠**字重 + 颜色**，不靠字距。
       * 顺带把字号从 11.5 提到 12：汉字在小字号下比英文难认得多，
       * 同一个视觉尺寸，中文需要多半级才等价。 */}
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg-mute">
        {icon}
        {label}
      </div>
      <div className={cn(
        'mt-1.5 flex items-baseline gap-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight',
        grad ? 'grad-text' : toneColor,
      )}>
        {value}
        {/* 趋势指示。企业级仪表盘的标配 —— 光有一个数字，
            看不出「这周比上周好还是差」。 */}
        {typeof trend === 'number' && trend !== 0 && (
          <span className={cn(
            'flex items-center gap-0.5 text-[11.5px] font-medium',
            trend > 0 ? 'text-ok' : 'text-bad',
          )}>
            <span aria-hidden="true">{trend > 0 ? '↑' : '↓'}</span>
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] leading-relaxed text-fg-faint">{sub}</div>}
      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} className="mt-2" />
      )}
    </div>
  );
}

/** 迷你趋势线。纯 SVG，不引图表库 —— 十几个点的折线用不上 recharts。 */
export function Sparkline({
  data, className, height = 22,
}: { data: number[]; className?: string; height?: number }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const W = 100;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = `spark-${data.length}-${Math.round(max)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(' ')} ${W},${height}`} fill={`url(#${id})`} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="var(--color-cyan)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** 会滚动的大数字。用在小屏也要看清的关键指标上。 */
export function CountUp({
  value, suffix = '', decimals = 0, grad,
}: { value: number; suffix?: string; decimals?: number; grad?: boolean }) {
  const v = useCountUp(value);
  return (
    <span className={cn('tabular-nums', grad && 'grad-text')}>
      {v.toFixed(decimals)}
      {suffix}
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

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} />;
}

/** 卡片网格骨架。用于「一组卡片」的加载态：班级列表、成就墙、关卡分组。
 *  比一整块灰好的地方在于它保留了网格的节奏，内容到位时不会跳。 */
export function CardGridSkeleton({
  count = 6, cols = 3, height = 96,
}: { count?: number; cols?: number; height?: number }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', cols >= 3 && 'lg:grid-cols-3')}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="rounded-xl" style={{ height }} />
      ))}
    </div>
  );
}

/** 图表骨架。统计页专用。
 *  光秃秃一块灰说明不了「这里要出图」；配上高低不一的柱子和一条基线，
 *  用户立刻知道等来的是图表 —— 而且不会把它误认成列表。 */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="panel rounded-lg p-4">
      <Skeleton className="h-3 w-28" />
      <div className="mt-5 flex items-end gap-2" style={{ height }}>
        {[42, 68, 33, 82, 52, 74, 38].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
      <Skeleton className="mt-3 h-px w-full" />
    </div>
  );
}

/** 详情页骨架。左栏正文 + 右栏信息卡，对应大多数「点进来看看」的页面。 */
export function DetailSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <Skeleton className="h-9 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}

/** 分栏页骨架。左边窄栏（表结构 / 题目列表）+ 右边主区（编辑器 / 结果）。
 *
 *  SQL 实训场、关卡详情、实验台都是这个形状 ——
 *  它们的布局和「表格」「卡片网格」都不一样，套用别的骨架反而更假：
 *  用户看到一个表格骨架，结果出来的是编辑器，会有一种「加载错了」的错觉。 */
export function SplitSkeleton({ mainHeight = 320 }: { mainHeight?: number }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr] lg:gap-4">
      {/* 左栏：几个小卡片（表结构那种） */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      {/* 右栏：工具条 + 主编辑区 + 结果区 */}
      <div className="space-y-2.5">
        <Skeleton className="h-11 rounded-lg" />
        <Skeleton className="rounded-lg" style={{ height: mainHeight }} />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    </div>
  );
}

/** 表格骨架屏。
 *
 * 加载态直接丢一个 `<Skeleton className="h-64" />` 是常见的偷懒做法 ——
 * 它只说明「这里在加载」，没说明「这里将出现什么」。用户看到一大块灰，
 * 不知道等来的是表格、图表还是一段文字。
 *
 * 按真实表格的形状铺骨架有两个好处：
 *   1. 内容到位时布局不跳（占位块的尺寸和真表头一致）
 *   2. 用户一眼知道这是列表页，能提前预期
 *
 * 列宽故意做成不等宽 —— 等宽的骨架看起来像进度条，不像表格。 */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  /* 第一列宽（通常是名字/标题）、中间列窄、最后一列是操作按钮 */
  const widthOf = (i: number) => {
    if (i === 0) return '26%';
    if (i === cols - 1) return '12%';
    return `${Math.round(52 / Math.max(1, cols - 2))}%`;
  };

  return (
    <div className="panel overflow-hidden rounded-lg">
      <div className="flex items-center gap-4 border-b border-hairline bg-veil/5 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-2.5" style={{ width: widthOf(i) }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-hairline px-4 py-3.5 last:border-b-0">
          {Array.from({ length: cols }, (_, i) => (
            <Skeleton
              key={i}
              className="h-3"
              /* 每行宽度略有差异，模拟真实数据的参差 */
              style={{ width: widthOf(i), opacity: 1 - r * 0.11 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Empty({
  title, desc, action, icon,
}: { title: string; desc?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
      {/* ★ 2026-10-01：去掉了图标背后那圈"渐变光晕"（blur-md 的
       *   grad-spectrum 色斑）和 16px 圆角，改成实色小方块。
       *
       *   空态是"什么都没有"的页面，原来却在这里放全站最亮的一团光 ——
       *   一个发光图标 + 一句说明，是"AI 生成的空态组件"的标准长相。
       *   空态真正需要的是**一个出口**（下面那个 action 按钮），
       *   而不是一个视觉落点。 */}
      <div className="grid h-11 w-11 place-items-center rounded-lg border border-hairline bg-veil/4 text-fg-faint">
        {icon || <Info size={18} />}
      </div>
      <div className="mt-1 text-[14px] font-medium text-fg-soft">{title}</div>
      {desc && <div className="max-w-md text-[12.5px] leading-relaxed text-fg-mute">{desc}</div>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

/** 键位提示。比一行说明文字更容易被记住，也更省空间。 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-hairline bg-veil/6 px-1 font-mono text-[10.5px] text-fg-mute">
      {children}
    </kbd>
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
