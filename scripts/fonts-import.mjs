/* 古风字体导入脚本 · 把霞鹜文楷的网页字体切片搬进仓库
 *
 * ── 为什么要有这个脚本，而不是手工 cp 一遍 ──────────────────────
 * 字体资产是**二进制**，进了 git 就基本不会再动。手工搬的后果是：
 * 半年后要升字体版本时，没人知道当初那 97 个文件是从哪个包的哪个版本
 * 切出来的、文件名为什么长这样、CSS 里那些 unicode-range 是从哪抄的。
 * 所以搬运规则必须写成代码。
 *
 * ── 它做什么 ────────────────────────────────────────────────────
 *   输入：lxgw-wenkai-screen-webfont 解包后的目录（含 files/ 和 *.css）
 *   输出：
 *     ① web/public/fonts/*.woff2   —— 97 个切片，文件名带内容哈希
 *     ② web/src/styles/wenkai.css  —— @font-face + unicode-range
 *
 * ── 两个刻意的设计 ──────────────────────────────────────────────
 *
 * 1. **用 GB 变体，不用全量变体。**
 *    全量变体 20MB / 388 个切片，GB 变体 4.3MB / 97 个切片。
 *    GB2312 的 6763 个汉字覆盖了本项目全部 1475 个自有汉字（实测 100%），
 *    超出的部分交给系统字体兜底 —— 生僻字本来也不该由网页字体承担。
 *    代价是 5 倍体积差，收益是几乎为零的覆盖率差。
 *
 * 2. **文件名带内容哈希。**
 *    服务端（server/src/index.js）的静态资源缓存策略是靠**文件名里有没有
 *    哈希**来判断能不能永久缓存的。叫 `subset-21.woff2` 的话，它会被
 *    判成「不能长缓存」而每次回源；而它明明是个永不改变的文件。
 *    所以这里按内容算一个短哈希拼进去，让那条规则自然命中 ——
 *    不用去改服务端代码加特例。
 *    顺带解决另一个问题：将来升字体版本时文件名会变，老缓存自动失效，
 *    不会出现「服务器换了字体但学生看到的还是旧的」。
 *
 * 用法：
 *   # 1. 取包（任选，npmmirror 在国内更快）
 *   npm pack lxgw-wenkai-screen-webfont@1.7.0 --registry=https://registry.npmmirror.com
 *   tar xzf lxgw-wenkai-screen-webfont-1.7.0.tgz
 *   # 2. 导入
 *   node scripts/fonts-import.mjs package
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_FONTS = path.join(ROOT, 'web/public/fonts');
const OUT_CSS = path.join(ROOT, 'web/src/styles/wenkai.css');

/* 只用 GB 变体。见文件头第 1 条。 */
const SRC_CSS = 'lxgwwenkaigbscreen.css';
/* 对外暴露的家族名。不用包里的原名（LXGW WenKai Screen），
 * 因为那个名字容易被系统里已经装了的同名桌面字体抢走 ——
 * 于是「明明自托管了字体，显示出来的却是别的东西」。 */
const FAMILY = 'LXGW WenKai GB';

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('用法：node scripts/fonts-import.mjs <解包后的 lxgw-wenkai-screen-webfont 目录>');
  process.exit(1);
}
const cssPath = path.join(srcDir, SRC_CSS);
if (!fs.existsSync(cssPath)) {
  console.error(`找不到 ${cssPath}。先解包：tar xzf lxgw-wenkai-screen-webfont-*.tgz`);
  process.exit(1);
}

const src = fs.readFileSync(cssPath, 'utf8');

/* 抓出每个 @font-face 的 (源文件名, unicode-range)。
 * 不用正则一把抓整块：块里既有 url() 又有 unicode-range，
 * 顺序固定但换行不定，逐块扫更稳。 */
const blocks = [];
for (const m of src.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
  const body = m[1];
  const file = /url\(['"]\.\/files\/([^'"]+\.woff2)['"]\)/.exec(body);
  /* ⚠️ 不能写成 `([^;]+);` —— 上游 CSS 里 unicode-range 是这一块的
   * 最后一行，**没有分号**（`unicode-range: U+… \n }`）。
   * 要求分号的话会一条都匹配不上，而报错信息会指向"结构可能变了"，
   * 把人往错的方向带。 */
  const range = /unicode-range:\s*([^;\n}]+)/.exec(body);
  if (file && range) blocks.push({ file: file[1], range: range[1].trim() });
}
if (!blocks.length) {
  console.error('一个 @font-face 都没解析出来，源 CSS 结构可能变了。');
  process.exit(1);
}

fs.mkdirSync(OUT_FONTS, { recursive: true });
/* 只清我们自己产出的文件，不动目录里其它东西。 */
for (const f of fs.readdirSync(OUT_FONTS)) {
  if (/^lxgwwenkai-gb-\d{3}\.[0-9a-f]{8}\.woff2$/.test(f)) fs.unlinkSync(path.join(OUT_FONTS, f));
}

const rules = [];
let total = 0;
for (const b of blocks) {
  const num = (/subset-(\d+)\.woff2$/.exec(b.file) || [])[1];
  if (!num) { console.error(`文件名里没有 subset 编号：${b.file}`); process.exit(1); }
  const buf = fs.readFileSync(path.join(srcDir, 'files', b.file));
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const name = `lxgwwenkai-gb-${String(num).padStart(3, '0')}.${hash}.woff2`;
  fs.writeFileSync(path.join(OUT_FONTS, name), buf);
  total += buf.length;
  rules.push(
    `@font-face {\n`
    + `  font-family: '${FAMILY}';\n`
    + `  font-style: normal;\n`
    + `  font-weight: 400;\n`
    /* swap：字体没下完时先用系统字体把字画出来。
     * 中文字体是「几百 KB 起」的量级，block 会让首屏白字几秒。 */
    + `  font-display: swap;\n`
    + `  src: url('/fonts/${name}') format('woff2');\n`
    + `  unicode-range: ${b.range};\n`
    + `}`,
  );
}

const header = `/* 霞鹜文楷 GB（LXGW WenKai Screen · GB2312 子集）
 * ⚠️ 这个文件是 scripts/fonts-import.mjs 生成的，不要手改 ——
 *    改完下次重新导入就没了。要调就改脚本。
 *
 * 来源：lxgw-wenkai-screen-webfont@1.7.0（MIT / OFL，见 web/public/fonts/LICENSE.txt）
 * 切片数：${blocks.length}　合计：${(total / 1048576).toFixed(2)} MB
 *
 * ── 为什么要切成 ${blocks.length} 片 ────────────────────────────────
 * 中文字体没法像拉丁字体那样一个 woff2 搞定 —— 6763 个汉字就是 4MB 起。
 * 所以按 unicode-range 切碎，浏览器**只下载页面上真正出现的那几片**。
 * 一个典型页面大约命中 15~30 片（≈0.8~1.6MB），之后走缓存。
 * 合并成一个文件反而更慢：每个用户都要下完 4.3MB 才能看见第一个字。
 *
 * ── 兜底 ────────────────────────────────────────────────────────
 * 落在所有 unicode-range 之外的字（生僻字、扩展区汉字、其它语种）
 * 不会命中任何 @font-face，浏览器直接往下走 --font-sans 的下一项。
 * 所以字体栈里 webfont 后面必须跟系统楷体 —— 见 index.css 的 --font-kai。
 */

`;

fs.writeFileSync(OUT_CSS, header + rules.join('\n\n') + '\n');
console.log(`✓ 字体切片 ${blocks.length} 个 · ${(total / 1048576).toFixed(2)} MB → web/public/fonts/`);
console.log(`✓ @font-face → web/src/styles/wenkai.css`);

/* 许可证要跟着资产走。MIT/OFL 都要求分发时保留声明。 */
const licenseSrc = path.join(srcDir, 'OFL.txt');
if (fs.existsSync(licenseSrc)) {
  const lic = fs.readFileSync(licenseSrc, 'utf8');
  fs.writeFileSync(
    path.join(OUT_FONTS, 'LICENSE.txt'),
    `霞鹜文楷 / LXGW WenKai — SIL Open Font License 1.1\n`
    + `来源：lxgw-wenkai-screen-webfont@1.7.0（https://github.com/chawyehsu/lxgw-wenkai-webfont）\n`
    + `上游字体：https://github.com/lxgw/LxgwWenKai\n\n`
    + lic,
  );
  console.log('✓ 许可证 → web/public/fonts/LICENSE.txt');
}
