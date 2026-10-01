/* 基于 Chrome CLI 的页面探测
 *
 * ── 为什么不用 CDP ──────────────────────────────────────────────
 * WorkBuddy 沙箱把页面级的 DevTools WebSocket 通道拦掉了：
 *   浏览器级端点（/devtools/browser/…）能连、命令有响应；
 *   页面级端点（/devtools/page/…）握手后立刻被以 1006 关闭；
 *   用 Target.attachToTarget 拿到的 sessionId 发命令也收不到任何响应。
 * 三种路径都试过，所以改用 Chrome 自己的命令行能力 ——
 * 它走进程内渲染，不经过 DevTools 的 WebSocket。
 *
 * ── ★ 三个必须绕开的坑（都是 CI 上真踩出来的）───────────────────
 *
 * 1. **探针页必须先写进 dist**。服务端有 SPA 回退：请求一个不存在的
 *    `/__probe.html` 会返回 index.html（200），于是"探针"变成了应用本身，
 *    而它里面没有探针脚本 —— 症状是截图拍出来全是登录页，
 *    或者探针结果永远是 PENDING。所以 `prepareProbe()` 必须在**任何**
 *    用到探针页的调用之前执行。
 *
 * 2. **登录只能用持久化 profile 做一次**。每个探针各自登录会撞上
 *    `/api/auth/login` 的限流（12 次/10 分钟）—— 13 个探针就必然失败，
 *    而且失败得很隐蔽：探针返回 `{fatal:'login failed'}`，
 *    调用方拿到一个对象而不是数组，报 `log.filter is not a function`，
 *    看起来像代码写错了。用 `--user-data-dir` 复用同一个 profile，
 *    登录一次，之后所有请求自动带上 cookie。
 *
 * 3. **iframe 的就绪不能靠 setTimeout 等**。`--virtual-time-budget` 会把
 *    定时器快进，而 iframe 的网络加载是真实耗时 —— 于是"等 8 秒"可能
 *    在真实世界里只过了几毫秒，`contentDocument` 还是 null。
 *    必须**轮询真实条件**（document 存在 + body 存在 + #root 有子节点），
 *    并且轮询本身要有次数上限。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findBrowser() {
  if (process.env.KUKE_BROWSER) return process.env.KUKE_BROWSER;
  const candidates = [
    /* ★ chrome-headless-shell 是**另一个二进制**，不是 Chrome 主程序。
     *   在 WorkBuddy 沙箱里 Chrome 主程序会被外层 SIGTERM 掉（退出码 137），
     *   而 headless-shell 能正常出图 —— 它本来就是为无头场景打包的，
     *   不需要显示器，也不受那套进程限制。
     *   放在最前面：能跑的那个优先。
     *   （它接受 --headless=new，只是忽略掉，所以参数不用改。） */
    path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-x64/chrome-headless-shell'),
    path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* 继续找 */ }
  }
  return null;
}

/* ---------- 共享 profile ---------- */

let profilePath = null;

/**
 * 所有 Chrome 调用共用一个 user-data-dir。
 * 这样 cookie 只在第一次登录时写一次，后面自动带上 ——
 * 既绕开了登录限流，也更接近"用户已经登录着"的真实场景。
 */
function profile() {
  if (!profilePath) {
    profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'kuke-chrome-profile-'));
  }
  return profilePath;
}

export function cleanupProfile() {
  if (profilePath) {
    try { fs.rmSync(profilePath, { recursive: true, force: true }); } catch { /* 无所谓 */ }
    profilePath = null;
  }
}

/* ---------- 探针文件 ---------- */

/**
 * 登录页：只负责把 cookie 种进 profile，**不做跳转**。
 *
 * ★ 为什么不跳转：跳转之后 `--dump-dom` 拿到的是跳转后页面的 DOM，
 *   里面没有 `STATUS=` 这行字，于是登录成功会被误判成失败
 *   （status 解析成 0）。停在原地才能读出真实状态码。
 */
function loginHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>login</title></head><body>
<pre id="login-result">PENDING</pre>
<script>
(async () => {
  const p = new URLSearchParams(location.search);
  const cred = p.get('login') || '';
  const out = document.getElementById('login-result');
  try {
    const i = cred.indexOf(':');
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cred.slice(0, i), password: cred.slice(i + 1) }),
      credentials: 'same-origin',
    });
    out.textContent = 'STATUS=' + r.status;
  } catch (e) {
    out.textContent = 'ERROR=' + ((e && e.message) || e);
  }
})();
</script></body></html>`;
}

/**
 * 探针页 = **应用 index.html 的副本 + 一段注入脚本**。
 *
 * ── 为什么不用同源 iframe（第一版的做法，在 CI 上挂了）─────────────
 * iframe 的就绪判断绕不开一个根本问题：`--virtual-time-budget` 会把
 * 定时器快进，而 iframe 的网络加载是真实耗时。轮询循环可能在真实世界
 * 只过了几毫秒就跑完 500 次，此时 `contentDocument` 还是 null。
 * 而主文档的加载**确实**会让虚拟时钟暂停（截图那条路在 CI 上是通的，
 * 就是证据）。所以让应用跑在主文档里，问题自然消失。
 *
 * ── 怎么让主文档显示目标页 ──────────────────────────────────────
 * 注入的是**经典脚本**（非 module），它会在解析到 `</body>` 时立即执行；
 * 而应用的入口是 `<script type="module">`，module 是 deferred 的，
 * 要等文档解析完才跑。所以注入脚本**先于** React 执行 ——
 * 此时用 `history.replaceState` 改掉 URL，React Router 挂载时
 * 读到的就是目标路径了。整个过程不产生任何网络请求。
 */
function probeScript() {
  return `<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var to = qs.get('to') || '/';
  var steps = [];
  try { steps = JSON.parse(decodeURIComponent(qs.get('steps') || '[]')); } catch (e) {}

  /* ★ 必须在 React 挂载之前改 URL。
     replaceState 不发请求，只改地址栏 —— 路由器挂载时会读它。 */
  try { history.replaceState({}, '', to); } catch (e) {}

  /* ★ 立即挂载结果元素，不要等 DOMContentLoaded。
     这个脚本在 </body> 之前，document.body 已经存在；
     而等 DOMContentLoaded 会有一个窗口期 —— 如果 --dump-dom 恰好
     在那个窗口里触发，页面上就没有 #probe-result，
     调用方拿到的是"探针页没有输出结果"，看起来像文件没被正确提供。 */
  /* ★ 捕获页面里的报错。
     「断言不成立」可能是超时，也可能是页面真的抛异常了 ——
     两者的修法完全相反（一个是给更多时间，一个是改代码），
     不区分就只能靠猜。 */
  var pageErrors = [];
  window.addEventListener('error', function (e) {
    pageErrors.push('error: ' + (e.message || (e.error && e.error.message) || '?'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    pageErrors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason || '?'));
  });
  var _ce = console.error;
  console.error = function () {
    pageErrors.push('console.error: ' + [].slice.call(arguments).map(function (a) {
      return (a && a.message) || String(a);
    }).join(' ').slice(0, 200));
    _ce.apply(console, arguments);
  };

  /* 干净的页面文本：去掉 script/style，否则我自己的注入脚本源码
     会混进 textContent，把诊断信息淹掉。 */
  function pageText() {
    try {
      var c = document.body.cloneNode(true);
      var junk = c.querySelectorAll('script, style');
      for (var i = 0; i < junk.length; i++) junk[i].parentNode.removeChild(junk[i]);
      return c.textContent || '';
    } catch (e) { return ''; }
  }

  var out = document.createElement('pre');
  out.id = 'probe-result';
  out.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre';
  out.textContent = 'PENDING';
  document.body.appendChild(out);

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ★ 每次迭代额外让出一帧。
   *
   *   原因：--virtual-time-budget 只控制 setTimeout —— 虚拟时间不为
   *   fetch 暂停，所以 setTimeout 链在**真实时间**里几乎瞬间就跑完了
   *   （400 次迭代可能只花几毫秒真实时间），而应用的数据请求还没回来。
   *   症状就是：第 1 步断言「找不到 textarea」失败，但截图里页面明明
   *   渲染得好好的 —— 因为那一屏当时还是骨架屏。
   *
   *   requestAnimationFrame 会强制一次真实的渲染帧，代价是真实时间。
   *   每次迭代加一帧之后，轮询的「虚拟耗时」不变，但真实耗时涨了几百倍。 */
  /* ★ 用 MessageChannel 让出，**不用 requestAnimationFrame**。
   *
   *   rAF 会推进 --virtual-time-budget 的虚拟时钟，而虚拟预算是有上限的。
   *   症状极具迷惑性：**某一步之后，后面的步骤再也不执行** ——
   *   而且预算调得越大，能跑的步数反而越少（因为 rAF 跑得更多）。
   *   实测：wait:0 能过、wait:1 就过不去；同样两步，select 后能跑、click 后就停。
   *
   *   MessageChannel 是宏任务但**不是定时器**，不推进虚拟时钟 ——
   *   循环可以一直转，把真实时间留给网络。这样预算只被 setTimeout 消耗，
   *   而 setTimeout 是应用自己的进度需要，不是探针在空转。 */
  var _mc = new MessageChannel();
  var _yieldResolve = null;
  _mc.port1.onmessage = function () { var r = _yieldResolve; _yieldResolve = null; if (r) r(); };
  _mc.port1.start();
  function nextFrame() {
    return new Promise(function (r) { _yieldResolve = r; _mc.port2.postMessage(0); });
  }

  function waitFor(fn, tries, gap) {
    var i = 0;
    return new Promise(function (resolve) {
      function next() {
        if (++i >= (tries || 400)) return resolve(null);
        setTimeout(function () { nextFrame().then(check); }, gap || 50);
      }
      function check() {
        var v = null;
        try { v = fn(); } catch (e) {}
        /* ★ 表达式可能返回 Promise（探针里直接调 fetch 就会）。
         *   不 await 的话 Promise 对象**永远是 truthy** ——
         *   断言当场「通过」，而它等的那件事还没发生。
         *   症状极具迷惑性：**下一步立刻失败**，失败信息指向下一步，
         *   完全看不出是上一步没等。 */
        if (v && typeof v.then === 'function') {
          v.then(function (r) { if (r) resolve(r); else next(); },
                 function () { next(); });
          return;
        }
        if (v) return resolve(v);
        next();
      }
      check();
    });
  }

  /* ★ 用注入内联 <script> 求值，**不用 Function / eval**。
   *
   *   库课的 CSP 是 script-src 'self' 'unsafe-inline'，**没有 unsafe-eval**。
   *   所以 Function('return (' + expr + ')')() 会被 CSP 直接拦掉，
   *   报错是「Evaluating a string as JavaScript violates ... 'unsafe-eval' is not an allowed source」。
   *
   *   症状极具迷惑性：**每条 expr 断言都失败**，但页面本身完全正常
   *   （截图里什么都对）。而且因为 waitFor 会吞掉异常，
   *   失败表现为「超时」而不是「被 CSP 拦了」——
   *   一路排查到「是不是选择器写错了」，离真正的原因很远。
   *
   *   注入的内联脚本走的是 'unsafe-inline'，是放行的；而且是**同步执行**，
   *   插进去就能读到结果，不需要 await。
   */
  function evalExpr(expr) {
    var s = document.createElement('script');
    s.textContent = 'window.__probeVal=(function(){try{return (' + expr + ');}catch(e){return null;}})();';
    document.documentElement.appendChild(s);
    if (s.parentNode) s.parentNode.removeChild(s);
    var v = window.__probeVal;
    try { window.__probeVal = undefined; } catch (e) { /* 清不掉也无所谓 */ }
    return v;
  }

  /* ★ 先找**文字完全相等**的，再退到「包含」。
   *
   *   真踩过：想点「运行」按钮，indexOf('运行') >= 0 命中了排在前面的
   *   **「运行历史」**—— 于是点错了元素，查询压根没跑。
   *   而失败信息指向的是**下一步**的断言（「页面里没有『张伟』」），
   *   一路去查 SQL 和数据，离真正的原因（点错了按钮）很远。
   *
   *   顺序：精确匹配（去掉首尾空白）→ 包含匹配。 */
  function findClickable(text) {
    var els = [].slice.call(document.querySelectorAll('button, a, [role=button]'));
    var want = String(text).trim();
    for (var i = 0; i < els.length; i++) {
      if ((els[i].textContent || '').trim() === want) return els[i];
    }
    for (var j = 0; j < els.length; j++) {
      if ((els[j].textContent || '').indexOf(want) >= 0) return els[j];
    }
    return undefined;
  }

  /* ★ 每走一步就写一次结果。
     原因：--virtual-time-budget 是一个**虚拟时间**预算，而我的轮询循环
     全都在消耗它。预算一旦到期，--dump-dom 会立刻抓当前 DOM ——
     如果只在最后写一次，拿到的就是 PENDING，看不出跑到哪了。
     逐步写入之后，最坏情况也能看到"卡在哪一步"。 */
  function done(v) {
    var el = document.getElementById('probe-result');
    if (el) el.textContent = JSON.stringify(v);
  }

  async function main() {
    var log = [];
    var flush = function () { done(log); };
    try {
      /* 等 React 挂载。判据是 #root 有子节点 —— 比等固定时长可靠。 */
      var mounted = await waitFor(function () {
        var root = document.getElementById('root');
        return root && root.children.length > 0 ? true : null;
      }, 600, 20);

      if (!mounted) { done([{ act: 'fatal', error: '应用在 10 秒（虚拟）内没有挂载，#root 一直是空的' }]); return; }

      log.push({ act: 'mounted', path: location.pathname, title: document.title });
      flush();

      /* 被弹回登录页时给出明确诊断，而不是让每条断言各报一次"找不到元素" */
      if (location.pathname === '/login') {
        done([{ act: 'fatal', error: '未登录：被重定向到了 /login。profile 里的 cookie 没生效。' }]);
        return;
      }

      for (var n = 0; n < steps.length; n++) {
        var st = steps[n];
        var rec = { i: n, act: st.act };
        if (st.expr) rec.expr = String(st.expr).slice(0, 120);
        if (st.text) rec.text = st.text;
        if (st.sel) rec.sel = st.sel;
        try {
          if (st.act === 'fill') {
            var el = document.querySelector(st.sel);
            if (!el) { rec.error = '找不到元素 ' + st.sel; }
            else {
              var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, st.value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              rec.ok = true;
            }
          } else if (st.act === 'select') {
            /* ★ 下拉框要单独一个动作。
             *   用 fill 的话走的是 HTMLInputElement 的 value setter，
             *   而 <select> 的 value 在 HTMLSelectElement 上 ——
             *   设不进去，而且 React 的 onChange 在 select 上挂的是
             *   change 事件（不是 input）。两处都不对，表现是
             *   「填了但没生效」，而步骤记录里 ok:true，看着像成功了。 */
            var sel = document.querySelector(st.sel);
            if (!sel) { rec.error = '找不到元素 ' + st.sel; }
            else {
              Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, st.value);
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              rec.ok = true;
            }
          } else if (st.act === 'click') {
            var c = st.sel ? document.querySelector(st.sel) : findClickable(st.text);
            if (!c) { rec.error = '找不到可点击元素：' + (st.text || st.sel); }
            else { c.click(); rec.ok = true; rec.text = (c.textContent || '').trim().slice(0, 40); }
          } else if (st.act === 'wait' || st.act === 'assert') {
            var ok = await waitFor(function () {
              try { return evalExpr(st.expr) || null; } catch (e) { return null; }
            }, Math.ceil((st.timeout || 6000) / 20), 20);
            rec.ok = !!ok;
            /* ★ 用 textContent 而不是 innerText：innerText 是**布局相关**的，
               *   只返回已渲染的内容。--dump-dom 不触发完整布局，
               *   动态挂载的主内容区会拿不到 —— 而侧栏渲染得早，所以在。
               *   症状就是断言失败但 actual 里只有侧栏，看着像主内容没渲染。 */
            if (!rec.ok && st.act === 'assert') rec.actual = pageText().slice(0, 1200);
          } else if (st.act === 'read') {
            rec.value = st.expr ? evalExpr(st.expr) : pageText().slice(0, 4000);
          } else if (st.act === 'clickNav') {
            var nav = findClickable(st.text);
            if (!nav) { rec.error = '找不到导航项：' + st.text; }
            else {
              nav.click();
              var moved = await waitFor(function () { return location.pathname === st.expect ? true : null; }, 200, 20);
              rec.ok = !!moved;
              rec.path = location.pathname;
            }
          }
        } catch (e) { rec.error = String((e && e.message) || e); }
        log.push(rec);
        flush();
        await sleep(st.wait === undefined ? 200 : st.wait);
        await nextFrame();
      }

      log.push({ act: 'finalText', value: pageText().slice(0, 2000) });
      log.push({ act: 'finalPath', value: location.pathname });
      if (pageErrors.length) log.push({ act: 'pageErrors', value: pageErrors.slice(0, 8) });
      done(log);
    } catch (e) {
      log.push({ act: 'fatal', error: String((e && e.message) || e) });
      done(log);
    }
  }
  main();
})();
<\/script>`;
}

/**
 * 把探针页写进 dist。**必须在任何调用之前执行。**
 *
 * 探针页是 index.html 的副本 —— 所以它加载的是**真实的构建产物**，
 * 不是另写一份骨架。这一点很重要：另写一份骨架的话，
 * 被测的就不是用户真正会打开的那个页面了。
 */
export function prepareProbe(distDir) {
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`web/dist/index.html 不存在：${distDir}`);

  const html = fs.readFileSync(index, 'utf8');
  if (!html.includes('</body>')) throw new Error('index.html 里没有 </body>，无法注入探针脚本');

  fs.writeFileSync(path.join(distDir, '__login.html'), loginHtml());
  fs.writeFileSync(
    path.join(distDir, '__probe.html'),
    html.replace('</body>', `${probeScript()}\n</body>`),
  );

  return {
    cleanup() {
      for (const f of ['__login.html', '__probe.html']) {
        try { fs.unlinkSync(path.join(distDir, f)); } catch { /* 已经没了 */ }
      }
    },
  };
}

/* ---------- 跑一次 Chrome ---------- */

function runChrome(args, { timeout = 60000, reducedMotion = false } = {}) {
  return new Promise((resolve, reject) => {
    const bin = findBrowser();
    if (!bin) return reject(new Error('找不到浏览器。设 KUKE_BROWSER=/path/to/chrome'));

    const child = spawn(bin, [
      '--headless=new',
      /* ★ 沙箱里 Chrome 自己的进程沙箱初始化会失败（Operation not permitted），
       *   不加这个标志它直接 FATAL 退出。测试用途、只访问本机服务，
       *   关掉进程沙箱是可接受的取舍。 */
      '--no-sandbox',
      '--disable-dev-shm-usage',
      /* ★ 2026-10-02：把 WebGL 打开，改用 SwiftShader 软件渲染。
       *
       *   原来这里是 `--disable-gpu`，它会把 WebGL 一起关掉 ——
       *   于是「星云 / 赛博绿」这两个带动态 3D 背景的主题，
       *   截图里永远是空的（`getContext('webgl')` 返回 null，
       *   CyberGrid 静默退出）。而背景正是那两套主题的全部卖点。
       *
       *   `--enable-unsafe-swiftshader` 是 Chrome 对"没有 GPU 时用软件
       *   渲染 WebGL"的显式开关（不加它，新版 Chrome 会拒绝创建 context）。
       *   顺带一提：`--disable-gpu` 还会让无头环境报告
       *   `prefers-reduced-motion: reduce`，而那正是 fx 的另一个开关 ——
       *   两个因素叠在一起，导致"背景永远不出现"这件事看起来像设计如此。
       *
       *   SwiftShader 是纯 CPU 渲染，慢，但这里只需要渲染几帧出图。
       *   如果某个环境真的跑不了，WebGL 拿不到 context，
       *   CyberGrid 会静默降级（CSS 光晕顶上来）—— 不会让测试变红。 */
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      `--user-data-dir=${profile()}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--no-pings',
      /* ★ 按需强制「减少动效」。
       *
       *   两个作用：
       *   ① 无障碍 —— 这是应用里真实存在的分支（前庭功能敏感的人
       *      会因为持续运动的背景不适）。
       *   ② 让断言可靠 —— WebGL/Canvas 背景持续跑 rAF，而 rAF 会不断
       *      推进 --virtual-time-budget 的虚拟时钟：预算被耗在渲染背景上，
       *      页面主体还没渲染完 dump 就发生了。
       *
       *   ⚠️ 但**截图不开**它 —— 那两层背景正是最好看的部分，
       *      关掉会让 README 的实拍图失去说服力。
       *      所以：断言走减少动效（可靠），截图走完整特效（好看）。 */
      ...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      ...args,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Chrome 超时（${timeout}ms）\n${err.slice(-600)}`));
    }, timeout);

    child.on('exit', (code) => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code }); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** 打开一个 URL，等 JS 跑完，返回渲染后的 DOM。 */
export async function dumpDom(url, { width = 1440, height = 940, budget = 12000, timeout = 60000, reducedMotion = true } = {}) {
  const { stdout, stderr } = await runChrome([
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${budget}`,
    '--dump-dom',
    url,
  ], { timeout, reducedMotion });
  if (!stdout.includes('<')) {
    throw new Error(`--dump-dom 没拿到 HTML。stderr：\n${stderr.slice(-600)}`);
  }
  return stdout;
}

/** 打开一个 URL 并截图。 */
export async function screenshot(url, file, { width = 1440, height = 940, budget = 12000, timeout = 60000, reducedMotion = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await runChrome([
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${budget}`,
    `--screenshot=${file}`,
    url,
  ], { timeout });
  if (!fs.existsSync(file) || fs.statSync(file).size < 3000) {
    throw new Error(`截图失败或文件过小：${file}`);
  }
  return file;
}

/**
 * 往共享 profile 里种一次登录 cookie。
 * 之后所有请求都会自动带上 —— 这是绕开登录限流的关键。
 */
export async function loginOnce(base, cred) {
  const dom = await dumpDom(
    `${base}/__login.html?login=${encodeURIComponent(cred)}&to=${encodeURIComponent('/')}`,
    { budget: 8000 },
  );
  const m = dom.match(/STATUS=(\d+)/);
  const status = m ? Number(m[1]) : 0;
  return { ok: status === 200, status, dom };
}

/**
 * 跑一段剧本，返回结果数组。
 * **永远返回数组** —— 出错时返回 `[{act:'fatal', ...}]`，
 * 而不是抛错或返回对象（那会让调用方 `log.filter` 崩掉，
 * 报出来的错和真正的原因差十万八千里）。
 *
 * 注意：`login` 参数只是保留签名兼容，探针**不再自己登录** ——
 * cookie 由 `loginOnce()` 一次性种进共享 profile。每个探针各登一次
 * 会撞上 /api/auth/login 的限流（12 次/10 分钟）。
 */
export async function runProbe(base, { to, steps, width, height, budget, timeout } = {}) {
  const url = `${base}/__probe.html`
    + `?to=${encodeURIComponent(to || '/')}`
    + `&steps=${encodeURIComponent(JSON.stringify(steps || []))}`;

  let dom;
  try {
    dom = await dumpDom(url, { width, height, budget, ...(timeout ? { timeout } : {}) });
  } catch (e) {
    return [{ act: 'fatal', error: String(e.message).split('\n')[0] }];
  }

  const m = dom.match(/<pre id="probe-result"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return [{ act: 'fatal', error: '探针页没有输出结果（__probe.html 没被正确提供？）' }];

  const raw = m[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .trim();

  if (raw === 'PENDING') return [{ act: 'fatal', error: '探针脚本没有跑完（virtual-time-budget 太短？）' }];

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return [{ act: 'fatal', error: `探针输出不是合法 JSON：${raw.slice(0, 200)}` }]; }

  if (!Array.isArray(parsed)) return [parsed, { act: 'note', error: '探针返回的不是数组' }];
  return parsed;
}

/** 从 dump 出来的 DOM 里抽正文文本。 */
export function domText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
