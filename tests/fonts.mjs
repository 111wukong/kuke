/* 古风字体回归
 *
 * ── 为什么字体需要单独的回归测试 ────────────────────────────────
 * 字体是**全站最容易静默失效**的一块，比颜色还严重：
 *
 *   颜色错了 → 截图能看出来。
 *   字体错了 → 页面照样渲染、布局照样正确、截图里文字照样清晰，
 *              只是从楷体变成了黑体。**没有任何断言会红。**
 *              而它恰恰是「古风」这个需求的主要载体 ——
 *              只换配色不换字体，得到的是"深棕色的普通界面"。
 *
 * 而且字体比颜色多两类失效方式：
 *   1. **资产与 CSS 脱钩** —— 文件名换了、CSS 没跟上，或者反过来，
 *      public/ 里躺着几个没人引用的孤儿文件。
 *   2. **退化成系统字体** —— 这是最阴的一种：字体栈写错一个字，
 *      或者 unicode-range 没覆盖到，浏览器就安静地往下走。
 *      看起来"能用"，只是不再是你自托管的那套字。
 *
 * 所以这一组守四件事：
 *   ① 资产 ↔ CSS 双向对齐（谁多谁少都算错）
 *   ② 字体栈必须有系统楷体兜底（否则 Linux 上会掉到 serif）
 *   ③ 主题注册表（themes.ts）与样式表（index.css）的「哪套主题用楷体」必须一致
 *   ④ 切片的 unicode-range 不能重叠、必须有 font-display
 *
 * 纯静态，不起服务。跑法：node tests/fonts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FONT_DIR = path.join(ROOT, 'web/public/fonts');
const FONT_CSS = path.join(ROOT, 'web/src/styles/wenkai.css');
const MAIN_CSS = path.join(ROOT, 'web/src/styles/index.css');
const THEMES_TS = path.join(ROOT, 'web/src/lib/themes.ts');

let pass = 0;
const failures = [];
const notes = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; return true; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
  return false;
};

/* ---------- 读三个来源 ---------- */
const cssSrc = fs.readFileSync(FONT_CSS, 'utf8');
const mainSrc = fs.readFileSync(MAIN_CSS, 'utf8');
const themesSrc = fs.readFileSync(THEMES_TS, 'utf8');
const files = fs.readdirSync(FONT_DIR);

/* ---------- ① 资产 ↔ CSS 双向对齐 ---------- */
const faces = [];
for (const m of cssSrc.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
  const body = m[1];
  const url = /url\('\/fonts\/([^']+\.woff2)'\)/.exec(body);
  const range = /unicode-range:\s*([^;\n}]+)/.exec(body);
  const display = /font-display:\s*([a-z]+)/.exec(body);
  const family = /font-family:\s*'([^']+)'/.exec(body);
  const weight = /font-weight:\s*(\d+)/.exec(body);
  faces.push({
    file: url?.[1],
    range: range?.[1]?.trim(),
    display: display?.[1],
    family: family?.[1],
    weight: weight?.[1],
  });
}

check('解析到 @font-face（≥ 50 片）', faces.length >= 50, `实际 ${faces.length}`);
check('每片都写了 src url', faces.every((f) => f.file), '有切片缺 url');
check('每片都写了 unicode-range', faces.every((f) => f.range), '有切片缺 unicode-range');
check('每片都写了 font-weight', faces.every((f) => f.weight), '有切片缺 font-weight');

/* font-display 不能省：中文网页字体是几百 KB 起步，
 * 默认的 block 行为会让首屏有几秒钟完全看不到字。 */
const noSwap = faces.filter((f) => f.display !== 'swap');
check('每片都是 font-display: swap', noSwap.length === 0, `${noSwap.length} 片不是 swap`);

/* 家族名只有一个。出现第二个家族名通常意味着有人手工往 wenkai.css 里
 * 加了 @font-face —— 而那个文件是生成的，下次导入就没了。 */
const families = [...new Set(faces.map((f) => f.family))];
check('只有一个字体家族名', families.length === 1, `实际 ${JSON.stringify(families)}`);

const referenced = new Set(faces.map((f) => f.file));
const present = new Set(files.filter((f) => f.endsWith('.woff2')));

const missing = [...referenced].filter((f) => !present.has(f));
check('CSS 引用的字体文件都存在', missing.length === 0, `缺 ${missing.length} 个：${missing.slice(0, 5).join(', ')}`);

/* 反向也要查。孤儿文件不会报错，只会悄悄让仓库变大、
 * 而且下一个人会以为"这些文件还在用，不能删"。 */
const orphans = [...present].filter((f) => !referenced.has(f));
check('没有未被引用的孤儿字体文件', orphans.length === 0, `多 ${orphans.length} 个：${orphans.slice(0, 5).join(', ')}`);

/* 文件名里必须带内容哈希 —— 服务端（server/src/index.js 的 setHeaders）
 * 就是靠这个正则判断能不能发 immutable 长缓存的。
 * 少了哈希，这 97 个永不改变的文件会每次都回源问一遍。 */
const badName = [...present].filter((f) => !/^lxgwwenkai-gb-\d{3}\.[0-9a-f]{8}\.woff2$/.test(f));
check('字体文件名带内容哈希（否则拿不到长缓存）', badName.length === 0, badName.slice(0, 3).join(', '));

/* ---------- ② 字体栈必须有系统楷体兜底 ---------- */
/* 自托管字体是 GB2312 子集。落在子集外的字不命中任何 @font-face，
 * 浏览器会**沿着字体栈往下走**。栈里下一项要是 `serif`，
 * Linux 上就变成 Noto Serif —— 同一句话里一半楷体一半宋体。 */
const kaiStack = /--font-kai:\s*([^;]+);/.exec(mainSrc)?.[1]?.trim();
check('index.css 定义了 --font-kai', !!kaiStack);

if (kaiStack) {
  const first = kaiStack.split(',')[0].trim().replace(/^["']|["']$/g, '');
  check('--font-kai 第一项是自托管家族名', first === families[0], `实际 "${first}"，自托管家族是 "${families[0]}"`);

  /* 兜底至少要认三个平台：macOS 的 Kaiti SC / STKaiti、
   * Windows 的 KaiTi / 楷体、Linux 的 AR PL UKai CN。 */
  const fallbacks = ['Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'AR PL UKai CN'];
  const hit = fallbacks.filter((f) => kaiStack.includes(f));
  check('--font-kai 里有系统楷体兜底（≥ 2 个平台）', hit.length >= 2, `只找到 ${JSON.stringify(hit)}`);

  check('--font-kai 最后一项是通用族 serif', /serif\s*$/.test(kaiStack), `实际结尾：${kaiStack.slice(-20)}`);

  /* 栈里不能出现无衬线兜底 —— 那等于"楷体没命中就变黑体"，
   * 古风主题会突然出现黑体字，比掉到宋体难看得多。 */
  check(
    '--font-kai 里没有混进无衬线字体',
    !/PingFang|YaHei|sans-serif/.test(kaiStack),
    '字体栈里出现了黑体/无衬线',
  );
}

/* ---------- ③ themes.ts 与 index.css 的「哪套用楷体」必须一致 ---------- */
/* 这是最容易漂移的一处：加主题时改了 CSS 忘了注册表（或反过来），
 * 症状是「选择器里预览是楷体、套上去是黑体」或者相反。
 * 两边都不报错。 */
const overridden = new Set();
const cleanMain = mainSrc.replace(/\/\*[\s\S]*?\*\//g, '');
let from = 0;
for (;;) {
  const idx = cleanMain.indexOf('--font-sans: var(--font-kai)', from);
  if (idx === -1) break;
  from = idx + 1;
  const open = cleanMain.lastIndexOf('{', idx);
  const start = cleanMain.lastIndexOf('}', open) + 1;
  const selector = cleanMain.slice(start, open);
  for (const m of selector.matchAll(/html\[data-theme="([a-z-]+)"\]/g)) overridden.add(m[1]);
}
check('样式表里至少有一处楷体覆盖', overridden.size > 0, `实际 ${overridden.size}`);

const declared = new Map();
for (const part of themesSrc.split(/\bid:\s*'/).slice(1)) {
  const id = part.slice(0, part.indexOf("'"));
  const fm = /font:\s*'(sans|kai)'/.exec(part);
  if (id && fm) declared.set(id, fm[1]);
}
check('themes.ts 每套主题都声明了 font', declared.size >= 8, `实际 ${declared.size} 套`);

const declaredKai = [...declared].filter(([, f]) => f === 'kai').map(([id]) => id).sort();
const cssKai = [...overridden].sort();
check(
  'themes.ts 标记 kai 的主题 === CSS 里挂楷体栈的主题',
  JSON.stringify(declaredKai) === JSON.stringify(cssKai),
  `注册表 ${JSON.stringify(declaredKai)} ≠ 样式表 ${JSON.stringify(cssKai)}`,
);

/* ---------- ④ unicode-range 不重叠 ---------- */
/* 重叠时浏览器按 @font-face 出现顺序取第一个，行为不可预期 ——
 * 而且两个切片内容不同的话，同一个字在不同页面可能长得不一样。 */
const seen = new Map();
let overlaps = 0;
for (const f of faces) {
  if (!f.range) continue;
  for (const part of f.range.split(',')) {
    const p = part.trim().replace(/U\+/i, '').toLowerCase();
    if (!p) continue;
    let a; let b;
    if (p.includes('-')) { [a, b] = p.split('-').map((x) => parseInt(x, 16)); } else { a = b = parseInt(p, 16); }
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    /* 逐区间登记。区间的粒度是几十个码点，不是几十万个，
     * 所以直接把码点摊开登记是可行的（97 片 × 平均 ~600 码点）。 */
    for (let c = a; c <= b; c++) {
      if (seen.has(c)) { overlaps++; break; }
      seen.set(c, f.file);
    }
  }
}
check('unicode-range 没有重叠', overlaps === 0, `${overlaps} 片与前面的切片重叠`);
notes.push(`字体共覆盖 ${seen.size} 个码点`);

/* ---------- ⑤ 项目自有汉字是否被字体覆盖 ---------- */
/* 这一条是「内容 ↔ 字体」的对账，和 content.mjs 查参考答案是同一类思路：
 * 代码测试查不出来的问题，只能拿真实内容去对。
 *
 * 阈值刻意留松：掉到系统楷体兜底**不是错误**（生僻字本来就不该
 * 由网页字体承担）。这条断言守的是"有人把 GB 子集换成更小的子集"
 * 这种整体性退化，不是逐字覆盖。 */
function collectCjk(dir, exts, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { collectCjk(p, exts, acc); continue; }
    if (!exts.some((x) => e.name.endsWith(x))) continue;
    for (const ch of fs.readFileSync(p, 'utf8')) {
      const c = ch.codePointAt(0);
      if (c >= 0x4e00 && c <= 0x9fff) acc.add(c);
    }
  }
}
const cjk = new Set();
collectCjk(path.join(ROOT, 'web/src'), ['.ts', '.tsx'], cjk);
collectCjk(path.join(ROOT, 'server/src'), ['.js'], cjk);

const uncovered = [...cjk].filter((c) => !seen.has(c));
const coverage = cjk.size ? (cjk.size - uncovered.length) / cjk.size : 1;
notes.push(`项目自有汉字 ${cjk.size} 个，字体覆盖 ${(coverage * 100).toFixed(1)}%`);
if (uncovered.length) {
  notes.push(`  未覆盖（会掉到系统楷体）：${uncovered.map((c) => String.fromCodePoint(c)).join('')}`);
}
check(
  '字体子集覆盖 ≥ 95% 的项目自有汉字',
  coverage >= 0.95,
  `实际 ${(coverage * 100).toFixed(1)}%`,
);

/* ---------- ⑥ 体积上限 ---------- */
/* 防的是「有人把全量变体（20MB / 388 片）搬进来」。
 * GB 子集 4.3MB 已经覆盖本项目 100% 的汉字，换全量只多花 5 倍流量。 */
let bytes = 0;
for (const f of present) bytes += fs.statSync(path.join(FONT_DIR, f)).size;
const mb = bytes / 1048576;
check('字体资产总体积 ≤ 8MB', mb <= 8, `实际 ${mb.toFixed(2)} MB`);
notes.push(`字体资产 ${present.size} 片 · ${mb.toFixed(2)} MB`);

/* ---------- 汇总 ---------- */
console.log('\n古风字体回归');
console.log('─'.repeat(60));
for (const n of notes) console.log('  · ' + n);
console.log(`\n通过 ${pass} · 失败 ${failures.length}`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('✓ 全部通过');
}
