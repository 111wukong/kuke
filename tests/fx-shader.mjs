/* 开场 3D 背景：着色器数学回归（不需要 GPU）
 *
 * ── 为什么需要一个不跑 GPU 的着色器测试 ──────────────────────────
 * 2026-10-02 这一版在着色器里连踩两个坑，两个都**不报错**：
 *
 *   ① 网格线的极性写反了。`f = |fract(v) - 0.5|` 在**线上**等于 0、
 *      在两条线中间等于 0.5，所以"是线"对应 f 小。原来写成
 *      `1 - smoothstep(0.5-w, 0.5, f)`，等于"f 小于 0.5-w 时全亮" ——
 *      覆盖 99% 的范围，整片地面被涂成一块均匀的蓝色，看不见任何线条。
 *   ② 衰减因子多乘了一项 `1 - smoothstep(0.55, 1.15, depth)`，
 *      而 depth 的取值范围是 1.67~6.25，永远大于 1.15 ——
 *      那个因子恒等于 0，**整片网格被乘没了**。
 *
 * 两个坑的共同点是：**着色器不报错，画面只是"少了点东西"**，
 * 而肉眼看到的是一块渐变，很容易当成风格而不是缺陷。
 * 截图也救不了 —— 无头截图只渲染一两帧，拍到的永远是开场第一帧。
 *
 * 所以这里把着色器里几个**纯函数**抽出来，转成 JS 在 Node 里算，
 * 直接断言它们的数学性质。不需要 GPU、不需要浏览器、毫秒级。
 *
 * ── 为什么是"转译"而不是"重写一遍公式" ──────────────────────────
 * 重写一遍的话，测试和实现是两份真相：改了实现、忘了改测试，
 * 测试照样绿。这里是从**源码里抽**出那几个函数体再转成 JS，
 * 所以改坏了实现，测试一定会红。
 *
 * 跑法：node tests/fx-shader.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../web/src/components/fx/Background.tsx');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; return true; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
  return false;
};

/* ---------- 1. 模板字符串里不能有游离的反引号 ----------
 * 这是第三个坑：GLSL 写在 JS 模板字符串里，注释中出现一个反引号
 * 就会提前闭合字符串，剩下的内容被当成 JS 执行 ——
 * 报出来的是「smoothstep is not defined」这种和着色器八竿子打不着的错。
 * （我在给上面那段注释加"反引号会出事"的说明时，又踩了一次。） */
function extractTemplate(name) {
  const i = src.indexOf(`const ${name} = \``);
  if (i < 0) return null;
  const start = src.indexOf('`', i) + 1;
  const end = src.indexOf('`', start);
  return { body: src.slice(start, end), end };
}
const vert = extractTemplate('VERT');
const frag = extractTemplate('FRAG');
check('找得到 VERT 模板字符串', !!vert);
check('找得到 FRAG 模板字符串', !!frag);

if (frag) {
  /* 取 FRAG 之后到文件末尾的代码里，是否有落单的反引号出现在
   * 本该是字符串内部的区域 —— 用"下一个反引号是不是紧跟分号/换行"来粗判。
   * 更稳的做法是直接让构建去报错；这条只作为提前预警。 */
  const after = src.slice(frag.end + 1, frag.end + 200);
  check(
    'FRAG 之后紧跟的是语句结束（模板串没被提前闭合）',
    /^\s*;/.test(after),
    `实际是：${JSON.stringify(after.slice(0, 40))}`,
  );
}

/* ---------- 2. 抽出 GLSL 纯函数，转成 JS ---------- */
function extractFn(name) {
  const m = new RegExp(`float\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(frag.body);
  return m ? { params: m[1], body: m[2] } : null;
}

/** 把 GLSL 片段里用到的那几个内置函数补上。 */
const GLSL_RUNTIME = `
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fract = (x) => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const pow = Math.pow, exp = Math.exp, abs = Math.abs, max = Math.max, min = Math.min;
`;

function toJs(fn) {
  const params = fn.params.split(',').map((s) => s.trim().split(/\s+/).pop());
  const body = fn.body
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\bfloat\s+/g, 'let ')
    .replace(/\breturn\s+/g, 'return ');
  // eslint-disable-next-line no-new-func
  return new Function(...params, `${GLSL_RUNTIME}\n${body}`);
}

const gridLineFn = extractFn('gridLine');
check('抽得到 gridLine 函数', !!gridLineFn);
const easeOutFn = extractFn('easeOut');
check('抽得到 easeOut 函数（GLSL 里没有，必须自己定义）', !!easeOutFn);

if (gridLineFn) {
  const gridLine = toJs(gridLineFn);

  /* ★ 核心断言：线在哪。
   * v 是半整数时是线心，v 是整数时是两条线的正中间。 */
  const W = 0.02;
  check('网格线：v=0.5（线心）应该亮', gridLine(0.5, W) > 0.99, `实际 ${gridLine(0.5, W).toFixed(3)}`);
  check('网格线：v=1.5（线心）应该亮', gridLine(1.5, W) > 0.99, `实际 ${gridLine(1.5, W).toFixed(3)}`);
  check('网格线：v=1.0（两线中间）应该暗', gridLine(1.0, W) < 0.01, `实际 ${gridLine(1.0, W).toFixed(3)}`);
  check('网格线：v=2.0（两线中间）应该暗', gridLine(2.0, W) < 0.01, `实际 ${gridLine(2.0, W).toFixed(3)}`);

  /* ★ 这一条直接抓住"极性写反"：采样一个周期，
   *   亮的比例必须很小。极性反了的话这个值会接近 1。 */
  let lit = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const v = i / (N / 4);            // 覆盖 4 个周期
    if (gridLine(v, W) > 0.5) lit++;
  }
  const ratio = lit / N;
  check(
    '网格线：亮的像素占比 < 15%（极性写反会接近 100%）',
    ratio < 0.15,
    `实际 ${(ratio * 100).toFixed(1)}%`,
  );
  check('网格线：亮的像素占比 > 0.5%（不能一条线都没有）', ratio > 0.005, `实际 ${(ratio * 100).toFixed(1)}%`);

  /* 线宽应该随 w 单调变宽 —— 抗锯齿的基础 */
  const litAt = (w) => {
    let n = 0;
    for (let i = 0; i < 4000; i++) if (gridLine(i / 1000, w) > 0.5) n++;
    return n;
  };
  check('网格线：线宽随 w 单调变宽', litAt(0.04) > litAt(0.02) && litAt(0.02) > litAt(0.01));
}

if (easeOutFn) {
  const easeOut = toJs(easeOutFn);
  check('easeOut(0) = 0', Math.abs(easeOut(0)) < 1e-6, `实际 ${easeOut(0)}`);
  check('easeOut(1) = 1', Math.abs(easeOut(1) - 1) < 1e-6, `实际 ${easeOut(1)}`);
  check('easeOut 是"开头快结尾稳"（中点已过半）', easeOut(0.5) > 0.5, `实际 ${easeOut(0.5).toFixed(3)}`);
  check('easeOut 越界输入被夹住', easeOut(3) === 1 && easeOut(-1) === 0);
}

/* ---------- 3. 衰减因子必须在真实取值范围内非零 ----------
 * 这一条抓的是第二个坑。把 fade 那一句抽出来，在真实的
 * dy ∈ [0, 0.44]（→ depth ∈ [1.67, 6.25]）上求值。 */
const fadeExpr = /float\s+fade\s*=\s*([\s\S]*?);/.exec(frag.body);
check('抽得到 fade 表达式', !!fadeExpr);

if (fadeExpr) {
  const expr = fadeExpr[1].replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');
  const horizon = -0.06;
  const evalFade = (dy) => {
    const depth = 1 / (dy + 0.16);
    // eslint-disable-next-line no-new-func
    return new Function('dy', 'depth', `${GLSL_RUNTIME}\nreturn (${expr});`)(dy, depth);
  };
  let maxFade = 0;
  for (let i = 0; i <= 200; i++) maxFade = Math.max(maxFade, evalFade((i / 200) * 0.44));
  check(
    '衰减因子在地面范围内有非零峰值（恒为 0 = 整片网格被乘没了）',
    maxFade > 0.8,
    `实际峰值 ${maxFade.toFixed(3)}`,
  );

  const atBottom = evalFade(0.44);
  check('屏幕最底部（最近处）网格仍然可见', atBottom > 0.5, `实际 ${atBottom.toFixed(3)}`);
  const nearHorizon = evalFade(0.01);
  check('贴近地平线处淡出（那里网格无限密，只会是摩尔纹）', nearHorizon < 0.1, `实际 ${nearHorizon.toFixed(3)}`);
}

/* ---------- 4. 性能相关的结构约束 ----------
 * 这几个是"改回去就会掉帧"的点，用文本断言守住。 */

/** 从 `marker` 处开始做花括号配对，返回整个块（含大括号）。
 *  ★ 不能用正则偷懒：`subscribe((t) => { ... });` 里嵌着箭头函数和
 *    if 块，非贪婪正则会一路吃到**下一个** subscribe 的结尾 ——
 *    于是"第一个循环里没有 resize"这条会误报（它吃到了第二个组件的 resize）。 */
function braceBlock(text, startIdx) {
  const open = text.indexOf('{', startIdx);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

const loopBlocks = [];
for (let i = src.indexOf('subscribe((t)'); i >= 0; i = src.indexOf('subscribe((t)', i + 1)) {
  const b = braceBlock(src, i);
  if (b) loopBlocks.push(b);
}
check('找得到渲染循环（subscribe 调用）', loopBlocks.length >= 2, `实际 ${loopBlocks.length} 个`);
check(
  '渲染循环里没有每帧调 resize（会触发强制同步布局）',
  loopBlocks.every((b) => !/\bresize\s*\(\)/.test(b)),
  loopBlocks.find((b) => /\bresize\s*\(\)/.test(b))?.slice(0, 120),
);
check('用 ResizeObserver 而不是 resize 事件', /new ResizeObserver/.test(src));
check('有帧率上限常量 FRAME_MS', /const FRAME_MS = 1000 \/ 60/.test(src));
check('页面隐藏时暂停（document.hidden）', /document\.hidden/.test(src));
check('有共享的 rAF 调度（而不是两层各自 requestAnimationFrame）', /const subscribers = new Set/.test(src));
check('卸载时释放 WebGL context', /WEBGL_lose_context/.test(src));
check('卸载时退订共享循环', /unsubscribe\(\);/.test(src));

/* ---------- 汇总 ---------- */
console.log('\n开场 3D 背景 · 着色器数学回归');
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${failures.length}`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('✓ 全部通过');
}
