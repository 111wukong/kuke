/* 测试用的服务生命周期：临时库 + 随机端口 + cookie 会话
 *
 * ── 为什么每次都用一次性库 ──────────────────────────────────────
 * 测试会注册账号、建班、删学生、跑 SQL。跑在真实库上，
 * 跑一次就把开发数据搅乱了，而且第二次跑的结果和第一次不一样
 * （邮箱已存在、班级码冲突）—— 那种测试没法信任。
 *
 * ── 为什么不用 127.0.0.1 的固定端口 ─────────────────────────────
 * 开发时本机可能正跑着一个服务占着 5180。固定端口会让测试
 * 连到那个服务上，然后对着真实数据跑一遍"测试"。
 * 端口冲突还容易被误读成"服务起不来"。
 * 所以先用 0 端口让系统分配，再从 server 上读回来。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '../../server/src/index.js');

export async function startServer({ env = {}, waitMs = 30000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuke-test-'));
  const dbPath = path.join(dir, 'test.db');

  /* ★ PORT=0 让操作系统分配空闲端口。但 Fastify 的日志里才有实际端口，
   * 所以这里不用日志解析 —— 改成显式要一个高位随机端口，
   * 冲突概率极低，而且失败了能立刻看出来（进程退出码非 0）。 */
  const port = 20000 + Math.floor(Math.random() * 20000);

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      KUKE_DB: dbPath,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
      KUKE_EMAIL: 'teacher@test.local',
      KUKE_PASSWORD: 'Teacher123',
      KUKE_USERNAME: '测试教师',
      NODE_ENV: 'test',
      /* ★ 浏览器冒烟要加载 30+ 个页面，每个 8~10 个请求 ——
       *   300/分钟 的默认阈值会被撞满，后半程的页面全变 429，
       *   而症状是「探针页没有输出结果」，看起来像静态托管坏了。 */
      KUKE_RATE_LIMIT: '100000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => {});

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务进程提前退出（code ${child.exitCode}）：\n${stderr}`);
    }
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        return {
          base,
          port,
          dbPath,
          dir,
          proc: child,
          async stop() {
            child.kill('SIGTERM');
            await new Promise((res) => {
              const t = setTimeout(() => { child.kill('SIGKILL'); res(); }, 3000);
              child.on('exit', () => { clearTimeout(t); res(); });
            });
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清不掉无所谓 */ }
          },
        };
      }
    } catch { /* 还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill('SIGKILL');
  throw new Error(`服务在 ${waitMs}ms 内没起来：\n${stderr}`);
}

/* ---------- 带 cookie 的 HTTP 客户端 ---------- */
export function makeClient(base) {
  const jar = new Map();

  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const absorb = (res) => {
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  };

  async function req(method, url, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const cookies = cookieHeader();
    if (cookies) headers.Cookie = cookies;

    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
      redirect: 'manual',
    });
    absorb(res);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { __raw: text }; }
    return { status: res.status, body: json, headers: res.headers };
  }

  return {
    jar,
    get: (u, o) => req('GET', u, undefined, o),
    post: (u, b, o) => req('POST', u, b, o),
    patch: (u, b, o) => req('PATCH', u, b, o),
    del: (u, b, o) => req('DELETE', u, b, o),
    clear: () => jar.clear(),
  };
}

/* ---------- 极简断言 ---------- */
export const results = { pass: 0, fail: 0, failures: [] };

export function check(name, cond, detail = '') {
  if (cond) { results.pass++; return true; }
  results.fail++;
  results.failures.push(`${name}${detail ? ` —— ${detail}` : ''}`);
  return false;
}

export function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(name, ok, ok ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

export function report(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(60));
  console.log(`通过 ${results.pass} · 失败 ${results.fail}`);
  if (results.failures.length) {
    console.log('\n失败明细：');
    results.failures.forEach((f) => console.log('  ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('✓ 全部通过');
  }
}
