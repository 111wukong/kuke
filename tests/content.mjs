/* 内容自检：跑一遍所有参考答案，确保判题基准是能跑的
 *
 * 这个脚本的价值在于「早」。关卡写错了（SQL 打错字、引用了不存在的列、
 * 结果集是空的）如果不检查，会一直到学生做题时才暴露 ——
 * 而那时的表现是「我写对了但它说我错」，学生会以为是自己错了。
 * 所以它进 CI，每次改内容都跑。
 */
import Database from 'better-sqlite3';
import { DATASETS } from '../server/src/data/datasets.js';
import { LEVELS } from '../server/src/data/levels.js';
import { NORMALIZE_TASKS } from '../server/src/data/normalize.js';
import { LABS } from '../server/src/data/labs.js';
import { QUESTIONS } from '../server/src/data/questions.js';
import { KNOWLEDGE, CATEGORIES, CHAPTERS } from '../server/src/data/catalog.js';
import { EDGES } from '../server/src/data/edges.js';
import { splitStatements } from '../server/src/lib/sqlGuard.js';
import { judgeNormalize, explain, candidateKeys, closure } from '../server/src/lib/normalize.js';
import { auditGraph } from '../server/src/lib/graph.js';

const problems = [];
const notes = [];
const dsMap = new Map(DATASETS.map((d) => [d.id, d]));

function execAll(db, sql) {
  const out = [];
  for (const st of splitStatements(sql)) {
    const p = db.prepare(st);
    if (p.reader) out.push({ columns: p.columns().map((c) => c.name), rows: p.all() });
    else out.push({ columns: [], rows: [], changes: p.run().changes });
  }
  return out;
}

function freshDb(datasetId) {
  const d = dsMap.get(datasetId);
  if (!d) throw new Error(`数据集不存在：${datasetId}`);
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(d.ddl);
  if (d.seed) db.exec(d.seed);
  return db;
}

/* ---------- 0. 文案字段必须是字符串 ----------
 * ★ 这一条是为一个非常隐蔽的 bug 加的：模板字符串里忘了转义反引号，
 *   比如 `` `仔细看那个 `%` 的位置` `` —— 语法**完全合法**，
 *   它被解析成 `"仔细看那个 " % " 的位置"`，即字符串取模，结果是 NaN。
 *   node --check 查不出来（不报语法错），只有运行时绑进数据库才炸，
 *   而报错是「NOT NULL constraint failed」—— 指向的是数据库约束，
 *   离真正的原因（少了一个反斜杠）隔了十万八千里。
 *   所以在这里统一验：凡是给人看的文案字段，必须是字符串。 */
const TEXT_FIELDS = ['brief', 'content', 'explanation', 'analysis', 'hint', 'title', 'summary', 'scenario', 'description'];
const TEXT_SOURCES = [
  ['关卡', LEVELS], ['客观题', QUESTIONS], ['范式题', NORMALIZE_TASKS],
  ['实验台', LABS], ['知识点', KNOWLEDGE], ['数据集', DATASETS],
];
for (const [label, arr] of TEXT_SOURCES) {
  for (const item of arr) {
    for (const f of TEXT_FIELDS) {
      const v = item[f];
      if (v === undefined) continue;
      if (typeof v !== 'string') {
        problems.push(`${label} ${item.id}：字段 ${f} 不是字符串（实际是 ${typeof v}，值 ${String(v)}）—— 多半是模板字符串里漏转义了反引号`);
      }
    }
  }
}

/* ---------- 1. 数据集自身 ---------- */
for (const d of DATASETS) {
  try {
    const db = freshDb(d.id);
    // 检查 tables_meta 里的表名和列名是否真的存在于 ddl 建出的表里
    for (const t of d.tables_meta || []) {
      const info = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t.name);
      if (!info.length) { problems.push(`数据集 ${d.id}：tables_meta 里的表 ${t.name} 在 ddl 里不存在`); continue; }
      const cols = new Set(info.map((r) => r.name));
      for (const c of t.columns) {
        if (!cols.has(c.name)) problems.push(`数据集 ${d.id}：表 ${t.name} 的列 ${c.name} 在 ddl 里不存在`);
      }
      for (const c of cols) {
        if (!t.columns.some((x) => x.name === c)) problems.push(`数据集 ${d.id}：表 ${t.name} 的列 ${c} 没有写进 tables_meta`);
      }
      const n = db.prepare(`SELECT COUNT(*) n FROM "${t.name}"`).get().n;
      if (t.rows != null && t.rows !== n) notes.push(`数据集 ${d.id}：表 ${t.name} 标注 ${t.rows} 行，实际 ${n} 行`);
    }
    db.close();
  } catch (e) {
    problems.push(`数据集 ${d.id} 加载失败：${e.message}`);
  }
}

/* ---------- 2. 关卡 ---------- */
for (const L of LEVELS) {
  let db;
  try {
    db = freshDb(L.dataset_id);
  } catch (e) { problems.push(`关卡 ${L.id}：${e.message}`); continue; }

  try {
    const ref = execAll(db, L.reference_sql);
    const last = [...ref].reverse().find((r) => r.columns.length);

    if (L.check_sql) {
      const c = execAll(db, L.check_sql);
      const row = c[c.length - 1].rows[0];
      const val = row ? Object.values(row)[0] : undefined;
      if (!val) problems.push(`关卡 ${L.id}：check_sql 对参考答案不通过（返回 ${JSON.stringify(val)}）`);
    } else if (!last) {
      problems.push(`关卡 ${L.id}：参考答案没有产生结果集，且没有 check_sql`);
    } else if (last.rows.length === 0) {
      problems.push(`关卡 ${L.id}：参考答案结果集为空 —— 题目条件多半写错了`);
    }

    // starter_sql 必须语法正确（不能一打开就报错）
    if (L.starter_sql) {
      const db2 = freshDb(L.dataset_id);
      try { execAll(db2, L.starter_sql); }
      catch (e) { problems.push(`关卡 ${L.id}：starter_sql 执行报错 —— ${e.message}`); }
      db2.close();
    }
  } catch (e) {
    problems.push(`关卡 ${L.id}：参考答案执行失败 —— ${e.message}`);
  } finally { db.close(); }
}

/* ---------- 3. 范式题 ---------- */
for (const t of NORMALIZE_TASKS) {
  try {
    const ex = explain(t.attrs, t.fds);
    /* 用题目自己的标准答案反向验证：把它当作学生答案提交，必须判对。
     * 注意 nf 题的答案不在数据文件里 —— 它由算法推导，
     * 数据文件里没有 answer 字段（有的话就成两份真相了）。 */
    let studentAnswer;
    if (t.ask === 'closure') studentAnswer = closure(t.attrs, t.fds, t.target);
    else if (t.ask === 'keys') studentAnswer = candidateKeys(t.attrs, t.fds).keys;
    else if (t.ask === 'nf') studentAnswer = ex.normalForm.nf;
    else if (t.ask === 'decompose') studentAnswer = t.answer?.schemes;

    if (studentAnswer === undefined) {
      problems.push(`范式题 ${t.id}：无法推导出标准答案（ask=${t.ask}）`);
      continue;
    }
    const v = judgeNormalize(t, studentAnswer);
    if (!v.pass) problems.push(`范式题 ${t.id}：用题目自带答案判题却不通过 —— ${v.message}`);
  } catch (e) {
    problems.push(`范式题 ${t.id}：${e.message}`);
  }
}

/* ---------- 4. 知识树与依赖图 ---------- */
const kidSet = new Set(KNOWLEDGE.map((k) => k.id));
for (const k of KNOWLEDGE) {
  if (!CATEGORIES.some((c) => c.id === k.category_id)) problems.push(`知识点 ${k.id}：分类 ${k.category_id} 不存在`);
  if (!CHAPTERS.some((c) => c.id === k.chapter_id)) problems.push(`知识点 ${k.id}：章节 ${k.chapter_id} 不存在`);
}
for (const c of CHAPTERS) {
  if (!CATEGORIES.some((x) => x.id === c.category_id)) problems.push(`章节 ${c.id}：分类 ${c.category_id} 不存在`);
}
for (const e of EDGES) {
  if (!kidSet.has(e.from_kid)) problems.push(`依赖边 ${e.from_kid}→${e.to_kid}：起点知识点不存在`);
  if (!kidSet.has(e.to_kid)) problems.push(`依赖边 ${e.from_kid}→${e.to_kid}：终点知识点不存在`);
}
const g = auditGraph(EDGES, [...kidSet]);
if (g.cycles.length) problems.push(`依赖图有环：${g.cycles.map((c) => c.join('→')).join('；')}`);
if (g.dangling.length) problems.push(`依赖图有悬空边：${g.dangling.join('，')}`);
notes.push(`依赖图：${g.total} 条边（prereq ${g.byType.prereq} / related ${g.byType.related} / confusable ${g.byType.confusable}），最长前置链 ${g.longestChain} 层`);

/* ---------- 5. 客观题 ---------- */
for (const q of QUESTIONS) {
  if (!kidSet.has(q.kid)) problems.push(`题目 ${q.id}：考点 ${q.kid} 不存在`);
  if (q.type === 'choice' || q.type === 'multi') {
    const opts = Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]');
    if (!opts.length) problems.push(`题目 ${q.id}：选项型题目没有选项`);
    const letters = opts.map((o) => String(o.key));
    for (const a of String(q.answer).split('')) {
      if (!letters.includes(a)) problems.push(`题目 ${q.id}：答案 ${a} 不在选项里`);
    }
  }
  if (!String(q.answer || '').length) problems.push(`题目 ${q.id}：没有答案`);
}

/* ---------- 6. 实验台 ---------- */
/** 事务调度的可串行化判定（优先图 + 环检测）。和数据文件里的答案对账。 */
function serializable(schedule) {
  const ops = schedule.map((o, i) => ({ ...o, i }));
  const edges = new Set();
  for (let a = 0; a < ops.length; a++) {
    for (let b = a + 1; b < ops.length; b++) {
      const x = ops[a]; const y = ops[b];
      if (x.t === y.t) continue;                 // 同事务不产生边
      if (x.item !== y.item) continue;           // 不同数据不冲突
      if (x.op === 'r' && y.op === 'r') continue; // 读-读不冲突
      edges.add(`${x.t}->${y.t}`);
    }
  }
  // 环检测
  const nodes = new Set(ops.flatMap((o) => [o.t]));
  const adj = new Map([...nodes].map((n) => [n, []]));
  for (const e of edges) { const [f, t] = e.split('->'); adj.get(f).push(t); }
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map();
  let cyclic = false;
  const visit = (n) => {
    color.set(n, GRAY);
    for (const m of adj.get(n) || []) {
      const c = color.get(m) || WHITE;
      if (c === GRAY) cyclic = true;
      else if (c === WHITE) visit(m);
    }
    color.set(n, BLACK);
  };
  for (const n of nodes) if ((color.get(n) || WHITE) === WHITE) visit(n);
  return { cyclic, edges: [...edges] };
}

/** 索引实验：实际跑 EXPLAIN QUERY PLAN，看选项里声明的 helps 对不对。 */
function planUsesIndex(datasetId, query, ddl) {
  const d = dsMap.get(datasetId);
  const fresh = new Database(':memory:');
  fresh.exec(d.ddl);
  if (d.seed) fresh.exec(d.seed);
  try {
    if (ddl) fresh.exec(ddl);
    const rows = fresh.prepare(`EXPLAIN QUERY PLAN ${query}`).all();
    const text = rows.map((r) => r.detail).join(' | ');
    return { text, uses: /SEARCH/i.test(text) };
  } finally { fresh.close(); }
}

for (const l of LABS) {
  if (l.kind === 'index') {
    const p = l.payload || {};
    if (!dsMap.has(p.dataset_id)) { problems.push(`实验台 ${l.id}：数据集 ${p.dataset_id} 不存在`); continue; }
    const opts = p.options || [];
    if (!opts.length) { problems.push(`实验台 ${l.id}：没有选项`); continue; }
    if (!opts.some((o) => o.key === l.answer.pick)) { problems.push(`实验台 ${l.id}：答案 ${l.answer.pick} 不在选项里`); continue; }

    for (const o of opts) {
      try {
        const r = planUsesIndex(p.dataset_id, p.query, o.ddl);
        if (!!o.helps !== r.uses) {
          problems.push(`实验台 ${l.id} 选项 ${o.key}：声明 helps=${!!o.helps}，但 EXPLAIN 实际${r.uses ? '用上了' : '没用上'}索引 —— ${r.text}`);
        }
      } catch (e) {
        problems.push(`实验台 ${l.id} 选项 ${o.key}：执行失败 —— ${e.message}`);
      }
    }
    const winners = opts.filter((o) => o.helps).map((o) => o.key);
    if (winners.length) {
      if (!winners.includes(l.answer.pick)) {
        problems.push(`实验台 ${l.id}：正确答案 ${l.answer.pick} 并没有真正用上索引（实际能用上的是 ${winners.join('/')}）`);
      }
    } else {
      /* 没有任何选项能用上索引 —— 这时正确答案应该是"都不能"那个选项。
       * 这类题（IX03 前导通配符）恰恰是最有价值的：它教的是"索引不是万能的"。
       * 所以不能因为 winners 为空就跳过检查，而要确认答案确实指向"都不能"。 */
      const noneOpt = opts.find((o) => o.ddl == null);
      if (!noneOpt) {
        problems.push(`实验台 ${l.id}：没有任何选项能用上索引，但也没有「都不能」选项 —— 题目无解`);
      } else if (l.answer.pick !== noneOpt.key) {
        problems.push(`实验台 ${l.id}：没有任何索引能生效，正确答案应为 ${noneOpt.key}（都不能），但数据里写的是 ${l.answer.pick}`);
      }
    }
  }

  if (l.kind === 'txn') {
    const p = l.payload || {};
    if (!p.options?.some((o) => o.key === l.answer.pick)) { problems.push(`实验台 ${l.id}：答案不在选项里`); continue; }
    if (p.ask === 'serializable') {
      const r = serializable(p.schedule || []);
      const correct = r.cyclic ? 'C' : (r.edges.every((e) => e.startsWith('T1->')) ? 'A' : 'B');
      if (correct !== l.answer.pick) {
        problems.push(`实验台 ${l.id}：优先图算出答案是 ${correct}（${r.cyclic ? '有环' : '无环，边：' + r.edges.join(',')}），但数据里写的是 ${l.answer.pick}`);
      }
    }
  }

  if (l.kid && !kidSet.has(l.kid)) problems.push(`实验台 ${l.id}：考点 ${l.kid} 不存在`);
}

/* ---------- 7. 关卡引用的考点 ---------- */
for (const L of LEVELS) {
  if (L.kid && !kidSet.has(L.kid)) problems.push(`关卡 ${L.id}：考点 ${L.kid} 不存在`);
}
for (const t of NORMALIZE_TASKS) {
  if (t.kid && !kidSet.has(t.kid)) problems.push(`范式题 ${t.id}：考点 ${t.kid} 不存在`);
}

/* ---------- 输出 ---------- */
console.log('内容自检');
console.log('─'.repeat(60));
console.log(`数据集 ${DATASETS.length} 个 · 知识点 ${KNOWLEDGE.length} 个 · 依赖边 ${EDGES.length} 条`);
console.log(`关卡 ${LEVELS.length} 关 · 客观题 ${QUESTIONS.length} 道 · 范式题 ${NORMALIZE_TASKS.length} 道 · 实验台 ${LABS.length} 个`);
if (notes.length) { console.log('\n提示：'); notes.forEach((n) => console.log('  · ' + n)); }
if (problems.length) {
  console.log(`\n✗ 发现 ${problems.length} 个问题：`);
  problems.forEach((p) => console.log('  · ' + p));
  process.exit(1);
}
console.log('\n✓ 全部通过');
