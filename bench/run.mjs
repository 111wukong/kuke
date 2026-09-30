/* 库课 · 并发压测（通用）
 *
 * 零第三方依赖：只用 node:http 原生客户端。
 * 三种发压模型：
 *   closed  —— 固定 N 个并发用户，每个用户「发完一个再发下一个」（无思考时间，最坏情况）
 *   session —— 固定 N 个虚拟用户，带思考时间跑一段完整学习流程（真实课堂节奏）
 *   login   —— N 个并发同时登录（开学第一课）
 *
 * IP 形态（--ip）：
 *   same  —— 所有请求同一个 X-Forwarded-For（校园网 / 机房 NAT 出口）
 *   diff  —— 每个虚拟用户一个 IP（人手一终端、独立宽带）
 *
 * 用法：
 *   node bench/run.mjs closed  --c 300 --dur 20 --path /api/study/snapshot --auth --ip diff
 *   node bench/run.mjs login   --c 300 --ip same
 *   node bench/run.mjs session --c 300 --dur 60 --ip diff
 *
 * 服务端记得开 TRUST_PROXY，否则 X-Forwarded-For 会被忽略（见 bench/README.md）。
 */
import http from 'node:http';
import fs from 'node:fs';

const HOST = process.env.BENCH_HOST || '127.0.0.1';
const PORT = Number(process.env.BENCH_PORT || 5180);
const TOKENS = process.env.TOKENS_OUT || '/tmp/kuke-bench/tokens.json';
const RESULTS = process.env.RESULTS_OUT || '/tmp/kuke-bench/results.jsonl';
const QIDS = (process.env.BENCH_QIDS || 'Q001,Q002,Q003,Q004,Q005,Q006,Q007,Q008').split(',');

const agent = new http.Agent({ keepAlive: true, maxSockets: 2048, maxFreeSockets: 512, timeout: 0 });

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function doReq({ method = 'GET', path, body = null, cookie = null, ip = null, timeoutMs = 60000 }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const headers = { accept: 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (ip) headers['x-forwarded-for'] = ip;
    let payload = null;
    if (body != null) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const r = http.request({ host: HOST, port: PORT, method, path, headers, agent }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, bytes: n }));
    });
    r.on('error', (e) => resolve({ status: 0, ms: Date.now() - t0, err: e.code || e.message }));
    r.setTimeout(timeoutMs, () => { r.destroy(); resolve({ status: -1, ms: Date.now() - t0, err: 'timeout' }); });
    if (payload) r.write(payload);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function summarize(name, results, wallMs) {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] : 0);
  const by = {};
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1;
  const ok = results.filter((r) => r.status >= 200 && r.status < 400).length;
  const errs = Object.keys(by).filter((k) => !(Number(k) >= 200 && Number(k) < 400));
  return {
    name,
    requests: results.length,
    rps: +(results.length / (wallMs / 1000)).toFixed(1),
    ok,
    okRate: results.length ? +((ok / results.length) * 100).toFixed(1) : 0,
    p50: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99),
    max: ms.length ? ms[ms.length - 1] : 0,
    avg: ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) : 0,
    codes: Object.fromEntries(Object.entries(by).sort()),
    errBreakdown: errs.length ? errs.map((k) => `${k}×${by[k]}`).join(' ') : '—',
  };
}

function print(o) {
  console.log(
    `\n■ ${o.name}\n` +
    `  请求 ${o.requests} · 吞吐 ${o.rps} req/s · 成功率 ${o.okRate}% · 非 2xx：${o.errBreakdown}\n` +
    `  延迟 avg ${o.avg}ms | p50 ${o.p50} | p90 ${o.p90} | p95 ${o.p95} | p99 ${o.p99} | max ${o.max}ms`
  );
}

/* ---------- 场景 1：closed-loop，固定并发打一个接口 ---------- */
async function closed(opts) {
  const { c, dur, path, method = 'GET', body = null, auth, ip } = opts;
  const tokens = auth ? JSON.parse(fs.readFileSync(TOKENS, 'utf8')) : [];
  const results = [];
  const stopAt = Date.now() + dur * 1000;
  let seq = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: c }, (_, w) => (async () => {
    const t = tokens[w % Math.max(tokens.length, 1)];
    const cookie = auth ? `kuke_sid=${t.token}` : null;
    const xff = ip === 'diff' ? `10.${(w >> 16) & 255}.${(w >> 8) & 255}.${w & 255}` : '202.96.128.1';
    while (Date.now() < stopAt) {
      seq++;
      const b = body ? (typeof body === 'function' ? body(seq, t) : body) : null;
      results.push(await doReq({ method, path, body: b, cookie, ip: xff }));
    }
  })()));
  return summarize(opts.name, results, Date.now() - t0);
}

/* ---------- 场景 2：登录风暴 ---------- */
async function loginStorm(opts) {
  const { c, ip } = opts;
  const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const results = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: c }, (_, w) => (async () => {
    const t = tokens[w % tokens.length];
    const xff = ip === 'diff' ? `10.${(w >> 16) & 255}.${(w >> 8) & 255}.${w & 255}` : '202.96.128.1';
    results.push(await doReq({
      method: 'POST', path: '/api/auth/login',
      body: { email: t.email, password: 'Student#12345' },
      ip: xff,
    }));
  })()));
  return summarize(opts.name, results, Date.now() - t0);
}

/* ---------- 场景 3：虚拟用户完整会话（带思考时间） ---------- */
async function sessionSim(opts) {
  const { c, dur, ip } = opts;
  const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const results = [];
  const stopAt = Date.now() + dur * 1000;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: c }, (_, w) => (async () => {
    const t = tokens[w % tokens.length];
    const cookie = `kuke_sid=${t.token}`;
    const xff = ip === 'diff' ? `10.${(w >> 16) & 255}.${(w >> 8) & 255}.${w & 255}` : '202.96.128.1';
    // 错峰进场：0~5 秒内随机开始，模拟学生陆续打开页面
    await sleep(Math.random() * 5000);
    while (Date.now() < stopAt) {
      // 一轮典型学习动作：仪表盘 → 知识树 → 关卡列表 → 复习队列 → 答一题 → 统计
      results.push(await doReq({ path: '/api/study/snapshot', cookie, ip: xff }));
      await sleep(300 + Math.random() * 400);
      results.push(await doReq({ path: '/api/catalog/tree', cookie, ip: xff }));
      await sleep(400 + Math.random() * 600);
      results.push(await doReq({ path: '/api/catalog/levels', cookie, ip: xff }));
      await sleep(500 + Math.random() * 800);
      results.push(await doReq({ path: '/api/study/review', cookie, ip: xff }));
      await sleep(600 + Math.random() * 1000);
      results.push(await doReq({
        method: 'POST', path: '/api/study/answer',
        body: { qid: QIDS[Math.floor(Math.random() * QIDS.length)], answer: 'B', context: 'practice', durationMs: 1200 },
        cookie, ip: xff,
      }));
      await sleep(800 + Math.random() * 1500);
      results.push(await doReq({ path: '/api/study/stats', cookie, ip: xff }));
      await sleep(1500 + Math.random() * 2500);
    }
  })()));
  return summarize(opts.name, results, Date.now() - t0);
}

/* ---------- 入口 ---------- */
const mode = process.argv[2] || 'closed';
const c = Number(arg('c', 300));
const dur = Number(arg('dur', 20));
const path = arg('path', '/api/study/snapshot');
const method = arg('method', 'GET');
const auth = process.argv.includes('--auth');
const ip = arg('ip', 'diff');
const label = arg('label', `${mode} c=${c} ip=${ip}`);

let r;
if (mode === 'login') r = await loginStorm({ name: label, c, ip });
else if (mode === 'session') r = await sessionSim({ name: label, c, dur, ip });
else r = await closed({ name: label, c, dur, path, method, auth, ip });

print(r);
fs.appendFileSync(RESULTS, JSON.stringify({ ...r, c, dur, ip, ts: Date.now() }) + '\n');
