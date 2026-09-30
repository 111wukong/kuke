/* 库课 · 判题路径压测
 *
 * 专门打 /api/sql/levels/:id/submit —— 最重的一条路径。
 * 每次提交要跑 worker 任务（学生 SQL，以及首次的参考答案），
 * 外加 attempts / stats_node / stats_daily 三张表的写库。
 *
 * 为什么单独一个脚本：run.mjs 的 closed 模式只能打固定 body 的接口，
 * 而判题需要 POST JSON。而且判题的瓶颈和读接口完全不同 ——
 * 读接口瓶颈在事件循环，判题瓶颈在 worker 池。
 *
 * 用法：
 *   node bench/bench-submit.mjs submit --c 300 --dur 20 --level L01
 *   node bench/bench-submit.mjs run    --c 300 --dur 20
 *   node bench/bench-submit.mjs mixed  --c 300 --dur 30
 */
import http from 'node:http';
import fs from 'node:fs';

const HOST = process.env.BENCH_HOST || '127.0.0.1';
const PORT = Number(process.env.BENCH_PORT || 5188);
const TOKENS = process.env.TOKENS_OUT || '/tmp/kuke-bench/tokens.json';
const RESULTS = process.env.RESULTS_OUT || '/tmp/kuke-bench/results-submit.jsonl';

const agent = new http.Agent({ keepAlive: true, maxSockets: 4096, maxFreeSockets: 1024, timeout: 0 });

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function doReq({ method = 'GET', path, body = null, cookie = null, ip = null, timeoutMs = 30000 }) {
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
  };
}

function print(o) {
  console.log(
    `\n■ ${o.name}\n` +
    `  请求 ${o.requests} · 吞吐 ${o.rps} req/s · 成功率 ${o.okRate}%\n` +
    `  状态码 ${JSON.stringify(o.codes)}\n` +
    `  延迟 avg ${o.avg}ms | p50 ${o.p50} | p90 ${o.p90} | p95 ${o.p95} | p99 ${o.p99} | max ${o.max}ms`
  );
}

/* 每个虚拟用户独立 IP —— 排除限流干扰，测的是 worker 池本身。
 * 想连带测限流就把 xff 写死成同一个值。 */
const xffOf = (w) => `10.${(w >> 8) & 255}.${w & 255}.1`;

async function submitStorm({ c, dur, level }) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const results = [];
  const stopAt = Date.now() + dur * 1000;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: c }, (_, w) => (async () => {
    const t = tokens[w % tokens.length];
    const cookie = `kuke_sid=${t.token}`;
    const xff = xffOf(w);
    while (Date.now() < stopAt) {
      results.push(await doReq({
        method: 'POST', path: `/api/sql/levels/${level}/submit`,
        body: { sql: 'SELECT * FROM student', durationMs: 1200 },
        cookie, ip: xff,
      }));
    }
  })()));
  return summarize(`判题提交 ${level} c=${c} ip=diff`, results, Date.now() - t0);
}

async function runStorm({ c, dur }) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const results = [];
  const stopAt = Date.now() + dur * 1000;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: c }, (_, w) => (async () => {
    const t = tokens[w % tokens.length];
    const cookie = `kuke_sid=${t.token}`;
    const xff = xffOf(w);
    while (Date.now() < stopAt) {
      results.push(await doReq({
        method: 'POST', path: '/api/sql/run',
        body: { datasetId: 'school', sql: 'SELECT * FROM student' },
        cookie, ip: xff,
      }));
    }
  })()));
  return summarize(`自由运行 /api/sql/run c=${c} ip=diff`, results, Date.now() - t0);
}

/* 混合：真实课堂节奏 —— 一半人刷页面，一半人在判题。
 * 这是最接近「一节课进行到一半」的负载形态：
 * 判题的 worker 占用会不会把读接口一起拖慢，只有这个场景能看出来。 */
async function mixed({ c, dur }) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const results = [];
  const stopAt = Date.now() + dur * 1000;
  const t0 = Date.now();
  const reads = ['/api/study/snapshot', '/api/catalog/tree', '/api/catalog/levels', '/api/study/stats'];
  await Promise.all(Array.from({ length: c }, (_, w) => (async () => {
    const t = tokens[w % tokens.length];
    const cookie = `kuke_sid=${t.token}`;
    const xff = xffOf(w);
    await sleep(Math.random() * 4000);
    while (Date.now() < stopAt) {
      if (w % 2 === 0) {
        results.push(await doReq({ path: reads[w % reads.length], cookie, ip: xff }));
        await sleep(300 + Math.random() * 700);
      } else {
        results.push(await doReq({
          method: 'POST', path: '/api/sql/levels/L01/submit',
          body: { sql: 'SELECT * FROM student', durationMs: 1200 }, cookie, ip: xff,
        }));
        await sleep(1500 + Math.random() * 2000);
      }
    }
  })()));
  return summarize(`混合负载 c=${c} dur=${dur}s`, results, Date.now() - t0);
}

const mode = process.argv[2] || 'submit';
const c = Number(arg('c', 300));
const dur = Number(arg('dur', 20));
const level = arg('level', 'L01');

let r;
if (mode === 'run') r = await runStorm({ c, dur });
else if (mode === 'mixed') r = await mixed({ c, dur });
else r = await submitStorm({ c, dur, level });

print(r);
fs.appendFileSync(RESULTS, JSON.stringify({ ...r, mode, c, dur, ts: Date.now() }) + '\n');
