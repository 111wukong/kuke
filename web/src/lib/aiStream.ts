/* AI 课堂的事件流客户端
 *
 * ── 为什么用 SSE 而不是轮询 ────────────────────────────────────
 * 上课是长时任务：老师讲一段（流式逐字）→ 挂起等作答 → 继续。
 * 一次 POST 挂着一整节课的连接，前端只需要一个事件处理器。
 * 轮询做不到「逐字」，而 WebSocket 要服务端多一层握手和心跳管理 ——
 * 这里只需要服务端单向推，SSE 正好。
 *
 * ── 为什么挂起期间连接不关 ─────────────────────────────────────
 * 服务端的 agent loop 停在 `await askUser(...)` 上，那个 Promise
 * 由 `/answer` 或 `/skip` 来 resolve。连接一直开着，答案一到，
 * 流就继续往下发。前端不需要重连、不需要重新建状态。
 */

export type AiEvent =
  | { type: 'start'; session: any }
  | { type: 'round'; round: number; phase: string; meta: any }
  | { type: 'speaking'; role: string; again?: boolean }
  | { type: 'delta'; role: string; text: string; move: string; raw: string }
  | { type: 'patch'; role: string; text: string; move: string; round: number }
  | { type: 'turn'; turn: { role: string; name: string; text: string; round: number }; animate?: boolean }
  | { type: 'tool'; role: string; phase: 'call' | 'done'; name: string; ok?: boolean; error?: string }
  | { type: 'board'; item: any }
  | { type: 'note'; text: string; level?: string }
  | { type: 'ask'; spec: { prompt: string; placeholder: string; phase: string; hint?: string } }
  | { type: 'user'; text: string; replyTo?: number }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string; kind?: string }
  | { type: 'done'; session: any };

/**
 * 开一节课。返回的 Promise 在**流结束时**才 resolve。
 * @param onEvent 每收到一个事件回调一次
 * @param signal  中止（组件卸载时用）
 */
export async function startClass(
  body: { kid: string; mode: string },
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ai/classroom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `开课失败（HTTP ${res.status}）`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* 不是 JSON 就算了 */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    /* SSE 以空行分隔事件。按 \n\n 切，最后一段可能不完整，留在 buf 里。 */
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;      // ': ping' 心跳直接跳过
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try { onEvent(JSON.parse(raw) as AiEvent); } catch { /* 坏事件跳过 */ }
      }
    }
  }
}

/** 交答案。返回 false 表示没接上（那一轮已经过去了 / 服务重启过）。 */
export async function answerClass(id: string, text: string): Promise<boolean> {
  const r = await fetch(`/api/ai/classroom/${id}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ text }),
  });
  if (!r.ok) return false;
  return !!(await r.json()).ok;
}

export async function skipClass(id: string): Promise<boolean> {
  const r = await fetch(`/api/ai/classroom/${id}/skip`, { method: 'POST', credentials: 'same-origin' });
  if (!r.ok) return false;
  return !!(await r.json()).ok;
}

/** 插话。返回 false 表示现在不能插（正在等你作答 / 课已经结束）。 */
export async function interjectClass(id: string, text: string): Promise<boolean> {
  const r = await fetch(`/api/ai/classroom/${id}/interject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ text }),
  });
  if (!r.ok) return false;
  return !!(await r.json()).ok;
}
