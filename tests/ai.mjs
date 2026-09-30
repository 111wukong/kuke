/* AI 端到端测试
 *
 * 打的是**真的链路**：
 *   HTTP 客户端 → Fastify 路由 → ai/classroom（集群编排）
 *   → ai/agent（内核循环）→ ai/llm（模型通道）→ mock 上游
 *
 * ── ★ 本文件最要紧的一条断言 ────────────────────────────────────
 * 不是「接口返回了 200」，而是 **mock 上游真的收到了 Authorization 头**。
 * 只断言返回值的话，即使凭据没发出去、只要 mock 不校验，测试照样绿 —— 那就白测了。
 *
 * ── 为什么不用真模型 ────────────────────────────────────────────
 * 真模型不可复现，而且烧钱。mock 能把分片怎么切、什么时候调工具、
 * JSON 会不会畸形都钉死。
 */

import { startServer, makeClient, check, eq, report } from './lib/harness.mjs';
import { startMockLLM, textDeltas, toolDeltas, GOOD_QUESTIONS } from './lib/mock-llm.mjs';

const FAKE_KEY = 'sk-test-kuke-0123456789abcdef';
const BEARER = `Bearer ${FAKE_KEY}`;

const mock = await startMockLLM();

/* 第 7 节生成的题留给第 8 节用。
 * ★ 别在第 8 节重新生成一次 —— 同一个考点再出一次会被**去重**挡掉
 *   （题干和刚入库的那批一样），拿到空数组，然后报一个
 *   「Cannot read properties of undefined」这种离现场很远的错。 */
let generatedQ = null;

/* ★ 测试用的服务**不能读项目根的 .env**。
 *   不隔离的话，本机 .env 里那把真 key 会（按「凭据类 .env 优先」的规则）
 *   顶掉测试传进去的假 key —— 于是「服务端真的收到了凭据」那条断言
 *   会拿着真 key 去比，测试要么假绿要么假红，两头都不可信。 */
const srv = await startServer({
  env: {
    KUKE_ENV_FILE: '/tmp/kuke-test-no-such-env-file',
    DEEPSEEK_API_KEY: FAKE_KEY,
    DEEPSEEK_BASE: mock.url,
    DEEPSEEK_MODEL: 'deepseek-chat',
  },
});
const base = srv.base;
const teacher = makeClient(base);

/* ---------- 工具 ---------- */
const cookieOf = (client) => [...client.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * 跑一节 AI 课：收 SSE 事件，遇到 ask 就按脚本作答。
 * @returns {{events:Array, sessionId:string, askCount:number}}
 */
async function runClass(client, body, answers = []) {
  const res = await fetch(`${base}/api/ai/classroom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieOf(client) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* 无所谓 */ }
    return { events: [], sessionId: null, askCount: 0, httpStatus: res.status, detail };
  }

  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sessionId = null;
  let ai = 0;
  let askCount = 0;
  const pending = [];

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
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        events.push(ev);
        if (ev.type === 'start') sessionId = ev.session.id;
        if (ev.type === 'ask' && sessionId) {
          askCount += 1;
          const label = answers[Math.min(ai++, answers.length - 1)] ?? '继续';
          /* ★ 异步提交，**不要 await** —— 等它会把 SSE 的读取卡住，
           *   而服务端正等着这个答案才继续往下发。这就是死锁。 */
          pending.push(
            fetch(`${base}/api/ai/classroom/${sessionId}/answer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Cookie: cookieOf(client) },
              body: JSON.stringify({ text: label }),
            }).catch(() => null),
          );
        }
      }
    }
  }
  await Promise.all(pending);
  return { events, sessionId, askCount, httpStatus: res.status };
}

try {
  /* ============================================================
     0. 登录 + 健康检查
     ============================================================ */
  const login = await teacher.post('/api/auth/login', { email: 'teacher@test.local', password: 'Teacher123' });
  check('登录成功', login.status === 200, `HTTP ${login.status}`);

  {
    const h = await teacher.get('/api/ai/health');
    eq('AI 健康检查返回 200', h.status, 200);
    eq('服务端报告已配密钥', h.body.hasKey, true);
    eq('密钥来源标成 environment（测试没给 .env）', h.body.keySource, 'environment');
    check('★ 健康检查的响应体里不含密钥本身', !JSON.stringify(h.body).includes(FAKE_KEY));
    check('★ 也不含密钥的任何前缀', !JSON.stringify(h.body).includes(FAKE_KEY.slice(0, 12)));
    eq('回的是模型名', h.body.model, 'deepseek-chat');
  }

  {
    const r = await teacher.get('/api/ai/tools');
    const names = (role) => r.body[role].map((t) => t.name);
    check('★ 老师手里有 write_sql（写完整解答的能力）', names('teacher').includes('write_sql'));
    check('★ 学生手里**没有** write_sql', !names('student').includes('write_sql'));
    check('★ 学生手里也没有 write_steps / write_latex', !names('student').includes('write_steps') && !names('student').includes('write_latex'));
    check('学生手里有 raise_hand / pass / recall_mistake', ['raise_hand', 'pass', 'recall_mistake'].every((n) => names('student').includes(n)));
    check('★ 老师手里**没有** raise_hand（老师不用举手）', !names('teacher').includes('raise_hand'));
    check('两边都有 run_sql（学生也能在教学库上跑 SQL）', names('teacher').includes('run_sql') && names('student').includes('run_sql'));
    check('工具数量与白名单一致', r.body.counts.teacher === names('teacher').length && r.body.counts.student === names('student').length);
    check('资料可见性分档返回了', !!r.body.depth && !!r.body.depth.c);
  }

  /* ============================================================
     1. ★ 一整节课（多人课堂，中途作答）
     ============================================================ */
  {
    mock.clearLog();
    mock.setRoute(null);          // 走默认路由
    mock.setScript([]);

    const { events, sessionId, askCount, httpStatus, detail } = await runClass(
      teacher, { kid: 'k-dbms', mode: 'class' }, ['还是没懂', '懂了，继续', '懂了，继续'],
    );

    eq('开课接口返回 200', httpStatus, 200);
    check('拿到了 session id', !!sessionId, detail || '');
    check('★ 每一轮都挂起了等作答（至少 2 次 ask）', askCount >= 2, `askCount=${askCount}`);

    const kinds = (t) => events.filter((e) => e.type === t);
    const notes = kinds('note').map((e) => e.text);

    check('★ 老师发言的增量流到了前端', kinds('delta').length > 0);
    check('★ 至少渲染了 3 轮', kinds('round').length >= 3, `rounds=${kinds('round').length}`);
    check('★ 三个学生都发过言', kinds('turn').filter((e) => e.turn.role !== 'teacher').length >= 3);
    check('★ 用户自己的答案也上屏了', kinds('user').length >= 2);
    check('★ 前端收到了「同学已安静」的提示', notes.some((n) => n.includes('安静')), JSON.stringify(notes));
    check('★ 前端收到了「本来要出题，被换成了确认」的提示', notes.some((n) => n.includes('被换成了理解确认')), JSON.stringify(notes));
    check('课结束时会发 done 事件', kinds('done').length === 1);

    /* 黑板 */
    const boards = kinds('board').map((e) => e.item);
    check('★ 黑板上有内容', boards.length >= 2, `blocks=${boards.length}`);
    check('★ 有真的 SQL 结果块（run_sql 跑出来的）', boards.some((b) => b.kind === 'sql'), JSON.stringify(boards.map((b) => b.kind)));
    check('★ 有序号步骤块', boards.some((b) => b.kind === 'steps'));
    const sqlBlock = boards.find((b) => b.kind === 'sql');
    if (sqlBlock) {
      check('SQL 结果块带了列名', Array.isArray(sqlBlock.columns) && sqlBlock.columns.length > 0, JSON.stringify(sqlBlock.columns));
      check('SQL 结果块带了行数据（真跑过，不是空壳）', Array.isArray(sqlBlock.rows) && sqlBlock.rows.length > 0, `rows=${sqlBlock.rows && sqlBlock.rows.length}`);
      check('SQL 结果块记了数据集', !!sqlBlock.dataset);
      check('★ 黑板上的块带了作者标记', boards.every((b) => !!b.by));
    }

    /* 教学动作标签 */
    const patches = kinds('patch');
    check('★ 老师的发言被标了教学动作', patches.some((p) => p.move), JSON.stringify(patches.map((p) => p.move)));

    /* ★★ 服务端真的收到了凭据 */
    check('★ mock 上游确实收到了 Authorization 头', mock.log.length > 0 && !!mock.log[0].auth, JSON.stringify(mock.log[0] && mock.log[0].auth));
    eq('★ Authorization 是 Bearer + 密钥', mock.log[0].auth, BEARER);
    check('★ 请求打在正确的路径上', mock.log[0].path === '/v1/chat/completions', mock.log[0].path);

    /* ★ 工具结果真的回灌给了模型 */
    const withToolMsg = mock.log.find((l) => (l.body.messages || []).some((m) => m.role === 'tool'));
    check('★ 工具结果以 role:tool 回灌给了模型', !!withToolMsg);
    if (withToolMsg) {
      const toolMsgs = withToolMsg.body.messages.filter((m) => m.role === 'tool');
      check('★ 回灌的 tool_call_id 和 assistant 消息里的对得上',
        toolMsgs.every((tm) => withToolMsg.body.messages.some((m) => m.role === 'assistant' && (m.tool_calls || []).some((tc) => tc.id === tm.tool_call_id))));
      /* ★ 这条同时证明了「分片拼接」是对的：参数拼坏 → 工具报错。 */
      const sqlMsg = toolMsgs.find((m) => String(m.content).includes('columns'));
      check('★ run_sql 真的执行了（回灌内容里有真实结果列，不是报错）',
        !!sqlMsg && !String(sqlMsg.content).includes('SQL 执行失败'), sqlMsg && String(sqlMsg.content).slice(0, 160));
    }

    /* ============================================================
       ★★ 结构性无知：四个角色拿到的**资料量**必须真的不同
       ============================================================
       这是多智能体最容易做砸的地方 —— 只靠提示词写「你基础不好」，
       模型会说出几乎一样的话，机制退化成噪音。
       真正的差异必须体现在**发给上游的请求体**里，所以直接断言它。 */
    const sysOf = (l) => String((l.body.messages.find((m) => m.role === 'system') || {}).content || '');
    const studentLogs = mock.log.filter((l) => /是陈老师课上的一名学生/.test(sysOf(l)));
    check('★ 三个学生是**独立调用**（不是一次生成三段台词）', studentLogs.length >= 3, `实际 ${studentLogs.length} 次`);
    /* ★ 一个角色会被调多次（每轮都发言），所以「两两不同」要按**角色取一份**再比。
     *   直接拿全部日志去重的话，3 个角色 × 2 轮 = 6 份，比出来必然不等 ——
     *   那是断言写错了，不是角色趋同。 */
    const onePerRole = ['林一鸣', '周雨桐', '马小虎'].map((n) => studentLogs.find((l) => sysOf(l).includes(n)));
    check('★ 三个角色拿到的提示词两两不同（角色没有趋同）',
      onePerRole.every(Boolean) && new Set(onePerRole.map(sysOf)).size === 3,
      `不同的有 ${new Set(onePerRole.map(sysOf)).size} 份`);

    const cLog = onePerRole[2];
    const aLog = onePerRole[0];
    check('★ 后进生（马小虎）的提示词里说明了「你手上只有一句摘要」',
      !!cLog && /只有上面那一句摘要/.test(sysOf(cLog)), cLog ? sysOf(cLog).slice(0, 120) : '没找到马小虎的请求');
    check('★ 优等生（林一鸣）拿到的资料明显比后进生多',
      !!aLog && !!cLog && sysOf(aLog).length > sysOf(cLog).length + 200,
      `林一鸣 ${aLog ? sysOf(aLog).length : 0} 字 vs 马小虎 ${cLog ? sysOf(cLog).length : 0} 字`);

    const tLog = mock.log.find((l) => /陈老师/.test(sysOf(l)) && !/是陈老师课上的一名学生/.test(sysOf(l)));
    check('★ 老师拿到的资料又比优等生多（全量 + 学情数据）',
      !!tLog && !!aLog && sysOf(tLog).length > sysOf(aLog).length,
      `老师 ${tLog ? sysOf(tLog).length : 0} 字 vs 林一鸣 ${aLog ? sysOf(aLog).length : 0} 字`);
    check('★ 老师提示词里带了学习档案（真实作答记录）',
      !!tLog && /真实作答记录/.test(sysOf(tLog)), tLog ? '没有档案段落' : '没找到老师的请求');
    check('★ 老师提示词里写了「需要具体结果时一律用 run_sql 真的跑一遍」',
      !!tLog && /一律用 run_sql 真的跑一遍/.test(sysOf(tLog)));

    /* 会话收尾 */
    const after = await teacher.get(`/api/ai/classroom/${sessionId}`);
    eq('课结束后会话仍在（能查状态）', after.status, 200);
    eq('课结束后 live=false', after.body.live, false);
    eq('★ 课结束后不能再插话', after.body.session.canInterject, false);
    check('★ 引导占比算得出来', (after.body.moves.focus + after.body.moves.probing + after.body.moves.telling) > 0, JSON.stringify(after.body.moves));
    check('★ 记录里带上了他答的原文', after.body.session.qa.some((q) => q.a === '还是没懂'));
  }

  /* ============================================================
     2. ★ 答疑阶段：同学必须安静，且不许出题
     ============================================================ */
  {
    mock.clearLog();
    mock.setRoute(null);
    const { events } = await runClass(teacher, { kid: 'k-dbms', mode: 'class' }, ['没听懂', '没听懂', '没听懂']);

    const clarifyRounds = events.filter((e) => e.type === 'round' && e.phase === 'clarify');
    check('★ 说「没听懂」之后进入了答疑阶段', clarifyRounds.length >= 1, JSON.stringify(events.filter((e) => e.type === 'round').map((e) => e.phase)));

    /* ★ 答疑轮里不该有任何学生发言 */
    const clarifyTurns = events.filter((e) => e.type === 'turn' && e.turn.round > 0);
    eq('★ 答疑阶段一条学生发言都没有', clarifyTurns.length, 0);

    /* ★ 老师故意违规出的那道算题必须被换掉 */
    const patches = events.filter((e) => e.type === 'patch');
    check('★ 答疑轮的结尾问题不再是「动手题」',
      patches.every((p) => !/写出[^，。？?]{0,14}|写一条查询/.test(p.text.slice(-60))),
      JSON.stringify(patches.map((p) => p.text.slice(-50))));
    check('★ 前端如实说明了「被换成了理解确认」',
      events.some((e) => e.type === 'note' && /被换成了理解确认/.test(e.text)));
  }

  /* ============================================================
     3. ★ 一对一模式：不调学生
     ============================================================ */
  {
    mock.clearLog();
    mock.setRoute(null);
    const { events } = await runClass(teacher, { kid: 'k-dbms', mode: 'solo' }, ['懂了，继续', '懂了，继续', '懂了，继续']);
    const studentTurns = events.filter((e) => e.type === 'turn' && e.turn.role !== 'teacher');
    eq('★ solo 模式下一句学生发言都没有', studentTurns.length, 0);
    check('老师仍然讲了', events.filter((e) => e.type === 'delta').length > 0);
  }

  /* ============================================================
     4. ★ 学生越权调用老师工具 → 被拒
     ============================================================ */
  {
    mock.clearLog();
    mock.setRoute((body) => {
      const msgs = body.messages || [];
      const sys = String((msgs.find((m) => m.role === 'system') || {}).content || '');
      const tools = body.tools || [];
      const hasToolResult = msgs.some((m) => m.role === 'tool');
      if (/课堂调度器/.test(sys)) return textDeltas('{"next":"END"}');
      if (/是陈老师课上的一名学生/.test(sys)) {
        // 学生故意试一个它不该有的工具
        if (tools.length && !hasToolResult) return toolDeltas([{ name: 'write_sql', args: { sql: 'SELECT 1' } }], '', 2);
        return textDeltas('我觉得是这样。');
      }
      if (/陈老师/.test(sys)) return textDeltas('(focus)\n\n你先说说看？');
      return textDeltas('（默认）');
    });

    const { events } = await runClass(teacher, { kid: 'k-dbms', mode: 'class' }, ['懂了', '懂了']);
    const toolResults = events.filter((e) => e.type === 'tool' && e.phase === 'done');
    const studentSql = toolResults.filter((e) => e.role !== 'teacher' && e.name === 'write_sql');
    check('★ 学生调 write_sql 被拒（ok=false）', studentSql.length > 0 && studentSql.every((e) => e.ok === false), JSON.stringify(studentSql));
    check('★ 拒绝时给了可操作的原因', studentSql.every((e) => /可用清单|只能用/.test(String(e.error || ''))), JSON.stringify(studentSql.map((e) => e.error)));

    /* 而且黑板上不该出现学生写的 SQL 块 */
    const boards = events.filter((e) => e.type === 'board').map((e) => e.item);
    check('★ 学生的越权调用没有污染黑板', !boards.some((b) => b.kind === 'latex' && String(b.tex).includes('SELECT 1')));
    mock.setRoute(null);
  }

  /* ============================================================
     5. ★ 上游不认 tools → 降级到文本协议
     ============================================================ */
  {
    mock.clearLog();
    mock.setMode('notools');
    mock.setRoute(null);
    const { events, askCount } = await runClass(teacher, { kid: 'k-dbms', mode: 'solo' }, ['懂了', '懂了']);
    mock.setMode('ok');
    check('★ 网关拒绝 tools 时仍然把课上完了', events.some((e) => e.type === 'done'), JSON.stringify(events.map((e) => e.type).slice(-6)));
    check('降级之后老师仍然发了言', events.filter((e) => e.type === 'delta').length > 0);
    check('★ 重试的请求去掉了 tools', mock.log.some((l) => !l.body.tools || l.body.tools.length === 0));
    check('★ 重试时把工具协议说明写进了 system',
      mock.log.some((l) => /工具调用协议/.test(String((l.body.messages[0] || {}).content || ''))));
    check('降级之后课照样会挂起等作答', askCount >= 1);
  }

  /* ============================================================
     6. 上游挂了不能让整节课炸掉
     ============================================================ */
  {
    mock.setMode('billing');
    const { events } = await runClass(teacher, { kid: 'k-dbms', mode: 'solo' }, ['x']);
    mock.setMode('ok');
    check('★ 上游报错时前端收到 error 事件（而不是无声失败）', events.some((e) => e.type === 'error'));
    check('★ 出错时也会走到 done（不会卡住连接）', events.some((e) => e.type === 'done'));
  }

  /* ============================================================
     7. ★ AI 出题：模型给的东西必须过清洗，而且真的入库
     ============================================================ */
  {
    mock.clearLog();
    mock.setScript([textDeltas(JSON.stringify(GOOD_QUESTIONS))]);
    const before = (await teacher.get('/api/catalog/knowledge')).body;

    const r = await teacher.post('/api/ai/generate', { kid: 'k-dbms', count: 3 });
    eq('出题接口返回 200', r.status, 200);
    eq('★ 好题被留下（要 3 道就给 3 道）', r.body.count, 3);
    check('★ 不可判的题被丢掉并计数', r.body.skippedUnjudgeable >= 1, `丢了几道：${r.body.skippedUnjudgeable}`);
    eq('不是解析失败', r.body.parseFailed, false);
    check('返回里说清了丢了几道', /生成|丢/.test(r.body.note), r.body.note);
    check('★ 出题请求走的是非流式', mock.log[0].body.stream === false);
    check('★ 出题提示词里写死了硬性边界（防线一）', /硬性要求/.test(String((mock.log[0].body.messages[0] || {}).content || '')));
    check('提示词里禁掉了简答题', /禁止出简答题/.test(String((mock.log[0].body.messages[0] || {}).content || '')));

    /* ★ 拿生成结果走一遍**真实的下游**：库课的判题器。
     *   清洗逻辑写得再漂亮也可能是错的 —— 判题器真正吃什么，只有跑一遍才知道。 */
    for (const q of r.body.created) {
      /* ★ 断言要打在**库课判题器真正返回的字段**上。
       *   /api/study/answer 回的是 { pass, score, message, correctAnswer }，
       *   不是 { correct } —— 写错字段名的话，即使判分完全正确，
       *   断言也会全红，而且失败明细里看起来「明明 pass 是 true」。 */
      const right = await teacher.post('/api/study/answer', { qid: q.id, answer: q.answer });
      check(`★ 生成题「${String(q.stem).slice(0, 14)}」的标准答案能判对`, right.body.pass === true,
        `answer=${q.answer} → ${JSON.stringify(right.body).slice(0, 140)}`);
    }
    const firstQ = r.body.created[0];
    generatedQ = firstQ;
    if (firstQ && firstQ.type === 'choice') {
      const wrongKey = 'ABCD'.split('').find((k) => k !== firstQ.answer);
      const wrong = await teacher.post('/api/study/answer', { qid: firstQ.id, answer: wrongKey });
      check('★ 生成题的错答案能判错', wrong.body.pass === false, JSON.stringify(wrong.body).slice(0, 140));
    }
    check('生成题确实进了题库（返回里带了 id）', r.body.created.every((q) => !!q.id && q.id.startsWith('QAI_')));

    /* 越权：学生不能出题 */
    const student = makeClient(base);
    await student.post('/api/auth/register', { email: `stu_ai_${Date.now()}@test.local`, password: 'Student123', username: '学生' });
    const denied = await student.post('/api/ai/generate', { kid: 'k-dbms', count: 1 });
    check('★ 学生不能调出题接口（403）', denied.status === 403, `HTTP ${denied.status}`);
  }

  /* ============================================================
     8. 讲评：成功与降级两条路
     ============================================================ */
  {
    const anyQ = generatedQ;
    check('复用第 7 节生成的题（没拿到就说明前一步有问题）', !!anyQ && !!anyQ.id);

    mock.clearLog();
    mock.setMode('ok');
    const good = await teacher.post('/api/ai/explain', { qid: anyQ.id, answer: 'Z' });
    eq('讲评接口返回 200', good.status, 200);
    eq('★ 讲评成功时 ok:true', good.body.ok, true);
    check('讲评正文非空', String(good.body.text).length > 8, good.body.text);
    check('★ 讲评请求里带上了他写的答案和标准答案',
      JSON.stringify(mock.log.at(-1).body.messages).includes('Z') && JSON.stringify(mock.log.at(-1).body.messages).includes(String(good.body.standard)));

    mock.setMode('billing');
    const bad = await teacher.post('/api/ai/explain', { qid: anyQ.id, answer: 'Z' });
    mock.setMode('ok');
    eq('★ 讲评失败仍然返回 200（走降级，不弹错误）', bad.status, 200);
    eq('★ 失败时 ok:false', bad.body.ok, false);
    check('★ 降级文案里把标准答案摊给了用户', String(bad.body.text).includes(String(bad.body.standard)), bad.body.text);
    check('降级文案里说明了原因', String(bad.body.text).includes('讲评没能生成'));
  }

  /* ============================================================
     9. ★ 权限：别人的课碰不到
     ============================================================ */
  {
    const other = makeClient(base);
    await other.post('/api/auth/register', { email: `other_ai_${Date.now()}@test.local`, password: 'Other12345', username: '别人' });

    mock.setRoute(null);
    mock.setScript([]);
    // 开一节不答的课（挂着）
    const p = runClass(teacher, { kid: 'k-dbms', mode: 'solo' }, []);
    await new Promise((r) => setTimeout(r, 1500));

    const list = await teacher.get('/api/ai/profile');
    eq('学习档案接口可用', list.status, 200);
    check('档案里带上了真实作答概况', !!list.body.overview, JSON.stringify(list.body.overview));

    const bogus = await other.get('/api/ai/classroom/does_not_exist');
    eq('★ 不存在的课返回 404', bogus.status, 404);
    await p;
  }

  /* ============================================================
     10. 学习档案：注入的是真数字，不是空话
     ============================================================ */
  {
    const p = await teacher.get('/api/ai/profile');
    const prompt = String(p.body.prompt || '');
    check('★ 档案里说明了「这是真实作答记录」', /真实作答记录/.test(prompt), prompt.slice(0, 100));
    check('★ 档案里带了总正确率（有数字）', /正确率\s*\d+%/.test(prompt), prompt.slice(0, 200));
    check('★ 档案里带了具体的考点名（不是「基础薄弱」这种空话）', /[-·]/.test(prompt) || /掌握度/.test(prompt), prompt.slice(0, 300));
  }
} finally {
  await srv.stop();
  await mock.close();
}

report('AI · 端到端（集群 + 工具 + 出题 + 讲评）');
