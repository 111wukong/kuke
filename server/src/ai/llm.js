/* AI · 模型通道
 *
 * 和上游说话只在这一个文件里。上层（agent / classroom）看到的是统一的
 * `chat()` 和一组回调，不关心 SSE 长什么样。
 *
 * ── 为什么这一段在**服务端**而不是浏览器 ────────────────────────
 * 问学（那个独立项目）把 agent loop 放在浏览器里，因为它没有后端，
 * 所有数据都在 localStorage。库课不一样：考点、题库、作答记录、
 * 判分器全在 SQLite 里 —— 让浏览器去查库既查不到也不安全。
 * 所以这里把 loop 放在服务端，前端只收事件流。
 * 顺带一个好处：密钥连「转发」这一步都不需要，本进程直接用。
 *
 * ── 三个必须处理好的地方 ────────────────────────────────────────
 *
 * 1. **流式 tool_calls 是按 index 分片的。** OpenAI 兼容协议里
 *    `tool_calls[].function.arguments` 会被切成好几段字符串下发，
 *    必须按 index 聚合、且是**拼接**不是覆盖。少这一步，
 *    工具参数会是一个半截 JSON，而报错是「JSON 解析失败」——
 *    指向的是解析那一行，离真正的原因（少了一次 +=）很远。
 *
 * 2. **三级降级链。** 不是所有 OpenAI 兼容网关都支持原生 `tools`。
 *    原生失败时要退到「文本工具协议」，再不行退到纯文本回答。
 *
 * 3. **错误要说清是哪一种。** 「连不上」「密钥不对」「余额不足」
 *    是三件不同的事，处理方式完全不同。压成一句「请求失败」，
 *    用户只能靠猜。
 */

import { fromEnvFile } from '../lib/env.js';
import { aiConfig, getSetting } from '../lib/appSettings.js';

/* 配置**惰性读**：env.js 在 import 时就把 .env 装好了，
 * 但写成函数能避免「模块加载顺序」这种隐性依赖 ——
 * 谁先 import 都不影响结果。
 *
 * ★ 现在配置有两个来源：**界面设置（数据库）优先，环境变量兜底**。
 *   部署的人（IT）和使用的人（老师）往往不是同一个 ——
 *   让老师为了换个模型去改服务器环境变量再重启，是把运维成本
 *   转嫁给了教学的人。见 lib/appSettings.js。 */
function cfg() {
  const c = aiConfig();
  return { key: c.apiKey, base: c.baseUrl, model: c.model, timeout: c.timeout };
}

export function aiHealth() {
  const c = cfg();
  return {
    ok: true,
    hasKey: !!c.key,
    keyLooksValid: /^sk-[A-Za-z0-9_-]{16,}$/.test(c.key),
    /* ★ 只回**来源**，不回任何一位密钥字符。
     *   「用错了哪把」和「这把失效了」是两件事，处理方式完全不同；
     *   只回一个 hasKey 的话，这两种情况长得一模一样。
     *   现在来源有三档：界面设置 / .env / 环境变量。 */
    keySource: !c.key ? 'none'
      : (getSetting('ai.apiKey', '') ? 'settings'
        : (fromEnvFile('DEEPSEEK_API_KEY') ? 'env-file' : 'environment')),
    base: c.base,
    model: c.model,
  };
}

/** 把上游的 HTTP 错误翻成人能看懂的话。 */
export function describeError(status, body) {
  const detail = body && body.detail ? String(body.detail).slice(0, 300) : '';
  if (status === 401 || /authentication|invalid.*api.?key/i.test(detail)) {
    return { kind: 'auth', message: '上游拒绝了这次请求（401）', hint: `多半是 API Key 不对或已失效。上游原话：${detail}` };
  }
  if (status === 402 || /insufficient|balance|quota/i.test(detail)) {
    return { kind: 'billing', message: '上游账户余额或额度不足', hint: detail };
  }
  if (status === 429) return { kind: 'ratelimit', message: '请求太频繁', hint: '等几秒再试。' };
  if (status === 504) return { kind: 'timeout', message: '上游超时没响应', hint: '可以调大 DEEPSEEK_TIMEOUT，或缩短上下文。' };
  return { kind: 'upstream', message: `上游返回 ${status}`, hint: detail };
}

/* ============================================================
   流式解析
   ============================================================ */

/**
 * 把上游的 SSE 流解析成回调。
 * @returns {Promise<{content, toolCalls, finishReason}>}
 */
export async function parseStream(res, hooks = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  let content = '';
  const toolCalls = [];
  let finishReason = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    /* SSE 以空行分隔事件。按 \n\n 切，最后一段可能不完整，留在 buf 里。
     * 不能按单个 \n 切 —— 一个事件里可能有多行（data: / event:）。 */
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let json;
        try { json = JSON.parse(data); } catch { continue; }

        const choice = json.choices && json.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta || {};

        if (delta.content) {
          content += delta.content;
          if (hooks.onDelta) hooks.onDelta(delta.content);
        }

        /* ★ tool_calls 的分片聚合 —— 这个文件里最要紧的一段。
         *   同一个 index 会出现多次，每次带一小段 arguments，必须 += 。 */
        if (delta.tool_calls) {
          for (const part of delta.tool_calls) {
            const i = part.index != null ? part.index : toolCalls.length;
            if (!toolCalls[i]) toolCalls[i] = { id: '', name: '', rawArgs: '' };
            if (part.id) toolCalls[i].id = part.id;
            if (part.function) {
              if (part.function.name) toolCalls[i].name = part.function.name;
              if (part.function.arguments) toolCalls[i].rawArgs += part.function.arguments;
            }
          }
        }
      }
    }
  }

  return { content, toolCalls: toolCalls.filter(Boolean), finishReason };
}

/* ============================================================
   文本工具协议（降级用）
   ============================================================ */
export function parseTextToolCalls(content) {
  const calls = [];
  const re = /```tool\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (obj && obj.name) calls.push({ id: `text_${calls.length}`, name: obj.name, rawArgs: JSON.stringify(obj.args || {}) });
    } catch { /* 这一块不是合法 JSON，跳过 */ }
  }
  return calls;
}

export const TOOL_PROTOCOL_HINT = `

【工具调用协议】
你可以调用下列工具来获取资料或操作黑板。需要调用时，输出一个围栏代码块：

\`\`\`tool
{"name": "工具名", "args": {"参数": "值"}}
\`\`\`

一次可以输出多个代码块（会按顺序执行）。不需要工具时直接回答，不要输出这个代码块。
`;

/* ============================================================
   对外接口
   ============================================================ */

/**
 * 和模型对话一轮。
 *
 * @param {object} opts
 *   messages / tools / stream / temperature / maxTokens / hooks / signal
 * @returns {Promise<{content, toolCalls, finishReason, degraded}>}
 *   degraded: '' | 'text-protocol' —— 走的是哪条降级路径
 */
export async function chat(opts) {
  const { messages, tools = [], hooks = {}, temperature, maxTokens, stream = true, signal, override } = opts;
  /* override 是给「测试连接」用的：用户刚在界面上填了一套配置但还没保存，
   * 要拿这套**未保存的值**去发一次真实请求验证。
   * 不然就只能「先保存再测试」—— 而那意味着一次填错会把线上正在用的
   * 配置也改坏，测试本身成了风险源。 */
  const c = override ? { ...cfg(), ...override } : cfg();

  if (!c.key) {
    const err = new Error('服务端没有配置 DeepSeek API Key');
    Object.assign(err, {
      kind: 'nokey',
      hint: '在项目根目录执行 cp .env.example .env，把 DEEPSEEK_API_KEY 填进去，然后重启服务。',
    });
    throw err;
  }

  const body = { model: c.model, messages, stream: !!stream };
  if (tools.length) body.tools = tools;
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), c.timeout);
  /* 调用方的 signal（比如客户端断开）也要能中止上游 ——
   * 不然用户关掉页面之后上游还在生成、还在计费。 */
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', () => ctl.abort(), { once: true });
  }

  let res;
  try {
    res = await fetch(`${c.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const timeout = e.name === 'AbortError';
    const err = new Error(timeout ? `上游 ${c.timeout}ms 没响应` : `连不上上游：${e.message}`);
    Object.assign(err, { kind: timeout ? 'timeout' : 'network' });
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    /* 上游报错时**读出它的正文**。DeepSeek 的错误正文里通常写清了
     * 是余额不足、模型名错、还是参数不对 —— 排查时最有价值的一条信息。 */
    const text = await res.text().catch(() => '');
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { detail: text }; }
    const info = describeError(res.status, { ...payload, detail: payload.detail || text });
    const err = new Error(info.message);
    Object.assign(err, info);
    throw err;
  }

  try {
    /* ---- 非流式分支 ---- */
    if (!stream) {
      const json = await res.json();
      const choice = (json.choices && json.choices[0]) || {};
      const msg = choice.message || {};
      const content = String(msg.content || '');
      if (content && hooks.onDelta) hooks.onDelta(content);
      const toolCalls = (msg.tool_calls || []).map((x) => ({
        id: x.id || '',
        name: (x.function && x.function.name) || '',
        rawArgs: (x.function && x.function.arguments) || '{}',
      })).filter((x) => x.name);
      if (toolCalls.length) return { content, toolCalls, finishReason: choice.finish_reason || '', degraded: '' };
      const textCalls = parseTextToolCalls(content);
      if (textCalls.length) return { content, toolCalls: textCalls, finishReason: choice.finish_reason || '', degraded: 'text-protocol' };
      return { content, toolCalls: [], finishReason: choice.finish_reason || '', degraded: '' };
    }

    /* ---- 流式：第一层，原生 tools ---- */
    const out = await parseStream(res, hooks);
    if (out.toolCalls.length) return { ...out, degraded: '' };

    /* ---- 第二层：模型没用原生工具，但正文里可能有文本协议调用 ---- */
    const textCalls = parseTextToolCalls(out.content);
    if (textCalls.length) return { ...out, toolCalls: textCalls, degraded: 'text-protocol' };

    /* ---- 第三层：完全没用工具，就当普通回答 ---- */
    return { ...out, degraded: '' };
  } finally {
    clearTimeout(timer);
  }
}
