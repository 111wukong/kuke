/* 基于 Chrome CLI 的页面探测
 *
 * ── 为什么不用 CDP ──────────────────────────────────────────────
 * 本机沙箱把页面级的 DevTools WebSocket 通道拦掉了：
 *   浏览器级端点（/devtools/browser/…）能连、命令有响应；
 *   页面级端点（/devtools/page/…）握手后立刻被以 1006 关闭；
 *   用 Target.attachToTarget 拿到的 sessionId 发命令也收不到任何响应。
 * 三种路径都试过，所以改用 Chrome 自己的命令行能力 —— 它走的是
 * 进程内的渲染，不经过 DevTools 的 WebSocket。
 *
 * ── 代价与补偿 ──────────────────────────────────────────────────
 * CLI 模式下没有"点击"这个动作。补偿办法是**同源 iframe 探针页**：
 * 探针页和被测应用同源，所以能拿到 iframe 里的完整 DOM、
 * 能触发 click、能读 innerText。把要做的动作写成脚本传给它，
 * 它跑完把结果写进自己的 DOM，再用 --dump-dom 读回来。
 *
 * 这条路比 CDP 绕，但它在这个环境里**真的能跑**。
 * 能跑的测试 > 更优雅但跑不起来的测试。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findBrowser() {
  if (process.env.KUKE_BROWSER) return process.env.KUKE_BROWSER;
  const candidates = [
    path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* 继续找 */ }
  }
  return null;
}

let sharedProfile = null;
function profileDir() {
  if (!sharedProfile) sharedProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'kuke-cli-profile-'));
  return sharedProfile;
}

export function cleanupProfile() {
  if (sharedProfile) {
    try { fs.rmSync(sharedProfile, { recursive: true, force: true }); } catch { /* 无所谓 */ }
    sharedProfile = null;
  }
}

/** 跑一次 Chrome CLI，返回 { stdout, stderr, code }。 */
function runChrome(args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = findBrowser();
    if (!bin) return reject(new Error('找不到浏览器。设 KUKE_BROWSER=/path/to/chrome'));

    const child = spawn(bin, [
      '--headless=new',
      /* ★ 本机沙箱里 Chrome 自己的沙箱初始化会失败（Operation not permitted），
       * 不加这个标志 Chrome 直接 FATAL 退出。测试用途、只访问本机服务，
       * 关掉它的进程沙箱是可接受的取舍。 */
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profileDir()}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-features=Translate,BackForwardCache',
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
      reject(new Error(`Chrome 超时（${timeout}ms）\n${err.slice(-800)}`));
    }, timeout);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code });
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** 打开一个 URL，等 JS 跑完，返回渲染后的 DOM。 */
export async function dumpDom(url, { width = 1440, height = 940, budget = 12000, timeout = 60000 } = {}) {
  const { stdout, stderr } = await runChrome([
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${budget}`,
    '--dump-dom',
    url,
  ], { timeout });
  if (!stdout.includes('<')) {
    throw new Error(`--dump-dom 没拿到 HTML。stderr：\n${stderr.slice(-600)}`);
  }
  return stdout;
}

/** 打开一个 URL 并截图。 */
export async function screenshot(url, file, { width = 1440, height = 940, budget = 12000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await runChrome([
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${budget}`,
    `--screenshot=${file}`,
    url,
  ]);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
    throw new Error(`截图失败或文件过小：${file}`);
  }
  return file;
}

/* ============================================================
   同源探针页
   ============================================================ */

/** 探针页的 HTML。它自己不做断言，只负责"按剧本操作 + 汇报结果"。 */
export function probeHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title>
<style>html,body{margin:0;height:100%}iframe{width:100vw;height:100vh;border:0;display:block}
#probe-result{position:fixed;left:-9999px;top:0}</style>
</head><body>
<pre id="probe-result">PENDING</pre>
<script>
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function findClickable(doc, text) {
  const els = [...doc.querySelectorAll('button, a, [role=button]')];
  return els.find(el => (el.textContent || '').includes(text));
}

async function waitFor(doc, expr, timeout) {
  const deadline = Date.now() + (timeout || 8000);
  while (Date.now() < deadline) {
    try { if (Function('document', 'return (' + expr + ')')(doc)) return true; } catch (e) {}
    await sleep(150);
  }
  return false;
}

async function main() {
  const qs = new URLSearchParams(location.search);
  const login = qs.get('login');
  const to = qs.get('to') || '/';
  const steps = JSON.parse(decodeURIComponent(qs.get('steps') || '[]'));
  const log = [];

  try {
    if (login) {
      const i = login.indexOf(':');
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: login.slice(0, i), password: login.slice(i + 1) }),
        credentials: 'same-origin',
      });
      log.push({ act: 'login', status: r.status });
      if (!r.ok) { document.getElementById('probe-result').textContent = JSON.stringify({ fatal: 'login failed', log }); return; }
    }

    const fr = document.createElement('iframe');
    fr.src = to;
    document.body.appendChild(fr);
    await new Promise(r => { fr.onload = r; setTimeout(r, 8000); });
    await sleep(1600);

    const d = fr.contentDocument;
    const w = fr.contentWindow;

    for (const st of steps) {
      const rec = { act: st.act };
      try {
        if (st.act === 'fill') {
          const el = d.querySelector(st.sel);
          if (!el) { rec.error = '找不到元素 ' + st.sel; }
          else {
            const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, st.value);
            el.dispatchEvent(new w.Event('input', { bubbles: true }));
            rec.ok = true;
          }
        } else if (st.act === 'click') {
          let el = null;
          if (st.sel) el = d.querySelector(st.sel);
          else el = findClickable(d, st.text);
          if (!el) { rec.error = '找不到可点击元素：' + (st.text || st.sel); }
          else { el.click(); rec.ok = true; rec.text = (el.textContent || '').trim().slice(0, 40); }
        } else if (st.act === 'wait') {
          rec.ok = await waitFor(d, st.expr, st.timeout);
        } else if (st.act === 'assert') {
          rec.ok = !!(await waitFor(d, st.expr, st.timeout || 3000));
          if (!rec.ok) rec.actual = (d.body.innerText || '').slice(0, 300);
        } else if (st.act === 'read') {
          rec.value = st.expr
            ? Function('document', 'return (' + st.expr + ')')(d)
            : (d.body.innerText || '').slice(0, 4000);
        } else if (st.act === 'scroll') {
          (d.scrollingElement || d.documentElement).scrollTop = st.y || 0;
          rec.ok = true;
        }
      } catch (e) { rec.error = String(e && e.message || e); }
      log.push(rec);
      await sleep(st.wait === undefined ? 500 : st.wait);
    }

    // 最后一屏的文本，方便失败时看现场
    log.push({ act: 'finalText', value: (d.body.innerText || '').slice(0, 1200) });
    log.push({ act: 'finalPath', value: w.location.pathname });
  } catch (e) {
    log.push({ act: 'fatal', error: String(e && e.message || e) });
  }

  document.getElementById('probe-result').textContent = JSON.stringify(log);
}
main();
</script>
</body></html>`;
}

/**
 * 把探针页写进 web/dist，跑一段剧本，返回结果数组。
 * 跑完删掉探针页 —— 它不该留在产物里。
 */
export async function runProbe(distDir, { base, login, to, steps, width, height, budget }) {
  const file = path.join(distDir, '__probe.html');
  fs.writeFileSync(file, probeHtml());

  try {
    const url = `${base}/__probe.html?login=${encodeURIComponent(login || '')}`
      + `&to=${encodeURIComponent(to || '/')}`
      + `&steps=${encodeURIComponent(JSON.stringify(steps || []))}`;
    const dom = await dumpDom(url, { width, height, budget });

    const m = dom.match(/<pre id="probe-result">([\s\S]*?)<\/pre>/);
    if (!m) return [{ act: 'fatal', error: '探针页没有输出结果（可能页面没加载完）' }];
    const raw = m[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
    if (raw === 'PENDING') return [{ act: 'fatal', error: '探针脚本没有跑完（virtual-time-budget 太短？）' }];
    return JSON.parse(raw);
  } finally {
    try { fs.unlinkSync(file); } catch { /* 已经没了 */ }
  }
}

/** 从 dump 出来的 DOM 里抽正文文本（去掉标签）。 */
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
