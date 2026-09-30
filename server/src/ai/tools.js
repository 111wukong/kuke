/* AI · 工具集
 *
 * 模型想「做点什么」时落到这里。
 *
 * ── 这个文件里最重要的不是工具本身，是**白名单** ─────────────────
 * 多角色 agent 集群最经典的失败模式是「角色趋同」：提示词里写
 * 「你是个聪明学生」「你基础不好」，模型会说出几乎一样的话。
 * 解法不是把形容词写得更狠，而是三样结构性差异：
 *
 *   1. 信息可见性递减 —— 每个角色拿到的资料量不同（见 MATERIAL_DEPTH）
 *   2. 工具白名单隔离 —— 学生**没有** write_sql（写完整解答的能力）
 *   3. 错误来源真实   —— 后进生的错来自题库里的真实干扰项
 *
 * 第 2 条只能用工具表约束。提示词约束不住 —— 一旦学生 agent 拿到了
 * write_sql，它就会开始写完整解法，慢慢退化成第二个老师。
 * 所以 TEACHER_ONLY 那条边界**必须写成断言**，见文件末尾的自检。
 *
 * ── 库课独有的两个工具 ──────────────────────────────────────────
 * `run_sql` 和 `explain_plan`：AI 能在教学库上**真的执行** SQL，
 * 结果直接上黑板。这是数学课那种「画个曲线」给不了的东西 ——
 * 学生能当场看见自己写错在哪、执行计划长什么样。
 */

import { db } from '../db/index.js';
import { compile, samplePoints, envelope, round6 } from './expr.js';
import { recentMistakes, runDiagnose } from './profile.js';

/* ============================================================
   资料可见性分档
   ============================================================
   角色 → 能看到考点的哪些字段。这张表是「角色差异化」的全部秘密，
   别在这里加形容词，只加字段。
   ============================================================ */
export const MATERIAL_DEPTH = {
  /* 老师：全都有 */
  teacher: { summary: 1, content: 1, sql_demo: 1, related: 1, mistakes: 1, meta: 1 },
  /* 优等生：正文 + 示例 + 关联考点。典型失误是「结论下得太早」——
     所以他资料齐全，错在不验边界条件，而不是错在不知道。 */
  a: { summary: 1, content: 1, sql_demo: 1, related: 1, mistakes: 0, meta: 1 },
  /* 中等生：正文，没有示例。典型失误是「条件用错」。 */
  b: { summary: 1, content: 1, sql_demo: 0, related: 0, mistakes: 0, meta: 1 },
  /* 后进生：**只有一句摘要**。典型失误是「概念混淆」。 */
  c: { summary: 1, content: 0, sql_demo: 0, related: 0, mistakes: 0, meta: 1 },
};

/* ============================================================
   黑板动作族
   ============================================================
   ★ 所有动作返回**同一个形状**：{ type:'board', item:{ kind, ... } }
     渲染层只认 kind。别让某个动作返回 { type:'svg' } 走特例分支 ——
     后面每加一种动作都要改渲染层，加三种之后渲染层就没法看了。
   ============================================================ */

/** highlight 不是一块内容，是打在已有块上的光。它**不占黑板块数的号**。
 *
 *  ★ 这个常量是**两个地方的唯一口径**：
 *    · 工具的 highlight 在哪些块里找目标
 *    · UI 的增量动画记账数几块
 *    两边口径必须一致。把 page / clear 也算进来的话，计数会比实际多，
 *    新块的起点算错，**该播动画的块不播** —— 静默失效，比报错难查得多。 */
export const BOARD_KINDS = ['sql', 'graph', 'steps', 'latex', 'page', 'clear', 'highlight'];
export const BOARD_BLOCK_KINDS = ['sql', 'graph', 'steps', 'latex'];

function board(kind, rest) { return { type: 'board', item: { kind, ...rest } }; }
function ok(data, render) { return { ok: true, data: data ?? null, render: render ?? null }; }
function bad(error) { return { ok: false, data: null, render: null, error: String(error) }; }

/* ============================================================
   数据访问（都走 kuke 的真实库）
   ============================================================ */

function kidRow(kid) {
  return db.prepare('SELECT id, title, summary, content, sql_demo, difficulty, importance, tags, chapter_id FROM knowledge WHERE id = ?').get(kid);
}

/** 按名字/关键词模糊找一个考点。模型给的名字往往不精确。 */
export function findKid(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const exact = db.prepare('SELECT id FROM knowledge WHERE id = ? OR title = ?').get(q, q);
  if (exact) return exact.id;
  const like = db.prepare('SELECT id FROM knowledge WHERE title LIKE ? ORDER BY importance DESC, difficulty LIMIT 1').get(`%${q}%`);
  if (like) return like.id;
  // 反过来：查询里含标题（模型可能把标题裹在一句话里）
  const all = db.prepare('SELECT id, title FROM knowledge').all();
  const hit = all.find((k) => q.includes(k.title));
  return hit ? hit.id : null;
}

/** 按角色裁剪考点资料。**唯一的资料出口** —— 任何工具想拿考点内容都得走它。
 *  绕过它直接查表的话，角色的信息差就失效了，四个 agent 会立刻收敛成同一种腔调。 */
export function materialFor(kid, depthKey) {
  const k = kidRow(kid);
  if (!k) return null;
  const d = MATERIAL_DEPTH[depthKey] || MATERIAL_DEPTH.c;
  const out = { kid: k.id, title: k.title };
  if (d.meta) {
    out.difficulty = k.difficulty;
    out.importance = k.importance;
    try { out.tags = JSON.parse(k.tags || '[]'); } catch { out.tags = []; }
  }
  if (d.summary) out.summary = k.summary;
  if (d.content) out.content = k.content;
  if (d.sql_demo) out.sql_demo = k.sql_demo;
  if (d.related) {
    out.prerequisites = db.prepare(`
      SELECT k.id, k.title FROM knowledge_edges e
        JOIN knowledge k ON k.id = e.from_kid
       WHERE e.to_kid = ? LIMIT 6
    `).all(kid);
    out.leadsTo = db.prepare(`
      SELECT k.id, k.title FROM knowledge_edges e
        JOIN knowledge k ON k.id = e.to_kid
       WHERE e.from_kid = ? LIMIT 6
    `).all(kid);
  }
  if (d.mistakes) {
    /* 老师能看到「这个考点的题里，错误选项长什么样」——
     * 那正是学生真实会踩的坑。 */
    const qs = db.prepare("SELECT stem, options, analysis FROM questions WHERE kid = ? AND type IN ('choice','multi') LIMIT 4").all(kid);
    out.commonMistakes = qs.flatMap((q) => {
      let opts = [];
      try { opts = JSON.parse(q.options || '[]'); } catch { opts = []; }
      /* ★ 库课的选项字段是 { key, text }，不是 { k, t }。
       *   读错字段名不会报错，只会静默返回一堆空串 —— 那样「常见错误」
       *   就变成了一句空话，而没有任何迹象。 */
      const right = new Set(String(q.answer || '').split('').map((c) => c.toUpperCase()));
      const wrong = opts.filter((o) => o && o.key && !right.has(String(o.key).toUpperCase()))
        .slice(0, 2).map((o) => o.text || '');
      return wrong.filter(Boolean).map((t) => ({ stem: q.stem.slice(0, 40), wrongOption: t }));
    }).slice(0, 4);
  }
  return out;
}

/* ★ SQL 沙箱**惰性加载**。
 *   sqlRunner.js 在 import 时就会起 2–4 个 worker 线程（每个都要 require
 *   better-sqlite3 这个原生模块）。而「读工具清单」「跑纯函数测试」
 *   这些事根本用不到它 —— 一 import tools.js 就拉一个 worker 池起来，
 *   在单元测试里会直接把进程拖住（实测被 SIGTERM 掉）。
 *   真正的服务端不受影响：routes/sql.js 本来就 eager 引了它。 */
let _pool = null;
async function getPool() {
  if (!_pool) ({ sqlPool: _pool } = await import('../lib/sqlRunner.js'));
  return _pool;
}

function loadDataset(id) {
  const d = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id || 'school');
  return d || db.prepare('SELECT * FROM datasets ORDER BY sort_order LIMIT 1').get();
}

/* ============================================================
   工具表
   ============================================================ */

const TABLE = {
  /* ---------------- 资料类（按角色裁剪） ---------------- */
  look_up: {
    description: '查一个考点的资料。返回的内容量取决于你是谁——同一个考点，不同角色查到的详略不同。',
    parameters: {
      type: 'object',
      properties: { kid: { type: 'string', description: '考点名或关键词，例如「GROUP BY」「索引」「范式」' } },
      required: ['kid'],
    },
    run(args, ctx) {
      const kid = findKid(args.kid);
      if (!kid) {
        const titles = db.prepare('SELECT title FROM knowledge ORDER BY importance DESC LIMIT 12').all().map((r) => r.title).join('、');
        return bad(`没有找到考点「${args.kid}」。平台上有：${titles}…（共 ${db.prepare('SELECT COUNT(*) n FROM knowledge').get().n} 个考点）`);
      }
      return ok(materialFor(kid, ctx.depth), null);
    },
  },

  /* ---------------- 算数 ---------------- */
  calc: {
    description: '算一个表达式的值。**不要自己心算**——需要具体数字时一律用它，你的心算经常错。',
    parameters: { type: 'object', properties: { expr: { type: 'string', description: '例如 "1024*1024"、"log2(1000000)"' } }, required: ['expr'] },
    run(args) {
      const expr = String(args.expr || '').trim();
      if (!expr) return bad('expr 不能为空');
      let fn;
      try { fn = compile(expr, []); } catch (e) { return bad(`表达式有问题：${e.message}`); }
      const v = fn(0);
      if (!Number.isFinite(v)) return bad(`表达式算不出有限值（${expr}）`);
      return ok({ expr, value: round6(v) }, null);
    },
  },

  /* ---------------- ★ 跑 SQL（库课独有） ---------------- */
  run_sql: {
    description: '在**真实的教学数据库**上执行 SQL，结果会显示在黑板上。写完一定要跑一遍——你猜的结果经常是错的。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '要执行的 SQL' },
        dataset: { type: 'string', description: '数据集 id：school(学生选课) / shop(电商订单) / library(图书借阅) / company(员工部门)，默认 school' },
        explain: { type: 'boolean', description: '设为 true 时返回执行计划而不是结果集，讲索引和优化时用' },
      },
      required: ['sql'],
    },
    async run(args) {
      const sql = String(args.sql || '').trim();
      if (!sql) return bad('sql 不能为空');
      const ds = loadDataset(args.dataset);
      if (!ds) return bad('没有可用的教学数据集');

      const pool = await getPool();
      const res = await pool.run({
        ddl: ds.ddl, seed: ds.seed, sql, allowWrite: false,
        explain: !!args.explain,
      }, { timeout: 5000 });

      if (!res.ok) {
        return bad(`SQL 执行失败（${res.phase}）：${res.error}`);
      }

      const first = (res.results || [])[0] || { columns: [], rows: [], rowCount: 0 };
      const columns = first.columns || [];
      const rows = first.rows || [];

      /* data 给模型看：**必须包含行**，不然它没法基于真实结果推理。
       * 但只给前 20 行 —— 再多就是白烧 token。 */
      const data = {
        dataset: ds.id,
        columns,
        rowCount: first.rowCount ?? rows.length,
        truncated: !!first.truncated || rows.length > 20,
        rows: rows.slice(0, 20),
        ms: res.ms,
        note: args.explain ? '这是执行计划。' : '结果已显示在黑板上。',
      };

      const item = board('sql', {
        dataset: ds.id,
        datasetTitle: ds.title,
        sql,
        explain: !!args.explain,
        columns,
        rows: rows.slice(0, 200),     // 黑板上最多显示 200 行
        rowCount: first.rowCount ?? rows.length,
        truncated: !!first.truncated,
        ms: res.ms,
      });
      return ok(data, item);
    },
  },

  explain_plan: {
    description: '看一条查询的执行计划（等价于 run_sql 传 explain:true）。讲索引、讲「为什么这条慢」时用它。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '要分析的查询' },
        dataset: { type: 'string', description: '数据集 id，默认 school' },
      },
      required: ['sql'],
    },
    async run(args, ctx) {
      return TABLE.run_sql.run({ sql: args.sql, dataset: args.dataset, explain: true }, ctx);
    },
  },

  /* ---------------- 画图 ---------------- */
  draw_graph: {
    description: '在黑板上画函数图像。曲线会从左到右描出来。讲复杂度曲线、索引选择性、命中率时很有用。可以带参数（如 n、k），界面上能拖动滑块实时看曲线怎么变。',
    parameters: {
      type: 'object',
      properties: {
        expr: { type: 'string', description: '关于 x 的表达式，例如 "log2(x)"、"k*x"、"1-(1-1/n)^x"' },
        xmin: { type: 'number', description: 'x 轴左端，默认 0' },
        xmax: { type: 'number', description: 'x 轴右端，默认 100' },
        title: { type: 'string', description: '这块图的标题' },
        params: { type: 'array', description: '可拖动参数，每个 {name, min, max, value}，最多 3 个。', items: { type: 'object', properties: { name: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' }, value: { type: 'number' } }, required: ['name'] } },
      },
      required: ['expr'],
    },
    run(args) {
      const expr = String(args.expr || '').trim();
      if (!expr) return bad('draw_graph 需要 expr');

      const rawParams = Array.isArray(args.params) ? args.params.slice(0, 3) : [];
      const params = [];
      for (const p of rawParams) {
        if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
        const name = p.name.trim();
        const min = Number.isFinite(Number(p.min)) ? Number(p.min) : -3;
        const max = Number.isFinite(Number(p.max)) ? Number(p.max) : 3;
        if (!(max > min)) return bad(`参数 ${name} 的 max 必须大于 min`);
        let value = Number.isFinite(Number(p.value)) ? Number(p.value) : (min + max) / 2;
        value = Math.min(max, Math.max(min, value));
        params.push({ name, min: round6(min), max: round6(max), value: round6(value) });
      }
      if (new Set(params.map((p) => p.name)).size !== params.length) return bad('参数名有重复');

      let fn;
      try { fn = compile(expr, params.map((p) => p.name)); } catch (e) { return bad(`表达式有问题：${e.message}`); }

      let xmin = Number.isFinite(Number(args.xmin)) ? Number(args.xmin) : 0;
      let xmax = Number.isFinite(Number(args.xmax)) ? Number(args.xmax) : 100;
      if (!(xmax > xmin)) return bad('xmax 必须大于 xmin');
      if (xmax - xmin > 1e6) { xmin = 0; xmax = 100; }

      const baseScope = {};
      for (const p of params) baseScope[p.name] = p.value;

      /* ★ y 轴范围预先算好并钉死。
       *   让每个参数各取遍 min / max 端点，把结果并起来求包络，重绘时复用。
       *   不这么做的话坐标轴会跟着参数一起缩放，整张图随手指抖，
       *   反而看不出参数到底改变了什么。 */
      const allY = [];
      const combos = params.length ? 2 ** params.length : 1;
      for (let mask = 0; mask < combos; mask++) {
        const sc = {};
        params.forEach((q, i) => { sc[q.name] = (mask >> i) & 1 ? q.max : q.min; });
        for (const [, y] of samplePoints(fn, xmin, xmax, 60, sc)) if (y !== null) allY.push(y);
      }
      for (const [, y] of samplePoints(fn, xmin, xmax, 240, baseScope)) if (y !== null) allY.push(y);
      const { ymin, ymax } = envelope(allY);

      const item = board('graph', {
        expr,
        title: String(args.title || `y = ${expr}`).slice(0, 80),
        xmin: round6(xmin), xmax: round6(xmax), ymin, ymax,
        params,
        samples: samplePoints(fn, xmin, xmax, 320, baseScope),
      });
      return ok({
        expr, xmin: round6(xmin), xmax: round6(xmax), ymin, ymax,
        params: params.map((p) => ({ name: p.name, min: p.min, max: p.max, value: p.value })),
        note: '图像已画在黑板上。',
      }, item);
    },
  },

  /* ---------------- 黑板：写步骤（老师专用） ---------------- */
  write_steps: {
    description: '在黑板上写出解题步骤，最多 8 条。逐条错开落下。这是「完整解答」，只有老师能用。',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, steps: { type: 'array', items: { type: 'string' }, description: '每一步一行，最多 8 条' } },
      required: ['steps'],
    },
    run(args) {
      const raw = Array.isArray(args.steps) ? args.steps : [args.steps];
      const steps = raw.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 8);
      if (!steps.length) return bad('steps 不能为空');
      const title = String(args.title || '').trim().slice(0, 60);
      return ok({ title, count: steps.length, note: `已写下 ${steps.length} 步。` }, board('steps', { title, steps }));
    },
  },

  /* ---------------- 黑板：标准 SQL（老师专用） ---------------- */
  write_sql: {
    description: '把一段标准 SQL 写在黑板上（带语法高亮）。这是「写完整解答」，只有老师能用。学生自己写的 SQL 要用 run_sql 跑出来看结果。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL 正文' },
        note: { type: 'string', description: '一句话说明，可省' },
      },
      required: ['sql'],
    },
    run(args) {
      const sql = String(args.sql || '').trim();
      if (!sql) return bad('sql 不能为空');
      const note = String(args.note || '').slice(0, 120);
      return ok({ sql, note }, board('latex', { tex: sql, caption: note, lang: 'sql' }));
    },
  },

  /* ---------------- 黑板：公式 ---------------- */
  write_latex: {
    description: '在黑板上排一个数学公式。$ 和 $$ 定界符会自动剥掉，直接写 LaTeX 内容即可。',
    parameters: { type: 'object', properties: { tex: { type: 'string' }, caption: { type: 'string' } }, required: ['tex'] },
    run(args) {
      const tex = String(args.tex || '').replace(/^\s*\$\$?|\$\$?\s*$/g, '').trim();
      if (!tex) return bad('tex 不能为空');
      return ok({ tex }, board('latex', { tex: tex.slice(0, 400), caption: String(args.caption || '').slice(0, 80) }));
    },
  },

  /* ---------------- 黑板：圈重点 ---------------- */
  highlight: {
    description: '把黑板上已有的某一块圈出来。按**文字**匹配（写目标块里出现过的一段字），不是按坐标。',
    parameters: { type: 'object', properties: { target: { type: 'string' }, why: { type: 'string' } }, required: ['target'] },
    run(args, ctx) {
      const target = String(args.target || '').trim();
      if (!target) return bad('target 不能为空');
      const items = (ctx.session && ctx.session.board) || [];
      const hit = items.filter((it) => BOARD_BLOCK_KINDS.includes(it.kind)).find((it) => blockText(it).includes(target));
      if (!hit) return bad(`黑板上没有包含「${target}」的内容。先看看已经画了什么，再圈。`);
      return ok({ target, on: hit.kind, note: '已圈出。' }, board('highlight', { target, why: String(args.why || '').slice(0, 80), hits: hit.kind }));
    },
  },

  /* ---------------- 黑板：翻页 / 擦除（老师专用） ---------------- */
  new_page: {
    description: '在黑板上开新的一页。**旧内容会保留**，可以翻回去看。想删掉才用 clear_board。',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: [] },
    run(args) {
      return ok({ note: '已翻到新的一页。' }, board('page', { title: String(args.title || '').trim().slice(0, 60) }));
    },
  },
  clear_board: {
    description: '把黑板擦干净。**之前写的内容会永久消失**，用户翻不回去。只想接着写就用 new_page。',
    parameters: { type: 'object', properties: {}, required: [] },
    run() { return ok({ note: '黑板已擦净。' }, board('clear', {})); },
  },

  /* ---------------- 学情类（老师专用） ---------------- */
  get_mistakes: {
    description: '看这个学习者**真实答错过的题**（含他当时写的答案和错因归类）。这是你针对性讲评的依据。',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: '最多几条，默认 5' } }, required: [] },
    run(args, ctx) {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
      const rows = recentMistakes(ctx.userId, limit).map((m) => ({
        考点: kidRow(m.kid)?.title || m.kid,
        题干: String(m.stem || '').slice(0, 60),
        他写的答案: String(m.answer || '').slice(0, 40),
        标准答案: String(m.std || '').slice(0, 40),
        错因: m.error_type || '未归类',
      }));
      if (!rows.length) return ok({ 错题: [], note: '他还没有答错过题。' });
      return ok({ 错题: rows });
    },
  },

  query_weakness: {
    description: '看他的薄弱考点与**根因**（沿依赖图回溯出来的，不是按错误次数排的）。用它决定这节课先讲什么。',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: '最多几条，默认 5' } }, required: [] },
    run(args, ctx) {
      const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
      const diag = runDiagnose(ctx.userId);
      const roots = (diag.roots || []).slice(0, limit).map((r) => ({
        根因: r.title, kid: r.kid,
        掌握度: Math.round(r.mastery * 100) + '%',
        做过: r.attempts + ' 题',
        能连带解决: r.coveredSymptoms - 1 + ' 个下游薄弱点',
        下游: (r.symptoms || []).slice(0, 3).map((s) => `${s.title}(${Math.round(s.mastery * 100)}%)`),
      }));
      if (!roots.length) {
        return ok({ 根因: [], 概述: diag.summary, 薄弱: (diag.weak || []).slice(0, limit).map((w) => ({ 考点: w.title, 掌握度: Math.round(w.mastery * 100) + '%' })) });
      }
      return ok({ 根因: roots, 概述: diag.summary });
    },
  },

  /* ---------------- 出题（老师专用） ---------------- */
  pose_question: {
    description: '留一道题让学习者**现在动手做**。调用之后整堂课会暂停等他作答，所以一轮最多调一次，而且要留在他够得着的难度上。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '题目原文' },
        hint: { type: 'string', description: '只在他卡住时给的最小提示，可省' },
        kid: { type: 'string', description: '这道题考哪个考点' },
      },
      required: ['question'],
    },
    run(args, ctx) {
      const question = String(args.question || '').trim();
      if (!question) return bad('question 不能为空');
      const kid = findKid(args.kid || args.question);
      const rec = { question: question.slice(0, 500), hint: String(args.hint || '').slice(0, 240), kid: kid || null };
      /* 记录到会话上，由编排层决定「何时真的挂起」——挂起只在一处实现 */
      if (ctx.session) ctx.session.pendingQuestion = rec;
      return ok({ posed: true, kid: rec.kid, note: '题已留出，接下来会等他作答。' });
    },
  },

  /* ---------------- 学生专用 ---------------- */
  recall_mistake: {
    description: '回忆你自己在这个考点上「卡住的地方」——就是你最容易犯的那个错。返回的是一条**真实的错误选项**（来自题库），不是正确答案。',
    parameters: { type: 'object', properties: { kid: { type: 'string', description: '考点名' } }, required: ['kid'] },
    run(args, ctx) {
      const kid = findKid(args.kid);
      if (!kid) return bad(`没有找到考点「${args.kid}」`);
      const qs = db.prepare("SELECT stem, options FROM questions WHERE kid = ? AND type IN ('choice','multi') LIMIT 6").all(kid);
      /* ★ 一人分一个干扰项：按角色序号索引，min 夹住不越界。
       *   这样三个人踩的是**不同的**坑，讨论才有张力。 */
      const pool = [];
      for (const q of qs) {
        let opts = [];
        try { opts = JSON.parse(q.options || '[]'); } catch { opts = []; }
        /* 字段名是 { key, text }；而且**必须按标准答案排除正确项** ——
         * 发给学生的「错误思路」里出现正确答案，讨论就没得吵了。 */
        const right = new Set(String(q.answer || '').split('').map((c) => c.toUpperCase()));
        for (const o of opts) {
          if (o && o.key && o.text && !right.has(String(o.key).toUpperCase())) {
            pool.push({ stem: q.stem, text: o.text });
          }
        }
      }
      if (!pool.length) return ok({ 考点: kidRow(kid).title, 想法: null, note: '这个考点你还没什么想法。' });
      const idx = Math.min(ctx.distractorIndex, pool.length - 1);
      const pick = pool[idx];
      return ok({
        考点: kidRow(kid).title,
        你当时是这么想的: pick.text,
        note: '这是你的想法，不是标准答案。请用你自己的话把它说出来，并说清你为什么这么想。',
      });
    },
  },

  raise_hand: {
    description: '举手，让老师把话头交给你。有疑问或者不同意别人时用它。',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: '一句话说清你要问什么' } }, required: ['reason'] },
    run(args, ctx) {
      const reason = String(args.reason || '').trim().slice(0, 120);
      if (!reason) return bad('reason 不能为空');
      if (ctx.session) ctx.session.pendingHand = { role: ctx.role, reason };
      return ok({ raised: true, reason });
    },
  },

  pass: {
    description: '弃权，这一轮不发言。真的没想法时用它，比硬编一句好。',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: [] },
    run(args, ctx) {
      if (ctx.session) ctx.session.passed = (ctx.session.passed || 0) + 1;
      return ok({ passed: true, reason: String(args.reason || '').slice(0, 80) });
    },
  },
};

/* 渲染层要知道每块黑板内容是什么文字，highlight 才能按文字匹配。 */
export function blockText(item) {
  if (!item) return '';
  if (item.kind === 'sql') return `${item.sql || ''} ${item.datasetTitle || ''} ${(item.columns || []).join(' ')}`;
  if (item.kind === 'graph') return `${item.title || ''} ${item.expr || ''}`;
  if (item.kind === 'steps') return `${item.title || ''} ${(item.steps || []).join(' ')}`;
  if (item.kind === 'latex') return `${item.tex || ''} ${item.caption || ''}`;
  if (item.kind === 'page') return item.title || '';
  return '';
}

/* ============================================================
   ★ 角色白名单
   ============================================================
   显式列举，不用 Object.keys(TABLE).map(toSchema)。
   后者会让老师也拿到「举手 / 弃权」——语义错误，而且会在
   断言「工具数量」的测试里静默破功。
   ============================================================ */

/** 写完整解答的能力。学生**没有**这个能力 —— 会跑 SQL 不等于会写解法。 */
export const TEACHER_ONLY = ['write_steps', 'write_sql', 'write_latex', 'new_page', 'clear_board', 'pose_question', 'get_mistakes', 'query_weakness'];
/** 学生专用：老师不该「举手」也不该「弃权」。 */
export const STUDENT_ONLY = ['raise_hand', 'pass', 'recall_mistake'];
/** 两边都有，但**数据源按角色裁剪**。 */
export const SHARED = ['look_up', 'calc', 'run_sql', 'explain_plan', 'draw_graph', 'highlight'];

export const TEACHER_TOOLS = [...SHARED, ...TEACHER_ONLY];
export const STUDENT_TOOLS = [...SHARED, ...STUDENT_ONLY];

/* 自检：这条边界必须硬。提示词约束不住，只有工具表能约束。
 * 写成模块级断言而不是测试里的一句 —— 测试可能被跳过，import 不会。 */
for (const t of STUDENT_TOOLS) {
  if (TEACHER_ONLY.includes(t)) throw new Error(`工具白名单配置错误：${t} 是老师专用，不该出现在学生白名单里`);
  if (!TABLE[t]) throw new Error(`工具白名单里有一个不存在的工具：${t}`);
}
for (const t of TEACHER_TOOLS) {
  if (STUDENT_ONLY.includes(t)) throw new Error(`工具白名单配置错误：${t} 是学生专用，不该出现在老师白名单里`);
  if (!TABLE[t]) throw new Error(`工具白名单里有一个不存在的工具：${t}`);
}

/** 学生不该有能力「写完整解答」。 */
export function assertStudentCannotWriteSolution() {
  const offenders = STUDENT_TOOLS.filter((t) => TEACHER_ONLY.includes(t));
  if (offenders.length) throw new Error(`学生白名单里出现了写解答类工具：${offenders.join(', ')}`);
  return true;
}

/* ============================================================
   对外接口
   ============================================================ */

function toSchema(name) {
  const t = TABLE[name];
  return { type: 'function', function: { name, description: t.description, parameters: t.parameters } };
}

export function schemaFor(role) {
  return (role === 'teacher' ? TEACHER_TOOLS : STUDENT_TOOLS).map(toSchema);
}

export function toolNamesFor(role) {
  return role === 'teacher' ? [...TEACHER_TOOLS] : [...STUDENT_TOOLS];
}

/** 造一个角色化的执行上下文。 */
export function makeCtx({ role, depth, session, userId, kid, distractorIndex = 0 }) {
  return { role, depth, session, userId, kid, distractorIndex };
}

/**
 * 执行一个工具。**异步** —— run_sql 要等 SQL 沙箱。
 * @param {string} name
 * @param {object} args   模型给的参数
 * @param {object} ctx    makeCtx() 的产物
 * @param {string} role   用于白名单校验
 */
export async function execute(name, args, ctx, role) {
  const allowed = role === 'teacher' ? TEACHER_TOOLS : STUDENT_TOOLS;
  if (!allowed.includes(name)) {
    /* 越权调用是**结构性**问题，不是模型调皮 —— 必须拒绝并让它看见 */
    return bad(`工具 ${name} 不在你的可用清单里。你只能用：${allowed.join('、')}`);
  }
  const t = TABLE[name];
  if (!t) return bad(`没有这个工具：${name}`);
  try {
    return await t.run(args && typeof args === 'object' ? args : {}, ctx || makeCtx({ role, depth: 'c' }));
  } catch (e) {
    // 工具内部异常不能让整节课挂掉
    return bad(`工具 ${name} 执行出错：${e.message}`);
  }
}

/** 给 UI 展示：这个角色手里有哪些工具。 */
export function describeTools(role) {
  return (role === 'teacher' ? TEACHER_TOOLS : STUDENT_TOOLS).map((n) => ({
    name: n,
    description: TABLE[n].description,
    teacherOnly: TEACHER_ONLY.includes(n),
  }));
}
