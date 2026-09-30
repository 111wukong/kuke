/* AI 课堂的浏览器冒烟
 *
 * ── 这个套件回答的是别处回答不了的问题 ──────────────────────────
 * `tests/ai.mjs` 验的是**数据流**：SSE 事件对不对、工具回灌对不对、
 * 出题入库对不对。它验不了「React 页面上点下去有没有反应」：
 *
 *   · 事件流接上组件了吗（useEffect 的清理有没有把流掐断）
 *   · 等作答期间插话入口该禁有没有禁
 *   · 黑板上的 SQL 结果表、曲线、步骤到底渲染出来没有
 *   · 有没有未捕获的 JS 异常
 *
 * 模型走 mock，不走真的 —— 确定性，而且不烧钱。
 */

import fs from 'node:fs';
import path from 'node:path';
import { startServer, check, report } from './lib/harness.mjs';
import { startMockLLM } from './lib/mock-llm.mjs';
import {
  findBrowser, cleanupProfile, prepareProbe, loginOnce, runProbe, screenshot,
} from './lib/cli-browser.mjs';

const FAKE_KEY = 'sk-test-kuke-browser-0123456789';

const bin = findBrowser();
if (!bin) {
  console.log('\nAI 课堂浏览器冒烟');
  console.log('─'.repeat(60));
  console.log('  跳过：找不到可用的浏览器。');
  console.log('  装一个 Chrome / Chromium，或者设 KUKE_BROWSER=/path/to/chrome。');
  console.log('  （Playwright 缓存里的 chrome-headless-shell 也在候选里）');
  process.exit(0);
}

const WEB_DIST = path.resolve(import.meta.dirname, '../web/dist');
if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  console.log('\nAI 课堂浏览器冒烟');
  console.log('─'.repeat(60));
  console.log('  跳过：web/dist 不存在，先跑 npm run build。');
  process.exit(0);
}

/* ============================================================
   剧本只写一份：DOM 断言和截图都跑它
   ============================================================
   ★ 截图**必须**也跑一遍剧本 —— 直接截 /classroom 的话截到的是空态，
     README 里放一张「请先选考点」的空页面等于没放。
   ============================================================ */
const CLASS_STEPS = [
  { act: 'wait', expr: "document.querySelector('select')", timeout: 12000, wait: 300 },
  { act: 'assert', expr: "!!document.querySelector('#root') && document.body.textContent.indexOf('开一节课') >= 0", timeout: 12000 },

  /* 选考点 —— 用 select 动作（React 在 <select> 上挂的是 change 事件，
     而且 value 在 HTMLSelectElement 上，fill 那套设不进去） */
  { act: 'select', sel: 'select', value: 'k-dbms', wait: 300 },
  { act: 'assert', expr: "document.querySelector('select').value === 'k-dbms'", timeout: 6000 },

  /* 开课 */
  { act: 'click', text: '开一节课', wait: 400 },
  { act: 'wait', expr: "document.body.textContent.indexOf('第 1 轮') >= 0", timeout: 40000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('第 1 轮') >= 0", timeout: 40000 },

  /* 老师讲 + 三个学生说话 */
  { act: 'wait', expr: "document.body.textContent.indexOf('林一鸣') >= 0 && document.body.textContent.indexOf('马小虎') >= 0", timeout: 60000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('林一鸣') >= 0", timeout: 20000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('马小虎') >= 0", timeout: 20000 },

  /* 答题卡弹出来 */
  { act: 'wait', expr: "document.body.textContent.indexOf('该你了') >= 0", timeout: 60000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('还是没懂') >= 0 && document.body.textContent.indexOf('懂了，继续') >= 0", timeout: 20000 },
  /* ★ 等作答期间插话入口必须是禁用的 —— 别让老师被两条线拉扯 */
  { act: 'assert', expr: "(function(){var i=document.querySelector('input[placeholder*=\"先把上面那道题交了\"]');return !!i && i.disabled;})()", timeout: 8000 },

  /* 读一下黑板 */
  { act: 'read', expr: "JSON.stringify({ blocks: document.querySelectorAll('[data-kind]').length, sql: document.querySelectorAll('[data-kind=sql]').length, steps: document.querySelectorAll('[data-kind=steps]').length, attrs: (function(){var b=document.querySelector('[data-blocks]');return b?{blocks:b.getAttribute('data-blocks'),clear:b.getAttribute('data-clear'),page:b.getAttribute('data-page')}:null;})() })" },

  /* 答「还是没懂」→ 答疑轮 */
  { act: 'click', text: '还是没懂', wait: 400 },
  { act: 'wait', expr: "document.body.textContent.indexOf('答疑重讲') >= 0", timeout: 60000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('答疑重讲') >= 0", timeout: 30000 },
  /* ★ 硬过滤的两条：同学安静 + 本来要出题被换掉 */
  { act: 'assert', expr: "document.body.textContent.indexOf('同学已安静') >= 0", timeout: 30000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('被换成了理解确认') >= 0", timeout: 30000 },

  /* 答「懂了，继续」→ 练习轮 */
  { act: 'wait', expr: "document.body.textContent.indexOf('该你了') >= 0", timeout: 60000 },
  { act: 'click', text: '懂了，继续', wait: 400 },
  { act: 'wait', expr: "document.body.textContent.indexOf('练习') >= 0", timeout: 60000 },

  /* 收尾 */
  { act: 'wait', expr: "document.body.textContent.indexOf('这一节结束了') >= 0", timeout: 90000 },
  { act: 'assert', expr: "document.body.textContent.indexOf('这一节结束了') >= 0", timeout: 30000 },
  /* ★ 收尾后插话入口回到「禁用 + 说清为什么」 */
  { act: 'assert', expr: "document.body.textContent.indexOf('开课之后可以随时插话') >= 0", timeout: 8000 },

  { act: 'read', expr: "JSON.stringify({ blocks: document.querySelectorAll('[data-kind]').length, gauge: (document.body.textContent.match(/引导类动作占比[\\s\\S]{0,40}/)||[''])[0] })" },
];

const mock = await startMockLLM();
const srv = await startServer({
  env: {
    KUKE_ENV_FILE: '/tmp/kuke-test-no-such-env-file',
    DEEPSEEK_API_KEY: FAKE_KEY,
    DEEPSEEK_BASE: mock.url,
    DEEPSEEK_MODEL: 'deepseek-chat',
  },
});

const probe = prepareProbe(WEB_DIST);
/* ★ loginHtml 用的分隔符是 ':'（不是 '|'）—— 写错就是 401，
 *   而报错只有一行 status=401，看不出是凭据格式的问题。 */
const CRED = 'teacher@test.local:Teacher123';

try {
  const login = await loginOnce(srv.base, CRED);
  check('登录探针成功（cookie 已种进共享 profile）', login.ok, `status=${login.status}`);

  /* ============================================================
     1. 页面能打开、能开课、能作答、能收尾
     ============================================================ */
  {
    const log = await runProbe(srv.base, {
      to: '/classroom',
      width: 1600,
      height: 1000,
      budget: 2000000,
      timeout: 240000,
      steps: CLASS_STEPS,
    });

    /* 探针剧本一长，出问题时最需要的是「跑到哪一步、每步结果是什么」。
     * 用 DEBUG_AI_PROBE=1 跑就能看到完整日志。 */
    if (process.env.DEBUG_AI_PROBE) console.log(JSON.stringify(log, null, 1));

    const fatal = log.find((r) => r.act === 'fatal');
    check('探针跑完了（没有 fatal）', !fatal, fatal ? JSON.stringify(fatal) : '');

    const pageErrors = log.find((r) => r.act === 'pageErrors');
    check('★ 页面没有未捕获的 JS 异常', !pageErrors, pageErrors ? JSON.stringify(pageErrors.value) : '');

    const failed = log.filter((r) => (r.act === 'assert' || r.act === 'wait') && r.ok === false);
    check('★ 所有断言与等待都通过', failed.length === 0,
      failed.slice(0, 4).map((f) => `${f.act}:${f.expr} → ${f.error || '超时'}`).join(' | '));

    const text = String((log.find((r) => r.act === 'finalText') || {}).value || '');
    check('★ 对话流里有老师讲的内容', text.includes('WHERE') || text.includes('我先不往下讲'), text.slice(0, 200));

    const reads = log.filter((r) => r.act === 'read' && typeof r.value === 'string')
      .map((r) => { try { return JSON.parse(r.value); } catch { return null; } })
      .filter(Boolean);

    const firstBoard = reads[0];
    if (firstBoard) {
      check('★ 黑板上出现了块', firstBoard.blocks >= 1, JSON.stringify(firstBoard));
      check('★ 有真的 SQL 结果块', firstBoard.sql >= 1, JSON.stringify(firstBoard));
      check('★ 有序号步骤块', firstBoard.steps >= 1, JSON.stringify(firstBoard));
      /* ★ 记账口径必须和渲染口径一致，否则增量动画会错位（静默失效） */
      check('★ 黑板的记账属性与真实块数一致（增量动画的记账口径）',
        firstBoard.attrs && Number(firstBoard.attrs.blocks) === firstBoard.blocks, JSON.stringify(firstBoard.attrs));
    } else {
      check('★ 黑板上出现了块', false, '没读到黑板信息');
    }

    const lastRead = reads[reads.length - 1];
    check('★ 收尾后引导占比仍然可见', !!lastRead && /引导类动作占比/.test(lastRead.gauge || ''),
      lastRead ? String(lastRead.gauge) : '没读到');
  }

  /* ============================================================
     2. 截图（给 README 用）
     ============================================================ */
  {
    const shotDir = path.resolve(import.meta.dirname, '../docs/screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    /* ★ 截图**不**开减少动效 —— 那正是最好看的部分。
     *   断言走减少动效（可靠），截图走完整特效（好看）。 */
    const url = `${srv.base}/__probe.html`
      + `?to=${encodeURIComponent('/classroom')}`
      + `&steps=${encodeURIComponent(JSON.stringify(CLASS_STEPS))}`;
    const file = path.join(shotDir, '20-ai-classroom.png');
    let shotErr = '';
    try {
      await screenshot(url, file, { width: 1600, height: 1000, budget: 2000000, timeout: 240000 });
    } catch (e) { shotErr = e.message; }
    /* ★ screenshot() 失败会**抛异常**、成功返回文件路径 ——
     *   它不返回 {ok,size}，按那个写断言永远是 undefined。 */
    check('AI 课堂截图已生成', !shotErr && fs.existsSync(file) && fs.statSync(file).size > 20000,
      shotErr || (fs.existsSync(file) ? `${fs.statSync(file).size} 字节` : '文件不存在'));
  }
} finally {
  probe.cleanup();
  cleanupProfile();
  await srv.stop();
  await mock.close();
}

report('AI 课堂 · 浏览器冒烟');
process.exit(process.exitCode || 0);
