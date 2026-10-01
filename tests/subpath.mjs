/* 子路径部署回归（静态扫描）
 *
 * ── 为什么需要这一组 ────────────────────────────────────────────
 * 库课挂在 https://aiallcc.club/kuke/ 这个**子路径**下（根路径归「研数」），
 * 路由 basename 是 /kuke/。而 basename 只有 React Router 自己认：
 *   <Link> / <NavLink> / navigate()  → href 会带上 /kuke
 *   原生 <a href="/xxx">             → 浏览器解析，**不带**前缀
 * 后者会解析成 https://aiallcc.club/xxx —— 隔壁应用的地址。
 *
 * 这个缺陷的表现是所有失效方式里最误导人的一种：
 *   不报错、不 404、控制台干净。研数是 SPA，任何未知路径都回它自己首页，
 *   于是"点进去变成了研数"看起来像是跳转成功、只是内容不对。
 *   很容易被误判成权限问题或数据问题（实际发生过一次：
 *   全站 53 处 AppLink 里 34 处走裸 <a href>，都跳到了研数）。
 *
 * 类型检查、构建、接口测试**都查不出它** —— 代码本身完全合法，
 * href 在浏览器里才被解析。所以只能靠源码级的规则来守。
 *
 * ── 这一组守四条规则 ────────────────────────────────────────────
 *   ① 站内路由（以 / 开头）不得写成裸 href
 *   ② AppLink 的"新标签"分支必须走 <Link>（新标签行为不能因此丢掉）
 *   ③ 站内跳转不得用 window.location.href / assign / replace
 *   ④ 扫描对象本身还在（组件改名不该让这一组变成永远绿空转）
 *      以及 markdown 里的站内链接必须补前缀
 *
 * ── ★ 扫描前必须先剥注释 ────────────────────────────────────────
 * 这不算洁癖：本项目最爱做的事就是在注释里写反例
 * （比如 links.tsx 里为了说明坑，专门写了 `<a href="/levels/12">`）。
 * 不剥注释的话，这一组会因为"文档里提到了错误写法"而永远红 ——
 * 而更常见的后果是有人受不了，干脆把断言删掉。
 *
 * 跑法：node tests/subpath.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../web/src');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; return; }
  failures.push(`${name}${detail ? '  → ' + detail : ''}`);
}

/* ---------- 收集源码文件 ---------- */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(SRC).sort();

/* ---------- 剥注释 ----------
 * 行注释的判定要求 // 前面不是 : ' " \ —— 否则 `'https://a.com'`
 * 这类字符串会被从中间切断，把同一行后面的真问题一起藏掉。 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const rel = (p) => path.relative(SRC, p);

/* ============================================================
   ① 站内路由不得写成裸 href
   ============================================================ */
console.log('\n① 站内路由不得写成裸 href');

/* 匹配 <a ... href="/xxx" 、href={'/xxx'} 、href={`/xxx`} */
const BARE_HREF = /<a\b[^>]*?href=\s*\{?\s*['"`]\/[^/]/g;
/* 也匹配 JSX 里直接写 href={to} 这种"变量透传"到 <a> 的写法 */
const HREF_VAR = /<a\b[^>]*?href=\{([A-Za-z_$][\w$]*)\}/g;

/* ---------- 白名单：只允许**注释里写明理由**的例外 ----------
 * 现在的唯一例外是 markdown 渲染器：里面的链接是**模型生成的字符串**，
 * 既有外链（https://...）也可能是站内路由，没法走 <Link> 组件。
 * 它自己那条路已经在 ⑤ 里单独守了（站内补前缀、其余协议拦成 #）。
 *
 * ★ 白名单必须自带"还在用"的校验（见下面的 stale 检查）——
 *   否则哪天 markdown 改成走 <Link> 了，这条赦免会永远躺着，
 *   下次真出现同类 bug 时就地放行，没人知道。 */
const ALLOW = [
  {
    file: 'lib/markdown.tsx',
    varName: 'safe',
    why: 'markdown 渲染器的链接是模型生成的字符串（可能是外链），无法走 <Link>；前缀与协议白名单由本文件 ⑤ 单独守',
    seen: false,
  },
];

function allowed(file, varName) {
  const hit = ALLOW.find((a) => a.file === file && a.varName === varName);
  if (hit) hit.seen = true;
  return !!hit;
}

let bareHits = 0;
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(BARE_HREF)) {
    bareHits++;
    check(`${rel(f)}: 裸 <a href> 指向站内路由（应改用 <Link>）`, false, m[0].slice(0, 70));
  }
  /* href={var} 在别处出现，同样意味着绕过了 Link */
  for (const m of src.matchAll(HREF_VAR)) {
    if (allowed(rel(f), m[1])) continue;
    bareHits++;
    check(`${rel(f)}: <a href={${m[1]}}> 变量透传 href（应改用 <Link to={...}>）`, false, m[0]);
  }
}
check(`全站没有裸 <a href> 指向站内路由（扫了 ${files.length} 个文件）`, bareHits === 0, `${bareHits} 处`);

for (const a of ALLOW) {
  check(`白名单条目仍在生效（${a.file} · href={${a.varName}}）—— 过期条目要删掉，不能永久赦免`,
    a.seen, '没扫到该写法，白名单已过期');
}

/* 其它形态：window.open('/xxx')、location.href 赋值 */
const WIN_OPEN = /window\.open\(\s*['"`]\/[^/]/g;
let openHits = 0;
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(WIN_OPEN)) {
    openHits++;
    check(`${rel(f)}: window.open('/xxx') 是裸路径（应改用 <Link target="_blank">）`, false, m[0]);
  }
}
check('全站没有 window.open 裸路径', openHits === 0, `${openHits} 处`);

/* ============================================================
   ② 站内跳转不得用 window.location
   ============================================================ */
console.log('② 站内跳转不得用 window.location');

const LOC = /window\.location(?:\.(?:href|pathname))\s*=|location\.(?:assign|replace)\(\s*['"`]\/[^/]/g;
let locHits = 0;
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(LOC)) {
    locHits++;
    check(`${rel(f)}: 站内跳转用了 window.location / location.assign（改用 useNavigate()）`, false, m[0].slice(0, 70));
  }
}
check('全站没有用 window.location 做站内跳转', locHits === 0, `${locHits} 处`);

/* ============================================================
   ③ AppLink 必须走 Link（新标签行为不能丢）
   ============================================================ */
console.log('③ AppLink 必须走 Link');

const links = stripComments(fs.readFileSync(path.join(SRC, 'lib/links.tsx'), 'utf8'));
const appLink = links.slice(links.indexOf('export function AppLink'));
check('links.tsx: AppLink 改用 <Link>（href 由 useHref 算，自动带 basename）',
  /<Link\b/.test(appLink) && !/<a\b/.test(appLink));
check('links.tsx: 新标签分支仍在（target="_blank" 没被顺手删掉）',
  /target="_blank"/.test(appLink));
check('links.tsx: 新标签分支保留了 rel="noopener noreferrer"',
  /rel="noopener noreferrer"/.test(appLink));

/* ============================================================
   ④ 扫描对象还在（防止测试空转成永远绿）
   ============================================================ */
console.log('④ 扫描对象还在（防空转）');

let appLinkUses = 0;
for (const f of files) {
  if (rel(f) === 'lib/links.tsx') continue;
  appLinkUses += (stripComments(fs.readFileSync(f, 'utf8')).match(/<AppLink\b/g) || []).length;
}
check(`站内还有 AppLink 调用点（当前 ${appLinkUses} 处）—— 组件被改名时这一组要跟着改，不能装作通过`,
  appLinkUses >= 20, `只扫到 ${appLinkUses} 处`);

/* ============================================================
   ⑤ markdown 的站内链接要补前缀
   ============================================================ */
console.log('⑤ markdown 渲染的站内链接要补前缀');

const md = stripComments(fs.readFileSync(path.join(SRC, 'lib/markdown.tsx'), 'utf8'));
check('markdown.tsx: 站内链接（以 / 开头）补上了部署前缀',
  /BASE_PATH\s*\+\s*tok\.href/.test(md) || /BASE_PATH\s*\+/.test(md));
check('markdown.tsx: BASE_PATH 用可选链兜底（否则单元测试整组静默跳过）',
  /import\.meta\s+as\s+any/.test(md) && /env\?\./.test(md));
check('markdown.tsx: 非 http / 非站内的协议仍然被拦成 #',
  /'#'/.test(md));

/* ---------- 汇总 ---------- */
console.log('\n子路径部署回归');
console.log('─'.repeat(60));
console.log(`扫 ${files.length} 个文件 · 通过 ${pass} · 失败 ${failures.length}`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('✓ 全部通过');
}
