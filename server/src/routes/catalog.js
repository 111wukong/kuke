/* 内容接口 /api/catalog/*
 *
 * 全部只读。知识树、知识点详情、题库、数据集、关卡、范式题、实验台。
 *
 * ── 一个刻意的设计：答案不下发 ──────────────────────────────────
 * 客观题的 answer 和 SQL 关卡的 reference_sql **绝不**随题目列表返回。
 * 它们只在"提交答案之后"或"明确点了看答案"时才给。
 *
 * 理由很直接：这是个浏览器应用，前端拿到的东西用户都能看到。
 * 如果列表接口带着答案，F12 一开就全剧透了 ——
 * 而这个系统里有一部分是"练习"，练习的价值全在"我先想"这一步。
 * 所以 /api/catalog/questions 返回的题目对象里没有 answer 字段，
 * 判分完全在服务端做。
 */
import { db } from '../db/index.js';
import { THEME_IDS } from '../lib/themes.js';
import { ACHIEVEMENTS } from '../lib/game.js';

const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

/** 题目脱敏：去掉答案与解析。 */
function shapeQuestion(q, { withAnswer = false } = {}) {
  const base = {
    id: q.id,
    kid: q.kid,
    type: q.type,
    difficulty: q.difficulty,
    stem: q.stem,
    options: parseJson(q.options, null),
  };
  if (withAnswer) {
    base.answer = q.answer;
    base.analysis = q.analysis;
    base.steps = parseJson(q.steps, []);
  }
  return base;
}

export default async function catalogRoutes(fastify) {
  /* ============ 知识树（分类 → 章 → 知识点，不含正文）============ */
  fastify.get('/api/catalog/tree', { preHandler: fastify.requireAuth }, async () => {
    const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
    const chapters = db.prepare('SELECT * FROM chapters ORDER BY sort_order, id').all();
    const knowledge = db.prepare(`
      SELECT id, category_id, chapter_id, title, summary, difficulty, importance, tags, sort_order
      FROM knowledge ORDER BY sort_order, id
    `).all();

    const edges = db.prepare('SELECT from_kid, to_kid, type, strength FROM knowledge_edges').all();

    return {
      categories: cats.map((c) => ({
        id: c.id, name: c.name, color: c.color, description: c.description, sortOrder: c.sort_order,
        chapters: chapters.filter((ch) => ch.category_id === c.id).map((ch) => ({
          id: ch.id, name: ch.name, summary: ch.summary, sortOrder: ch.sort_order,
          knowledge: knowledge.filter((k) => k.chapter_id === ch.id).map((k) => ({
            id: k.id, title: k.title, summary: k.summary,
            difficulty: k.difficulty, importance: k.importance,
            tags: parseJson(k.tags, []),
          })),
        })),
      })),
      edges,
      stats: {
        categories: cats.length,
        chapters: chapters.length,
        knowledge: knowledge.length,
        edges: edges.length,
      },
    };
  });

  /* ============ 知识点详情 ============ */
  fastify.get('/api/catalog/knowledge/:id', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const k = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(req.params.id);
    if (!k) return reply.code(404).send({ error: '知识点不存在' });

    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(k.chapter_id);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(k.category_id);

    /* 前后依赖：学生看完这一节最想知道的就是"我该先补什么 / 接下来学什么"。
     * 这两个列表直接放在详情页里，不用他再去图里找。 */
    const prereqs = db.prepare(`
      SELECT e.from_kid AS kid, e.strength, e.reason, k.title
      FROM knowledge_edges e JOIN knowledge k ON k.id = e.from_kid
      WHERE e.to_kid = ? AND e.type = 'prereq' ORDER BY e.strength
    `).all(k.id);

    const unlocks = db.prepare(`
      SELECT e.to_kid AS kid, e.strength, e.reason, k.title
      FROM knowledge_edges e JOIN knowledge k ON k.id = e.to_kid
      WHERE e.from_kid = ? AND e.type = 'prereq' ORDER BY e.strength
    `).all(k.id);

    const related = db.prepare(`
      SELECT CASE WHEN e.from_kid = ? THEN e.to_kid ELSE e.from_kid END AS kid, e.reason, k.title
      FROM knowledge_edges e JOIN knowledge k
        ON k.id = CASE WHEN e.from_kid = ? THEN e.to_kid ELSE e.from_kid END
      WHERE (e.from_kid = ? OR e.to_kid = ?) AND e.type = 'related'
    `).all(k.id, k.id, k.id, k.id);

    const confusable = db.prepare(`
      SELECT CASE WHEN e.from_kid = ? THEN e.to_kid ELSE e.from_kid END AS kid, e.reason, k.title
      FROM knowledge_edges e JOIN knowledge k
        ON k.id = CASE WHEN e.from_kid = ? THEN e.to_kid ELSE e.from_kid END
      WHERE (e.from_kid = ? OR e.to_kid = ?) AND e.type = 'confusable'
    `).all(k.id, k.id, k.id, k.id);

    // 这个知识点的题量（让学生知道练完要多久）
    const counts = db.prepare(`
      SELECT (SELECT COUNT(*) FROM questions WHERE kid = ?) AS questions,
             (SELECT COUNT(*) FROM sql_levels WHERE kid = ?) AS levels,
             (SELECT COUNT(*) FROM normalize_tasks WHERE kid = ?) AS normalizeTasks
    `).get(k.id, k.id, k.id);

    const myStats = db.prepare('SELECT n, c FROM stats_node WHERE user_id = ? AND kid = ?')
      .get(req.user.id, k.id) || { n: 0, c: 0 };

    return {
      knowledge: {
        id: k.id,
        title: k.title,
        summary: k.summary,
        content: k.content,
        sqlDemo: k.sql_demo,
        difficulty: k.difficulty,
        importance: k.importance,
        tags: parseJson(k.tags, []),
        chapterId: k.chapter_id,
        chapterName: chapter?.name || '',
        categoryId: k.category_id,
        categoryName: category?.name || '',
        categoryColor: category?.color || '#3b82f6',
      },
      prereqs,
      unlocks,
      related,
      confusable,
      counts,
      myStats: { attempts: myStats.n, correct: myStats.c },
    };
  });

  /* ============ 知识点正文里可以"拿去实训场跑"的示例 ============ */
  fastify.get('/api/catalog/knowledge/:id/demo', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const k = db.prepare('SELECT sql_demo FROM knowledge WHERE id = ?').get(req.params.id);
    if (!k) return reply.code(404).send({ error: '知识点不存在' });
    return { sql: k.sql_demo || '' };
  });

  /* ============ 题库列表（不下发答案）============ */
  fastify.get('/api/catalog/questions', {
    preHandler: fastify.requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          kid: { type: 'string' },
          chapter: { type: 'string' },
          type: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  }, async (req) => {
    const where = [];
    const params = [];
    if (req.query.kid) { where.push('q.kid = ?'); params.push(req.query.kid); }
    if (req.query.chapter) { where.push('k.chapter_id = ?'); params.push(req.query.chapter); }
    if (req.query.type) { where.push('q.type = ?'); params.push(req.query.type); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT q.* FROM questions q
      LEFT JOIN knowledge k ON k.id = q.kid
      ${clause}
      ORDER BY q.kid, q.sort_order, q.id
      LIMIT ?
    `).all(...params, req.query.limit ?? 100);

    return { questions: rows.map((q) => shapeQuestion(q)), total: rows.length };
  });

  /* ============ 数据集 ============ */
  fastify.get('/api/catalog/datasets', { preHandler: fastify.requireAuth }, async () => {
    const rows = db.prepare('SELECT * FROM datasets ORDER BY sort_order, id').all();
    return {
      datasets: rows.map((d) => ({
        id: d.id,
        name: d.name,
        title: d.title,
        description: d.description,
        scenario: d.scenario,
        tables: parseJson(d.tables_meta, []),
      })),
    };
  });

  /* 建表语句。单独一个接口，因为「查看建表语句」是做题时的辅助动作，
   * 不该跟数据集列表一起下发（那会让列表响应大一倍）。 */
  fastify.get('/api/catalog/datasets/:id/ddl', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const d = db.prepare('SELECT ddl FROM datasets WHERE id = ?').get(req.params.id);
    if (!d) return reply.code(404).send({ error: '数据集不存在' });
    return { ddl: d.ddl };
  });

  /* ============ SQL 关卡列表（不下发参考答案）============ */
  fastify.get('/api/catalog/levels', {
    preHandler: fastify.requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: { dataset: { type: 'string' }, kid: { type: 'string' } },
      },
    },
  }, async (req) => {
    const where = [];
    const params = [];
    if (req.query.dataset) { where.push('l.dataset_id = ?'); params.push(req.query.dataset); }
    if (req.query.kid) { where.push('l.kid = ?'); params.push(req.query.kid); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT l.id, l.dataset_id, l.chapter_id, l.kid, l.seq, l.title, l.difficulty, l.order_matters
      FROM sql_levels l ${clause} ORDER BY l.seq, l.id
    `).all(...params);

    // 这个用户过了哪些关（取每个关卡最好的一次）
    const passed = db.prepare(`
      SELECT ref_id, MAX(correct) AS ok, COUNT(*) AS tries
      FROM attempts WHERE user_id = ? AND kind = 'level'
      GROUP BY ref_id
    `).all(req.user.id);
    const passMap = new Map(passed.map((p) => [p.ref_id, p]));

    return {
      levels: rows.map((l) => {
        const p = passMap.get(l.id);
        return {
          id: l.id,
          datasetId: l.dataset_id,
          chapterId: l.chapter_id,
          kid: l.kid,
          seq: l.seq,
          title: l.title,
          difficulty: l.difficulty,
          orderMatters: l.order_matters === 1,
          passed: !!p && p.ok === 1,
          attempts: p?.tries || 0,
        };
      }),
    };
  });

  /* 关卡详情。starter_sql 给编辑器做初始内容；
   * ★ reference_sql 和 check_sql 不下发 —— 除非显式 ?reveal=1（看答案）。 */
  fastify.get('/api/catalog/levels/:id', {
    preHandler: fastify.requireAuth,
    schema: {
      querystring: { type: 'object', properties: { reveal: { type: 'integer' } } },
    },
  }, async (req, reply) => {
    const l = db.prepare('SELECT * FROM sql_levels WHERE id = ?').get(req.params.id);
    if (!l) return reply.code(404).send({ error: '关卡不存在' });

    const ds = db.prepare('SELECT id, title, description FROM datasets WHERE id = ?').get(l.dataset_id);

    const out = {
      level: {
        id: l.id,
        datasetId: l.dataset_id,
        datasetTitle: ds?.title || '',
        datasetDescription: ds?.description || '',
        chapterId: l.chapter_id,
        kid: l.kid,
        seq: l.seq,
        title: l.title,
        brief: l.brief,
        hint: l.hint,
        starterSql: l.starter_sql,
        difficulty: l.difficulty,
        orderMatters: l.order_matters === 1,
        requireColumns: l.require_columns === 1,
        hasCheckSql: !!l.check_sql,
      },
      // 上一个 / 下一个，方便"过关自动进入下一关"
      prev: db.prepare('SELECT id, title FROM sql_levels WHERE seq < ? ORDER BY seq DESC LIMIT 1').get(l.seq) || null,
      next: db.prepare('SELECT id, title FROM sql_levels WHERE seq > ? ORDER BY seq ASC LIMIT 1').get(l.seq) || null,
    };
    if (req.query.reveal === 1) out.reference = l.reference_sql;
    return out;
  });

  /* ============ 范式题（不下发 answer）============ */
  fastify.get('/api/catalog/normalize-tasks', { preHandler: fastify.requireAuth }, async (req) => {
    const rows = db.prepare('SELECT * FROM normalize_tasks ORDER BY sort_order, id').all();
    const done = db.prepare(`
      SELECT ref_id, MAX(correct) AS ok, COUNT(*) AS tries FROM attempts
      WHERE user_id = ? AND kind = 'normalize' GROUP BY ref_id
    `).all(req.user.id);
    const map = new Map(done.map((d) => [d.ref_id, d]));

    return {
      tasks: rows.map((t) => ({
        id: t.id,
        kid: t.kid,
        title: t.title,
        brief: t.brief,
        attrs: parseJson(t.attrs, []),
        fds: parseJson(t.fds, []),
        ask: t.ask,
        target: t.target,
        difficulty: t.difficulty,
        solved: !!map.get(t.id)?.ok,
        attempts: map.get(t.id)?.tries || 0,
      })),
    };
  });

  fastify.get('/api/catalog/normalize-tasks/:id', {
    preHandler: fastify.requireAuth,
    schema: { querystring: { type: 'object', properties: { reveal: { type: 'integer' } } } },
  }, async (req, reply) => {
    const t = db.prepare('SELECT * FROM normalize_tasks WHERE id = ?').get(req.params.id);
    if (!t) return reply.code(404).send({ error: '题目不存在' });
    const out = {
      task: {
        id: t.id,
        kid: t.kid,
        title: t.title,
        brief: t.brief,
        attrs: parseJson(t.attrs, []),
        fds: parseJson(t.fds, []),
        ask: t.ask,
        target: t.target,
        hint: t.hint,
        difficulty: t.difficulty,
      },
    };
    if (req.query.reveal === 1) out.answer = parseJson(t.answer, {});
    return out;
  });

  /* ============ 实验台 ============ */
  fastify.get('/api/catalog/labs', {
    preHandler: fastify.requireAuth,
    schema: { querystring: { type: 'object', properties: { kind: { type: 'string' } } } },
  }, async (req) => {
    const where = [];
    const params = [];
    if (req.query.kind) { where.push('kind = ?'); params.push(req.query.kind); }
    const rows = db.prepare(`
      SELECT id, kind, title, difficulty, kid FROM labs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY kind, sort_order, id
    `).all(...params);

    const done = db.prepare(`
      SELECT ref_id, MAX(correct) AS ok FROM attempts
      WHERE user_id = ? AND kind = 'lab' GROUP BY ref_id
    `).all(req.user.id);
    const map = new Map(done.map((d) => [d.ref_id, d]));

    return {
      labs: rows.map((l) => ({
        id: l.id, kind: l.kind, title: l.title, difficulty: l.difficulty, kid: l.kid,
        solved: !!map.get(l.id)?.ok,
      })),
    };
  });

  /* 实验台详情。索引实验要带上数据集元信息，事务实验不需要。
   * ★ answer 和 explanation 不下发 —— 学生在页面上先自己判断。 */
  fastify.get('/api/catalog/labs/:id', {
    preHandler: fastify.requireAuth,
    schema: { querystring: { type: 'object', properties: { reveal: { type: 'integer' } } } },
  }, async (req, reply) => {
    const l = db.prepare('SELECT * FROM labs WHERE id = ?').get(req.params.id);
    if (!l) return reply.code(404).send({ error: '实验不存在' });
    const payload = parseJson(l.payload, {});

    const out = {
      lab: {
        id: l.id,
        kind: l.kind,
        title: l.title,
        brief: l.brief,
        difficulty: l.difficulty,
        payload,
      },
    };
    if (l.kind === 'index' && payload.dataset_id) {
      const ds = db.prepare('SELECT id, title, description FROM datasets WHERE id = ?').get(payload.dataset_id);
      out.lab.dataset = ds ? { id: ds.id, title: ds.title, description: ds.description } : null;
    }
    if (req.query.reveal === 1) {
      out.answer = parseJson(l.answer, {});
      out.explanation = l.explanation;
    }
    return out;
  });

  /* ============ 元信息（主题、成就定义）============ */
  fastify.get('/api/meta', async () => ({
    themes: THEME_IDS,
    achievements: ACHIEVEMENTS,
  }));
}
