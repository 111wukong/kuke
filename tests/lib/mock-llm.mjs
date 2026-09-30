/* 假的 OpenAI 兼容上游
 *
 * ── 为什么不用真模型 ────────────────────────────────────────────
 * 真模型不可复现：分片怎么切、什么时候调工具、JSON 会不会畸形，
 * 每次都不同。mock 能把这些都钉死，于是「分片拼接」「降级链」「清洗」
 * 这些路径才测得准。而且**不烧用户的钱**。
 *
 * ── ★ 最要紧的一条断言不是「函数返回了 ok」 ─────────────────────
 * 而是「服务端真的收到了凭据」。所以 mock 会把每个请求的
 * Authorization 头记下来，测试直接断言它。
 * 只断言返回值的话，即使凭据没发出去、只要 mock 不校验，测试照样绿。
 *
 * ── 必须同时实现 stream:true 和 stream:false ────────────────────
 * 展示型文本走流式、结构化生成（出题）走非流式。
 * 漏掉任何一条，端到端时都会炸。
 */

import http from 'node:http';

/* ============================================================
   脚本条目：统一用 delta 数组描述，两种传输方式共用
   ============================================================ */
export function textDeltas(text, size = 6) {
  const out = [];
  const s = String(text);
  for (let i = 0; i < s.length; i += size) out.push({ content: s.slice(i, i + size) });
  if (!out.length) out.push({ content: '' });
  return { deltas: out };
}

/**
 * 分片 tool_calls —— 专门用来验「按 index 聚合、且是拼接不是覆盖」。
 * 每个参数 JSON 会被切成 N 段，拼错一个字符就会 JSON.parse 失败。
 */
export function toolDeltas(calls, finalText = '', shards = 3) {
  const deltas = [];
  calls.forEach((c, i) => {
    deltas.push({ tool_calls: [{ index: i, id: c.id || `call_${i}`, type: 'function', function: { name: c.name, arguments: '' } }] });
    const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args || {});
    const step = Math.max(1, Math.ceil(args.length / shards));
    for (let p = 0; p < args.length; p += step) {
      deltas.push({ tool_calls: [{ index: i, function: { arguments: args.slice(p, p + step) } }] });
    }
  });
  if (finalText) deltas.push(...textDeltas(finalText).deltas);
  return { deltas };
}

function aggregate(deltas) {
  let content = '';
  const calls = [];
  for (const d of deltas) {
    if (d.content) content += d.content;
    if (d.tool_calls) {
      for (const p of d.tool_calls) {
        const i = p.index != null ? p.index : calls.length;
        if (!calls[i]) calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (p.id) calls[i].id = p.id;
        if (p.function) {
          if (p.function.name) calls[i].function.name = p.function.name;
          if (p.function.arguments) calls[i].function.arguments += p.function.arguments;
        }
      }
    }
  }
  return { content, tool_calls: calls.filter(Boolean) };
}

/* ============================================================
   一份「真模型会吐出来的东西」的样本
   ============================================================
   ★ 顺序是刻意打乱的：**坏题放在前面**。
     如果好题都在前、坏题都在后，缓冲配额永远用不上 —— 凑够 3 道就 break 了。
     真模型也是随机穿插的，所以样本必须复现这一点。 */
export const GOOD_QUESTIONS = {
  questions: [
    // ① 坏：简答题，库课不自动判分
    { type: 'short', stem: '请论述索引的优缺点，并举例说明。', answer: '略' },
    // ② 好：单选
    {
      type: 'choice',
      stem: '在 SQL 中，WHERE 和 HAVING 的区别是什么？',
      options: [
        { key: 'A', text: 'WHERE 在分组前过滤行，HAVING 在分组后过滤组' },
        { key: 'B', text: 'WHERE 在分组后过滤组，HAVING 在分组前过滤行' },
        { key: 'C', text: '两者完全等价，可以互换' },
        { key: 'D', text: 'WHERE 只能用于子查询' },
      ],
      answer: 'A',
      difficulty: 2,
      analysis: '执行顺序是 FROM → WHERE → GROUP BY → HAVING → SELECT。WHERE 作用于行，HAVING 作用于组。',
    },
    // ③ 坏：填空答案含字母（库课判不了）
    { type: 'blank', stem: 'B+ 树中一个非叶节点有 m 个关键字，最多能有多少个孩子结点？', answer: 'm+1', difficulty: 3, analysis: 'm 个关键字把区间分成 m+1 段。' },
    // ④ 好：填空（纯数值，可判）
    { type: 'blank', stem: 'B+ 树中一个非叶节点有 3 个关键字，最多能有多少个孩子结点？', answer: '4', difficulty: 3, analysis: '3 个关键字把区间分成 4 段。' },
    // ⑤ 好：判断
    { type: 'judge', stem: '在 SQL 中，NULL = NULL 的结果是 TRUE。', answer: 'F', difficulty: 2, analysis: 'NULL 参与任何比较的结果都是 UNKNOWN。' },
    // ⑥ 好：多选
    { type: 'multi', stem: '以下哪些操作可能导致索引失效？', options: [{ key: 'A', text: '在索引列上使用函数' }, { key: 'B', text: '用 LIKE 以 % 开头' }, { key: 'C', text: '使用等值查询' }, { key: 'D', text: '隐式类型转换' }], answer: 'ABD', difficulty: 3, analysis: '等值查询恰恰是最能用上索引的。' },
    // ⑦ 坏：只有三个选项（放在后面 —— 缓冲够用时它根本轮不到）
    { type: 'choice', stem: '只有三个选项的题，应该被丢掉。', options: [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }, { key: 'C', text: 'z' }], answer: 'A' },
  ],
};

/* ============================================================
   默认路由：不写脚本时按请求内容决定回什么
   ============================================================ */
export function defaultRoute(body) {
  const msgs = body.messages || [];
  const sys = String((msgs.find((m) => m.role === 'system') || {}).content || '');
  const tools = body.tools || [];
  const hasToolResult = msgs.some((m) => m.role === 'tool' || (m.role === 'user' && /【工具结果/.test(String(m.content || ''))));

  if (/课堂调度器/.test(sys)) return textDeltas('{"next":"END"}');
  if (/数据库课程的出题老师/.test(sys)) return textDeltas(JSON.stringify(GOOD_QUESTIONS));
  if (/讲评老师/.test(sys)) return textDeltas('你大概是漏了执行顺序那一步。先想清楚 WHERE 和 GROUP BY 谁在前，再重新走一遍。这一步现在清楚了吗？');

  /* ★ 学生必须排在老师**之前**判：学生的 system 里也含「陈老师」三个字。
   *   顺序反了的话三个学生会全部走进老师分支，拿到同一段老师台词，
   *   于是「角色趋同」这个要测的问题反而被测成了假的通过。 */
  if (/是陈老师课上的一名学生/.test(sys)) {
    const who = ['林一鸣', '周雨桐', '马小虎'].find((n) => sys.includes(n)) || '某同学';
    if (tools.length && !hasToolResult) {
      return toolDeltas([{ name: 'run_sql', args: { sql: 'SELECT COUNT(*) FROM student', dataset: 'school' } }], '', 3);
    }
    return textDeltas(`${who}：我觉得应该是分组前过滤吧，不过我不太确定。`);
  }

  if (/陈老师/.test(sys)) {
    if (/答疑重讲/.test(sys)) {
      /* ★ 故意违规：在答疑轮出一道要动手的题。
       *   不违规的话，「被换成了理解确认」这条提示永远不会出现 ——
       *   而那正是硬过滤存在的意义。测试夹具要主动制造违规。 */
      return textDeltas('(telling)\n\n好，那你写一条查询看看：SELECT * FROM student WHERE sage > 20 会返回几行？');
    }
    if (/当前阶段：练习/.test(sys) && !hasToolResult) {
      return toolDeltas([{ name: 'pose_question', args: { question: '写出一个查询：找出选修了「数据库」这门课的学生的姓名。', hint: '需要三张表连起来。', kid: 'k-join' } }], '', 2);
    }
    if (tools.length && !hasToolResult) {
      /* 老师一次调两个工具：真的跑一条 SQL + 写步骤。 */
      return toolDeltas([
        { name: 'run_sql', args: { sql: 'SELECT sname, sage FROM student ORDER BY sage DESC LIMIT 3', dataset: 'school' } },
        { name: 'write_steps', args: { title: 'WHERE 与 HAVING', steps: ['FROM：先确定数据源', 'WHERE：在分组前过滤行', 'GROUP BY：分组', 'HAVING：在分组后过滤组'] } },
      ], '', 3);
    }
    return textDeltas('(focus)\n\n我先不往下讲。你想想，如果 SQL 里没有 WHERE，会出什么问题？');
  }
  return textDeltas('（mock 默认回复）');
}

/* ============================================================
   mock 上游
   ============================================================ */
export async function startMockLLM(opts = {}) {
  const log = [];
  let queue = [];
  let mode = 'ok';
  let route = opts.route || null;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch { /* 保留 {} */ }

    log.push({
      path: req.url,
      auth: req.headers['authorization'] || null,
      contentType: req.headers['content-type'] || null,
      body,
    });

    const sendJson = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    if (mode === 'auth') return sendJson(401, { error: { message: 'Authentication Fails, Your api key is invalid' } });
    if (mode === 'billing') return sendJson(402, { error: { message: 'Insufficient Balance' } });
    if (mode === 'ratelimit') return sendJson(429, { error: { message: 'Rate limit reached' } });
    /* ★ 只拒绝**带 tools 的**请求 —— 这才像真网关：
     *   不支持工具的网关，不带 tools 时是能正常对话的。
     *   不加这个条件的话，降级之后的重试也会被拒，测不出「降级链」本身。 */
    if (mode === 'notools' && Array.isArray(body.tools) && body.tools.length) {
      return sendJson(400, { error: { message: 'Invalid parameter: tools is not supported by this model' } });
    }

    /* ★ route 可能是异步的（要模拟「每个角色都慢 400ms」那种场景）。
     *   不 await 的话，拿到的是个 Promise，`entry.deltas` 是 undefined，
     *   于是聚合出空正文 —— 表现是「所有角色都一言不发」，
     *   而报错指向的地方离真正的原因很远。 */
    let entry = queue.shift();
    if (!entry && route) entry = await route(body);
    if (!entry) entry = defaultRoute(body);
    const { content, tool_calls } = aggregate(entry.deltas || []);

    if (body.stream === false) {
      return sendJson(200, {
        id: 'mock', object: 'chat.completion', model: body.model || 'mock',
        choices: [{
          index: 0,
          message: { role: 'assistant', content, ...(tool_calls.length ? { tool_calls } : {}) },
          finish_reason: tool_calls.length ? 'tool_calls' : 'stop',
        }],
      });
    }

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    for (const d of entry.deltas || []) {
      res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, finish_reason: null }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool_calls.length ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    log,
    push: (entry) => { queue.push(entry); },
    setScript: (list) => { queue = list.slice(); },
    clearLog: () => { log.length = 0; },
    setMode: (m) => { mode = m; },
    setRoute: (r) => { route = r; },
    get pending() { return queue.length; },
    close: () => new Promise((r) => server.close(r)),
  };
}
