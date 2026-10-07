/* 国风图标组件 —— 山水/仙侠主题侧栏导航专用
 *
 * 设计原则：
 * 1. 统一 viewBox="0 0 24 24"，与 lucide-react 图标尺寸一致
 * 2. 统一 stroke-width="1.6"，比 lucide 默认 2 略细，更有「线描工笔」感
 * 3. 线条用 currentColor，继承父级文字色（激活态变青绿/墨蓝，默认态变墨色）
 * 4. 风格统一为「线描 + 少量填色块」，不画毛笔效果（SVG 做不出好的水墨晕染）
 *
 * ★ 2026-10-07 仙侠增强：在关键图标上加了「灵气飘带」「光点」「符箓圈」
 *   装饰元素。这些装饰用 opacity 0.4-0.7 控制不抢主，在仙侠主题下
 *   配合 CSS 的 drop-shadow(淡金) 形成玄幻光效。山水主题下这些装饰
 *   也存在，但 currentColor 在山水主题下是青绿/墨色，不会显得「太亮」。
 *
 * 图标映射表（lucide → 国风）：
 *   仪表盘   LayoutDashboard → 罗盘（司南）+ 灵气弧
 *   知识树   Network → 枝叶（一枝三叶）+ 光点
 *   AI 课堂  GraduationCap → 书卷（半展卷轴）+ 灵气飘带
 *   SQL 实训场 Terminal → 竹简（三片竹简）+ 符纹
 *   SQL 闯关  Flag → 令箭（令牌）+ 光阵
 *   每日一练  PenLine → 毛笔（悬笔）+ 灵气
 *   范式实验室 Sigma → 天平（度量）+ 光点
 *   索引与事务 FlaskConical → 葫芦（炼丹葫芦）+ 灵气环
 *   复习队列   RotateCcw → 回纹（回字纹）+ 光点
 *   错题本     CircleAlert → 朱批（朱砂批注圈）+ 灵气
 *   学习统计   ChartNoAxesColumn → 卦象（三爻卦）+ 光阵
 *   成就       Trophy → 玉璧（圆璧）+ 光晕
 *   设置       Settings → 齿轮已是通用符号，改成太极图 + 光点
 *   作业       ClipboardList → 文牒（卷轴文书）+ 印章光
 *   班级       Users → 学塾匾（匾额）+ 灵气
 *   教师工作台 ShieldCheck → 官印（方形印章）+ 光阵
 */

import type { SVGProps } from 'react';

export type GuofengIconName =
  | 'compass'     // 仪表盘 → 罗盘
  | 'branches'    // 知识树 → 枝叶
  | 'scroll'      // AI 课堂 → 书卷
  | 'bamboo'      // SQL 实训场 → 竹简
  | 'token'       // SQL 闯关 → 令箭
  | 'brush'       // 每日一练 → 毛笔
  | 'balance'     // 范式实验室 → 天平
  | 'gourd'       // 索引与事务 → 葫芦
  | 'meander'     // 复习队列 → 回纹
  | 'vermilion'   // 错题本 → 朱批
  | 'trigram'     // 学习统计 → 卦象
  | 'jadebi'      // 成就 → 玉璧
  | 'taiji'       // 设置 → 太极
  | 'document'    // 作业 → 文牒
  | 'academy'     // 班级 → 学塾匾
  | 'official';   // 教师工作台 → 官印

const common: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function GuofengIcon({ name, size = 16, className }: { name: GuofengIconName; size?: number; className?: string }) {
  const props = { ...common, width: size, height: size, className };
  switch (name) {
    case 'compass': // 罗盘（司南）—— 外圆 + 内圆 + 指针 + 灵气弧
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" />
          <circle cx="12" cy="12" r="4.5" opacity="0.5" />
          <path d="M12 5.5 L13.5 11.5 L12 10 L10.5 11.5 Z" fill="currentColor" stroke="none" />
          <path d="M12 18.5 L10.5 12.5 L12 14 L13.5 12.5 Z" opacity="0.4" />
          <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
          {/* ★ 灵气弧 —— 右上方飘带 */}
          <path d="M18.5 4.5 C20 5 21.5 7 21.5 9.5" opacity="0.35" />
          <circle cx="21.5" cy="9.5" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
        </svg>
      );
    case 'branches': // 枝叶 —— 树干向上伸出两根分叉，每叉带 2-3 片叶
      return (
        <svg {...props}>
          {/* 主干 */}
          <path d="M12 22 L12 13" />
          {/* 左分叉 */}
          <path d="M12 13 C10 12 8.5 10.5 7.5 8" />
          {/* 右分叉 */}
          <path d="M12 13 C14 12 15.5 10.5 16.5 8" />
          {/* 左分叉顶端的叶子（三叶一组） */}
          <path d="M7.5 8 C6 7 5.5 5 6 3.5 C7 5 8 6 7.5 8" />
          <path d="M7.5 8 C9 7 9.5 5 9 3.5 C8 5 7 6 7.5 8" opacity="0.7" />
          {/* 右分叉顶端的叶子 */}
          <path d="M16.5 8 C18 7 18.5 5 18 3.5 C17 5 16 6 16.5 8" />
          <path d="M16.5 8 C15 7 14.5 5 15 3.5 C16 5 17 6 16.5 8" opacity="0.7" />
          {/* 底部分根 */}
          <path d="M12 22 L10 23 M12 22 L14 23" opacity="0.5" />
        </svg>
      );
    case 'scroll': // 书卷 —— 半展卷轴 + 灵气飘带
      return (
        <svg {...props}>
          <path d="M6 6 C6 5 6.5 4.5 7.5 4.5 L16.5 4.5 C17.5 4.5 18 5 18 6 L18 17 C18 18 17.5 18.5 16.5 18.5 L7.5 18.5" />
          <path d="M6 6 C5 6 4.5 6.5 4.5 7.5 L4.5 16.5 C4.5 17.5 5 18 6 18" />
          <path d="M7.5 9 L15 9 M7.5 12 L15 12 M7.5 15 L13 15" opacity="0.5" />
          <ellipse cx="6" cy="6" rx="1.5" ry="2" />
          <ellipse cx="6" cy="18" rx="1.5" ry="2" />
          {/* ★ 灵气飘带 —— 卷轴右上方 */}
          <path d="M19.5 3 C21 3.5 22 5 22 7" opacity="0.30" />
        </svg>
      );
    case 'bamboo': // 竹简 —— 三片竖竹简，顶部穿绳 + 符纹光点
      return (
        <svg {...props}>
          <path d="M6 6 L6 19" />
          <path d="M12 5.5 L12 19" />
          <path d="M18 6 L18 19" />
          <path d="M5 5.5 C8 5 14 5 19 6" />
          <path d="M5 7 C8 6.5 14 6.5 19 7.5" opacity="0.5" />
          <path d="M5.5 10 L6.5 10 M11.5 10 L12.5 10 M17.5 10 L18.5 10" opacity="0.4" />
          <path d="M5.5 14 L6.5 14 M11.5 14 L12.5 14 M17.5 14 L18.5 14" opacity="0.4" />
          {/* ★ 符纹光点 —— 三片竹简底部各一颗 */}
          <circle cx="6" cy="21" r="0.6" fill="currentColor" stroke="none" opacity="0.55" />
          <circle cx="12" cy="21" r="0.6" fill="currentColor" stroke="none" opacity="0.55" />
          <circle cx="18" cy="21" r="0.6" fill="currentColor" stroke="none" opacity="0.55" />
        </svg>
      );
    case 'token': // 令箭 —— 令牌 + 光阵
      return (
        <svg {...props}>
          <path d="M12 3 L18 7 L18 18 L12 21 L6 18 L6 7 Z" />
          <path d="M12 3 L12 21" opacity="0.4" />
          <path d="M9.5 9 L14.5 9 M9.5 12 L14.5 12" opacity="0.5" />
          {/* ★ 光阵 —— 底部符箓圈 */}
          <ellipse cx="12" cy="23" rx="5" ry="1" opacity="0.30" />
        </svg>
      );
    case 'brush': // 毛笔 —— 笔杆向下，笔头尖锥形 + 灵气飘带
      return (
        <svg {...props}>
          {/* 笔杆上段 —— 竹管的两侧 */}
          <path d="M14 3 L15 4 L15 9" />
          <path d="M14 3 L13 4 L13 9" opacity="0.5" />
          {/* 笔杆与笔头的连接箍 */}
          <path d="M11 12 L17 12 L17 13.5 L11 13.5 Z" />
          {/* 笔头 —— 从 13.5 到 19.5 的尖锥（不是毛团） */}
          <path d="M11.5 13.5 L16.5 13.5 L15.5 19.5 L12.5 19.5 Z" />
          {/* 笔锋尖 */}
          <path d="M12.5 19.5 L15.5 19.5 L14 21" />
          {/* 笔杆中线 */}
          <path d="M14 3 L14 9" opacity="0.4" />
          {/* ★ 灵气飘带 —— 笔尖左下方 */}
          <path d="M9 19 C7 20 5 20 3 19" opacity="0.35" />
          <circle cx="3" cy="19" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
        </svg>
      );
    case 'balance': // 天平 —— 横梁 + 两端秤盘 + 中柱
      return (
        <svg {...props}>
          <path d="M12 4 L12 8" />
          <path d="M5 8 L19 8" />
          <path d="M12 8 L12 19" />
          <path d="M12 19 L10 21 M12 19 L14 21" />
          <path d="M5 8 C3.5 8 3 9 3 10 C3 11 4 11.5 5 11.5 C6 11.5 7 11 7 10 C7 9 6.5 8 5 8" />
          <path d="M19 8 C17.5 8 17 9 17 10 C17 11 18 11.5 19 11.5 C20 11.5 21 11 21 10 C21 9 20.5 8 19 8" />
          <circle cx="12" cy="5.5" r="1.5" />
        </svg>
      );
    case 'gourd': // 葫芦 —— 上小下大的葫芦形 + 灵气环
      return (
        <svg {...props}>
          <path d="M12 3 C11 3 10.5 4 10.5 5 C10.5 5.5 11 6 11.5 6.5 C10 7 9 8.5 9 10.5 C9 13 10.5 15 12 15 C13.5 15 15 13 15 10.5 C15 8.5 14 7 12.5 6.5 C13 6 13.5 5.5 13.5 5 C13.5 4 13 3 12 3 Z" />
          <path d="M12 15 C12 17 11 19 11 20.5 C11 21.5 11.5 22 12 22 C12.5 22 13 21.5 13 20.5 C13 19 12 17 12 15" />
          <path d="M10 11 L11 11 M13 11 L14 11" opacity="0.4" />
          {/* ★ 灵气环 —— 葫芦底部光阵 */}
          <ellipse cx="12" cy="23.5" rx="4" ry="0.7" opacity="0.30" />
        </svg>
      );
    case 'meander': // 回纹 —— 回字纹，方形回旋
      return (
        <svg {...props}>
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <path d="M8 8 L16 8 L16 16 L12 16 L12 12 L8 12" opacity="0.6" />
          <path d="M10 10 L14 10 L14 14" opacity="0.3" />
        </svg>
      );
    case 'vermilion': // 朱批 —— 圈批 + 批注引线（朱笔感的「批」字符号）
      return (
        <svg {...props}>
          {/* 主圈 —— 朱批圈选 */}
          <circle cx="11" cy="11" r="6" />
          {/* 圈内的两点 —— 暗示「批」字的笔画 */}
          <path d="M8.5 9.5 L10.5 9.5 M9 11.5 L11 11.5" opacity="0.6" />
          {/* 圈外的批注引线 —— 一笔斜出的朱砂划痕 */}
          <path d="M16 16 L21 21" strokeWidth="2" />
          {/* 朱砂点（落笔处） */}
          <circle cx="21" cy="21" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'trigram': // 卦象 —— 三爻卦（乾卦☰）+ 光阵
      return (
        <svg {...props}>
          <path d="M5 7 L19 7" />
          <path d="M5 12 L19 12" />
          <path d="M5 17 L19 17" />
          <path d="M5 4.5 L19 4.5" opacity="0.3" />
          <path d="M5 19.5 L19 19.5" opacity="0.3" />
          <circle cx="5" cy="7" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="7" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="5" cy="17" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="17" r="0.6" fill="currentColor" stroke="none" />
          {/* ★ 光阵 —— 左右各一道灵气 */}
          <path d="M2 9.5 C1 11 1 13 2 14.5" opacity="0.25" />
          <path d="M22 9.5 C23 11 23 13 22 14.5" opacity="0.25" />
        </svg>
      );
    case 'jadebi': // 玉璧 —— 外圆 + 内圆孔 + 光晕
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3 L12 8 M12 16 L12 21 M3 12 L8 12 M16 12 L21 12" opacity="0.4" />
          <circle cx="12" cy="3" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="21" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="3" cy="12" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="21" cy="12" r="0.6" fill="currentColor" stroke="none" />
          {/* ★ 光晕 —— 内孔中心一颗亮点 */}
          <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" opacity="0.6" />
        </svg>
      );
    case 'taiji': // 太极 —— 简化阴阳鱼
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3 C12 6 15 6 15 9 C15 12 12 12 12 12 C12 12 9 12 9 15 C9 18 12 18 12 21" />
          <circle cx="12" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" opacity="0.5" />
        </svg>
      );
    case 'document': // 文牒 —— 折角文书（与「书卷」半展卷轴区分；这里是折页信札）
      return (
        <svg {...props}>
          {/* 主页 —— 带右上折角 */}
          <path d="M5 3 L15 3 L19 7 L19 21 L5 21 Z" />
          {/* 折角 */}
          <path d="M15 3 L15 7 L19 7" />
          {/* 文书上的两行字 */}
          <path d="M8 11 L16 11 M8 14 L16 14 M8 17 L13 17" opacity="0.5" />
          {/* 朱砂印 —— 落在右下角，区别于「书卷」的轴头 */}
          <rect x="13" y="16" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" opacity="0.8" />
          <path d="M14 17.5 L16 17.5 M14 18.5 L16 18.5 M15 17 L15 19" stroke="#f4ecd5" strokeWidth="0.4" />
        </svg>
      );
    case 'academy': // 学塾匾 —— 横匾形，上下边框
      return (
        <svg {...props}>
          <path d="M3 7 L21 7 L19.5 19 L4.5 19 Z" />
          <path d="M3 7 L2 9 M21 7 L22 9" opacity="0.5" />
          <path d="M7 11 L17 11 M7 14 L15 14" opacity="0.4" />
          <path d="M5 7 L5 5 L7 7 M19 7 L19 5 L17 7" opacity="0.4" />
        </svg>
      );
    case 'official': // 官印 —— 方形印章 + 印文十字 + 光阵
      return (
        <svg {...props}>
          <rect x="4.5" y="4.5" width="15" height="15" rx="1" transform="rotate(45 12 12)" />
          <rect x="4.5" y="4.5" width="15" height="15" rx="1" opacity="0.3" />
          <path d="M12 8 L12 16 M8 12 L16 12" opacity="0.5" />
          {/* ★ 光阵 —— 四角光点 */}
          <circle cx="4" cy="4" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
          <circle cx="20" cy="4" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
          <circle cx="4" cy="20" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
          <circle cx="20" cy="20" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
        </svg>
      );
    default:
      return null;
  }
}
