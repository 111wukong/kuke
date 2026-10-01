/* 测试总入口
 *
 * 四组，从快到慢、从纯到集成：
 *   1. content    内容自检 —— 每道题的参考答案都真跑一遍
 *   2. unit       单元测试 —— 纯函数（判题 / 范式 / FSRS / 图谱 / 渲染器）
 *   3. api        接口冒烟 —— 起真服务跑完整业务流程
 *   4. hardening  加固回归 —— 安全头 / 限流 / 沙箱逃逸 / 权限边界
 *   5. contrast   主题对比度 —— 8 套主题的文字色是否过 WCAG AA
 *   6. fonts      古风字体 —— 资产/CSS/主题注册表三方对齐
 *   7. browser    浏览器冒烟 + 截图（需要能跑无头浏览器的环境，跑不了会明确跳过）
 *
 * ── 为什么 fonts 也要单独一组 ───────────────────────────────────
 * 字体错了不会报错，也不会让截图变难看 —— 只是从楷体变成了黑体。
 * 它比颜色更依赖"三处同时改对"：public/ 里的资产、styles/ 里的
 * @font-face、lib/themes.ts 里的注册项。少改一处就静默退化。
 *
 * ── 为什么 contrast 要单独一组 ──────────────────────────────────
 * 它守的是**看不见的回归**。改主题时把某个 fg 调暗一点，
 * 页面照样渲染、截图照样好看（你盯着的永远是主色和标题），
 * 而「未入班」「登录 IP」这类小字已经读不出来了。
 * 这个项目里实际发生过：8 套主题的 fg-faint 全在 1.8~2.6:1，
 * 而 fg 和 fg-soft 都在 6:1 以上 —— 光看截图完全看不出问题。
 *
 * ── 为什么 content 要单独一组 ───────────────────────────────────
 * 它检查的不是代码，是**内容**：45 个关卡的参考答案、15 道范式题、
 * 9 个实验台、74 道客观题。这类错误的症状是"学生写对了却被判错"，
 * 而代码测试一条都查不出来。所以必须有一组专门跑内容。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { name: '内容自检', file: 'content.mjs', desc: '每道题的参考答案都真跑一遍' },
  { name: '单元测试', file: 'unit.mjs', desc: '判题 / 范式算法 / FSRS / 图谱 / 渲染器' },
  { name: '接口冒烟', file: 'api.mjs', desc: '起真服务跑完整业务流程' },
  { name: '加固回归', file: 'hardening.mjs', desc: '安全头 / 限流 / 沙箱逃逸 / 权限边界' },
  { name: '主题对比度', file: 'contrast.mjs', desc: '9 套主题的文字色是否过 WCAG AA（纯静态，最快）' },
  { name: '子路径部署', file: 'subpath.mjs', desc: '裸 href / window.location / basename 前缀没被绕过（纯静态）' },
  { name: '开场3D', file: 'fx-shader.mjs', desc: '着色器数学：网格极性 / 衰减因子 / 循环里的 resize（纯静态，不需要 GPU）' },
  { name: '古风字体', file: 'fonts.mjs', desc: '字体资产与 CSS 对齐 / 楷体栈有兜底 / 主题与样式表一致（纯静态）' },
  { name: 'AI 纯函数', file: 'ai-unit.mjs', desc: '表达式求值器 / 出题清洗不变量 / 阶段状态机 / 工具白名单' },
  { name: 'AI 配置规则', file: 'ai-config.mjs', desc: '全局配置继承 / 自助注册不继承 / 个人覆盖 / 权限边界' },
  { name: 'AI 端到端', file: 'ai.mjs', desc: '多智能体课堂 / 工具调用 / 出题入库 / 讲评（mock 上游）' },
  { name: '浏览器冒烟', file: 'browser.mjs', desc: '真浏览器逐页断言 + 截图（跑不了会跳过）' },
  { name: 'AI 课堂冒烟', file: 'browser-ai.mjs', desc: '真浏览器跑一节 AI 课：开课 / 作答 / 黑板（跑不了会跳过）' },
];

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = only.length
  ? SUITES.filter((s) => only.some((o) => s.file.includes(o) || s.name.includes(o)))
  : SUITES;

console.log('库课 · 测试');
console.log('═'.repeat(64));

const summary = [];
for (const s of suites) {
  console.log(`\n▶ ${s.name}  —— ${s.desc}`);
  const t0 = Date.now();
  const code = await run(s.file);
  summary.push({ ...s, code, ms: Date.now() - t0 });
}

console.log('\n' + '═'.repeat(64));
console.log('汇总');
for (const s of summary) {
  const mark = s.code === 0 ? '✓' : '✗';
  console.log(`  ${mark} ${s.name.padEnd(12, '　')} ${(s.ms / 1000).toFixed(1)}s`);
}

const failed = summary.filter((s) => s.code !== 0);
if (failed.length) {
  console.log(`\n${failed.length} 组失败：${failed.map((s) => s.name).join('、')}`);
  process.exit(1);
}
console.log('\n全部通过。');
