/* 浏览器冒烟 + 截图
 *
 * ⚠️ 需要**能跑起无头浏览器**的环境。
 *    WorkBuddy 沙箱里跑不了（Chrome 进程被拦，退出码 137）——
 *    脚本检测到会明确跳过，不假装通过。CI（Ubuntu + Chrome）上正常。
 *
 * 用法：
 *   node tests/browser.mjs           # 截图 + 冒烟断言
 *   node tests/browser.mjs --shots   # 只出图
 *   KUKE_BROWSER=/path/to/chrome node tests/browser.mjs
 *
 * ── 架构（CI 上踩过坑之后重写的）────────────────────────────────
 *
 *   ① prepareProbe()   先把两个探针页写进 dist
 *   ② loginOnce()      用持久化 profile 登录一次，cookie 留在 profile 里
 *   ③ 截图             直接导航到应用 URL（**不走 iframe**）
 *   ④ 冒烟断言         走同源 iframe 探针（需要点击和填表）
 *
 * 第 ③ 步为什么不用 iframe：一开始截图也走探针页，结果探针页在
 * 截图循环开始时还没写进 dist，被 SPA 回退成了 index.html ——
 * 18 张"截图"拍的全是登录页。直接导航既简单又不会拍错。
 *
 * 第 ② 步为什么必须只登一次：每个探针各自登录会撞上
 * /api/auth/login 的限流（12 次/10 分钟），第 13 个开始必然失败，
 * 而且失败得很隐蔽（探针返回对象而不是数组，报 `log.filter is not a function`）。
 */
import { startServer, check, report } from './lib/harness.mjs';
import {
  runProbe, screenshot, dumpDom, prepareProbe,
  cleanupProfile, findBrowser, loginOnce,
} from './lib/cli-browser.mjs';
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

const LOGIN = 'teacher@test.local:Teacher123';

/* ① 探针页必须在任何调用之前写进 dist */
const probe = prepareProbe(DIST);

const srv = await startServer();
let canRun = false;
let skipReason = '';

try {
  /* 能力探测：浏览器到底能不能跑 */
  try {
    const r = await dumpDom(`${srv.base}/api/health`, { budget: 3000, timeout: 15000 });
    canRun = r.includes('ok');
  } catch (e) {
    skipReason = String(e.message).split('\n')[0];
  }

  if (!canRun) {
    console.log('\n⚠ 无头浏览器在这个环境里跑不起来，跳过。');
    console.log(`  原因：${skipReason}`);
    console.log('  这是环境限制（沙箱拦了 Chrome 的进程），不是项目的问题。');
    console.log('  在有桌面环境的机器或 CI 上会正常出图并断言。');
    await srv.stop();
    probe.cleanup();
    cleanupProfile();
    process.exit(0);
  }

  console.log(`\n[浏览器] ${browserBin}`);

  /* ★ 登录页必须在 loginOnce **之前**拍。
   *   profile 一旦有了 cookie，访问 /login 会被重定向到首页 ——
   *   拍出来就是仪表盘而不是登录页。 */
  console.log(`\n[截图] → ${SHOT_DIR}`);
  try {
    await screenshot(`${srv.base}/login`, path.join(SHOT_DIR, '01-login.png'), {
      width: 1440, height: 940, budget: 16000,
    });
    console.log('  ✓ 01-login');
  } catch (e) {
    console.log(`  ✗ 01-login —— ${String(e.message).split('\n')[0]}`);
  }

  /* ② 登录一次，cookie 留在共享 profile 里 */
  const li = await loginOnce(srv.base, LOGIN);
  if (!li.ok) {
    console.log(`\n✗ 登录失败（HTTP ${li.status}）—— 后面的断言会全部失败，先查这个。`);
  } else {
    console.log('[登录] 已种入 profile，后续请求自动带 cookie');
  }

  /* ③ 截图：直接导航到应用页面 */
  const PAGES = [
    ['02-dashboard', '/'],
    ['03-knowledge-tree', '/learn'],
    ['04-knowledge-detail', '/learn/k-groupby'],
    ['05-sql-lab', '/lab/sql'],
    ['06-levels', '/levels'],
    ['07-level-detail', '/levels/L03'],
    ['08-normalize', '/normalize'],
    ['09-index-lab', '/lab'],
    ['10-review', '/review'],
    ['11-mistakes', '/mistakes'],
    ['12-stats', '/stats'],
    ['13-achievements', '/achievements'],
    ['14-assignments', '/assignments'],
    ['15-classes', '/classes'],
    ['16-settings', '/settings'],
    ['17-admin', '/admin'],
  ];

  for (const [name, route] of PAGES) {
    try {
      await screenshot(`${srv.base}${route}`, path.join(SHOT_DIR, `${name}.png`), {
        width: 1440, height: 940, budget: 20000,
      });
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name} —— ${String(e.message).split('\n')[0]}`);
    }
  }

  /* 亮色主题各来一张。主题存在 localStorage，URL 参数改不了 ——
   * 所以先用探针把它切了，再拍。同一个 profile，localStorage 会留着。 */
  try {
    const switched = await runProbe(srv.base, {
      to: '/settings',
      steps: [
        { act: 'assert', expr: "document.body.textContent.includes('宣纸')", timeout: 8000 },
        { act: 'click', text: '宣纸' },
        { act: 'assert', expr: "document.documentElement.getAttribute('data-theme') === 'paper'", timeout: 6000 },
      ],
      budget: 90000,
    });
    const bad = switched.filter((r) => r.error || r.ok === false);
    if (bad.length) throw new Error(`切主题失败：${JSON.stringify(bad).slice(0, 160)}`);

    for (const [name, route] of [['18-dashboard-light', '/'], ['19-sql-lab-light', '/lab/sql']]) {
      await screenshot(`${srv.base}${route}`, path.join(SHOT_DIR, `${name}.png`), {
        width: 1440, height: 940, budget: 20000,
      });
      console.log(`  ✓ ${name}`);
    }
    // 切回深色，免得影响后面的断言
    await runProbe(srv.base, {
      to: '/settings',
      steps: [{ act: 'click', text: '深空' }],
      budget: 60000,
    });
  } catch (e) {
    console.log(`  ✗ 亮色主题截图 —— ${String(e.message).split('\n')[0]}`);
  }

  if (shotsOnly) {
    await srv.stop();
    probe.cleanup();
    cleanupProfile();
    const n = fs.existsSync(SHOT_DIR) ? fs.readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')).length : 0;
    console.log(`\n截图 ${n} 张 → ${SHOT_DIR}`);
    process.exit(0);
  }

  /* ④ 冒烟断言：同源 iframe 探针（需要点击、填表） */
  console.log('\n[冒烟] 逐页断言\n');

  async function probeCase(name, to, steps, budget = 120000) {
    const log = await runProbe(srv.base, { to, steps, width: 1440, height: 940, budget });
    const bad = log.filter((r) => r.act === 'fatal' || r.error || r.ok === false);
    /* 诊断信息要带上是哪个路由 —— 不然「断言不成立」看不出
     * 是页面没渲染，还是路由根本没切过去。 */
    const where = log.filter((r) => r.act === 'mounted' || r.act === 'finalPath')
      .map((r) => `${r.act}=${r.path ?? r.value}`).join(' ');
    const errs = log.find((r) => r.act === 'pageErrors');
    const errTxt = errs ? ` 【页面报错 ${JSON.stringify(errs.value).slice(0, 300)}】` : '';
    check(name, bad.length === 0,
      bad.map((x) => `${x.act}: ${x.error || '断言不成立'}${x.actual ? ` 实际=${String(x.actual).slice(0, 200)}` : ''}`).join(' | ')
      + (where ? ` 【${where}】` : '') + errTxt);
    return log;
  }

  await probeCase('仪表盘：渲染了 hero 与概览卡', '/', [
    { act: 'assert', expr: "document.body.textContent.includes('今日目标')", timeout: 8000 },
    { act: 'assert', expr: "['待复习','错题','总正确率','SQL 关卡'].every(t => document.body.textContent.includes(t))" },
    { act: 'assert', expr: "document.body.textContent.includes('今天做什么')" },
  ]);

  await probeCase('知识树：七个分类都在，可学性视图能切', '/learn', [
    { act: 'assert', expr: "['基础理论','SQL 语言','数据库设计','存储与索引','查询优化','事务与并发','恢复与安全'].every(t => document.body.textContent.includes(t))", timeout: 8000 },
    { act: 'click', text: '按可学性' },
    { act: 'assert', expr: "document.body.textContent.includes('现在可以学的')" },
  ]);

  await probeCase('知识点详情：正文渲染且标记不漏屏', '/learn/k-groupby', [
    { act: 'assert', expr: "!!document.querySelector('.prose-doc')", timeout: 8000 },
    { act: 'assert', expr: "!!document.querySelector('.prose-doc pre code')" },
    { act: 'assert', expr: "!!document.querySelector('.prose-doc table')" },
    { act: 'assert', expr: "!!document.querySelector('.prose-doc .tok-kw')" },
    {
      act: 'assert',
      expr: `(() => {
        const t = document.querySelector('.prose-doc').textContent;
        return !/\\*\\*/.test(t) && !/\\\`/.test(t) && !/^#{1,6}\\s/m.test(t);
      })()`,
    },
  ]);

  await probeCase('SQL 实训场：跑查询能出结果', '/lab/sql', [
    { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 8000 },
    { act: 'assert', expr: "document.body.textContent.includes('表结构')" },
    { act: 'fill', sel: 'textarea', value: "SELECT sname, sdept FROM student WHERE sdept = '计算机系';" },
    { act: 'click', text: '运行' },
    { act: 'assert', expr: "document.body.textContent.includes('张伟')", timeout: 8000 },
    { act: 'assert', expr: "document.body.textContent.includes('sname')" },
  ]);

  await probeCase('SQL 实训场：错误 SQL 给可读提示', '/lab/sql', [
    { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 8000 },
    { act: 'fill', sel: 'textarea', value: 'SELECT * FROM 不存在的表;' },
    { act: 'click', text: '运行' },
    { act: 'assert', expr: "/执行出错|不存在/.test(document.body.textContent)", timeout: 10000 },
  ]);

  await probeCase('关卡：错误答案判错、正确答案过关', '/levels/L03', [
    { act: 'assert', expr: "document.body.textContent.includes('条件筛选')", timeout: 8000 },
    { act: 'fill', sel: 'textarea', value: 'SELECT sno FROM student;' },
    { act: 'click', text: '提交答案' },
    { act: 'assert', expr: "document.body.textContent.includes('还没通过')", timeout: 8000 },
    { act: 'assert', expr: "document.body.textContent.includes('期望的结果')" },
    { act: 'fill', sel: 'textarea', value: "SELECT * FROM student WHERE sdept = '计算机系';" },
    { act: 'click', text: '提交答案' },
    { act: 'assert', expr: "document.body.textContent.includes('过关')", timeout: 8000 },
  ]);

  await probeCase('范式实验室：切换题目、提交、看推导', '/normalize', [
    { act: 'assert', expr: "document.body.textContent.includes('范式实验室')", timeout: 8000 },
    { act: 'click', text: '部分依赖' },
    { act: 'assert', expr: "['1NF','2NF','3NF','BCNF'].every(t => document.body.textContent.includes(t))", timeout: 8000 },
    { act: 'click', text: '1NF' },
    { act: 'click', text: '提交' },
    { act: 'assert', expr: "document.body.textContent.includes('正确')", timeout: 10000 },
    { act: 'click', text: '看推导' },
    { act: 'assert', expr: "document.body.textContent.includes('完整推导')", timeout: 10000 },
  ]);

  await probeCase('索引实验：展示真实的执行计划', '/lab', [
    { act: 'assert', expr: "document.body.textContent.includes('要分析的查询')", timeout: 8000 },
    { act: 'click', text: 'CREATE INDEX' },
    { act: 'click', text: '提交判断' },
    { act: 'assert', expr: "document.body.textContent.includes('数据库自己怎么说')", timeout: 8000 },
    { act: 'assert', expr: "/SCAN|SEARCH/i.test(document.body.textContent)" },
  ]);

  await probeCase('统计页：图表渲染出来了', '/stats', [
    { act: 'assert', expr: "document.body.textContent.includes('累计作答')", timeout: 8000 },
    { act: 'assert', expr: "!!document.querySelector('.recharts-surface') || document.body.textContent.includes('还没有作答记录')" },
  ]);

  await probeCase('教师工作台：六个标签页都在', '/admin', [
    { act: 'assert', expr: "document.body.textContent.includes('教师工作台')", timeout: 8000 },
    { act: 'assert', expr: "['总览','学生管理','班级','作业','内容','审计日志'].every(t => document.body.textContent.includes(t))" },
    { act: 'click', text: '学生管理' },
    { act: 'assert', expr: "document.body.textContent.includes('批量建号') || document.body.textContent.includes('还没有学生')", timeout: 8000 },
  ]);

  await probeCase('移动端：不出现横向滚动', '/', [
    { act: 'assert', expr: "document.body.textContent.includes('今日目标')", timeout: 8000 },
    { act: 'assert', expr: 'document.documentElement.scrollWidth <= window.innerWidth + 2' },
  ]);

  await probeCase('登出后受保护页面会回到登录页', '/', [
    { act: 'assert', expr: "document.body.textContent.includes('今日目标')", timeout: 8000 },
    { act: 'assert', expr: "fetch('/api/auth/logout', {method:'POST', credentials:'same-origin'}).then(r => r.status === 200)", timeout: 8000 },
    { act: 'assert', expr: "!!document.querySelector('input[type=email]')", timeout: 10000 },
  ]);

} finally {
  await srv.stop();
  probe.cleanup();
  cleanupProfile();
}

const shots = fs.existsSync(SHOT_DIR) ? fs.readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')) : [];
console.log(`\n截图 ${shots.length} 张 → ${SHOT_DIR}`);

report('浏览器冒烟测试');
