/* 种子导入
 *
 * ── 幂等 ────────────────────────────────────────────────────────
 * 每次启动都跑。已经存在的内容**不覆盖**（用 INSERT OR IGNORE），
 * 因为教师可能改过内置内容的文案 —— 启动服务不该把人家改的东西冲掉。
 *
 * 但有一类例外必须覆盖：**结构性的、程序要读的字段**，
 * 比如 sql_levels.reference_sql（判题基准）、check_sql、order_matters。
 * 这些如果被改坏，判题就是错的，而症状是"学生写对了却判错"。
 * 所以关卡和范式题走 UPSERT（更新判题相关字段），
 * 知识点正文走 INSERT OR IGNORE（保留教师改动）。
 *
 * ── 依赖图的硬门禁 ──────────────────────────────────────────────
 * 导入前先做环检测。有环就直接抛错、不写库 ——
 * 因为带环的图会让根因回溯无限递归、让拓扑排序静默出错。
 * 宁可服务起不来，也不要让它带着坏数据跑起来。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db, initSchema, rebuildStats } from './index.js';
import { migrate } from './migrate.js';
import { CATEGORIES, CHAPTERS, KNOWLEDGE } from '../data/catalog.js';
import { EDGES } from '../data/edges.js';
import { QUESTIONS } from '../data/questions.js';
import { DATASETS } from '../data/datasets.js';
import { LEVELS } from '../data/levels.js';
import { NORMALIZE_TASKS } from '../data/normalize.js';
import { LABS } from '../data/labs.js';
import { auditGraph } from '../lib/graph.js';

export function seed({ quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const counts = {};

  /* ---------- 依赖图门禁：先验后写 ---------- */
  const kidSet = KNOWLEDGE.map((k) => k.id);
  const audit = auditGraph(EDGES, kidSet);
  if (audit.cycles.length) {
    throw new Error(
      `依赖图有环，拒绝导入：${audit.cycles.map((c) => c.join(' → ')).join('；')}\n`
      + '带环的图会让根因回溯无限递归、让拓扑排序静默出错。先修数据。',
    );
  }
  if (audit.dangling.length) {
    throw new Error(`依赖图有悬空边，拒绝导入：${audit.dangling.join('，')}`);
  }

  const run = db.transaction(() => {
    /* ---------- 知识树 ---------- */
    const insCat = db.prepare(`INSERT INTO categories (id, name, color, description, sort_order)
      VALUES (@id, @name, @color, @description, @sort_order)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color,
        description=excluded.description, sort_order=excluded.sort_order`);
    for (const c of CATEGORIES) insCat.run({ description: '', ...c });
    counts.categories = CATEGORIES.length;

    const insCh = db.prepare(`INSERT INTO chapters (id, category_id, name, summary, sort_order)
      VALUES (@id, @category_id, @name, @summary, @sort_order)
      ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name,
        summary=excluded.summary, sort_order=excluded.sort_order`);
    for (const c of CHAPTERS) insCh.run({ summary: '', ...c });
    counts.chapters = CHAPTERS.length;

    /* 知识点：只插不覆盖。教师改过的正文是他的劳动成果，
     * 不能被一次重启冲掉。 */
    const insKn = db.prepare(`INSERT OR IGNORE INTO knowledge
      (id, category_id, chapter_id, title, summary, content, sql_demo, difficulty, importance, tags, sort_order)
      VALUES (@id, @category_id, @chapter_id, @title, @summary, @content, @sql_demo, @difficulty, @importance, @tags, @sort_order)`);
    for (const k of KNOWLEDGE) {
      insKn.run({
        summary: '', sql_demo: '', difficulty: 2, importance: 2, sort_order: 0,
        ...k,
        tags: JSON.stringify(k.tags || []),
      });
    }
    counts.knowledge = KNOWLEDGE.length;

    /* ---------- 依赖边 ---------- */
    db.prepare('DELETE FROM knowledge_edges WHERE source = ?').run('seed');
    const insEdge = db.prepare(`INSERT OR REPLACE INTO knowledge_edges
      (from_kid, to_kid, type, strength, reason, source) VALUES (?,?,?,?,?,'seed')`);
    for (const e of EDGES) {
      insEdge.run(e.from_kid, e.to_kid, e.type || 'prereq', e.strength || 'hard', e.reason || '');
    }
    counts.edges = EDGES.length;

    /* ---------- 题库 ---------- */
    const insQ = db.prepare(`INSERT INTO questions
      (id, kid, type, difficulty, stem, options, answer, analysis, steps, source, sort_order)
      VALUES (@id, @kid, @type, @difficulty, @stem, @options, @answer, @analysis, @steps, @source, @sort_order)
      ON CONFLICT(id) DO UPDATE SET kid=excluded.kid, type=excluded.type, difficulty=excluded.difficulty,
        stem=excluded.stem, options=excluded.options, answer=excluded.answer,
        analysis=excluded.analysis, steps=excluded.steps`);
    for (const q of QUESTIONS) {
      insQ.run({
        difficulty: 2, analysis: '', source: '', sort_order: 0,
        ...q,
        options: q.options ? JSON.stringify(q.options) : null,
        steps: JSON.stringify(q.steps || []),
      });
    }
    counts.questions = QUESTIONS.length;

    /* ---------- 数据集 ---------- */
    const insDs = db.prepare(`INSERT INTO datasets
      (id, name, title, description, scenario, ddl, seed, tables_meta, sort_order)
      VALUES (@id, @name, @title, @description, @scenario, @ddl, @seed, @tables_meta, @sort_order)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, title=excluded.title,
        description=excluded.description, scenario=excluded.scenario, ddl=excluded.ddl,
        seed=excluded.seed, tables_meta=excluded.tables_meta, sort_order=excluded.sort_order`);
    for (const [i, d] of DATASETS.entries()) {
      insDs.run({
        description: '', scenario: '', seed: '',
        ...d,
        tables_meta: JSON.stringify(d.tables_meta || []),
        sort_order: d.sort_order ?? i + 1,
      });
    }
    counts.datasets = DATASETS.length;

    /* ---------- SQL 关卡 ----------
     * 这里用 UPSERT 并且**覆盖判题相关字段**（reference_sql / check_sql /
     * order_matters / require_columns）。理由：这些是判题基准，
     * 如果数据文件修了一个错误的参考答案，而库里还留着旧的那份，
     * 学生就会继续被错误地判分。题目描述类的字段（title/brief/hint）
     * 也一起更新 —— 它们和判题基准是配套的。 */
    const insLv = db.prepare(`INSERT INTO sql_levels
      (id, dataset_id, chapter_id, kid, seq, title, brief, hint, starter_sql, reference_sql,
       check_sql, order_matters, require_columns, difficulty, sort_order)
      VALUES (@id, @dataset_id, @chapter_id, @kid, @seq, @title, @brief, @hint, @starter_sql,
              @reference_sql, @check_sql, @order_matters, @require_columns, @difficulty, @sort_order)
      ON CONFLICT(id) DO UPDATE SET dataset_id=excluded.dataset_id, chapter_id=excluded.chapter_id,
        kid=excluded.kid, seq=excluded.seq, title=excluded.title, brief=excluded.brief,
        hint=excluded.hint, starter_sql=excluded.starter_sql, reference_sql=excluded.reference_sql,
        check_sql=excluded.check_sql, order_matters=excluded.order_matters,
        require_columns=excluded.require_columns, difficulty=excluded.difficulty,
        sort_order=excluded.sort_order`);
    for (const [i, L] of LEVELS.entries()) {
      insLv.run({
        chapter_id: '', kid: '', brief: '', hint: '', starter_sql: '', check_sql: '',
        order_matters: 0, require_columns: 0, difficulty: 2,
        ...L,
        seq: L.seq ?? i + 1,
        sort_order: L.sort_order ?? i + 1,
      });
    }
    counts.levels = LEVELS.length;

    /* ---------- 范式题 ---------- */
    const insNt = db.prepare(`INSERT INTO normalize_tasks
      (id, kid, title, brief, attrs, fds, ask, target, answer, hint, difficulty, sort_order)
      VALUES (@id, @kid, @title, @brief, @attrs, @fds, @ask, @target, @answer, @hint, @difficulty, @sort_order)
      ON CONFLICT(id) DO UPDATE SET kid=excluded.kid, title=excluded.title, brief=excluded.brief,
        attrs=excluded.attrs, fds=excluded.fds, ask=excluded.ask, target=excluded.target,
        answer=excluded.answer, hint=excluded.hint, difficulty=excluded.difficulty,
        sort_order=excluded.sort_order`);
    for (const [i, t] of NORMALIZE_TASKS.entries()) {
      insNt.run({
        kid: '', brief: '', hint: '', difficulty: 2,
        ...t,
        attrs: JSON.stringify(t.attrs),
        fds: JSON.stringify(t.fds),
        target: Array.isArray(t.target) ? t.target.join(',') : (t.target || ''),
        answer: JSON.stringify(t.answer || {}),
        sort_order: t.sort_order ?? i + 1,
      });
    }
    counts.normalizeTasks = NORMALIZE_TASKS.length;

    /* ---------- 实验台 ---------- */
    const insLab = db.prepare(`INSERT INTO labs
      (id, kind, title, brief, kid, payload, answer, explanation, difficulty, sort_order)
      VALUES (@id, @kind, @title, @brief, @kid, @payload, @answer, @explanation, @difficulty, @sort_order)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, brief=excluded.brief,
        kid=excluded.kid, payload=excluded.payload, answer=excluded.answer,
        explanation=excluded.explanation, difficulty=excluded.difficulty,
        sort_order=excluded.sort_order`);
    for (const [i, l] of LABS.entries()) {
      insLab.run({
        brief: '', explanation: '', difficulty: 2, kid: '',
        ...l,
        payload: JSON.stringify(l.payload || {}),
        answer: JSON.stringify(l.answer || {}),
        sort_order: l.sort_order ?? i + 1,
      });
    }
    counts.labs = LABS.length;
  });

  run();

  log(`[seed] 分类 ${counts.categories} · 章 ${counts.chapters} · 知识点 ${counts.knowledge}`
    + ` · 依赖边 ${counts.edges} · 客观题 ${counts.questions}`);
  log(`[seed] 数据集 ${counts.datasets} · SQL 关卡 ${counts.levels}`
    + ` · 范式题 ${counts.normalizeTasks} · 实验台 ${counts.labs}`);
  log(`[seed] 依赖图体检：最长前置链 ${audit.longestChain} 层，`
    + `根节点 ${audit.roots} 个，叶节点 ${audit.leaves} 个`);

  return counts;
}

/* 允许 `npm run seed` 单独执行。
 *
 * ★ 不能用 `import.meta.url === \`file://${process.argv[1]}\`` 判断主模块 ——
 * npm 传进来的 argv[1] 是**相对路径**（src/db/seed.js），
 * 而 import.meta.url 是绝对 file:// URL，两者永远不等。
 * 症状是"跑了但什么都没发生"：不报错、不输出、库是空的，
 * 看着像 seed 逻辑坏了，其实是这段判断根本没进去。
 * 必须用 pathToFileURL 归一化后再比。 */
const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  initSchema();
  migrate();
  const c = seed();
  rebuildStats();
  console.log('[seed] 完成', c);
}
