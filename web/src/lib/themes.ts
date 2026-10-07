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

/**
 * 布局变体。
 *
 * ★ 为什么布局和配色分开成两个维度，而不是塞进"主题"里：
 *   配色和布局是**正交**的两件事 —— "深色侧栏 + 白色顶栏"这套结构
 *   和"用哪个蓝色"没有关系。分成两个维度之后：
 *     · 以后想让古风主题也走 console 布局，加一行就行，不用重写配色
 *     · 测试可以分别验（配色归 contrast.mjs，布局归 browser.mjs）
 *   但**选择入口只有一个**（主题选择器），因为用户想的是
 *   "我要一套若依那样的界面"，不是"我要 console 布局 + Element 配色"。
 *
 *   'app'     默认。侧栏与内容同色，顶栏 sticky，靠留白分区块。
 *   'console' 后台管理风（若依/Element 那一套）。深色侧栏 + 白色顶栏
 *             + 灰色内容区 + 标签页栏。见 index.css 的 console 布局一节。
 */
export type ThemeLayout = 'app' | 'console';

export interface ThemeDef {
  id: string;
  name: string;
  desc: string;
  mode: ThemeMode;
  /** 要不要挂 WebGL 网格 + 星尘。亮色主题一律不挂。 */
  fx: boolean;
  /** 用哪套布局。见 ThemeLayout。 */
  layout: ThemeLayout;
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
     * ★ 2026-10-02：用户要求"保留开场的动态 3D 效果"，所以特效本身
     *   做了大幅优化（抗锯齿、开场动画、性能），并给了它一个专门的
     *   主题「星云」。深空保持安静 —— 想开背景的人去选星云/赛博绿。 */
    desc: '深蓝灰底 + 青紫强调。默认主题，安静的深色工作台。',
    mode: 'dark',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#03040a', '#10151f', '#22d3ee', '#a855f7', '#e9ebf4'],
  },
  {
    id: 'nebula',
    name: '星云',
    /* ★ 2026-10-02 新增。**这套就是"开场的动态 3D 效果"的正式落点。**
     *
     * 深空的青紫配色本来是为赛博网格挑的，但底色不够深 —— 网格和
     * 辉光压在上面有点"糊在墙上"。星云把底色压到近黑的深靛，
     * 让星蓝的网格和品红的辉光真的有地方发光；再把 fx 三色单独给
     * （--fx-grid / --fx-glow / --fx-star），因为它们和"文字强调色"
     * 的需求正好相反。
     *
     * 背景这一版做了四件事：网格按屏幕像素反推线宽（远近都不闪）、
     * 2.4 秒的开场（地平线先亮、网格再铺开、星尘最后浮出）、
     * 天空渐变 + 地平线辉光、星尘改成 sprite + 景深。
     * 性能上修掉了"每帧读 clientWidth 触发强制同步布局"，
     * 并加了 60fps 上限与页面隐藏暂停。 */
    desc: '深靛底 + 星云辉光。**带动态 3D 背景**（网格地平线 + 星尘），有开场动画。',
    mode: 'dark',
    fx: true,
    layout: 'app',
    font: 'sans',
    preview: ['#05030f', '#1e163c', '#d946ef', '#7c9cff', '#ece9fb'],
  },
  {
    id: 'cyber-lime',
    name: '赛博绿',
    desc: '磷光绿终端 + 同一套动态 3D 背景。想长时间盯屏幕又想要动感，选它。',
    mode: 'dark',
    fx: true,
    layout: 'app',
    font: 'sans',
    preview: ['#030803', '#0b2b17', '#a3e635', '#2dd4bf', '#e6f5ea'],
  },
  {
    id: 'nord-frost',
    name: '北境',
    desc: 'Nord 极地蓝灰。冷、静、低饱和，适合白天光线强的时候。',
    mode: 'dark',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#1b1f27', '#3b4252', '#88c0d0', '#b48ead', '#eceff4'],
  },
  {
    id: 'ember',
    name: '熔岩',
    desc: '暖橙暗底。夜里看书不刺眼，对比度仍然够。',
    mode: 'dark',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#0a0504', '#2f1811', '#fb923c', '#f43f5e', '#f7ece6'],
  },
  {
    id: 'midnight-rose',
    name: '午夜玫瑰',
    desc: '深紫底 + 品红强调。视觉最重的一套，适合做长时间专注块。',
    mode: 'dark',
    fx: false,
    layout: 'app',
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
    layout: 'app',
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
    layout: 'app',
    font: 'kai',
    preview: ['#f7f0df', '#fffdf7', '#9c2619', '#356161', '#241608'],
  },
  {
    id: 'paper',
    name: '宣纸',
    desc: '暖白纸面 + 靛蓝强调。要打印、要投屏、白天在窗边用，选它。',
    mode: 'light',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#faf8f4', '#ffffff', '#4f46e5', '#0e7490', '#1c1917'],
  },
  {
    id: 'mint',
    name: '薄荷',
    desc: '冷白 + 青绿。比宣纸更清爽，适合夏天和强光环境。',
    mode: 'light',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#f2f8f6', '#ffffff', '#0d9488', '#0891b2', '#10201d'],
  },
  {
    id: 'solarized',
    name: '护眼米',
    desc: 'Solarized Light 米黄底。公认最省眼的低对比配色。',
    mode: 'light',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#fdf6e3', '#fffdf5', '#268bd2', '#2aa198', '#073642'],
  },
  {
    id: 'ruoyi',
    name: '若依',
    /* ★ 2026-10-02 新增。它不是"又一套配色"，而是**一整套视觉语言**：
     *   配色（Element UI 调色板）+ 布局（深色侧栏 / 白色顶栏 / 灰色内容区
     *   / 标签页栏）一起换。所以它是唯一一个 `layout: 'console'` 的主题。
     *
     *   两处刻意偏离 Element 原色，见 index.css 里 ruoyi 主题块的注释：
     *   #409EFF 在浅灰底上只有 2.24:1（它是填充色不是文字色），
     *   Element 的次要文字 #909399 也只有 2.5:1 左右 —— 两条都过不了
     *   本项目的对比度回归。所以强调色压深到 #2b7fd4、四级文字整体压深。
     *   这不是美化，是可读性底线。 */
    desc: '后台管理风格（若依 / Element UI）。深色侧栏 + 白色顶栏 + 标签页栏，**布局也跟着换**。',
    mode: 'light',
    fx: false,
    layout: 'console',
    font: 'sans',
    preview: ['#f0f2f5', '#ffffff', '#409eff', '#304156', '#303133'],
  },

  /* ★ 2026-10-05 新增 · 山水 · 青绿山水（《赛凡俱乐部》那一挂）
   *
   * ── 这一套不是把砚晨换了个名字 ─────────────────────────────────
   * 砚晨是「古风书房晨窗」：单色调，茶色纸、淡墨字、安静。
   * 山水是「青绿山水横幅 + 朱砂印章 + 卷轴轴头」：要把《千里江山图》
   * 那种青绿调子搬进来，强调色光谱更鲜艳，靠背景横幅撑识别度。
   *
   * ── 为什么用「横幅」而不是 SVG 拼贴 ────────────────────────────
   * 山、水、松、远帆这种题材，AI 出图比 SVG 拼贴自然得多 —— 后者
   * 一眼就是「PPT 模板」。一张 1920×420 的横幅配 SVG 印章/卷轴细节，
   * 既是国风味，又不显得过度装饰。
   *
   * ── fx 字段关掉的理由 ─────────────────────────────────────────
   * 这套主题自带横幅背景图，再叠 WebGL 网格/星尘就是双层"动的东西"，
   * 阅读体验立刻崩 —— 一张山水图已经是主角了，再加赛博网格会让
   * 整页像「博物馆里嵌了一块LED屏」。fx 关掉，让横幅自己当背景。 */
  {
    id: 'shanshui',
    name: '山水',
    desc: '青绿山水横幅 + 朱砂印章 + 卷轴轴头。楷体，亮色。数据密集界面也能用的国风。',
    mode: 'light',
    fx: false,
    layout: 'app',
    font: 'kai',
    preview: ['#f4ecd5', '#fbf5e3', '#3a6b5b', '#9c2619', '#1f1408'],
  },
  /* ---- 素白 Modern SaaS ----
   * 中性色板 + 单一强调色。是 ui-design-brain 那套「Modern SaaS」预设的落地：
   * 留白当装饰、光晕几乎关掉、只留一个自信的强调色（深靛蓝）。
   *
   * ★ 它和「山水」是刻意做成对照的：同一份代码，一套是国风（横幅 + 印章 +
   *   楷体 + 青绿朱砂），一套是现代 SaaS（纯色面 + 系统字 + 单一靛蓝）。
   *   想看清「设计语言」和「组件实现」是两件事，切这两套主题最直观 ——
   *   组件结构一个像素都没变，变的只有令牌。 */
  {
    id: 'modern-saas',
    name: '素白',
    desc: '中性色板 + 单一深靛蓝强调。克制的现代 SaaS 风 —— 留白当装饰，光晕几乎关掉。',
    mode: 'light',
    fx: false,
    layout: 'app',
    font: 'sans',
    preview: ['#faf9f7', '#ffffff', '#1d4ed8', '#56514b', '#1a1917'],
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
