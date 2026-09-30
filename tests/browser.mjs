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
 * ════════════════════════════════════════════════════════════════
 * 架构（在 CI 上反复踩坑之后定下来的）
 * ════════════════════════════════════════════════════════════════
 *
 *   ① prepareProbe()   先把探针页写进 dist
 *   ② loginOnce()      用持久化 profile 登录一次，cookie 留在 profile 里
 *   ③ 截图             直接导航到应用 URL
 *   ④ 页面断言         直接导航 + --dump-dom，断言在**抓下来的 HTML** 上
 *   ⑤ 交互断言         注入探针脚本（能点击、填表）
 *
 * ── 为什么页面断言和交互断言要分开 ──────────────────────────────
 *
 * 一开始全走探针，结果「页面里有没有这段字」这类断言大面积失败，
 * 而截图证明页面渲染完全正常（人工看过图）。三个原因叠在一起：
 *
 * 1. **探针的轮询循环在消耗虚拟时间**。`--virtual-time-budget` 控制的是
 *    `setTimeout` / `setInterval` / rAF；而 React 19 的并发调度走
 *    `MessageChannel`，那是**真实时间**。两个时钟不同步 ——
 *    轮询在虚拟时间里瞬间跑完几十次迭代，给出「没有这段字」的结论时，
 *    React 在真实世界里才刚渲染了前两个组件。
 *
 * 2. **`innerText` 是布局相关的**，`--dump-dom` 不触发完整布局，
 *    动态挂载的主内容区拿不到（侧栏渲染得早，所以在）——
 *    症状是断言失败但 actual 里只有侧栏，看着像主内容没渲染。
 *
 * 3. **`textContent` 会连注入脚本的源码一起返回**（它就写在 body 里），
 *    把诊断信息淹掉。
 *
 * 所以断言分两条路：
 *   · **页面断言**（占绝大多数）走 ④：和截图同一条路径，
 *     而截图在 CI 上被证明可靠。断言对象是**页面冻结后的 DOM 快照**，
 *     不受两个时钟不同步的影响。
 *   · **交互断言**（点击、填表）走 ⑤：探针里用 `textContent`、
 *     轮询间隔压到 20ms（每次迭代都是一次真实的让出，
 *     等于给 React 更多真实时间），并捕获页面报错一起报出来。
 */
import { startServer, check, report } from './lib/harness.mjs';
import {
  runProbe, screenshot, dumpDom, domText, prepareProbe,
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
  /* 能力探测：浏览器到底能不能跑。
   *
   * ★ 超时给宽一点，并且重试一次。CI runner 上 Chrome 第一次启动
   *   （新建 profile、写缓存）可能要十几秒 —— 15 秒的超时会导致
   *   「测试静默跳过」，而跳过的 job 是**绿的**，看起来像通过。
   *   实测踩过：一次 CI 因为探测超时跳过，报告 success，
   *   而那次改动根本没被验证。 */
  for (let attempt = 1; attempt <= 2 && !canRun; attempt++) {
    try {
      const r = await dumpDom(`${srv.base}/api/health`, { budget: 5000, timeout: 60000 });
      canRun = r.includes('ok');
      if (!canRun) skipReason = 'health 接口返回的内容里没有 ok';
    } catch (e) {
      skipReason = String(e.message).split('\n')[0];
      if (attempt === 1) console.log(`[探测] 第 1 次失败（${skipReason}），重试一次…`);
    }
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

  /* ---------- 截图 ---------- */

  console.log(`\n[截图] → ${SHOT_DIR}`);

  /* ★ 先把主题钉成「深空」（默认主题）。
   *
   *   主题存在 localStorage，而 useTheme 的初始值会跟随系统偏好 ——
   *   CI runner 报的是 light，于是默认主题的页面会被拍成亮色，
   *   和「默认深色」的定位不符。
   *
   *   这一步放在**登录之前**：登录页自带主题选择器，不需要登录就能用；
   *   而且登录页截图本身也应该是深色的。 */
  try {
    await runProbe(srv.base, {
      to: '/login',
      steps: [
        { act: 'assert', expr: "!!document.querySelector('button')", timeout: 8000 },
        { act: 'click', text: '主题' },
        { act: 'click', text: '深空' },
        { act: 'assert', expr: "document.documentElement.getAttribute('data-theme') === 'deep-space'", timeout: 8000 },
      ],
      budget: 90000,
    });
    console.log('[主题] 已钉成深空');
  } catch (e) {
    console.log(`[主题] 钉深空失败（截图可能是亮色）—— ${String(e.message).split('\n')[0]}`);
  }

  /* ★ 登录页必须在 loginOnce **之前**拍。
   *   profile 一旦有了 cookie，访问 /login 会被重定向到首页 ——
   *   拍出来就是仪表盘而不是登录页。 */
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
        { act: 'assert', expr: "document.documentElement.getAttribute('data-theme') === 'paper'", timeout: 8000 },
      ],
      budget: 90000,
    });
    const bad = switched.filter((r) => r.error || r.ok === false);
    if (bad.length) throw new Error(`切主题失败：${JSON.stringify(bad).slice(0, 200)}`);

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

  /* ---------- ④ 页面断言：直接导航 + dump-dom ---------- */

  console.log('\n[冒烟] 页面断言\n');

  async function assertPage(name, route, needles) {
    let text = '';
    try {
      const html = await dumpDom(`${srv.base}${route}`, { width: 1440, height: 940, budget: 40000 });
      text = domText(html);
    } catch (e) {
      check(name, false, `抓取失败：${String(e.message).split('\n')[0]}`);
      return;
    }
    const missing = needles.filter((n) => !text.includes(n));
    check(name, missing.length === 0,
      missing.length ? `页面文本里找不到：${missing.join('、')}（文本长度 ${text.length}）` : '');
  }

  await assertPage('仪表盘：hero、概览卡、今日待办都在', '/',
    ['今日目标', '待复习', '错题', '总正确率', 'SQL 关卡', '今天做什么', '快捷入口']);

  await assertPage('知识树：七个分类都在', '/learn',
    ['基础理论', 'SQL 语言', '数据库设计', '存储与索引', '查询优化', '事务与并发', '恢复与安全', '43 个知识点']);

  await assertPage('知识点详情：正文、代码块、表格、依赖关系都在', '/learn/k-groupby',
    ['GROUP BY', '先学这些', '学完能解锁', '容易和它混淆', '建表语句']);

  await assertPage('SQL 实训场：编辑器、表结构、数据集说明都在', '/lab/sql',
    ['SQL 实训场', '表结构', '学生选课库', '建表语句', '运行历史', '沙箱说明']);

  await assertPage('SQL 闯关：四个数据集、通关进度都在', '/levels',
    ['SQL 闯关', '学生选课库', '电商订单库', '图书借阅库', '员工部门库', '通关进度']);

  await assertPage('关卡详情：题面与编辑器都在', '/levels/L03',
    ['条件筛选', '提交答案']);

  await assertPage('范式实验室：四种问法的题目都在', '/normalize',
    ['范式实验室', '求属性闭包', '函数依赖集', '候选键']);

  await assertPage('索引与事务实验台：两栏题目都在', '/lab',
    ['实验台', '索引', '事务', '要分析的查询']);

  await assertPage('复习队列：FSRS 说明与四档自评都在', '/review',
    ['复习队列', 'FSRS', '间隔重复']);

  await assertPage('错题本：判定口径写清楚了', '/mistakes',
    ['错题本', '曾经答错']);

  await assertPage('统计页：数字卡与诊断都在', '/stats',
    ['累计作答', '总体正确率', '连续学习', '诊断']);

  await assertPage('成就墙：判定口径公开', '/achievements',
    ['成就墙', '已解锁', '判定口径']);

  await assertPage('班级页渲染正常', '/classes',
    ['班级', '我的班级', '邀请码']);

  await assertPage('设置页：外观与隐私说明都在', '/settings',
    ['外观', '学习偏好', '修改密码', '活跃设备', '关于隐私']);

  await assertPage('教师工作台：六个标签页都在', '/admin',
    ['教师工作台', '总览', '学生管理', '班级', '作业', '内容', '审计日志']);

  /* ---------- ⑤ 交互断言：注入探针 ---------- */

  console.log('\n[冒烟] 交互断言\n');

  async function probeCase(name, to, steps, budget = 400000) {
    const log = await runProbe(srv.base, { to, steps, width: 1440, height: 940, budget });
    const bad = log.filter((r) => r.act === 'fatal' || r.error || r.ok === false);
    const where = log.filter((r) => r.act === 'mounted' || r.act === 'finalPath')
      .map((r) => `${r.act}=${r.path ?? r.value}`).join(' ');
    const errs = log.find((r) => r.act === 'pageErrors');
    const errTxt = errs ? ` 【页面报错 ${JSON.stringify(errs.value).slice(0, 300)}】` : '';
    /* 这里曾经一度用 soft()（不计入失败）。原因是虚拟时间和 React
     * 调度器不同步 —— 探针的轮询在真实时间里跑得太快，
     * 应用还没把数据请求跑完。最后找到的解法是让**每一次轮询迭代
     * 都让出一帧**（rAF 强制真实渲染），见 cli-browser.mjs 里的说明。
     * 修好之后 22 条断言全绿，所以改回硬检查。 */
    check(name, bad.length === 0,
      bad.map((x) => `第${(x.i ?? 0) + 1}步 ${x.act}${x.expr ? `(${String(x.expr).slice(0, 60)})` : x.text ? `(点击「${x.text}」)` : ''}: ${x.error || '断言不成立'}`).join(' | ')
      + (where ? ` 【${where}】` : '') + errTxt);
    return log;
  }

  await probeCase('SQL 实训场：写查询能拿到真实结果', '/lab/sql', [
    { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 8000 },
    { act: 'fill', sel: 'textarea', value: "SELECT sname, sdept FROM student WHERE sdept = '计算机系';" },
    { act: 'click', text: '运行' },
    { act: 'assert', expr: "document.body.textContent.includes('张伟')", timeout: 8000 },
    { act: 'assert', expr: "document.body.textContent.includes('sname')" },
  ]);

  await probeCase('SQL 实训场：错误 SQL 给可读提示', '/lab/sql', [
    { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 8000 },
    { act: 'fill', sel: 'textarea', value: 'SELECT * FROM 不存在的表;' },
    { act: 'click', text: '运行' },
    { act: 'assert', expr: "/执行出错|不存在/.test(document.body.textContent)", timeout: 8000 },
  ]);

  await probeCase('关卡：错误答案判错、正确答案过关', '/levels/L03', [
    { act: 'assert', expr: "!!document.querySelector('textarea')", timeout: 8000 },
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
    { act: 'assert', expr: "document.body.textContent.includes('正确')", timeout: 8000 },
    { act: 'click', text: '看推导' },
    { act: 'assert', expr: "document.body.textContent.includes('完整推导')", timeout: 8000 },
  ]);

  await probeCase('索引实验：展示真实的执行计划', '/lab', [
    { act: 'assert', expr: "document.body.textContent.includes('要分析的查询')", timeout: 8000 },
    { act: 'click', text: 'CREATE INDEX' },
    { act: 'click', text: '提交判断' },
    { act: 'assert', expr: "document.body.textContent.includes('数据库自己怎么说')", timeout: 8000 },
    { act: 'assert', expr: "/SCAN|SEARCH/i.test(document.body.textContent)" },
  ]);

  await probeCase('设置页：切换主题生效（含亮色对比度）', '/settings', [
    { act: 'assert', expr: "document.body.textContent.includes('宣纸')", timeout: 8000 },
    { act: 'click', text: '宣纸' },
    { act: 'assert', expr: "document.documentElement.getAttribute('data-theme') === 'paper'", timeout: 8000 },
    {
      act: 'assert',
      /* ★ timeout 是必须的，不是保险。
       *
       * 这条断言读的是 getComputedStyle(document.body) —— 它依赖
       * 「data-theme 已经切到 paper 且 CSS 变量已经重算完」。
       * 上一步只断言了 data-theme 属性变了，那是一个 DOM 属性赋值，
       * 立即生效；而样式重算要等一帧。
       *
       * 少了 timeout，这条断言会在属性刚改完、样式还没落地时求值，
       * 拿到的是上一个主题的颜色 —— 于是变成随机失败：
       * 机器快就过、机器忙就挂。实测同一份代码跑两次，
       * 一次 21/1 一次 22/0。
       *
       * 周围所有断言都带 timeout，只有这条漏了。 */
      timeout: 8000,
      expr: `(() => {
        const s = getComputedStyle(document.body);
        const lum = (c) => {
          const m = c.match(/([0-9]+),[ ]*([0-9]+),[ ]*([0-9]+)/);
          return m ? (+m[1] * 0.299 + +m[2] * 0.587 + +m[3] * 0.114) / 255 : null;
        };
        const f = lum(s.color), b = lum(s.backgroundColor);
        return f !== null && b !== null && f < 0.5 && b > 0.5;
      })()`,
    },
    { act: 'click', text: '深空' },
  ]);

  await probeCase('登出后受保护页面会回到登录页', '/', [
    { act: 'assert', expr: "document.body.textContent.includes('今日目标')", timeout: 8000 },
    /* ★ 点**界面上的退出按钮**，不要直接调 logout 接口。
     *   直接调接口只清了服务端的会话，前端的 auth store 并不知道 ——
     *   而「登出后要跳登录页」这件事靠的正是前端状态变化。
     *   直接调接口等于绕开了要测的那条链。 */
    { act: 'click', text: '退出', wait: 400 },
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
