/* 仙侠页横幅（shanshui 主题专属）
 *
 * ── 它解决什么问题 ─────────────────────────────────────────────
 * 全局横幅（body::after）是固定的云海仙岛 —— 整个站切到仙侠主题后，
 * 每个页面都长一样，缺少"这一页"的辨识。这里按当前路由给每个页面
 * 配一张**不重复**的专属横幅图（共 17 张，一套 1008×672 系列）
 * 和一句仙侠注脚，让每一页都有一块自己的"屏风画"。
 *
 * ── 设计取舍 ──────────────────────────────────────────────────
 * · 只渲染在 lg 及以上 —— 移动端空间全让给内容
 * · 图放在右 60% 区，左 40% 是宣纸渐隐 —— 页面名交给顶栏面包屑，
 *   这里不抢"标题"的语义，只负责氛围
 * · 左右两端各一根卷轴轴头（伪元素），呼应"宣纸卷轴"的语汇
 * · 底部一根淡金细线（发光），呼应"淡金发光线条"
 *
 * ── 路由匹配 ──────────────────────────────────────────────────
 * 与 APP_PAGES 同源设计：先精确匹配，再按最长前缀匹配
 * （/learn/k-x → /learn 的图），和顶栏面包屑的 pageNameOf 同策略。
 */
import { useLocation } from 'react-router-dom';
import { useTheme } from '@/stores/theme';
import { PAGE_NAMES } from '@/routes';

/** 每个路由模式的仙侠注脚与专属图。顺序即前缀匹配优先级（最长在前无需排序，精确优先）。 */
const BANNERS: { pattern: string; note: string; img: string }[] = [
  { pattern: '/', note: '修仙问道，先从今日功课起', img: '/img/xianxia-dashboard.png' },
  { pattern: '/learn', note: '知识如灵根，枝叶见真章', img: '/img/xianxia-learn.png' },
  { pattern: '/classroom', note: '听仙师讲道，悟 SQL 真法', img: '/img/xianxia-classroom.png' },
  { pattern: '/lab/sql', note: '演武场中，剑气纵横试锋芒', img: '/img/xianxia-sqllab.png' },
  { pattern: '/levels', note: '一关一阶，登仙路漫漫', img: '/img/xianxia-levels.png' },
  { pattern: '/practice', note: '洞府闭关，日日淬炼灵元', img: '/img/xianxia-practice.png' },
  { pattern: '/normalize', note: '推演天地法则，拆解范式迷局', img: '/img/xianxia-normalize.png' },
  { pattern: '/lab', note: '炼器阁中，调五行以成灵宝', img: '/img/xianxia-lab.png' },
  { pattern: '/review', note: '温故而知新，灵识自归位', img: '/img/xianxia-review.png' },
  { pattern: '/mistakes', note: '朱砂批红，错漏皆可改', img: '/img/xianxia-mistakes.png' },
  { pattern: '/stats', note: '观星推演，窥天命轨迹', img: '/img/xianxia-stats.png' },
  { pattern: '/achievements', note: '功业修成，位列仙阶', img: '/img/xianxia-achievements.png' },
  { pattern: '/assignments', note: '师命既出，文牒自当差', img: '/img/xianxia-assignments.png' },
  { pattern: '/classes', note: '同门共证，道友相携', img: '/img/xianxia-classes.png' },
  { pattern: '/settings', note: '调五行之气，衡洞府乾坤', img: '/img/xianxia-settings.png' },
  { pattern: '/admin', note: '掌一宗教务，巡视诸峰', img: '/img/xianxia-admin.png' },
];

export function XianxiaBanner() {
  const { pathname } = useLocation();
  const { def: theme } = useTheme();
  if (theme.id !== 'shanshui') return null;

  /* 精确匹配优先 → 最长前缀匹配（与顶栏 pageNameOf 同策略）。
   * 图同理：/learn/k-select 沿用 /learn 的《灵根知树》图 ——
   * 每页一图不等价于每路由一图，知识点详情共享其父页的屏风画。 */
  const exact = BANNERS.find((b) => b.pattern === pathname);
  const pref = exact
    ?? BANNERS
      .filter((b) => b.pattern !== '/' && pathname.startsWith(b.pattern))
      .sort((a, b) => b.pattern.length - a.pattern.length)[0];

  const page = pref ?? BANNERS[0];

  /* 页面名：精确 → 最长前缀（与顶栏面包屑同源数据） */
  const pageName = PAGE_NAMES[pathname]
    ?? Object.entries(PAGE_NAMES)
      .filter(([p]) => p !== '/' && pathname.startsWith(p))
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1]
    ?? '库课';

  return (
    <div
      className="xianxia-banner relative mb-4 hidden h-28 w-full overflow-hidden rounded-lg border border-hairline sm:block"
      aria-hidden="true"
    >
      {/* 屏风画：右侧 60% 的专属图，左缘渐隐进宣纸底 */}
      <div
        className="absolute inset-0 xianxia-banner-art"
        style={{ backgroundImage: `url("${page.img}")` }}
      />
      {/* 左 40% 从关联到透明的宣纸渐隐 —— 保证底色连续 */}
      <div className="absolute inset-y-0 left-0 w-[46%] xianxia-banner-sheen" />
      {/* 底部淡金发光细线 */}
      <div className="xianxia-banner-goldline absolute inset-x-3 bottom-0 h-px" />
      {/* 注脚 + 朱砂小印 */}
      <div className="relative z-10 flex h-full items-center gap-2.5 pl-5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[4px] text-[15px] font-bold text-[#f4ecd5] xianxia-banner-seal"
        >
          库
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] tracking-[0.08em] text-fg-mute">
            {page.note}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-faint">
            {pageName}
          </div>
        </div>
      </div>
    </div>
  );
}