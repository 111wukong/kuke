/* AI 接口 /api/ai/*
 *
 * ── 为什么 agent loop 在服务端 ──────────────────────────────────
 * 那个独立的问学项目把 loop 放在浏览器里，因为它没有后端，
 * 所有数据都在 localStorage。库课不一样：考点、题库、作答记录、
 * 判分器全在 SQLite 里 —— 让浏览器去查库既查不到也不安全。
 * 所以这里把 loop 放在服务端，前端只收事件流。
 *
 * ── 一个 SSE 连接撑一整节课 ─────────────────────────────────────
 * 上课是长时任务：老师讲一段 → 挂起等作答 → 继续。
 * 挂起期间连接**不关**，前端把答案 POST 到 /answer，服务端
 * resolve 那个 Promise，流继续往下走。
 * 这比「每轮重新建连接」简单得多，而且前端只需要一个事件处理器。
 */

import { aiHealth } from '../ai/llm.js';
import { generateQuestions, explainAnswer, AGENTS, STUDENT_KEYS, PHASE_META } from '../ai/agent.js';
import { MODES, newSession, run, publicSession, canInterject, interjectPlaceholder, submitAnswer, skipAnswer, interject, estimateCalls, isLive } from '../ai/classroom.js';
import { describeTools, TEACHER_TOOLS, STUDENT_TOOLS, MATERIAL_DEPTH } from '../ai/tools.js';
import { profileCard, learningProfile } from '../ai/profile.js';
import { db } from '../db/index.js';

/* ============================================================
   会话表（内存）
   ============================================================
   上课是**有状态**的：挂起等作答的那个 Promise 就在这个对象上。
   不落库的原因：Promise 序列化会丢 resolve，读回来是个死框。
   代价是服务重启会丢掉进行中的课 —— 对「一节课十几分钟」这个量级
   可以接受，而且重开一节比恢复一个半截状态更干净。
   ============================================================ */
const SESSIONS = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function gcSessions() {
  const now = Date.now();
  for (const [id, s] of SESSIONS) {
    if (s.done && now - (s._endedAt || s._startedAt || now) > SESSION_TTL) SESSIONS.delete(id);
  }
}
setInterval(gcSessions, 5 * 60 * 1000).unref?.();

export default async function aiRoutes(fastify) {
  /* ============ 密钥状态 ============ */
  fastify.get('/api/ai/health', { preHandler: fastify.requireAuth }, async () => aiHealth());

  /* ============ 工具清单（前端展示「谁手里有什么」） ============ */
  fastify.get('/api/ai/tools', { preHandler: fastify.requireAuth }, async () => ({
    teacher: describeTools('teacher'),
    student: describeTools('a'),
    counts: { teacher: TEACHER_TOOLS.length, student: STUDENT_TOOLS.length },
    depth: MATERIAL_DEPTH,
  }));

  /* ============ 学习档案卡片（侧栏） ============ */
  fastify.get('/api/ai/profile', { preHandler: fastify.requireAuth }, async (req) => {
    const card = profileCard(req.user.id);
    return { ...card, prompt: learningProfile(req.user.id) };
  });

  /* ============ 模式列表 ============ */
  fastify.get('/api/ai/modes', { preHandler: fastify.requireAuth }, async () => ({
    modes: Object.entries(MODES).map(([id, m]) => ({ id, ...m, estimate: estimateCalls(id) })),
  }));

  /* ============================================================
     开一节课（SSE）
     ============================================================
     请求体 { kid, mode }
     事件流：round / speaking / delta / patch / turn / tool / board /
             note / ask / user / error / done
     ============================================================ */
  fastify.post('/api/ai/classroom', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['kid'],
        properties: {
          kid: { type: 'string', maxLength: 200 },
          mode: { type: 'string', maxLength: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const { kid, mode = 'class' } = req.body;
    const title = db.prepare('SELECT title FROM knowledge WHERE id = ?').get(kid)?.title || kid;
    const session = newSession(kid, mode, { userId: req.user.id, kidTitle: title });
    session._startedAt = Date.now();
    SESSIONS.set(session.id, session);

    /* ★ 接管响应。Fastify 不再往里写任何东西，我们直接操作 raw socket。 */
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',   // 告诉反代别缓冲，否则流式会变成一次性
    });

    const send = (obj) => {
      if (raw.writableEnded) return;
      try { raw.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* 连接断了 */ }
    };

    /* ★ 客户端断开时中止上游。
     *   不中止的话，用户关掉页面之后上游还在生成、还在计费，
     *   而结果没有任何人接收。 */
    const ac = new AbortController();
    raw.on('close', () => ac.abort());

    /* 心跳：模型思考或跑 SQL 时可能十几秒没有事件，
     * 中间的反代会以为连接死了。 */
    const beat = setInterval(() => { if (!raw.writableEnded) raw.write(': ping\n\n'); }, 15000);

    send({ type: 'start', session: publicSession(session) });

    try {
      await run(session, {
        onEvent: send,
        onStatus: (s) => send({ type: 'status', text: s }),
      }, { signal: ac.signal });
    } catch (e) {
      send({ type: 'error', message: e.message, kind: e.kind || 'unknown' });
    } finally {
      clearInterval(beat);
      session._endedAt = Date.now();
      if (!raw.writableEnded) raw.end();
    }
  });

  /* ============ 交答案 / 跳过 / 插话 ============ */
  const findSession = (req, reply) => {
    const s = SESSIONS.get(req.params.id);
    if (!s) { reply.code(404).send({ error: '这节课不在了（服务重启过？重开一节吧）', code: 'NO_SESSION' }); return null; }
    /* ★ 资源级权限：只能操作自己的课。别人的课给 403 而不是 404 ——
     *   404 会让「课存在但没权限」和「课不存在」长得一样，排查时很费劲。 */
    if (s.userId !== req.user.id) { reply.code(403).send({ error: '这不是你的课', code: 'FORBIDDEN' }); return null; }
    return s;
  };

  fastify.post('/api/ai/classroom/:id/answer', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 4000 } } } },
  }, async (req, reply) => {
    const s = findSession(req, reply);
    if (!s) return reply;
    const ok = submitAnswer(s, req.body.text);
    /* 没接上不算错误 —— 可能是重复提交，也可能是那一轮已经过去了。 */
    return { ok, awaiting: !!s.awaiting };
  });

  fastify.post('/api/ai/classroom/:id/skip', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const s = findSession(req, reply);
    if (!s) return reply;
    return { ok: skipAnswer(s), awaiting: !!s.awaiting };
  });

  fastify.post('/api/ai/classroom/:id/interject', {
    preHandler: fastify.requireAuth,
    schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 2000 } } } },
  }, async (req, reply) => {
    const s = findSession(req, reply);
    if (!s) return reply;
    const ok = interject(s, req.body.text);
    return { ok, canInterject: canInterject(s), placeholder: interjectPlaceholder(s) };
  });

  fastify.get('/api/ai/classroom/:id', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const s = findSession(req, reply);
    if (!s) return reply;
    return { session: publicSession(s), live: isLive(s), moves: s.moves, phaseMeta: PHASE_META[s.phase] };
  });

  /* ============================================================
     AI 出题（写进题库）
     ============================================================ */
  fastify.post('/api/ai/generate', {
    preHandler: fastify.requireTeacher,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['kid'],
        properties: {
          kid: { type: 'string', maxLength: 200 },
          count: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  }, async (req) => {
    const res = await generateQuestions({
      kid: req.body.kid,
      count: req.body.count || 3,
      ownerId: req.user.id,
      insert: true,
    });
    /* ★ 返回里要带「丢了几道、为什么丢」。
     *   只返回一个空数组的话，用户不知道是模型不行、还是网络坏了、还是自己点错了。 */
    return {
      created: res.inserted || [],
      count: (res.inserted || []).length,
      skippedDuplicate: res.skippedDuplicate,
      skippedUnjudgeable: res.skippedUnjudgeable,
      parseFailed: res.parseFailed,
      note: res.note,
    };
  });

  /* ============================================================
     讲评（答错之后）
     ============================================================ */
  fastify.post('/api/ai/explain', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['qid', 'answer'],
        properties: {
          qid: { type: 'string', maxLength: 100 },
          answer: { type: 'string', maxLength: 4000 },
        },
      },
    },
  }, async (req, reply) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.body.qid);
    if (!q) return reply.code(404).send({ error: '题目不存在' });

    const { judgeQuestion } = await import('../lib/judge.js');
    const verdict = judgeQuestion(q, req.body.answer);
    const out = await explainAnswer({
      kid: q.kid,
      stem: q.stem,
      userAnswer: req.body.answer,
      standard: verdict.correctAnswer ?? q.answer,
      correct: !!verdict.pass,
    });
    /* ★ 讲评失败也回 200 + ok:false。
     *   回 5xx 会走全局错误提示，用户看到「出错了」——
     *   而实际上那条降级路径（自己对照标准答案）还在，功能是可用的。 */
    return { ok: out.ok, text: out.text, standard: verdict.correctAnswer ?? q.answer, pass: !!verdict.pass };
  });
}

/* 给测试用：清空会话表 */
export function _clearSessions() { SESSIONS.clear(); }
