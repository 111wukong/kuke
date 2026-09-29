/* 浏览器冒烟 + 截图
 *
 * ⚠️ 这个脚本需要**能跑起无头浏览器**的环境。
 *    本机沙箱里跑不了 —— Chrome 的进程沙箱初始化失败（Operation not permitted），
 *    加 --no-sandbox 之后进程又会被外层以 SIGTERM 杀掉；
 *    CDP 的页面级 WebSocket 通道也被阻断（浏览器级能连，页面级握手后立刻 1006）。
 *    三条路都试过，所以这里**检测到跑不了就明确跳过**，而不是假装通过。
 *    在有真实桌面环境的机器或 CI 上，它会正常出图并断言。
 *
 * 用法：
 *   node tests/browser.mjs           # 跑冒烟 + 出图
 *   node tests/browser.mjs --shots   # 只出图
 *   KUKE_BROWSER=/path/to/chrome node tests/browser.mjs
 */
import { startServer, check, report } from './lib/harness.mjs';
import { runProbe, screenshot, dumpDom, domText, cleanupProfile, findBrowser } from './lib/cli-browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.resolve('docs/screenshots');
const DIST = path.resolve('web/dist');
const shotsOnly = process.argv.includes('--shots');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('web/dist 不存在。先跑 npm run build。');
  process.exit(1);
}

const browserBin = findBrowser();
if (!browserBin) {
  console.log('\n⚠ 找不到浏览器，跳过浏览器测试。');
  console.log('  装一个 Chrome，或者设 KUKE_BROWSER=/path/to/chrome。');
  process.exit(0);
}

/* ---------- 先探一次：浏览器能不能真的跑起来 ---------- */
const srv = await startServer();
let canRun = false;
try {
  /* 短超时 + 立刻放弃：这个环境里 Chrome 要么起不来要么被外层杀掉，
   * 探测阶段必须快，不能把整个测试入口拖死。 */
  const probe = await dumpDom(`${srv.base}/api/health`, { budget: 3000, timeout: 15000 });
  canRun = probe.includes('"ok"') || probe.includes('ok');
} catch (e) {
  console.log('\n⚠ 无头浏览器在这个环境里跑不起来，跳过。');
  console.log(`  原因：${String(e.message).split('\n')[0]}`);
  console.log('  这是环境限制（沙箱拦了 Chrome 的进程），不是项目的问题。');
  await srv.stop();
  cleanupProfile();
  process.exit(0);
}

const LOGIN = 'teacher@test.local:Teacher123';
const results = [];

/* ============================================================
   截图：逐页拍
   ============================================================ */
const PAGES = [
  ['02-dashboard', '/', '今日进度'],
  ['03-knowledge-tree', '/learn', '基础理论'],
  ['04-knowledge-detail', '/learn/k-groupby', 'GROUP BY'],
  ['05-sql-lab', '/lab/sql', '表结构'],
  ['06-levels', '/levels', '通关进度'],
  ['07-level-detail', '/levels/L03', '条件筛选'],
  ['08-normalize', '/normalize', '范式实验室'],
  ['09-index-lab', '/lab', '实验台'],
  ['10-review', '/review', '复习队列'],
  ['11-mistakes', '/mistakes', '错题本'],
  ['12-stats', '/stats', '累计作答'],
  ['13-achievements', '/achievements', '成就墙'],
  ['14-assignments', '/assignments', '作业'],
  ['15-classes', '/classes', '班级'],
  ['16-settings', '/settings', '外观'],
  ['17-admin', '/admin', '教师工作台'],
];

console.log(`\n[浏览器] ${browserBin}`);
console.log(`[截图] 输出到 ${SHOT_DIR}\n`);

for (const [name, route, expect] of PAGES) {
  try {
    await screenshot(
      `${srv.base}/__probe.html?login=${encodeURIComponent(LOGIN)}&to=${encodeURIComponent(route)}`,
      path.join(SHOT_DIR, `${name}.png`),
      { width: 1440, height: 940, budget: 16000 },
    );
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name} —— ${String(e.message).split('\n')[0]}`);
  }
}

/* 亮色主题各来一张 */
for (const [name, route] of [['18-dashboard-light', '/'], ['19-sql-lab-light', '/lab/sql']]) {
  try {
    await screenshot(
      `${srv.base}/__probe.html?login=${encodeURIComponent(LOGIN)}&to=${encodeURIComponent(route)}&theme=paper`,
      path.join(SHOT_DIR, `${name}.png`),
      { width: 1440, height: 940, budget: 16000 },
    );
    console.log(`  ✓ ${name}`);
  } catch { /* 忽略 */ }
}

if (shotsOnly) {
  await srv.stop();
  cleanupProfile();
  console.log(`\n截图完成 → ${SHOT_DIR}`);
  process.exit(0);
}

/* ============================================================
   冒烟：用同源 iframe 探针驱动交互
   ============================================================ */
console.log('\n[冒烟] 逐页断言\n');

async function probe(name, to, steps) {
  try {
    const log = await runProbe(DIST, {
      base: srv.base, login: LOGIN, to, steps,
      width: 1440, height: 940, budget: 24000,
    });
    const bad = log.filter((r) => r.act === 'fatal' || r.error || r.ok === false);
    check(name, bad.length === 0,
      bad.map((b) => `${b.act}: ${b.error || '断言不成立'}${b.actual ? ` 实际=${String(b.actual).slice(0, 120)}` : ''}`).join(' | '));
    return log;
  } catch (e) {
    check(name, false, String(e.message).split('\n')[0]);
    return [];
  }
}

await probe('仪表盘：渲染了今日进度与概览卡', '/', [
  { act: 'assert', expr: "document.body.innerText.includes('今日进度')", timeout: 12000 },
  { act: 'assert', expr: "['待复习','错题','总正确率','SQL 关卡'].every(t => document.body.innerText.includes(t))" },
]);

await probe('知识树：七个分类都在', '/learn', [
  { act: 'assert', expr: "['基础理论','SQL 语言','数据库设计','存储与索引','查询优化','事务与并发','恢复与安全'].every(t => document.body.innerText.includes(t))", timeout: 12000 },
  { act: 'click', text: '按可学性' },
  { act: 'assert', expr: "document.body.innerText.includes('现在可以学的')" },
]);

await probe('知识点详情：正文渲染且标记不漏屏', '/learn/k-groupby', [
  { act: 'assert', expr: "!!document.querySelector('.prose-doc')", timeout: 12000 },
  { act: 'assert', expr: "!!document.querySelector('.prose-doc pre code')" },
  { act: 'assert', expr: "!!document.querySelector('.prose-doc table')" },
  { act: 'assert', expr: "!!document.querySelector('.prose-doc .tok-kw')" },
  {
    act: 'assert',
    expr: `(() => {
      const t = document.querySelector('.prose-doc').innerText;
      return !/\\*\\*/.test(t) && !/\\\`/.test(t) && !/^#{1,6}\\s/m.test(t);
    })()`,
  },
]);

await probe('SQL 实训场：跑查询能出结果', '/lab/sql', [
  { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 12000 },
  { act: 'assert', expr: "document.body.innerText.includes('表结构')" },
  {
    act: 'fill', sel: 'textarea',
    value: "SELECT sname, sdept FROM student WHERE sdept = '计算机系';",
  },
  { act: 'click', text: '运行' },
  { act: 'assert', expr: "document.body.innerText.includes('张伟')", timeout: 12000 },
  { act: 'assert', expr: "document.body.innerText.includes('sname')" },
]);

await probe('SQL 实训场：错误 SQL 给可读提示', '/lab/sql', [
  { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 12000 },
  { act: 'fill', sel: 'textarea', value: 'SELECT * FROM 不存在的表;' },
  { act: 'click', text: '运行' },
  { act: 'assert', expr: "/执行出错|不存在/.test(document.body.innerText)", timeout: 10000 },
]);

await probe('关卡：错误答案判错、正确答案过关', '/levels/L03', [
  { act: 'assert', expr: "document.body.innerText.includes('条件筛选')", timeout: 12000 },
  { act: 'fill', sel: 'textarea', value: 'SELECT sno FROM student;' },
  { act: 'click', text: '提交答案' },
  { act: 'assert', expr: "document.body.innerText.includes('还没通过')", timeout: 12000 },
  { act: 'assert', expr: "document.body.innerText.includes('期望的结果')" },
  { act: 'fill', sel: 'textarea', value: "SELECT * FROM student WHERE sdept = '计算机系';" },
  { act: 'click', text: '提交答案' },
  { act: 'assert', expr: "document.body.innerText.includes('过关')", timeout: 12000 },
]);

await probe('范式实验室：切换题目并提交答案', '/normalize', [
  { act: 'assert', expr: "document.body.innerText.includes('范式实验室')", timeout: 12000 },
  { act: 'click', text: '部分依赖' },
  { act: 'assert', expr: "['1NF','2NF','3NF','BCNF'].every(t => document.body.innerText.includes(t))", timeout: 8000 },
  { act: 'click', text: '1NF' },
  { act: 'click', text: '提交' },
  { act: 'assert', expr: "document.body.innerText.includes('正确')", timeout: 10000 },
  { act: 'click', text: '看推导' },
  { act: 'assert', expr: "document.body.innerText.includes('完整推导')", timeout: 10000 },
]);

await probe('索引实验：展示真实的执行计划', '/lab', [
  { act: 'assert', expr: "document.body.innerText.includes('要分析的查询')", timeout: 12000 },
  { act: 'click', text: 'CREATE INDEX' },
  { act: 'click', text: '提交判断' },
  { act: 'assert', expr: "document.body.innerText.includes('数据库自己怎么说')", timeout: 12000 },
  { act: 'assert', expr: "/SCAN|SEARCH/i.test(document.body.innerText)" },
]);

await probe('统计页：图表渲染出来了', '/stats', [
  { act: 'assert', expr: "document.body.innerText.includes('累计作答')", timeout: 12000 },
  { act: 'assert', expr: "!!document.querySelector('.recharts-surface') || document.body.innerText.includes('还没有作答记录')" },
]);

await probe('设置页：切换主题生效', '/settings', [
  { act: 'assert', expr: "document.body.innerText.includes('外观')", timeout: 12000 },
  { act: 'assert', expr: "document.body.innerText.includes('宣纸')" },
  { act: 'click', text: '宣纸' },
  { act: 'assert', expr: "document.documentElement.getAttribute('data-theme') === 'paper'", timeout: 6000 },
  {
    act: 'assert',
    expr: `(() => {
      const s = getComputedStyle(document.body);
      const lum = (c) => { const m = c.match(/(\\d+),\\s*(\\d+),\\s*(\\d+)/); return m ? (+m[1]*0.299 + +m[2]*0.587 + +m[3]*0.114) / 255 : null; };
      const f = lum(s.color), b = lum(s.backgroundColor);
      return f !== null && b !== null && f < 0.5 && b > 0.5;
    })()`,
  },
]);

await probe('教师工作台：六个标签页都在', '/admin', [
  { act: 'assert', expr: "document.body.innerText.includes('教师工作台')", timeout: 12000 },
  { act: 'assert', expr: "['总览','学生管理','班级','作业','内容','审计日志'].every(t => document.body.innerText.includes(t))" },
  { act: 'click', text: '学生管理' },
  { act: 'assert', expr: "document.body.innerText.includes('批量建号') || document.body.innerText.includes('还没有学生')", timeout: 8000 },
]);

await probe('移动端：不出现横向滚动', '/', [
  { act: 'assert', expr: "document.body.innerText.includes('今日进度')", timeout: 12000 },
  { act: 'assert', expr: 'document.documentElement.scrollWidth <= window.innerWidth + 2' },
]);

await probe('登出后受保护页面会回到登录页', '/', [
  { act: 'assert', expr: "document.body.innerText.includes('今日进度')", timeout: 12000 },
  { act: 'assert', expr: "fetch('/api/auth/logout', {method:'POST', credentials:'same-origin'}).then(r => r.status === 200)", timeout: 8000 },
  { act: 'assert', expr: "!!document.querySelector('input[type=email]')", timeout: 10000 },
]);

/* ---------- 清理 ---------- */
await srv.stop();
cleanupProfile();

const shots = fs.existsSync(SHOT_DIR) ? fs.readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')) : [];
console.log(`\n截图 ${shots.length} 张 → ${SHOT_DIR}`);

report('浏览器冒烟测试');
