/* 学习接口 /api/study/*
 *
 * 仪表盘快照、答题提交、错题本、复习队列（FSRS）、统计、根因诊断、笔记。
 */
import { db, bumpStats } from '../db/index.js';
import { judgeQuestion, guessErrorType } from '../lib/judge.js';
import { judgeNormalize, explain as explainNormalize, parseAttrGroup, parseSchemeList } from '../lib/normalize.js';
import { newCard, grade as fsrsGrade, currentRetrievability, ratingFromOutcome } from '../lib/fsrs.js';
import { diagnose } from '../lib/diagnose.js';
import { snapshot, dailyPlan, addXp, updateCombo, checkin, refreshAchievements, myAchievements, achievementStats } from '../lib/progress.js';
import { todayLocal } from '../lib/dates.js';
import { xpFor } from '../lib/game.js';
import { rl } from '../lib/rateLimit.js';

const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

const newId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export default async function studyRoutes(fastify) {
  /* ============ 仪表盘快照 ============ */
  fastify.get('/api/study/snapshot', { preHandler: fastify.requireAuth }, async (req) => {
    const settings = db.prepare('SELECT daily_goal FROM user_settings WHERE user_id = ?').get(req.user.id);
    return {
      snapshot: snapshot(req.user.id),
      plan: dailyPlan(req.user.id, settings?.daily_goal ?? 20),
    };
  });

  /* ============ 提交客观题 ============ */
  fastify.post('/api/study/answer', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(120, '1 minute') },
    schema: {
      body: {
        type: 'object',
        required: ['qid', 'answer'],
        properties: {
          qid: { type: 'string' },
          answer: { type: 'string', maxLength: 4000 },
          context: { type: 'string' },
          durationMs: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.body.qid);
    if (!q) return reply.code(404).send({ error: '题目不存在' });

    const verdict = judgeQuestion(q, req.body.answer);
    const now = Date.now();
    const today = todayLocal();
    const context = ['practice', 'review', 'assignment'].includes(req.body.context) ? req.body.context : 'practice';

    /* ★ 整条作答流程包在一个事务里。
     * 写 4 张表（attempts / stats_node / stats_daily / cards），
     * 不包事务的话会出现「题算对了但 XP 没加上」「统计涨了但明细没有」
     * 这种偏账，而且**不会报错** —— 只会让数字永远对不上。 */
    const result = db.transaction(() => {
      const errorType = guessErrorType(q, req.body.answer, verdict);

      db.prepare(`INSERT INTO attempts
        (id, user_id, kind, ref_id, kid, answer, correct, score, context, date, ts, duration_ms, error_type)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        newId('att'), req.user.id, 'question', q.id, q.kid,
        String(req.body.answer).slice(0, 4000),
        verdict.pass ? 1 : 0, verdict.score ?? (verdict.pass ? 100 : 0),
        context, today, now, req.body.durationMs || 0, errorType,
      );

      if (q.kid) bumpStats(req.user.id, q.kid, today, verdict.pass ? 1 : 0, now);

      // 连击
      const combo = updateCombo(req.user.id, verdict.pass);

      let xp = 0;
      if (verdict.pass) {
        xp = Math.round(xpFor({
          correct: true, kind: 'question', context, difficulty: q.difficulty,
        }) * combo.bonus);
        if (xp) addXp(req.user.id, xp);
      }

      /* 答错就自动建一张复习卡 —— 这是错题进入间隔重复的入口。
       * 为什么用 question 类型而不是 knowledge：复习时要看到原题，
       * 不然「复习」变成了「重读知识点」，那对做题能力没有帮助。 */
      let cardCreated = false;
      if (!verdict.pass) {
        const exists = db.prepare("SELECT id FROM cards WHERE user_id = ? AND question_id = ?").get(req.user.id, q.id);
        if (!exists) {
          const c = newCard(null, q.id, 'mistake');
          db.prepare(`INSERT INTO cards
            (id, user_id, type, knowledge_id, question_id, due, interval, state, reps, lapses, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
            c.id, req.user.id, 'mistake', null, q.id, today, 0, 'new', 0, 0, today,
          );
          cardCreated = true;
        }
      }

      return { errorType, combo: combo.combo, bonus: combo.bonus, xp, cardCreated };
    })();

    const unlocked = refreshAchievements(req.user.id);
    checkin(req.user.id, { tasksDone: 1 });

    return {
      pass: verdict.pass,
      score: verdict.score,
      message: verdict.message,
      needsManual: !!verdict.needsManual,
      // 答对之后才给答案与解析。答错时也给 —— 不给的话学生不知道错在哪，
      // 而这道题他已经答过了，再藏着没有意义。
      correctAnswer: verdict.correctAnswer,
      analysis: q.analysis,
      steps: parseJson(q.steps, []),
      errorType: result.errorType,
      combo: result.combo,
      comboBonus: result.bonus,
      xpGained: result.xp,
      cardCreated: result.cardCreated,
      unlocked,
    };
  });

  /* ============ 提交范式题 ============ */
  fastify.post('/api/study/normalize/:id', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(60, '1 minute') },
    schema: {
      body: {
        type: 'object',
        required: ['answer'],
        properties: { answer: { type: 'object' }, durationMs: { type: 'integer' } },
      },
    },
  }, async (req, reply) => {
    const t = db.prepare('SELECT * FROM normalize_tasks WHERE id = ?').get(req.params.id);
    if (!t) return reply.code(404).send({ error: '题目不存在' });

    const task = {
      attrs: parseJson(t.attrs, []),
      fds: parseJson(t.fds, []),
      ask: t.ask,
      target: t.target.includes(',') ? t.target.split(',') : t.target,
      answer: parseJson(t.answer, {}),
    };

    /* answer 的形状随 ask 变化：closure 是一组属性、keys 是若干组属性、
     * nf 是字符串、decompose 是若干组属性。
     * 统一走 parseAttrGroup —— 它会按**题目的属性集**来切分，
     * 所以学生写 'AB' 还是 'A,B' 还是 ['A','B'] 都能认。 */
    const raw = req.body.answer;
    let studentAnswer = raw.value;
    if (task.ask === 'closure') {
      studentAnswer = parseAttrGroup(studentAnswer, task.attrs);
    } else if (task.ask === 'keys' || task.ask === 'decompose') {
      studentAnswer = parseSchemeList(studentAnswer, task.attrs);
    }

    const verdict = judgeNormalize(task, studentAnswer);
    const now = Date.now();
    const today = todayLocal();

    const out = db.transaction(() => {
      db.prepare(`INSERT INTO attempts
        (id, user_id, kind, ref_id, kid, answer, correct, score, context, date, ts, duration_ms, error_type)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        newId('att'), req.user.id, 'normalize', t.id, t.kid || '',
        JSON.stringify(studentAnswer).slice(0, 4000),
        verdict.pass ? 1 : 0, verdict.score || 0, 'practice', today, now,
        req.body.durationMs || 0, verdict.pass ? '' : 'concept',
      );
      if (t.kid) bumpStats(req.user.id, t.kid, today, verdict.pass ? 1 : 0, now);

      const combo = updateCombo(req.user.id, verdict.pass);
      let xp = 0;
      if (verdict.pass) {
        const prev = db.prepare(`SELECT MAX(correct) ok FROM attempts
          WHERE user_id = ? AND kind = 'normalize' AND ref_id = ? AND ts < ?`)
          .get(req.user.id, t.id, now).ok;
        if (prev !== 1) {
          xp = Math.round(xpFor({ correct: true, kind: 'normalize', difficulty: t.difficulty }) * combo.bonus);
          addXp(req.user.id, xp);
        }
      }
      return { combo: combo.combo, xp };
    })();

    const unlocked = refreshAchievements(req.user.id);
    checkin(req.user.id, { tasksDone: 1 });

    return {
      ...verdict,
      combo: out.combo,
      xpGained: out.xp,
      unlocked,
    };
  });

  /* ============ 范式题的完整推导（点了"看解析"才给）============ */
  fastify.get('/api/study/normalize/:id/explain', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const t = db.prepare('SELECT * FROM normalize_tasks WHERE id = ?').get(req.params.id);
    if (!t) return reply.code(404).send({ error: '题目不存在' });
    const tries = db.prepare(`SELECT COUNT(*) n FROM attempts
      WHERE user_id = ? AND kind = 'normalize' AND ref_id = ?`).get(req.user.id, t.id).n;
    if (tries === 0) {
      return reply.code(403).send({ error: '先自己推一次，再看推导过程', code: 'TRY_FIRST' });
    }
    return { derivation: explainNormalize(parseJson(t.attrs, []), parseJson(t.fds, [])) };
  });

  /* ============ 错题本 ============ */
  fastify.get('/api/study/mistakes', {
    preHandler: fastify.requireAuth,
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } } },
  }, async (req) => {
    /* 错题口径：这个 ref_id 曾经答错、且**至今没有答对过**。
     * 用 MIN(correct)=0 而不是"最后一次是错的"：
     * 一道题错了三次、第四次对了，它不该还挂在错题本里。
     * 反过来，第一次对了、后来错了 —— 也要算错题（说明忘了）。
     * 所以正确口径是 MAX(correct)=0。 */
    const rows = db.prepare(`
      SELECT ref_id, kind, kid, COUNT(*) tries, MAX(ts) last_ts, MAX(error_type) error_type
      FROM attempts
      WHERE user_id = ? AND kind IN ('question','level','normalize','lab')
      GROUP BY ref_id
      HAVING MAX(correct) = 0
      ORDER BY last_ts DESC
      LIMIT ?
    `).all(req.user.id, req.query.limit ?? 100);

    const enrich = rows.map((r) => {
      let title = r.ref_id;
      let type = r.kind;
      if (r.kind === 'question') {
        const q = db.prepare('SELECT stem, type FROM questions WHERE id = ?').get(r.ref_id);
        title = q?.stem?.slice(0, 80) || r.ref_id;
        type = q?.type || 'question';
      } else if (r.kind === 'level') {
        title = db.prepare('SELECT title FROM sql_levels WHERE id = ?').get(r.ref_id)?.title || r.ref_id;
        type = 'sql';
      } else if (r.kind === 'normalize') {
        title = db.prepare('SELECT title FROM normalize_tasks WHERE id = ?').get(r.ref_id)?.title || r.ref_id;
        type = 'normalize';
      } else if (r.kind === 'lab') {
        title = db.prepare('SELECT title FROM labs WHERE id = ?').get(r.ref_id)?.title || r.ref_id;
        type = 'lab';
      }
      const kidTitle = r.kid ? db.prepare('SELECT title FROM knowledge WHERE id = ?').get(r.kid)?.title : '';
      return { refId: r.ref_id, kind: r.kind, type, title, kid: r.kid, kidTitle, tries: r.tries, lastTs: r.last_ts, errorType: r.error_type };
    });

    // 错因分布：教师端和学生端都用得上
    const byError = db.prepare(`
      SELECT error_type, COUNT(*) n FROM (
        SELECT ref_id, MAX(error_type) error_type FROM attempts
        WHERE user_id = ? AND correct = 0 GROUP BY ref_id
      ) GROUP BY error_type ORDER BY n DESC`).all(req.user.id);

    return { mistakes: enrich, total: enrich.length, byError };
  });

  /* ============ 复习队列（FSRS）============ */
  fastify.get('/api/study/review', { preHandler: fastify.requireAuth }, async (req) => {
    const today = todayLocal();
    const rows = db.prepare(`
      SELECT c.*, k.title AS knowledge_title, q.stem AS question_stem, q.type AS question_type, q.options AS question_options
      FROM cards c
      LEFT JOIN knowledge k ON k.id = c.knowledge_id
      LEFT JOIN questions q ON q.id = c.question_id
      WHERE c.user_id = ? AND c.due <= ?
      ORDER BY c.due ASC
      LIMIT 60
    `).all(req.user.id, today);

    const items = rows.map((c) => ({
      cardId: c.id,
      type: c.type,
      state: c.state,
      reps: c.reps,
      lapses: c.lapses,
      interval: c.interval,
      due: c.due,
      // 快忘掉的排前面 —— 比单纯按 due 排更贴近实际需要
      retrievability: currentRetrievability(c),
      knowledge: c.knowledge_id ? { id: c.knowledge_id, title: c.knowledge_title } : null,
      question: c.question_id
        ? { id: c.question_id, stem: c.question_stem, type: c.question_type, options: parseJson(c.question_options, null) }
        : null,
    }));

    const total = db.prepare('SELECT COUNT(*) n FROM cards WHERE user_id = ?').get(req.user.id).n;
    const upcoming = db.prepare(`
      SELECT due, COUNT(*) n FROM cards WHERE user_id = ? AND due > ?
      GROUP BY due ORDER BY due LIMIT 14`).all(req.user.id, today);

    return { items, total, upcoming };
  });

  /* ============ 复习一张卡 ============ */
  fastify.post('/api/study/review/:cardId', {
    preHandler: fastify.requireAuth,
    schema: {
      body: {
        type: 'object',
        properties: {
          rating: { type: 'integer', minimum: 1, maximum: 4 },
          correct: { type: 'boolean' },
          durationMs: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.cardId, req.user.id);
    if (!card) return reply.code(404).send({ error: '卡片不存在' });

    /* 评分来源：显式传 rating，或者由「答对/答错 + 用时」推出来。
     * 两种都支持，因为不同界面给的信息不一样 ——
     * 知识点卡片只能自评（"记得/忘了"），错题卡片能拿到对错和用时。 */
    const rating = req.body.rating
      || ratingFromOutcome(req.body.correct !== false, req.body.durationMs || 0);

    const next = fsrsGrade({
      state: card.state,
      stability: card.stability,
      difficulty: card.difficulty,
      interval: card.interval,
      reps: card.reps,
      lapses: card.lapses,
      lastReview: card.last_review,
    }, rating);

    db.prepare(`UPDATE cards SET due=?, interval=?, state=?, stability=?, difficulty=?,
      reps=?, lapses=?, last_review=? WHERE id=?`).run(
      next.due, next.interval, next.state, next.stability, next.difficulty,
      next.reps, next.lapses, next.lastReview, card.id,
    );

    const today = todayLocal();
    const correct = rating >= 3;
    db.prepare(`INSERT INTO attempts
      (id, user_id, kind, ref_id, kid, answer, correct, score, context, date, ts, duration_ms, error_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      newId('att'), req.user.id, 'question',
      card.question_id || card.knowledge_id || card.id, '',
      String(rating), correct ? 1 : 0, correct ? 100 : 0, 'review',
      today, Date.now(), req.body.durationMs || 0, correct ? '' : 'forget',
    );

    let xp = 0;
    if (correct) {
      xp = xpFor({ correct: true, kind: 'question', context: 'review' });
      addXp(req.user.id, xp);
    }
    const combo = updateCombo(req.user.id, correct);
    checkin(req.user.id, { tasksDone: 1 });

    return {
      ok: true,
      next: {
        due: next.due,
        interval: next.interval,
        state: next.state,
        stability: Number(next.stability?.toFixed?.(2) ?? next.stability),
        difficulty: Number(next.difficulty?.toFixed?.(2) ?? next.difficulty),
      },
      xpGained: xp,
      combo: combo.combo,
    };
  });

  /* ============ 手动加一张复习卡 ============ */
  fastify.post('/api/study/cards', {
    preHandler: fastify.requireAuth,
    schema: {
      body: {
        type: 'object',
        properties: { knowledgeId: { type: 'string' }, questionId: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { knowledgeId, questionId } = req.body || {};
    if (!knowledgeId && !questionId) return reply.code(400).send({ error: '要指定知识点或题目' });

    const dup = db.prepare(`SELECT id FROM cards WHERE user_id = ?
      AND (knowledge_id = ? OR question_id = ?)`).get(req.user.id, knowledgeId || '', questionId || '');
    if (dup) return { ok: true, already: true };

    const c = newCard(knowledgeId || null, questionId || null, questionId ? 'mistake' : 'knowledge');
    db.prepare(`INSERT INTO cards
      (id, user_id, type, knowledge_id, question_id, due, interval, state, reps, lapses, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      c.id, req.user.id, c.type, c.knowledgeId, c.questionId, c.due, 0, 'new', 0, 0, c.createdAt,
    );
    return { ok: true, cardId: c.id };
  });

  /* ============ 统计 ============ */
  fastify.get('/api/study/stats', { preHandler: fastify.requireAuth }, async (req) => {
    const nodes = db.prepare(`
      SELECT s.kid, s.n, s.c, k.title, k.chapter_id, c.name AS chapter_name, c.id AS cat_id, cat.name AS cat_name, cat.color
      FROM stats_node s
      JOIN knowledge k ON k.id = s.kid
      LEFT JOIN chapters c ON c.id = k.chapter_id
      LEFT JOIN categories cat ON cat.id = k.category_id
      WHERE s.user_id = ?`).all(req.user.id);

    const byCategory = new Map();
    for (const n of nodes) {
      const key = n.cat_id || 'other';
      if (!byCategory.has(key)) byCategory.set(key, { id: key, name: n.cat_name || '未分类', color: n.color || '#3b82f6', n: 0, c: 0, nodes: 0 });
      const g = byCategory.get(key);
      g.n += n.n; g.c += n.c; g.nodes += 1;
    }

    const daily = db.prepare('SELECT date, n, c, minutes FROM stats_daily WHERE user_id = ? ORDER BY date').all(req.user.id);
    const kinds = db.prepare(`
      SELECT kind, COUNT(*) n, SUM(correct) c FROM attempts
      WHERE user_id = ? GROUP BY kind`).all(req.user.id);

    const recent = db.prepare(`
      SELECT a.id, a.kind, a.ref_id, a.kid, a.correct, a.ts, a.context, a.error_type,
             COALESCE(q.stem, l.title, nt.title, lb.title) AS title
      FROM attempts a
      LEFT JOIN questions q ON q.id = a.ref_id AND a.kind = 'question'
      LEFT JOIN sql_levels l ON l.id = a.ref_id AND a.kind = 'level'
      LEFT JOIN normalize_tasks nt ON nt.id = a.ref_id AND a.kind = 'normalize'
      LEFT JOIN labs lb ON lb.id = a.ref_id AND a.kind = 'lab'
      WHERE a.user_id = ? ORDER BY a.ts DESC LIMIT 40`).all(req.user.id);

    return {
      nodes: nodes.map((n) => ({
        kid: n.kid, title: n.title, chapterId: n.chapter_id, chapterName: n.chapter_name,
        attempts: n.n, correct: n.c,
        mastery: Math.round(((n.c + 1) / (n.n + 2)) * 100),
      })),
      byCategory: [...byCategory.values()].map((g) => ({
        ...g, accuracy: g.n ? Math.round((g.c / g.n) * 100) : 0,
      })),
      daily,
      kinds: kinds.map((k) => ({ kind: k.kind, attempts: k.n, correct: k.c || 0 })),
      recent: recent.map((r) => ({
        id: r.id, kind: r.kind, refId: r.ref_id, kid: r.kid, correct: r.correct === 1,
        ts: r.ts, context: r.context, errorType: r.error_type, title: r.title || r.ref_id,
      })),
      achievements: myAchievements(req.user.id),
    };
  });

  /* ============ 根因诊断 ============ */
  fastify.get('/api/study/diagnose', { preHandler: fastify.requireAuth }, async (req) => {
    const stats = {};
    for (const r of db.prepare('SELECT kid, n, c FROM stats_node WHERE user_id = ?').all(req.user.id)) {
      stats[r.kid] = { n: r.n, c: r.c };
    }
    const meta = {};
    for (const k of db.prepare('SELECT id, title, chapter_id FROM knowledge').all()) {
      meta[k.id] = { title: k.title, chapterId: k.chapter_id };
    }
    const edges = db.prepare('SELECT from_kid, to_kid, type, strength FROM knowledge_edges').all();
    return { diagnosis: diagnose(stats, edges, meta) };
  });

  /* ============ 笔记 ============ */
  fastify.get('/api/study/notes', {
    preHandler: fastify.requireAuth,
    schema: { querystring: { type: 'object', properties: { kid: { type: 'string' } } } },
  }, async (req) => {
    if (req.query.kid) {
      const rows = db.prepare('SELECT * FROM notes WHERE user_id = ? AND kid = ? ORDER BY created_at DESC')
        .all(req.user.id, req.query.kid);
      return { notes: rows };
    }
    const rows = db.prepare(`
      SELECT n.*, k.title AS kid_title FROM notes n
      LEFT JOIN knowledge k ON k.id = n.kid
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`).all(req.user.id);
    return { notes: rows.map((n) => ({ ...n, kidTitle: n.kid_title })) };
  });

  fastify.post('/api/study/notes', {
    preHandler: fastify.requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['kid', 'text'],
        properties: { kid: { type: 'string' }, text: { type: 'string', maxLength: 4000 } },
      },
    },
  }, async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM knowledge WHERE id = ?').get(req.body.kid)) {
      return reply.code(404).send({ error: '知识点不存在' });
    }
    const id = newId('note');
    db.prepare('INSERT INTO notes (id, user_id, kid, text, date, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, req.user.id, req.body.kid, req.body.text, todayLocal(), new Date().toISOString());
    return { ok: true, id };
  });

  fastify.delete('/api/study/notes/:id', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const r = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!r.changes) return reply.code(404).send({ error: '笔记不存在' });
    return { ok: true };
  });

  /* ============ 成就墙 ============ */
  fastify.get('/api/study/achievements', { preHandler: fastify.requireAuth }, async (req) => ({
    achievements: myAchievements(req.user.id),
    stats: achievementStats(req.user.id),
  }));
}
