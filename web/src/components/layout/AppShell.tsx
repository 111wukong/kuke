/* 应用外壳：侧栏 + 顶栏 + 主区
 *
 * ── 侧栏分组的取舍 ──────────────────────────────────────────────
 * 分四组：学习 / 训练 / 我的 / 教学（后者按角色条件渲染）。
 * 分组不是为了好看 —— 是让"侧栏有几项入口"这件事数得清。
 * 十几个入口平铺一列的话，找一个页面要靠扫。
 *
 * ── ★ 前端的角色判断只是"不显示入口"，不是鉴权 ─────────────────
 * 学生手敲 /admin 照样能进页面，页面里的请求会被服务端 403 挡掉。
 * 把前端藏起来当安全措施是最经典的自欺欺人 ——
 * 所以 Admin 页面自己也会在拿到 403 时给出明确提示，而不是白屏。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Network, Terminal, Flag, PenLine, Sigma, FlaskConical,
  CircleAlert, RotateCcw, ChartNoAxesColumn, Trophy, Settings,
  ClipboardList, Users, ShieldCheck, Menu, Flame, Zap, Database, GraduationCap,
} from 'lucide-react';
import { CyberGrid, Starfield } from '@/components/fx/Background';
import { Toaster, ThemePicker } from '@/components/ui/Toaster';
import { KeepAlivePages } from '@/components/layout/KeepAlivePages';
import { APP_PAGES } from '@/routes';
import { AppNavLink } from '@/lib/links';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';
import { useCountUp, useMediaQuery } from '@/lib/hooks';
import { useHotkeys, HotkeyHelp, HotkeyHint } from './Hotkeys';
import { cn, avatarStyle } from '@/lib/utils';

interface NavItem { to: string; icon: any; label: string; badge?: 'due' | 'wrong' }

function navGroups(role: string | undefined): { group: string; items: NavItem[] }[] {
  const groups: { group: string; items: NavItem[] }[] = [
    {
      group: '学习',
      items: [
        { to: '/', icon: LayoutDashboard, label: '仪表盘' },
        { to: '/learn', icon: Network, label: '知识树' },
        { to: '/classroom', icon: GraduationCap, label: 'AI 课堂' },
        { to: '/lab/sql', icon: Terminal, label: 'SQL 实训场' },
        { to: '/levels', icon: Flag, label: 'SQL 闯关' },
        { to: '/practice', icon: PenLine, label: '每日一练' },
        { to: '/normalize', icon: Sigma, label: '范式实验室' },
        { to: '/lab', icon: FlaskConical, label: '索引与事务' },
      ],
    },
    {
      group: '训练',
      items: [
        { to: '/review', icon: RotateCcw, label: '复习队列', badge: 'due' },
        { to: '/mistakes', icon: CircleAlert, label: '错题本', badge: 'wrong' },
      ],
    },
    {
      group: '我的',
      items: [
        { to: '/stats', icon: ChartNoAxesColumn, label: '学习统计' },
        { to: '/achievements', icon: Trophy, label: '成就' },
        { to: '/settings', icon: Settings, label: '设置' },
      ],
    },
  ];

  if (role === 'student' || role === 'teacher' || role === 'admin') {
    groups.splice(2, 0, {
      group: '课程',
      items: [
        { to: '/assignments', icon: ClipboardList, label: '作业' },
        { to: '/classes', icon: Users, label: '班级' },
      ],
    });
  }

  if (isStaffRole(role)) {
    groups.push({
      group: '教学',
      items: [{ to: '/admin', icon: ShieldCheck, label: '教师工作台' }],
    });
  }

  return groups;
}

const isStaffRole = (r?: string) => r === 'teacher' || r === 'admin';

export function AppShell() {
  const { snapshot, refreshSnapshot, navOpen, setNavOpen } = useApp();
  /* 全局快捷键。跳转表在 Hotkeys.tsx —— 用「g 前缀」避免误触，
   * 输入框里一律不响应。 */
  const [hotkeyHelp, openHotkeyHelp, closeHotkeyHelp] = useHotkeys();
  const location = useLocation();
  const { user } = useAuth();
  const { def: theme } = useTheme();
  const mainRef = useRef<HTMLElement>(null);

  const NAV = useMemo(() => navGroups(user?.role), [user?.role]);

  /* 尊重「减少动效」系统设置。
   *
   * 这不是锦上添花 —— 前庭功能敏感的人会因为这些持续运动的背景
   * 感到眩晕。CSS 里已经有 `prefers-reduced-motion` 的兜底
   * （把所有 animation/transition 压到 0.01ms），但那只管 CSS；
   * WebGL 和 Canvas 的 rAF 循环它管不着，必须在这里主动不挂载。
   *
   * 顺带解决一个测试问题：无头浏览器跑 `--virtual-time-budget` 时，
   * 持续运行的 rAF 循环会不断推进虚拟时钟，把预算耗在渲染背景上 ——
   * 于是页面主体还没渲染完，dump 就发生了。
   * 加 `--force-prefers-reduced-motion` 就能让测试走这条分支。 */
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => { refreshSnapshot(); }, [refreshSnapshot]);

  // 切页时关掉移动端抽屉
  useEffect(() => { setNavOpen(false); }, [location.pathname, setNavOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setNavOpen]);

  const dueCount = snapshot?.dueCount ?? 0;
  const wrongCount = snapshot?.wrong ?? 0;

  return (
    <div className="relative flex min-h-dvh">
      {/* 三层背景，从后往前：
       *   CyberGrid(-z-20) 赛博网格地平线 —— 唯一有"地面"的层，负责纵深
       *   CSS 光晕/静态网格   由 body::before / ::after 画，负责色彩与降级
       *   Starfield(-z-10)   星尘 —— 浮在最前，天空里要有星星
       * 顺序不能换：星星在网格后面就变成"地上的星星"了。
       *
       * ★ 这两层只在**暗色主题**挂载（theme.fx）。原因不是性能，是审美：
       *   霓虹赛博网格 + 磷光星尘画在宣纸那种暖白底上，会变成一片灰蒙蒙的
       *   脏点，既不像纸也不像夜。亮色主题改用 CSS 层的淡色光晕 + 细网格。 */}
      {theme.fx && !reduceMotion && <CyberGrid />}
      {theme.fx && !reduceMotion && <Starfield />}

      {/* 移动端遮罩 */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-scrim/70 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* 侧栏 */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-hairline bg-ink-950/95 backdrop-blur-md transition-transform duration-300 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)' }}
      >
        <Brand />

        <div className="flex-1 overflow-y-auto px-2.5 pb-3">
          <nav aria-label="主导航">
            {NAV.map((g) => (
              <div key={g.group} className="mb-3">
                {/* 分组标题。原本是 `uppercase tracking-[0.14em]` ——
                    英文界面用「小号大写 + 加字距」做分组标签，但这两个属性
                    对汉字都没用甚至有害：uppercase 对中文无效，
                    0.14em 的字距会把「学 习」「训 练」撑成散架的样子。
                    中文用字重和颜色做层次；字号从 10.5 提到 11.5，
                    因为汉字在小字号下比拉丁字母难认。 */}
                <div className="px-2.5 pb-1.5 pt-2 text-[11.5px] font-semibold text-fg-faint">
                  {g.group}
                </div>
                {g.items.map((it) => (
                  <NavItemRow
                    key={it.to}
                    {...it}
                    badgeCount={it.badge === 'due' ? dueCount : it.badge === 'wrong' ? wrongCount : 0}
                  />
                ))}
              </div>
            ))}
          </nav>
        </div>

        <SideFooter onShowHotkeys={openHotkeyHelp} />
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setNavOpen(true)} />

        <main
          ref={mainRef}
          id="main-scroll"
          className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-6 lg:px-8 lg:pt-6"
        >
          <div className="mx-auto w-full max-w-[1200px]">
            {/* 页面在这里切换。带保活 —— 切走的页面不卸载，只是藏起来，
                所以本地状态和滚动位置都留着。 */}
            <KeepAlivePages pages={APP_PAGES} container={mainRef} />
          </div>
        </main>
      </div>

      <Toaster />
      <HotkeyHelp open={hotkeyHelp} onClose={closeHotkeyHelp} />
    </div>
  );
}

/* ============ 品牌区 ============ */

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      {/* ★ 2026-10-01：去掉了图标背后那层 blur-[7px] 的渐变光晕，
       *   改成实色方块。
       *
       *   原来那个做法（渐变光斑 + 玻璃方块 + 里面一个图标）是"AI 应用
       *   图标"的标准长相 —— 几乎每个 AI 产品落地页左上角都是这个。
       *   它的问题是：**光晕不携带任何信息**。品牌识别靠的是字形和颜色，
       *   不是发光强度。
       *
       *   现在是一个 32px 的实心强调色方块 + 反白图标 —— 这是从
       *   Linear 到 Stripe 到 GitHub 都在用的做法，因为它清晰、可缩放、
       *   且在亮暗两种主题下都成立。 */}
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-cyan text-on-accent">
        <Database size={17} />
      </span>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-tight tracking-tight text-fg">库课</div>
        <div className="truncate text-[10.5px] text-fg-faint">数据库课程学习平台</div>
      </div>
    </div>
  );
}

/* ============ 导航项 ============ */

function NavItemRow({ to, icon: Icon, label, badgeCount }: NavItem & { badgeCount: number }) {
  return (
    <AppNavLink
      to={to}
      end={to === '/'}
      className={({ isActive }: { isActive: boolean }) => cn(
        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors duration-150',
        isActive
          ? 'nav-active-bar bg-cyan/12 font-medium text-cyan'
          : 'text-fg-soft hover:bg-veil/6 hover:text-fg',
      )}
    >
      {/* ★ 去掉悬停时图标的放大动画（group-hover:scale-[1.08]）——
       *   侧栏有 14 个条目，鼠标扫过时图标逐个弹跳，是很吵的动效。 */}
      <Icon size={16} className="shrink-0" />
      <span className="truncate">{label}</span>
      {badgeCount > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-rose/20 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-rose">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </AppNavLink>
  );
}

/* ============ 侧栏底部：等级进度 ============ */

function SideFooter({ onShowHotkeys }: { onShowHotkeys: () => void }) {
  const { snapshot } = useApp();
  const { user } = useAuth();
  if (!user) return null;

  const lv = snapshot?.level ?? 1;
  const title = snapshot?.levelTitle ?? '初识数据';
  const into = snapshot?.levelInfo?.into ?? 0;
  const need = snapshot?.levelInfo?.need ?? 100;
  const streak = snapshot?.streak ?? 0;
  const progress = need ? into / need : 0;
  const xp = useCountUp(snapshot?.xp ?? 0);

  return (
    <div className="border-t border-hairline p-2.5">
      {/* 快捷键入口。藏着的功能等于没有 —— 不摆出来，没人会去按 ? 试试。 */}
      <HotkeyHint onClick={onShowHotkeys} />
      <div className="panel relative overflow-hidden rounded-lg p-2.5">
        <div className="flex items-center gap-2">
          <span
            /* ★ 去掉等级徽章上的发光。它是侧栏里一个 28px 的圆点，
             *   发光除了让侧栏变吵没有任何作用。 */
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
            style={avatarStyle(user.avatarHue)}
          >
            {lv}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-fg">{title}</div>
            <div className="text-[10.5px] tabular-nums text-fg-faint">
              {into} / {need} XP
            </div>
          </div>
          {streak > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-amber"
              title={`连续学习 ${streak} 天`}
            >
              <Flame size={12} />
              {streak}
            </span>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-veil/10">
          <div
            /* ★ 进度条从"彩虹渐变"改成单色强调色。
             *   进度条的语义是"完成了多少"，一条从青到紫到品红的彩虹
             *   并不能多表达任何东西 —— 它只是把"进度"这件事说三遍。 */
            className="h-full rounded-full transition-[width] duration-700"
            style={{
              width: `${Math.min(100, progress * 100)}%`,
              background: 'var(--color-cyan)',
              transitionTimingFunction: 'var(--ease-out-expo)',
            }}
          />
        </div>
        <div className="mt-1 text-right text-[10px] tabular-nums text-fg-faint">
          总 {Math.round(xp)} XP
        </div>
      </div>

      <UserRow />
    </div>
  );
}

function UserRow() {
  const { user, logout } = useAuth();
  const { toast } = useApp();
  if (!user) return null;

  const roleLabel = { student: '学生', teacher: '教师', admin: '管理员' }[user.role];

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg px-1.5 py-1.5">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
        style={avatarStyle(user.avatarHue)}
      >
        {user.username.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-fg">{user.username}</div>
        <div className="text-[10.5px] text-fg-faint">{roleLabel}</div>
      </div>
      <button
        onClick={async () => { await logout(); toast('info', '已退出登录'); }}
        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-mute hover:bg-veil/8 hover:text-fg"
      >
        退出
      </button>
    </div>
  );
}

/* ============ 顶栏 ============ */

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { snapshot } = useApp();
  const { user } = useAuth();
  const location = useLocation();

  // 面包屑：从路由表反查当前在哪一层。不单独维护一张映射表 ——
  // 那迟早会和路由漂移（加了个页面，面包屑里没有它）。
  const crumb = useMemo(() => {
    const all = [
      { p: '/', n: '仪表盘' }, { p: '/learn', n: '知识树' }, { p: '/lab/sql', n: 'SQL 实训场' },
      { p: '/levels', n: 'SQL 闯关' }, { p: '/practice', n: '每日一练' },
      { p: '/normalize', n: '范式实验室' }, { p: '/lab', n: '索引与事务' },
      { p: '/review', n: '复习队列' }, { p: '/mistakes', n: '错题本' },
      { p: '/stats', n: '学习统计' }, { p: '/achievements', n: '成就' },
      { p: '/settings', n: '设置' }, { p: '/assignments', n: '作业' },
      { p: '/classes', n: '班级' }, { p: '/admin', n: '教师工作台' },
    ];
    const exact = all.find((x) => x.p === location.pathname);
    if (exact) return exact.n;
    const pref = all
      .filter((x) => x.p !== '/' && location.pathname.startsWith(x.p))
      .sort((a, b) => b.p.length - a.p.length)[0];
    return pref?.n || '库课';
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-ink-1000/88 backdrop-blur-md">
      <div className="flex h-13 items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="rounded-md p-1.5 text-fg-soft transition-colors hover:bg-veil/8 lg:hidden"
          aria-label="打开导航"
        >
          <Menu size={18} />
        </button>

        <h1 className="truncate text-[14.5px] font-semibold text-fg">{crumb}</h1>

        <div className="ml-auto flex items-center gap-2">
          {snapshot && snapshot.combo >= 3 && (
            <span className="glow-pulse hidden items-center gap-1 rounded-md border border-amber/30 bg-warn-soft px-2 py-1 text-[11.5px] font-semibold text-amber sm:flex">
              <Zap size={12} />
              连对 {snapshot.combo}
            </span>
          )}
          {snapshot && (
            <span className="hidden items-center gap-1 text-[11.5px] tabular-nums text-fg-mute sm:flex">
              今日 {snapshot.today.attempts} 题
            </span>
          )}
          <ThemePicker compact />
          {user?.role === 'admin' && (
            <span className="hidden rounded-md border border-violet/30 bg-violet/10 px-1.5 py-0.5 text-[10.5px] font-medium text-violet sm:inline">
              管理员
            </span>
          )}
        </div>
      </div>
      {/* 底边一道两端淡出的渐变线。比纯 border 更有"接缝"感 ——
          它把顶栏和内容区分开，而不是让两者糊在一起。 */}
      <div className="hairline-fade" aria-hidden="true" />
    </header>
  );
}
