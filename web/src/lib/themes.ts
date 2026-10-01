/* 主题注册表
 *
 * ── 职责边界（这个文件只管"有哪些主题"，不管"长什么样"）──────────
 * 真正决定颜色的是 web/src/styles/index.css 里的
 * `html[data-theme="xxx"] { --color-…: … }` 那一段。这里只存三样东西：
 *   1. id / 名称 / 一句话描述 —— 给选择器渲染用；
 *   2. mode（dark | light）—— 决定要不要挂 WebGL 背景、color-scheme 怎么设；
 *   3. preview 色板 —— 选择器上那个小缩略图。**它是手抄的**，不跟 CSS 联动。
 *
 * ── 为什么色板要手抄而不是从 CSS 读 ─────────────────────────────
 * 要联动就得把颜色从 CSS 搬到 JS 再运行时写进 style，
 * 代价是首屏会闪一下（JS 跑之前没有变量）。
 * 宁可手抄，也不闪。
 *
 * ⚠️ id 清单必须和 server/src/lib/themes.js 的 THEME_IDS 一致。
 * 两边漂移的表现是：这里能选、保存时被服务端收敛回默认
 * （不报错，但静默失效）。接口冒烟里有一条断言比对这两个清单。
 */

export type ThemeMode = 'dark' | 'light';

export interface ThemeDef {
  id: string;
  name: string;
  desc: string;
  mode: ThemeMode;
  /** 要不要挂 WebGL 赛博网格 + 星尘。亮色主题一律不挂。 */
  fx: boolean;
  /**
   * 这套主题用哪套字。
   *
   * ★ 它**不是**「声明」，是**引用** —— 真正决定字体的是 index.css 里
   *   那个 `--font-sans: var(--font-kai)`。这里这一项只干一件事：
   *   让主题选择器用**这套主题自己的字**把名字画出来。
   *   于是选之前就能看见字体长什么样，而不是选完才发现"怎么变楷体了"。
   *   两处漂移的症状是「预览是楷体、套上去是黑体」——
   *   tests/fonts.mjs 里有一条断言比对它们。
   */
  font: 'sans' | 'kai';
  /** 缩略图色板：[底, 面, 主强调, 次强调, 文字] */
  preview: [string, string, string, string, string];
}

export const DEFAULT_THEME = 'deep-space';

export const THEMES: ThemeDef[] = [
  /* ---------------- 暗色 ---------------- */
  {
    id: 'deep-space',
    name: '深空',
    /* ★ 2026-10-01：默认主题的 fx 从 true 改成 false。
     *
     * 它原来挂着一层 WebGL 赛博网格地平线 + Canvas 星尘。单看很酷，
     * 但它同时是"AI 生成感"最强的元素：透视网格 + 霓虹青紫 +
     * 星尘，这套组合几乎是"2023 年之后的 AI 落地页"的标配，
     * 而它和"数据库课程学习平台"这件事没有任何关系。
     *
     * 更要命的是它对**阅读**是负贡献：网格线会从卡片边缘透出来，
     * 星尘在暗色正文上是一层噪点。数据密集的界面最不需要的就是
     * 会动的背景。
     *
     * 没有删掉这套特效 —— 赛博绿（cyber-lime）仍然开着，
     * 想要那个感觉的人可以选它。默认主题应该是安静的。 */
    desc: '深蓝灰底 + 青紫强调。默认主题，安静的深色工作台。',
    mode: 'dark',
    fx: false,
    font: 'sans',
    preview: ['#03040a', '#10151f', '#22d3ee', '#a855f7', '#e9ebf4'],
  },
  {
    id: 'cyber-lime',
    name: '赛博绿',
    desc: '磷光绿终端 + 赛博网格背景。**唯一带动态背景的主题**，想要炫技感选它。',
    mode: 'dark',
    fx: true,
    font: 'sans',
    preview: ['#030803', '#0b2b17', '#a3e635', '#2dd4bf', '#e6f5ea'],
  },
  {
    id: 'nord-frost',
    name: '北境',
    desc: 'Nord 极地蓝灰。冷、静、低饱和，适合白天光线强的时候。',
    mode: 'dark',
    fx: false,
    font: 'sans',
    preview: ['#1b1f27', '#3b4252', '#88c0d0', '#b48ead', '#eceff4'],
  },
  {
    id: 'ember',
    name: '熔岩',
    desc: '暖橙暗底。夜里看书不刺眼，对比度仍然够。',
    mode: 'dark',
    fx: false,
    font: 'sans',
    preview: ['#0a0504', '#2f1811', '#fb923c', '#f43f5e', '#f7ece6'],
  },
  {
    id: 'midnight-rose',
    name: '午夜玫瑰',
    desc: '深紫底 + 品红强调。视觉最重的一套，适合做长时间专注块。',
    mode: 'dark',
    fx: false,
    font: 'sans',
    preview: ['#08040d', '#1f132e', '#e879f9', '#a855f7', '#f1e9f7'],
  },
  {
    id: 'ink-autumn',
    name: '砚秋',
    desc: '古风书房夜读。旧木家具深褐 + 朱砂印章 + 暖黄灯光 + 楷体。',
    mode: 'dark',
    /* 不挂 WebGL 赛博网格 —— 古风主题不需要赛博的东西。
     * fx 关闭后，halo-1/halo-2 这两层色斑也不会渲染，画面靠
     * mesh 那层细网格（暖黄色调）撑结构。 */
    fx: false,
    font: 'kai',
    preview: ['#2b1810', '#4a2c1c', '#df8476', '#8bbebe', '#f4e8d0'],
  },

  /* ---------------- 亮色 ---------------- */
  {
    id: 'ink-dawn',
    name: '砚晨',
    desc: '古风书房晨窗。茶色宣纸 + 淡墨字 + 朱砂印章，砚秋的白天版。',
    mode: 'light',
    fx: false,
    font: 'kai',
    preview: ['#f7f0df', '#fffdf7', '#9c2619', '#356161', '#241608'],
  },
  {
    id: 'paper',
    name: '宣纸',
    desc: '暖白纸面 + 靛蓝强调。要打印、要投屏、白天在窗边用，选它。',
    mode: 'light',
    fx: false,
    font: 'sans',
    preview: ['#faf8f4', '#ffffff', '#4f46e5', '#0e7490', '#1c1917'],
  },
  {
    id: 'mint',
    name: '薄荷',
    desc: '冷白 + 青绿。比宣纸更清爽，适合夏天和强光环境。',
    mode: 'light',
    fx: false,
    font: 'sans',
    preview: ['#f2f8f6', '#ffffff', '#0d9488', '#0891b2', '#10201d'],
  },
  {
    id: 'solarized',
    name: '护眼米',
    desc: 'Solarized Light 米黄底。公认最省眼的低对比配色。',
    mode: 'light',
    fx: false,
    font: 'sans',
    preview: ['#fdf6e3', '#fffdf5', '#268bd2', '#2aa198', '#073642'],
  },
];

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/** 取主题定义。未知 id 一律落回默认 —— 不抛错。 */
export function themeOf(id: string | null | undefined): ThemeDef {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_THEME)!;
}

export function isThemeId(v: unknown): boolean {
  return typeof v === 'string' && BY_ID.has(v);
}

/** 本地缓存键。存在 localStorage 里，让首屏在接口回来之前就能用对的主题。
 *  index.html 里的内联脚本读的就是这个键。 */
export const THEME_STORAGE_KEY = 'kuke:theme';
