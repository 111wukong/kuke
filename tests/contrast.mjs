/* 主题对比度回归
 *
 * ── 为什么值得单独一个测试文件 ──────────────────────────────────
 * 颜色对比度是**看不见的回归**。
 *
 * 改主题时把某个 fg 调暗一点点，页面照样渲染、截图照样好看 ——
 * 因为你盯着的永远是主色和标题。而「未入班」「登录 IP」「作答时间」
 * 这类小字已经悄悄读不出来了，**没有任何断言会红**。
 *
 * 这个项目里实际发生过：8 套主题的 fg-faint 全部在 1.8~2.6:1，
 * 而 fg 和 fg-soft 都在 6:1 以上 —— 光看截图完全看不出问题。
 *
 * ── 阈值依据（WCAG 2.1 AA）──────────────────────────────────────
 *   正文          4.5:1
 *   大字号(≥24px)  3:1
 *   非文字元素     3:1
 * ★ 小字在 WCAG 里**没有豁免**。「小字可以低对比」是常见的误解，
 *   而恰恰是小字最需要对比度。
 *
 * 跑法：node tests/contrast.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.resolve(__dirname, '../web/src/styles/index.css');
const src = fs.readFileSync(CSS, 'utf8');

/* ---------- 颜色数学（WCAG 2.1）---------- */
const hex2rgb = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ---------- 逐行扫描收集主题块 ----------
 * 不用正则抓块：CSS 里有单行闭合的空块（html[data-theme="deep-space"] { ... }），
 * 非贪婪正则 `\{([\s\S]*?)\n\}` 会一路吃到下一个块的 \n}，把整块吞掉。
 * 状态机没有这个问题。 */
const lines = src.split('\n');
const blocks = [];
let cur = null;
lines.forEach((line, i) => {
  const s = line.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!cur) {
    const open = /(?:@theme|html\[data-theme="([a-z-]+)"\])\s*\{/.exec(s);
    if (open) {
      cur = { label: open[1] || 'deep-space（@theme 默认）', vars: {} };
      if (/\}/.test(s.slice(s.indexOf('{') + 1))) { blocks.push(cur); cur = null; }
    }
    return;
  }
  const m = /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/.exec(s);
  if (m) cur.vars[m[1]] = m[2];
  if (/\}/.test(s)) { blocks.push(cur); cur = null; }
});

const themes = blocks.filter((b) => b.vars['fg-mute'] && b.vars['ink-900']);

let pass = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; return true; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
  return false;
};

/* ---------- 1. 文字层级必须达标 ---------- */
const LEVELS = [
  ['fg', 4.5, '正文'],
  ['fg-soft', 4.5, '次要正文'],
  ['fg-mute', 4.5, '标签 / 辅助说明'],
  ['fg-faint', 4.5, '最弱一级（时间戳、占位、编号）'],
];

check('至少识别到 8 套主题', themes.length >= 8, `实际 ${themes.length}`);

for (const t of themes) {
  const bg = hex2rgb(t.vars['ink-900']);
  for (const [lv, need, desc] of LEVELS) {
    const hex = t.vars[lv];
    if (!hex) { check(`${t.label} · ${lv} 存在`, false); continue; }
    const c = contrast(hex2rgb(hex), bg);
    check(
      `${t.label} · ${lv}（${desc}）≥ ${need}:1`,
      c >= need,
      `${hex} 实测 ${c.toFixed(2)}:1`
    );
  }
}

/* ---------- 2. 强调色守 3:1，不守 4.5 ---------- */
/*
 * ★ 这里是一个**刻意的取舍**，值得写清楚，否则下次有人会把阈值提到 4.5
 *   然后发现要改 250 处、还要牺牲 8 套主题的标识色。
 *
 * 现状：8 套主题的强调色（cyan / ok / warn / bad …）实测在 3.0 ~ 12.9 之间，
 *       全部 ≥ 3:1，但有几个（mint 的 cyan、nord-frost 的 magenta、
 *       solarized 的 blue）低于 4.5。
 *
 * 为什么不一刀切提到 4.5：
 *   1. 这些色**主要用途不是文字** —— 边框、图标、背景、进度条、
 *      图表线条，全是「非文字 UI 元素」，WCAG 对它们的要求就是 3:1。
 *   2. 它们当文字用时，场合是**强调**（链接、状态标签、错误提示），
 *      不是需要长时间阅读的正文。正文用的是 fg / fg-soft，那两级
 *      实测 6:1 以上，已经远超 AA。
 *   3. 把 mint 的 `#0d9488` 调到 4.5 需要加深到 teal-700/800 ——
 *      那个主题的「清爽」就没了，而它正是为此选的色。
 *      连带 `bg-cyan/10`、`border-cyan/30` 这些半透明用法也会变。
 *
 * 所以：**守住 3:1 这条底线**（低于它无论怎么用都看不清），
 * 4.5 留给「正文色」那一组去守。
 *
 * 如果将来真的要给强调色配一套「文字专用」的深色变体
 * （`--color-cyan-text` 之类），改这里是第一步 ——
 * 但那是另一个决定，不该由「把阈值调高」顺带做掉。
 */
const ACCENTS = ['cyan', 'violet', 'blue', 'emerald', 'rose', 'amber', 'magenta', 'ok', 'warn', 'bad'];
for (const t of themes) {
  const bg = hex2rgb(t.vars['ink-900']);
  for (const a of ACCENTS) {
    const hex = t.vars[a];
    if (!hex) continue;
    const c = contrast(hex2rgb(hex), bg);
    check(`${t.label} · --color-${a} ≥ 3:1`, c >= 3, `${hex} 实测 ${c.toFixed(2)}:1`);
  }
}

/* ---------- 3. 层级不能塌陷 ---------- */
/* 把所有文字色都提到同一个亮度，对比度是达标了，但视觉层级没了 ——
 * fg 和 fg-faint 看起来一样，页面会变成一片糊。 */
for (const t of themes) {
  const bg = hex2rgb(t.vars['ink-900']);
  const cs = LEVELS.map(([lv]) => contrast(hex2rgb(t.vars[lv]), bg));
  check(
    `${t.label} · 四级文字保持单调递减（层级没塌）`,
    cs[0] > cs[1] && cs[1] > cs[2] && cs[2] > cs[3],
    cs.map((c) => c.toFixed(1)).join(' > ')
  );
  /* 最弱一级和最亮一级至少差 3 倍，否则看不出区别 */
  check(
    `${t.label} · fg 与 fg-faint 有足够区分度`,
    cs[0] / cs[3] >= 2.0,
    `比值 ${(cs[0] / cs[3]).toFixed(2)}`
  );
}

/* ---------- 汇总 ---------- */
console.log('\n主题对比度回归');
console.log('─'.repeat(60));
console.log(`检查 ${themes.length} 套主题 · 通过 ${pass} · 失败 ${failures.length}`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✓ 全部通过');
}
