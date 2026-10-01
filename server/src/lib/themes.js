/* 主题 id 白名单（服务端侧）
 *
 * ⚠️ 这份清单必须和 web/src/lib/themes.ts 的 THEMES 一致。
 * 两边漂移的表现是：前端能选、保存时被服务端静默收敛回默认
 * —— 不报错，但用户会觉得「我选的主题每次都被重置」。
 * 接口冒烟里有一条断言专门比对这两个清单，漏改会红。
 */
export const THEME_IDS = [
  'deep-space',
  'cyber-lime',
  'nord-frost',
  'ember',
  'midnight-rose',
  'ink-autumn',
  'paper',
  'mint',
  'solarized',
];

export const DEFAULT_THEME = 'deep-space';

export function isThemeId(v) {
  return typeof v === 'string' && THEME_IDS.includes(v);
}
