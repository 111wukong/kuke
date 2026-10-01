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

/* ---------- 8. 判题必须「可失败」 ----------
 *
 * ★ 这一条守的是一类非常隐蔽的坏题：**学生什么都不做也能过关**。
 *
 * 判题流程是「跑学生的 SQL → 跑 check_sql → 返回 1 就算过」。
 * 上面第 2 节已经验过「参考答案能让 check_sql 返回 1」，
 * 但没验过反向：**在没作答的原始库上，check_sql 必须返回 0**。
 *
 * 少了这一半，一道题只要条件写得永远成立（比如题目要求删 NULL 成绩，
 * 而这个库里的 NULL 成绩本来就是 0 行），它就会变成"白送分"——
 * 页面不报错、测试全绿、学生一路点过去，学不到任何东西。
 * 实际发生过：L39 原题要求删 grade IS NULL 的记录，而 sc 表里
 * NULL 成绩是 0 行，check_sql 恒为真。
 *
 * ⚠️ **执行报错不算失败，要跳过**。有一类关卡（L38 建表题）的 check_sql
 * 引用的表是**学生自己创建的**，在原始库上必然报 no such table。
 * 把它当失败会把好题判成坏题。所以这里只认「跑出了真值」这一种情况；
 * 跳过的那几道记进 notes，保持可见。
 */
const unfalsifiableSkipped = [];
for (const L of LEVELS) {
  if (!L.check_sql) continue;
  let db;
  try {
    db = freshDb(L.dataset_id);
    const r = execAll(db, L.check_sql);
    const row = r[r.length - 1].rows[0];
    const val = row ? Object.values(row)[0] : undefined;
    if (val) {
      problems.push(
        `关卡 ${L.id}：check_sql 在**未作答**的库上就返回了真值（${JSON.stringify(val)}）—— `
        + '这道题什么都不做也能通过。多半是题目条件指向了数据集里本来就不存在的情况。',
      );
    }
  } catch {
    /* 学生要自己建表/建视图的关卡，原始库上跑不了 check_sql —— 正常 */
    unfalsifiableSkipped.push(L.id);
  } finally { db?.close(); }
}
if (unfalsifiableSkipped.length) {
  notes.push(`「可失败性」检查跳过了 ${unfalsifiableSkipped.join('/')}（它们的 check_sql 依赖学生自己建的对象）`);
}

/* ---------- 9. 知识点的示例 SQL 必须能跑 ----------
 *
 * catalog.js 的文件头写着「sql_demo 必须能在它所属的 dataset 上跑通 ——
 * tests/content.mjs 会验证」，但**这条验证一直没写**。
 * 缺了它的症状是：知识点正文里那个「在实训场里跑」按钮点下去直接报错，
 * 而报错发生在学生面前，不在 CI 里。
 *
 * 所以补上。顺带验 dataset 引用是否存在 —— 引用错了会静默跑到别的库上。
 */
let demoCount = 0;
for (const k of KNOWLEDGE) {
  if (!k.sql_demo) continue;
  demoCount++;
  if (!k.sql_demo_dataset) {
    problems.push(`知识点 ${k.id}：有 sql_demo 但没写 sql_demo_dataset`);
    continue;
  }
  if (!dsMap.has(k.sql_demo_dataset)) {
    problems.push(`知识点 ${k.id}：sql_demo_dataset「${k.sql_demo_dataset}」不存在`);
    continue;
  }
  let db;
  try {
    db = freshDb(k.sql_demo_dataset);
    db.prepare(k.sql_demo).all();
  } catch (e) {
    problems.push(`知识点 ${k.id}：sql_demo 跑不通 —— ${e.message}`);
  } finally { db?.close(); }
}

/* ---------- 10. 「内容里对引擎行为的断言」与引擎对账 ----------
 *
 * ★ 这一条是这个项目里最有价值的一类检查，值得单独解释。
 *
 * 数据库课的内容里，有一大批陈述是**可以拿引擎直接验证的**：
 * 「这个写法会让索引失效」「这个查询返回空集」「这条语句会报错」。
 * 它们最容易出错，因为它们**看起来都对**（符合教材、符合 MySQL 经验），
 * 而学生只要在本平台的实训场里跑一遍就能发现是错的 ——
 * 那一刻他不会再信这个平台上的任何一句话。
 *
 * 实测已经抓到过四条：
 *   · `LIKE '张%'` 在 SQLite 上并不走索引（教材说走）
 *   · `sno = 2021001`（TEXT 列给数字）在 SQLite 上照样走索引（MySQL 上不走）
 *   · `deptno = 10 OR sal > 20000` 在 SQLite 上有 MULTI-INDEX OR（老 MySQL 上不走）
 *   · 非聚合列别名在 SQLite 的 WHERE 里能用（标准 SQL 里不能）
 *
 * 所以这里把「内容里声明过的行为」列成一张表，逐条真跑。
 * 内容改了、SQLite 升级了，这张表都会红。
 */
const ENGINE_CLAIMS = [
  // —— 索引：确实失效的 ——
  { db: 'company', setup: ['CREATE INDEX c1 ON emp(sal)'], sql: 'SELECT * FROM emp WHERE sal + 100 > 20000', expect: 'SCAN', why: '列上做运算 → 全表扫描' },
  { db: 'company', setup: ['CREATE INDEX c2 ON emp(hiredate)'], sql: "SELECT * FROM emp WHERE substr(hiredate,1,4) = '2022'", expect: 'SCAN', why: '列上套函数 → 全表扫描' },
  { db: 'company', setup: ['CREATE INDEX c3 ON emp(ename)'], sql: "SELECT * FROM emp WHERE ename LIKE '%伟'", expect: 'SCAN', why: '前导通配符 → 全表扫描' },
  // —— 索引：**教材说失效、SQLite 上其实没失效**的 ——
  { db: 'company', setup: ['CREATE INDEX c4 ON emp(ename)'], sql: "SELECT * FROM emp WHERE ename LIKE '张%'", expect: 'SCAN', why: '后缀通配符在 SQLite 上也不走索引（BINARY 索引 vs 大小写不敏感的 LIKE）' },
  { db: 'company', setup: ['CREATE INDEX c5 ON emp(ename COLLATE NOCASE)'], sql: "SELECT * FROM emp WHERE ename LIKE '张%'", expect: 'SEARCH', why: '索引建成 NOCASE 之后 LIKE 前缀才走索引' },
  { db: 'company', setup: ['CREATE INDEX c6 ON emp(ename)'], sql: "SELECT * FROM emp WHERE ename GLOB '张*'", expect: 'SEARCH', why: 'GLOB 区分大小写，能直接用 BINARY 索引' },
  { db: 'company', setup: ['CREATE INDEX c7 ON emp(ename)'], sql: "SELECT * FROM emp WHERE ename >= '张' AND ename < '张' || char(0x10FFFF)", expect: 'SEARCH', why: '手工范围条件是最通用的前缀匹配写法' },
  { db: 'company', setup: ['CREATE INDEX c8 ON emp(deptno)', 'CREATE INDEX c9 ON emp(sal)'], sql: 'SELECT * FROM emp WHERE deptno = 10 OR sal > 20000', expect: 'MULTI-INDEX OR', why: 'SQLite 有 MULTI-INDEX OR，不会退化成全表扫描' },
  // —— 索引：类型不匹配在 SQLite 上不影响索引 ——
  { db: 'school', setup: ['CREATE INDEX c10 ON sc(sno)'], sql: 'SELECT * FROM sc WHERE sno = 2021001', expect: 'SEARCH', why: 'SQLite 把无亲和性的字面量按列的类型处理，索引照用（MySQL 上才会失效）' },
  // —— 别名在 WHERE 里（SQLite 宽松） ——
  { db: 'school', setup: [], sql: 'SELECT sage AS 年龄 FROM student WHERE 年龄 > 20', expect: 'OK', why: 'SQLite 允许 WHERE 用 SELECT 别名；标准 SQL / PostgreSQL 不允许' },
];
for (const c of ENGINE_CLAIMS) {
  let db;
  try {
    db = freshDb(c.db);
    for (const s of c.setup) db.exec(s);
    if (c.expect === 'OK') {
      db.prepare(c.sql).all();
    } else {
      const text = db.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all().map((r) => r.detail).join(' | ');
      if (!text.includes(c.expect)) {
        problems.push(`引擎行为对账失败：${c.why}\n      语句 ${c.sql}\n      期望计划里含「${c.expect}」，实际：${text}`);
      }
    }
  } catch (e) {
    problems.push(`引擎行为对账失败（执行报错）：${c.why}\n      语句 ${c.sql}\n      ${e.message}`);
  } finally { db?.close(); }
}

/* ---------- 11. 「内容里引用的数字」与数据集对账 ----------
 * 正文和解析里会写具体数字（"14 行 vs 6 个有奖金的"）。
 * 数字最容易在改数据集时过期，而过期之后没有任何东西会红 ——
 * 只有学生会发现"平台上说的和跑出来的不一样"。
 * 这里把内容里**承诺过的**数字列出来逐条验。
 * 加一条的成本很低，漏一条的代价是信任。 */
const NUMBER_CLAIMS = [
  { db: 'company', sql: 'SELECT COUNT(*) c FROM emp', want: 14, why: 'k-aggregate / Q019：emp 有 14 行' },
  { db: 'company', sql: 'SELECT COUNT(comm) c FROM emp', want: 6, why: 'k-aggregate / Q019：有奖金（comm 非空）的是 6 个' },
  { db: 'company', sql: 'SELECT COUNT(*) c FROM emp WHERE comm IS NULL', want: 8, why: 'Q019：comm 为 NULL 的是 8 行' },
  { db: 'company', sql: 'SELECT ROUND(AVG(comm),2) c FROM emp', want: 2616.67, why: 'k-aggregate：AVG(comm) = 2616.67' },
  { db: 'company', sql: 'SELECT ROUND(AVG(COALESCE(comm,0)),2) c FROM emp', want: 1121.43, why: 'k-aggregate：AVG(COALESCE(comm,0)) = 1121.43' },
  { db: 'company', sql: 'SELECT COUNT(*) c FROM emp WHERE mgr IS NULL', want: 1, why: 'L30：总经理只有 1 个（没有上级）' },
  { db: 'school', sql: 'SELECT COUNT(DISTINCT sdept) c FROM student', want: 3, why: 'L45：系的数量（题面曾写"四个系"，实际三个）' },
  { db: 'school', sql: 'SELECT COUNT(*) c FROM sc', want: 26, why: 'k-subquery：sc 表 26 行' },
  { db: 'school', sql: 'SELECT COUNT(*) c FROM sc WHERE grade < 60', want: 1, why: 'L39：不及格记录 1 条（题目改成删它才有意义）' },
  { db: 'school', sql: 'SELECT COUNT(*) c FROM sc WHERE grade IS NULL', want: 0, why: 'L39 的教训：这个库里没有 NULL 成绩，所以删 NULL 是空操作' },
  { db: 'school', sql: 'SELECT COUNT(*) c FROM student', want: 11, why: 'L01：学生 11 人' },
  { db: 'shop', sql: 'SELECT unit_price FROM order_item WHERE oid = 1012 AND pid = 103', want: 1199, why: 'L20：订单 1012 商品 103 成交价 1199' },
  { db: 'shop', sql: 'SELECT price FROM product WHERE pid = 103', want: 1299, why: 'L20：商品 103 现价 1299（成交价与现价不同，这是本题的教学点）' },
];
for (const c of NUMBER_CLAIMS) {
  let db;
  try {
    db = freshDb(c.db);
    const row = db.prepare(c.sql).get();
    const got = row ? Object.values(row)[0] : undefined;
    if (got !== c.want) {
      problems.push(`数字对账失败：${c.why}\n      期望 ${c.want}，实际 ${got}`);
    }
  } catch (e) {
    problems.push(`数字对账失败（执行报错）：${c.why} —— ${e.message}`);
  } finally { db?.close(); }
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
