/* AI 课堂的真机联通检查
 *
 * ── 它和 tests/ai.mjs 的区别 ────────────────────────────────────
 * tests/ai.mjs 打的是 **mock 上游** —— 确定、不烧钱，用来验逻辑。
 * 这个脚本打的是**真的 DeepSeek** —— 用来验「协议没理解错」：
 * 流式真的能解析、tool_calls 真的会来、模型真的会调 run_sql。
 *
 * 两者都要有。只有 mock 的话，协议理解错了也测不出来；
 * 只有真机的话，不可复现且烧钱。
 *
 * 用法：
 *   node scripts/smoke-ai.mjs                        # 默认跑一节 solo 课
 *   node scripts/smoke-ai.mjs --kid k-index --mode class
 *   node scripts/smoke-ai.mjs --base http://127.0.0.1:5180 --email x@y.z --password xxx
 */

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const BASE = arg('base', 'http://127.0.0.1:5180').replace(/\/+$/, '');
const EMAIL = arg('email', 'teacher@localhost');
const PASSWORD = arg('password', 'Kuke2026');
const KID = arg('kid', 'k-dbms');
const MODE = arg('mode', 'solo');

const ANSWERS = ['还是没懂', '懂了，继续', '懂了，继续', '懂了，继续'];

/* ---------- 带 cookie 的会话 ---------- */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  for (const c of r.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  if (!r.ok) throw new Error(`登录失败（HTTP ${r.status}）：${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  console.log(`✓ 已登录 ${j.user.email}（${j.user.username} · ${j.user.role}）`);
}

async function main() {
  await login();

  const health = await (await fetch(`${BASE}/api/ai/health`, { headers: { Cookie: cookieHeader() } })).json();
  console.log(`✓ AI：模型 ${health.model} · 密钥来自 ${health.keySource === 'env-file' ? '.env' : '环境变量'}`);
  if (!health.hasKey) throw new Error('服务端没配 DEEPSEEK_API_KEY');

  console.log(`\n—— 开一节课：考点 ${KID} · 模式 ${MODE} ——\n`);

  const res = await fetch(`${BASE}/api/ai/classroom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ kid: KID, mode: MODE }),
  });
  if (!res.ok) throw new Error(`开课失败（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sessionId = null;
  let ai = 0;
  let round = 0;
  let teacherText = '';
  const boards = [];
  const calls = [];

  const t0 = Date.now();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let e;
        try { e = JSON.parse(line.slice(5).trim()); } catch { continue; }

        switch (e.type) {
          case 'start': sessionId = e.session.id; break;
          case 'round':
            round = e.round + 1;
            console.log(`\n【第 ${round} 轮 · ${e.meta?.label || e.phase}】`);
            break;
          case 'delta':
            // 只打印一次：增量是逐字的，直接 print 会把终端刷爆
            break;
          case 'patch':
            teacherText = e.text;
            console.log(`老师(${e.move || '—'})：${String(e.text).replace(/\s+/g, ' ').slice(0, 160)}`);
            break;
          case 'turn':
            console.log(`${e.turn.name}：${String(e.turn.text).replace(/\s+/g, ' ').slice(0, 90)}`);
            break;
          case 'tool':
            if (e.phase === 'call') calls.push(e.name);
            break;
          case 'board':
            boards.push(e.item);
            console.log(`  [黑板] ${e.item.kind}${e.item.kind === 'sql' ? ` · ${e.item.rowCount} 行` : ''}`);
            break;
          case 'note':
            console.log(`  [提示] ${e.text}`);
            break;
          case 'ask': {
            const label = ANSWERS[Math.min(ai++, ANSWERS.length - 1)];
            console.log(`  [该你了] ${String(e.spec.prompt).replace(/\s+/g, ' ').slice(0, 70)}`);
            console.log(`  → 自动作答：${label}`);
            fetch(`${BASE}/api/ai/classroom/${sessionId}/answer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
              body: JSON.stringify({ text: label }),
            }).catch(() => {});
            break;
          }
          case 'error':
            console.log(`  [错误] ${e.message}`);
            break;
          default: break;
        }
      }
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n' + '─'.repeat(60));
  console.log(`✓ 一节课跑完 · ${round} 轮 · ${secs}s`);
  console.log(`  黑板 ${boards.length} 块：${boards.map((b) => b.kind).join(' / ') || '（空）'}`);
  console.log(`  工具调用：${calls.length ? calls.join(' / ') : '（无）'}`);

  const sql = boards.filter((b) => b.kind === 'sql');
  if (sql.length) {
    const b = sql[0];
    console.log(`\n  ★ 第一条真的在教学库上跑出来的 SQL：`);
    console.log(`    ${String(b.sql).replace(/\s+/g, ' ').slice(0, 100)}`);
    console.log(`    列：${(b.columns || []).join(', ')} · ${b.rowCount} 行`);
    if (b.rows?.length) console.log(`    首行：${JSON.stringify(b.rows[0])}`);
  }
  if (teacherText) {
    console.log(`\n  老师最后一段：${String(teacherText).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  console.log('\n完成。去浏览器里体验：' + BASE + '/classroom');
}

main().catch((e) => {
  console.error('\n✗ ' + (e?.message || e));
  process.exit(1);
});
