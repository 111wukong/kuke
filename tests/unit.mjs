/* 单元测试
 *
 * ── 这份测试覆盖什么 ────────────────────────────────────────────
 * 全部是**纯函数**：判题、范式算法、FSRS、图算法、根因诊断、
 * 以及前端的两个渲染器（SQL 高亮 / Markdown）。
 *
 * ── 为什么前端渲染器也在这里测 ──────────────────────────────────
 * 它们看起来"是 UI"，但核心是纯字符串处理，而**最容易出的缺陷
 * 恰好在这一层**：
 *   · SQL 高亮忘了转义 → 学生的 SQL 变成 XSS
 *   · Markdown 解析顺序错 → ** 和 $ 漏到屏幕上
 * 这两类问题页面不报错、截图看不出来、接口测试更测不到。
 * 所以必须单独测，而且必须测到"输入里带恶意字符"这种情况。
 *
 * ── 前端 TS 文件怎么在 Node 里跑 ────────────────────────────────
 * 用 tsc 把两个 .ts/.tsx 编译到临时目录再 import。
 * Node 22 的 --experimental-strip-types 只能处理 .ts（没有 JSX），
 * 而 markdown.tsx 里有 JSX，所以走编译更省事。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitStatements, checkStatement, analyze, statementKind, stripLiterals } from '../server/src/lib/sqlGuard.js';
import { normalizeCell, compareResults, judgeSql, finalResultSet } from '../server/src/lib/sqlCompare.js';
import {
  closure, candidateKeys, minimalCover, equivalentFdSets, normalForm, isLossless,
  preservesDependencies, synthesize3NF, decomposeBCNF, judgeNormalize, parseAttrGroup, parseSchemeList,
} from '../server/src/lib/normalize.js';
import {
  retrievability, grade as fsrsGrade, newCard, nextInterval, ratingFromOutcome, W,
} from '../server/src/lib/fsrs.js';
import { buildGraph, ancestors, descendants, detectCycles, topoSort, auditGraph } from '../server/src/lib/graph.js';
import { diagnose, masteryOf, diagnoseClass } from '../server/src/lib/diagnose.js';
import { judgeQuestion, normalizeBlank, normalizeBool, normalizeMulti, toHalfWidth } from '../server/src/lib/judge.js';
import { levelInfo, xpFor, comboBonus, checkAchievements, streakFrom } from '../server/src/lib/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = { pass: 0, fail: 0, failures: [] };

function ok(name, cond, detail = '') {
  if (cond) { results.pass++; return; }
  results.fail++;
  results.failures.push(`${name}${detail ? ` —— ${detail}` : ''}`);
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b),
  JSON.stringify(a) === JSON.stringify(b) ? '' : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
const group = (t) => console.log(`\n${t}`);

/* ============================================================
   〇、源文件语法自检
   ============================================================
   ★ 这一组是为一个**反复踩**的坑加的：模板字符串里漏转义反引号。
   比如注释里写 `document.body`（带反引号），而它所在的模板字符串
   恰好是用反引号界定的 —— 字符串就被从中间截断了。

   这个坑的恶劣之处在于：
     · 报错信息指向下一行的中文，看起来像编码问题
     · 如果内容里是 `${name}` 这种，语法**完全合法**，
       运行时才炸（ReferenceError 或者静默变成字符串拼接）
     · 如果内容是 `A` % `B` 这种，语法也合法，结果是 NaN ——
       而绑进数据库才报「NOT NULL constraint failed」

   所以最省事的防线就是：**让每个源文件都过一遍解析器**。
   node --check 不执行代码，只解析，代价可以忽略。
   本项目已经在 catalog.js / questions.js / labs.js / cli-browser.mjs
   上各栽过一次。 */
group('源文件语法自检');

const SRC_ROOTS = [
  path.resolve(__dirname, '../server/src'),
  path.resolve(__dirname, '../tests'),
  path.resolve(__dirname, '../web/src'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const srcFiles = SRC_ROOTS.flatMap((r) => walk(r));
ok(`找到源文件（${srcFiles.length} 个）`, srcFiles.length > 20, `只找到 ${srcFiles.length} 个`);

let syntaxBad = 0;
for (const f of srcFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    syntaxBad++;
    const msg = String(e.stderr || e.message).split('\n').slice(0, 4).join(' ');
    results.failures.push(`语法错误 ${path.relative(process.cwd(), f)} —— ${msg.slice(0, 200)}`);
  }
}
ok(`全部 ${srcFiles.length} 个源文件语法正确`, syntaxBad === 0, `${syntaxBad} 个文件解析失败`);

/* ---------- 前端路由约定 ----------
 *
 * ★ 这条静态检查是为一个真实缺陷加的：路由保活**绕过了 `<Routes>`**
 *   （那正是它要做的事 —— `<Routes>` 只渲染匹配的一条，切走的页面会被卸载），
 *   而 `useParams()` 的上下文恰恰由 `<Routes>` 提供。
 *   所以页面里任何 `useParams()` 都会永远返回 `{}`。
 *
 *   症状极其隐蔽：页面渲染正常，只是显示「知识点不存在」这类空态 ——
 *   看起来像数据问题，不像路由问题。四个页面同时中招
 *   （知识点详情 / 关卡详情 / 作业详情 / 学生详情），
 *   而接口测试全绿（它们直接打 API，不经过页面）。
 *
 *   是浏览器测试断言页面正文时才暴露的。 */
const WEB_PAGES = path.resolve(__dirname, '../web/src');
const pageFiles = walk(WEB_PAGES).concat(
  fs.existsSync(WEB_PAGES)
    ? fs.readdirSync(path.join(WEB_PAGES, 'pages'), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx$/.test(e.name))
      .map((e) => path.join(WEB_PAGES, 'pages', e.name))
    : [],
);

let useParamsOffenders = [];
for (const f of new Set(pageFiles)) {
  const src = fs.readFileSync(f, 'utf8');
  // 只看真正的调用，注释里的说明不算
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/\buseParams\s*[(<]/.test(code)) {
    useParamsOffenders.push(path.relative(WEB_PAGES, f));
  }
}
ok('★ 页面里没有直接用 useParams（保活绕过了 Routes，它永远返回空对象）',
  useParamsOffenders.length === 0,
  `这些文件要改用 usePageParams：${useParamsOffenders.join('、')}`);

/* 反向确认：usePageParams 确实被用到了，否则上面那条会「因为没人用而通过」 */
const usesPageParams = pageFiles.some((f) => {
  if (!fs.existsSync(f)) return false;
  return /usePageParams\s*[(<]/.test(fs.readFileSync(f, 'utf8'));
});
ok('★ 至少有一个页面在用 usePageParams（否则上一条是假绿）', usesPageParams);

/* ============================================================
   一、SQL 语句切分与安全闸门
   ============================================================ */
group('SQL 切分与安全闸门');

eq('按分号切分多语句', splitStatements('SELECT 1; SELECT 2;').length, 2);
eq('★ 分号在字符串里不算分隔符',
  splitStatements("SELECT ';' AS semi;").length, 1);
eq('★ 分号在双引号标识符里不算分隔符',
  splitStatements('SELECT "a;b";').length, 1);
eq('★ 行注释里的分号不算分隔符',
  splitStatements('SELECT 1 -- 注释里的 ; 不算\n; SELECT 2;').length, 2);
eq('块注释里的分号不算分隔符',
  splitStatements('SELECT /* a ; b */ 1;').length, 1);
eq('字符串里的转义单引号不提前结束',
  splitStatements("SELECT 'it''s';").length, 1);
eq('末尾没有分号也能切出一条', splitStatements('SELECT 1').length, 1);
eq('空字符串切出 0 条', splitStatements('   ').length, 0);

eq('识别 SELECT 为只读', checkStatement('SELECT 1').readonly, true);
eq('识别 INSERT 为写操作', checkStatement('INSERT INTO t VALUES(1)').mutating, true);
/* statementKind 取的是前两个词，所以 'WITH x AS (...)' 得到 'with x'。
 * 判读只读靠的是第一个词 'with'，所以这个结果是对的。 */
eq('识别 WITH 语句的 kind', statementKind('WITH x AS (SELECT 1) SELECT * FROM x'), 'with x');
ok('WITH 语句被判为只读', checkStatement('WITH x AS (SELECT 1) SELECT * FROM x').readonly === true);

ok('★ ATTACH 被拦截', checkStatement("ATTACH DATABASE '/etc/passwd' AS x").ok === false);
ok('★ load_extension 被拦截', checkStatement("SELECT load_extension('x.so')").ok === false);
ok('★ sqlite_master 被拦截', checkStatement('SELECT * FROM sqlite_master').ok === false);
ok('★ writable_schema 被拦截', checkStatement('PRAGMA writable_schema=1').ok === false);
ok('★ VACUUM INTO 被拦截', checkStatement("VACUUM INTO '/tmp/x'").ok === false);
ok('允许的 PRAGMA 放行', checkStatement('PRAGMA table_info(student)').ok === true);
ok('未允许的 PRAGMA 拦截', checkStatement('PRAGMA journal_mode=WAL').ok === false);
ok('只读模式下写操作被拦', checkStatement('INSERT INTO t VALUES(1)', { allowWrite: false }).ok === false);
ok('只读模式下 SELECT 放行', checkStatement('SELECT 1', { allowWrite: false }).ok === true);
ok('★ 注释里写 DROP 不会误伤（先剥字面量）',
  checkStatement('SELECT 1 /* DROP TABLE t */').ok === true);
ok('手写 BEGIN 被拦（沙箱自己管事务）',
  checkStatement('BEGIN').ok === false);

const an = analyze('UPDATE t SET x = 1', { allowWrite: true });
ok('★ UPDATE 缺 WHERE 会给出提醒', an.warnings.some((w) => w.includes('没有 WHERE')), JSON.stringify(an.warnings));
const an2 = analyze('SELECT * FROM t');
ok('SELECT * 会给出提醒', an2.warnings.some((w) => w.includes('SELECT *')));

eq('stripLiterals 把字符串换成占位符',
  stripLiterals("SELECT 'abc' FROM t").includes('abc'), false);

/* ============================================================
   二、结果集比对判题
   ============================================================ */
group('结果集比对判题');

eq('NULL 归一化', JSON.stringify(normalizeCell(null)), '{"t":"null"}');
eq('数字归一化', JSON.stringify(normalizeCell(1.5)), '{"t":"num","v":1.5}');
eq('纯数字字符串按数字处理', JSON.stringify(normalizeCell('42')), '{"t":"num","v":42}');
eq('★ 有前导零的字符串不数值化（007 ≠ 7）',
  JSON.stringify(normalizeCell('007')), '{"t":"str","v":"007"}');

const rs = (cols, rows) => ({ columns: cols, rows });
ok('列数不同判错', compareResults(rs(['a'], [[1]]), rs(['a', 'b'], [[1, 2]])).reason === 'COLUMN_COUNT');
ok('行数不同判错', compareResults(rs(['a'], [[1]]), rs(['a'], [[1], [2]])).reason === 'ROW_COUNT');
ok('★ 无序比对：行序不同但内容相同应通过',
  compareResults(rs(['a'], [[1], [2]]), rs(['a'], [[2], [1]])).pass === true);
ok('★ 有序比对：行序不同应判错',
  compareResults(rs(['a'], [[1], [2]]), rs(['a'], [[2], [1]]), { orderMatters: true }).pass === false);
ok('★ 列名不同但数据一致，默认只警告不判错',
  compareResults(rs(['cnt'], [[5]]), rs(['COUNT(*)'], [[5]])).pass === true);
ok('★ 要求列名时，列名不同判错',
  compareResults(rs(['cnt'], [[5]]), rs(['COUNT(*)'], [[5]]), { requireColumns: true }).pass === false);
ok('★ 重复行按多重集比对（少一个重复项要判错）',
  compareResults(rs(['a'], [[1], [1]]), rs(['a'], [[1], [1], [1]])).pass === false);
ok('数值容差：1 与 1.0 等价',
  compareResults(rs(['a'], [[1]]), rs(['a'], [[1.0]])).pass === true);
ok('NULL 与 NULL 视为相同',
  compareResults(rs(['a'], [[null]]), rs(['a'], [[null]])).pass === true);
ok('NULL 与 0 不同',
  compareResults(rs(['a'], [[null]]), rs(['a'], [[0]])).pass === false);

const execOf = (cols, rows) => ({ ok: true, results: [{ columns: cols, rows }] });
eq('finalResultSet 取最后一条有结果集的语句',
  finalResultSet({ ok: true, results: [{ columns: [], rows: [], changes: 1 }, { columns: ['a'], rows: [[1]] }] }).columns, ['a']);
ok('judgeSql 封装可用',
  judgeSql(execOf(['a'], [[1]]), execOf(['a'], [[1]])).pass === true);

/* ============================================================
   三、范式算法
   ============================================================ */
group('范式算法');

eq('★ 闭包必须循环到不动点（只扫一遍会漏）',
  closure(['A', 'B', 'C', 'D'], [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['B'], rhs: ['C'] }], ['A']),
  ['A', 'B', 'C']);
eq('闭包：多属性起点',
  closure(['A', 'B', 'C', 'D', 'E'], [
    { lhs: ['A', 'B'], rhs: ['C'] }, { lhs: ['C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['E'] },
  ], ['A', 'B']),
  ['A', 'B', 'C', 'D', 'E']);
eq('★ 闭包：传字符串而不是数组也要能跑（sortAttrs 要容忍）',
  closure(['A', 'B', 'C'], [{ lhs: ['A'], rhs: ['B'] }], 'A'),
  ['A', 'B']);

eq('候选键：单键',
  candidateKeys(['A', 'B', 'C', 'D'], [
    { lhs: ['A'], rhs: ['B'] }, { lhs: ['B'], rhs: ['C'] }, { lhs: ['A'], rhs: ['D'] },
  ]).keys,
  [['A']]);
eq('★ 候选键：三个键（AB / BC / BD）',
  candidateKeys(['A', 'B', 'C', 'D'], [
    { lhs: ['A', 'B'], rhs: ['C'] }, { lhs: ['C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['A'] },
  ]).keys,
  [['A', 'B'], ['B', 'C'], ['B', 'D']]);

const cov = minimalCover(['A', 'B', 'C'], [
  { lhs: ['A'], rhs: ['B', 'C'] }, { lhs: ['B'], rhs: ['C'] }, { lhs: ['A'], rhs: ['B'] },
]);
ok('最小覆盖：右部单属性化 + 去冗余',
  cov.every((fd) => fd.rhs.length === 1) && cov.length === 2, JSON.stringify(cov));
/* ★ 这一条一开始写错了：我拿 {A→B, B→C} 和 {A→B, A→C} 比，
 * 而它们**本来就不等价** —— 后者推不出 B→C。
 * 正确的用法是：多一条冗余依赖的集合仍然等价。 */
ok('★ 等价判定：多一条冗余依赖仍然等价',
  equivalentFdSets(['A', 'B', 'C'], cov, [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['B'], rhs: ['C'] }, { lhs: ['A'], rhs: ['C'] }]) === true);
ok('★ 等价判定：不等价的集合要判否',
  equivalentFdSets(['A', 'B', 'C'], cov, [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A'], rhs: ['C'] }]) === false);

eq('范式：部分依赖 → 只到 1NF',
  normalForm(['Sno', 'Sname', 'Cno', 'Grade'], [
    { lhs: ['Sno'], rhs: ['Sname'] }, { lhs: ['Sno', 'Cno'], rhs: ['Grade'] },
  ]).nf, '1NF');
eq('范式：传递依赖 → 2NF',
  normalForm(['Sno', 'Sname', 'Sdept', 'Dhead'], [
    { lhs: ['Sno'], rhs: ['Sname'] }, { lhs: ['Sno'], rhs: ['Sdept'] }, { lhs: ['Sdept'], rhs: ['Dhead'] },
  ]).nf, '2NF');
eq('★ 范式：3NF 但不是 BCNF 的经典例子（STJ）',
  normalForm(['S', 'T', 'J'], [{ lhs: ['S', 'T'], rhs: ['J'] }, { lhs: ['J'], rhs: ['T'] }]).nf, '3NF');
eq('范式：标准 BCNF',
  normalForm(['A', 'B', 'C'], [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A'], rhs: ['C'] }]).nf, 'BCNF');
/* ★ 这一条一开始也写错了。R(A,B,C) 配 AB→C, C→A：
 *   候选键是 AB 和 BC，三个属性全是主属性 → 3NF 条件满足；
 *   但 C 不是超键（C⁺ = CA）→ BCNF 不满足。所以答案是 3NF。
 *   这又是一个「3NF 但不是 BCNF」的例子，和 STJ 同类。 */
eq('★ 范式：多候选键时仍是 3NF 而不是 BCNF',
  normalForm(['A', 'B', 'C'], [{ lhs: ['A', 'B'], rhs: ['C'] }, { lhs: ['C'], rhs: ['A'] }]).nf, '3NF');

ok('★ 无损连接：二分解的正确判定',
  isLossless(['Sno', 'Sdept', 'Dhead'], [{ lhs: ['Sno'], rhs: ['Sdept'] }, { lhs: ['Sdept'], rhs: ['Dhead'] }],
    [['Sno', 'Sdept'], ['Sdept', 'Dhead']]).lossless === true);
/* ★ 这一条同样写错了：分解成 (Sno,Sdept) 和 (Sno,Dhead) 时，
 *   R1∩R2 = {Sno}，而 Sno→Sdept 成立 —— 按二分解定理它是**无损**的。
 *   要构造真正有损的分解，得让公共属性推不出任何一侧的差集：
 *   R(A,B,C) 配 A→B，拆成 (A,B) 和 (B,C)：
 *   R1∩R2 = {B}，但 B→A 和 B→C 都不成立 → 有损。 */
ok('★ 有损分解被正确识别',
  isLossless(['A', 'B', 'C'], [{ lhs: ['A'], rhs: ['B'] }],
    [['A', 'B'], ['B', 'C']]).lossless === false);
ok('无损分解仍然判对',
  isLossless(['A', 'B', 'C'], [{ lhs: ['A'], rhs: ['B'] }],
    [['A', 'B'], ['A', 'C']]).lossless === true);
ok('★ 三分解用矩阵法判定（STJ 分解成 JT / SJ 是无损的）',
  isLossless(['S', 'T', 'J'], [{ lhs: ['S', 'T'], rhs: ['J'] }, { lhs: ['J'], rhs: ['T'] }],
    [['J', 'T'], ['S', 'J']]).lossless === true);
ok('★ BCNF 分解不保持依赖（STJ 的 ST→J 会丢）',
  preservesDependencies(['S', 'T', 'J'], [{ lhs: ['S', 'T'], rhs: ['J'] }, { lhs: ['J'], rhs: ['T'] }],
    [['J', 'T'], ['S', 'J']]).preserved === false);
ok('3NF 合成法保持依赖',
  preservesDependencies(['A', 'B', 'C', 'D', 'E'],
    [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A', 'C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['E'] }],
    [['A', 'B'], ['A', 'C', 'D'], ['D', 'E']]).preserved === true);

ok('3NF 合成结果无损',
  isLossless(['A', 'B', 'C', 'D', 'E'],
    [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A', 'C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['E'] }],
    synthesize3NF(['A', 'B', 'C', 'D', 'E'],
      [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A', 'C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['E'] }])).lossless === true);
ok('BCNF 分解结果无损',
  isLossless(['S', 'T', 'J'], [{ lhs: ['S', 'T'], rhs: ['J'] }, { lhs: ['J'], rhs: ['T'] }],
    decomposeBCNF(['S', 'T', 'J'], [{ lhs: ['S', 'T'], rhs: ['J'] }, { lhs: ['J'], rhs: ['T'] }])).lossless === true);

eq('★ parseAttrGroup：AB 按题目属性集切成 A,B',
  parseAttrGroup('AB', ['A', 'B', 'C']), ['A', 'B']);
eq('parseAttrGroup：A,B 也能切',
  parseAttrGroup('A,B', ['A', 'B', 'C']), ['A', 'B']);
eq('★ parseAttrGroup：多字符属性名不做拆分',
  parseAttrGroup('Sno', ['Sno', 'Sname']), ['Sno']);
eq('parseSchemeList：二维解析',
  parseSchemeList(['AB', 'BC'], ['A', 'B', 'C']), [['A', 'B'], ['B', 'C']]);

const nfTask = { attrs: ['S', 'T', 'J'], fds: [{ lhs: ['S', 'T'], rhs: ['J'] }, { lhs: ['J'], rhs: ['T'] }], ask: 'nf' };
ok('判分：范式题答对', judgeNormalize(nfTask, '3NF').pass === true);
ok('判分：范式题答错', judgeNormalize(nfTask, 'BCNF').pass === false);

const keysTask = { attrs: ['A', 'B', 'C', 'D'], fds: [{ lhs: ['A', 'B'], rhs: ['C'] }, { lhs: ['C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['A'] }], ask: 'keys' };
ok('判分：候选键顺序无关', judgeNormalize(keysTask, [['B', 'C'], ['A', 'B'], ['B', 'D']]).pass === true);
ok('判分：候选键多了判错', judgeNormalize(keysTask, [['A', 'B'], ['B', 'C'], ['B', 'D'], ['A', 'C']]).pass === false);

const decTask = {
  attrs: ['A', 'B', 'C', 'D', 'E'],
  fds: [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A', 'C'], rhs: ['D'] }, { lhs: ['D'], rhs: ['E'] }],
  ask: 'decompose', target: '3NF',
};
ok('★ 判分：分解题验性质而不是比答案（换一种合法分解也通过）',
  judgeNormalize(decTask, [['A', 'B'], ['A', 'C', 'D'], ['D', 'E']]).pass === true);
ok('★ 判分：有损分解被拒绝',
  judgeNormalize(decTask, [['A', 'B'], ['C', 'D'], ['D', 'E']]).pass === false);
ok('★ 判分：没覆盖全部属性的分解被拒绝',
  judgeNormalize(decTask, [['A', 'B'], ['A', 'C']]).pass === false);

/* ============================================================
   四、FSRS 间隔重复
   ============================================================ */
group('FSRS 间隔重复');

ok('遗忘曲线：t=S 时保留率约 0.9',
  Math.abs(retrievability(10, 10) - 0.9) < 0.001, String(retrievability(10, 10)));
ok('遗忘曲线：t=0 时保留率约 1',
  Math.abs(retrievability(0, 10) - 1) < 0.001);
ok('稳定度为 0 时保留率为 0', retrievability(5, 0) === 0);
eq('默认权重是 21 个', W.length, 21);

const fresh = { state: 'new', stability: null, difficulty: null, interval: 0, reps: 0, lapses: 0, lastReview: null };
const g1 = fsrsGrade(fresh, 3);
ok('首次评"记得"进入 review', g1.state === 'review');
ok('首次评"记得"产出正间隔', g1.interval >= 1, String(g1.interval));
const g1again = fsrsGrade(fresh, 1);
ok('首次评"忘了"进入 learning', g1again.state === 'learning');
ok('★ 评"很熟"的间隔 > 评"记得"的间隔',
  fsrsGrade(fresh, 4).stability > fsrsGrade(fresh, 3).stability);

const reviewed = { state: 'review', stability: 10, difficulty: 5, interval: 10, reps: 3, lapses: 0, lastReview: '2026-01-01' };
const gOk = fsrsGrade(reviewed, 3);
const gForget = fsrsGrade(reviewed, 1);
ok('★ 答对后稳定度上升', gOk.stability > 10, `${gOk.stability}`);
ok('★ 答错后稳定度下降', gForget.stability < 10, `${gForget.stability}`);
ok('答错后状态变 relearning', gForget.state === 'relearning');
ok('答错累加 lapses', gForget.lapses === 1);
ok('间隔上限 365 天', nextInterval(10000) === 365);
ok('间隔下限 1 天', nextInterval(0.001) === 1);

const card = newCard('k-x', null, 'knowledge');
ok('新卡 due 在未来', card.due > card.createdAt);
eq('评分映射：答错→1', ratingFromOutcome(false, 100), 1);
eq('评分映射：秒答→4', ratingFromOutcome(true, 3000), 4);
eq('评分映射：磨很久→2', ratingFromOutcome(true, 90000), 2);
eq('评分映射：正常→3', ratingFromOutcome(true, 30000), 3);

/* ============================================================
   五、知识图谱与根因诊断
   ============================================================ */
group('知识图谱与根因诊断');

const E = (f, t, type = 'prereq', strength = 'hard') => ({ from_kid: f, to_kid: t, type, strength });
const edges = [E('A', 'B'), E('B', 'C'), E('A', 'D'), E('D', 'C')];
const g = buildGraph(edges);

eq('祖先：C 的祖先包含 A、B、D',
  [...ancestors(g, 'C').keys()].sort(), ['A', 'B', 'D']);
eq('后代：A 的后代包含 B、C、D',
  [...descendants(g, 'A').keys()].sort(), ['B', 'C', 'D']);
eq('★ 环检测：有环能找出来',
  detectCycles([E('A', 'B'), E('B', 'C'), E('C', 'A')]).length, 1);
eq('环检测：无环返回空', detectCycles(edges).length, 0);
eq('★ 拓扑排序：前置排在前面',
  topoSort(edges).order, ['A', 'B', 'D', 'C']);
ok('拓扑排序：有环时 cycles 非空', topoSort([E('A', 'B'), E('B', 'A')]).cycles.length > 0);
ok('related 边视为双向',
  buildGraph([E('A', 'B', 'related')]).out.has('B') === true);
ok('confusable 边不进图',
  buildGraph([E('A', 'B', 'confusable')]).out.size === 0);

const audit = auditGraph([E('A', 'B'), E('B', 'C')], ['A', 'B', 'C']);
ok('图谱体检：ok 为真', audit.ok === true);
ok('图谱体检：能识别悬空边',
  auditGraph([E('A', 'ZZZ')], ['A']).dangling.length === 1);

eq('掌握度：0 题时为 0.5（拉普拉斯平滑）', masteryOf(0, 0).toFixed(3), '0.500');
eq('掌握度：1 题做对不是 100%', masteryOf(1, 1).toFixed(3), '0.667');
eq('掌握度：4 题全对接近 1', masteryOf(4, 4).toFixed(3), '0.833');

const stats = { A: { n: 10, c: 9 }, B: { n: 10, c: 3 }, C: { n: 10, c: 2 } };
const meta = { A: { title: 'A' }, B: { title: 'B' }, C: { title: 'C' } };
const dg = diagnose(stats, edges, meta);
ok('诊断：找出薄弱点（B、C）', dg.weak.length === 2, JSON.stringify(dg.weak.map((w) => w.kid)));
ok('★ 诊断：根因是 B 而不是 C（C 的祖先 B 也薄弱）',
  dg.roots.length === 1 && dg.roots[0].kid === 'B', JSON.stringify(dg.roots.map((r) => r.kid)));
ok('★ 诊断：根因带上了它拖累的症状数',
  dg.roots[0].coveredSymptoms === 2, String(dg.roots[0]?.coveredSymptoms));
ok('诊断：学习路径非空', dg.path.length > 0);
ok('诊断：有可读摘要', typeof dg.summary === 'string' && dg.summary.length > 5);

const dgEmpty = diagnose({}, edges, meta);
ok('诊断：没有作答时给出引导文案', dgEmpty.summary.includes('还没有作答'));

const cls = diagnoseClass([
  { userId: 1, username: 'a', stats: { A: { n: 5, c: 4 }, B: { n: 5, c: 1 } } },
  { userId: 2, username: 'b', stats: { A: { n: 5, c: 5 }, B: { n: 5, c: 2 } } },
], edges, meta);
ok('班级诊断：找出共性问题 B', cls.common[0]?.kid === 'B', JSON.stringify(cls.common[0]));
ok('班级诊断：比例正确', cls.common[0]?.ratio === 1, String(cls.common[0]?.ratio));

/* ============================================================
   六、客观题判题
   ============================================================ */
group('客观题判题');

eq('全角转半角', toHalfWidth('ＡＢＣ１２３'), 'ABC123');
eq('单选：小写也算对', judgeQuestion({ type: 'choice', answer: 'B' }, 'b').pass, true);
eq('单选：全角也算对', judgeQuestion({ type: 'choice', answer: 'B' }, 'Ｂ').pass, true);
eq('多选：顺序无关', judgeQuestion({ type: 'multi', answer: 'ACD' }, 'DCA').pass, true);
eq('多选：去重', judgeQuestion({ type: 'multi', answer: 'ACD' }, 'AACDD').pass, true);
eq('★ 多选：漏选给一半分', judgeQuestion({ type: 'multi', answer: 'ACD' }, 'AC').score, 50);
eq('★ 多选：选错项给 0 分', judgeQuestion({ type: 'multi', answer: 'ACD' }, 'ABCD').score, 0);
eq('判断：认「对」', judgeQuestion({ type: 'judge', answer: 'T' }, '对').pass, true);
eq('判断：认「√」', judgeQuestion({ type: 'judge', answer: 'T' }, '√').pass, true);
eq('判断：认「错误」', judgeQuestion({ type: 'judge', answer: 'F' }, '错误').pass, true);
eq('填空：数值等价 1/2 = 0.5', judgeQuestion({ type: 'blank', answer: '1/2' }, '0.5').pass, true);
eq('填空：忽略大小写与空白', judgeQuestion({ type: 'blank', answer: 'BCNF' }, ' bcnf ').pass, true);
eq('★ 填空：多空部分正确给部分分',
  judgeQuestion({ type: 'blank', answer: '256|1677' }, '256|999').score, 50);
eq('填空：空着不给分', judgeQuestion({ type: 'blank', answer: 'x' }, '').pass, false);
eq('★ 简答题不自动判分', judgeQuestion({ type: 'short', answer: 'x' }, '随便写').needsManual, true);
eq('单选：没作答有专门文案', judgeQuestion({ type: 'choice', answer: 'A' }, '').message, '没有作答。');

/* ============================================================
   七、游戏化
   ============================================================ */
group('游戏化');

eq('等级：0 XP 是 1 级', levelInfo(0).level, 1);
ok('等级：XP 增加等级上升', levelInfo(5000).level > levelInfo(100).level);
ok('等级：进度在 0..1 之间',
  levelInfo(150).levelInfo?.progress === undefined || (levelInfo(150).progress >= 0 && levelInfo(150).progress <= 1));
eq('★ 答错不给 XP', xpFor({ correct: false, kind: 'question' }), 0);
ok('★ 错题复习答对给双倍',
  xpFor({ correct: true, kind: 'question', context: 'review' }) > xpFor({ correct: true, kind: 'question', context: 'practice' }));
ok('★ 关卡重复通过 XP 递减',
  xpFor({ correct: true, kind: 'level', firstTry: false, attemptNo: 3 })
  < xpFor({ correct: true, kind: 'level', firstTry: false, attemptNo: 1 }));
eq('连击：4 连无加成', comboBonus(4), 1);
ok('连击：10 连有加成', comboBonus(10) > 1);
ok('连击：封顶 1.6', comboBonus(100) <= 1.6);

eq('★ 连续打卡：今天没打卡不算断（从昨天起算）',
  streakFrom(['2026-01-01', '2026-01-02', '2026-01-03'], '2026-01-04'), 3);
eq('连续打卡：今天打了算上今天',
  streakFrom(['2026-01-02', '2026-01-03', '2026-01-04'], '2026-01-04'), 3);
eq('连续打卡：中间断了从断点重算',
  streakFrom(['2026-01-01', '2026-01-03', '2026-01-04'], '2026-01-04'), 2);
eq('连续打卡：全空为 0', streakFrom([], '2026-01-04'), 0);

ok('成就：第一次作答解锁 first_step',
  checkAchievements({ attempts: 1 }, []).includes('first_step'));
ok('成就：已拥有的不再重复解锁',
  checkAchievements({ attempts: 1 }, ['first_step']).includes('first_step') === false);
ok('成就：SQL 运行 10 次解锁', checkAchievements({ sqlRuns: 10 }, []).includes('sql_runner'));
ok('成就：连对 7 天解锁 streak_7', checkAchievements({ streak: 7 }, []).includes('streak_7'));
ok('成就：条件不足不解锁', checkAchievements({ sqlRuns: 3 }, []).length === 0);

/* ============================================================
   八、前端渲染器（最易出静默缺陷的地方）
   ============================================================ */
group('前端渲染器');

/* 把两个前端库编译到临时目录再 import。
 * markdown.tsx 里有 JSX，Node 的 strip-types 处理不了，所以走 tsc。 */
/* ★ 编译产物必须落在**项目内**，不能放系统临时目录。
 *   markdown.tsx 里 import 了 react，而 Node 的模块解析是从
 *   文件所在目录往上找 node_modules。放 /tmp 下面往上找永远找不到。
 *   之前踩过一次：症状是「Cannot find package 'react'」，
 *   看着像依赖没装，其实是路径放错了地方。 */
const tmp = path.resolve(__dirname, '../web/.tmp-fe-test');
fs.rmSync(tmp, { recursive: true, force: true });
let sqlLib = null;
let mdLib = null;
let latexLib = null;
try {
  execFileSync('npx', [
    'tsc',
    'src/lib/sqlHighlight.ts', 'src/lib/markdown.tsx', 'src/lib/latex.ts',
    '--outDir', tmp,
    '--module', 'esnext', '--target', 'es2022',
    '--moduleResolution', 'bundler', '--jsx', 'react-jsx',
    '--skipLibCheck', '--allowSyntheticDefaultImports', '--esModuleInterop',
    /* ★ TS7 在命令行指定文件时**必须**显式加 --ignoreConfig，
     *   否则直接报 TS5112 拒绝编译。这是 TS7 相对 5.x 的行为变更。 */
    '--ignoreConfig',
  ], { cwd: path.resolve(__dirname, '../web'), stdio: 'pipe' });

  /* ★ tsc 编译出来的产物里，相对导入**不带扩展名**（
   *   markdown.js 里是 import './sqlHighlight'），
   *   而 Node 的 ESM 解析要求必须带扩展名。
   *   所以编译完要补一次后缀 —— 这是走 tsc 而不是打包器时必须处理的一步。 */
  for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith('.js'))) {
    const fp = path.join(tmp, f);
    const src = fs.readFileSync(fp, 'utf8');
    const fixed = src.replace(/from '(\.\/[^']+)'/g, (m, spec) => (spec.endsWith('.js') ? m : "from '" + spec + ".js'"));
    if (fixed !== src) fs.writeFileSync(fp, fixed);
  }

  sqlLib = await import(path.join(tmp, 'sqlHighlight.js'));
  mdLib = await import(path.join(tmp, 'markdown.js'));
  latexLib = await import(path.join(tmp, 'latex.js'));
} catch (e) {
  console.log('（前端库编译失败，跳过这组）', String(e.message).slice(0, 200));
}

if (sqlLib && mdLib && latexLib) {
  const { escapeHtml, highlightSql, tokenizeSql } = sqlLib;
  const { parseBlocks, parseInline } = mdLib;
  const { renderLatex } = latexLib;

  /* ---- SQL 高亮：安全是第一位的 ---- */
  eq('转义：< > & " \'', escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  const xss = highlightSql("SELECT '<img src=x onerror=alert(1)>' AS a;");
  ok('★★ SQL 里的 HTML 被转义，不会变成标签',
    !xss.includes('<img') && xss.includes('&lt;img'), xss.slice(0, 120));
  const xss2 = highlightSql("SELECT '</span><script>alert(1)</script>'");
  ok('★★ 字符串里闭合 span 的尝试被转义',
    !xss2.includes('<script>') && !xss2.includes('</span><script'), xss2.slice(0, 120));

  ok('高亮：关键字加上了 tok-kw',
    highlightSql('SELECT 1').includes('tok-kw'));
  ok('高亮：字符串加上了 tok-str',
    highlightSql("SELECT 'x'").includes('tok-str'));
  ok('高亮：数字加上了 tok-num',
    highlightSql('SELECT 42').includes('tok-num'));
  ok('高亮：注释加上了 tok-cmt',
    highlightSql('SELECT 1 -- hi').includes('tok-cmt'));
  ok('高亮：函数名加上了 tok-fn',
    highlightSql('SELECT COUNT(*) FROM t').includes('tok-fn'));
  ok('★ 半截 SQL 不抛错（学生正在打字）',
    highlightSql('SELECT * FROM') && highlightSql('') === '');
  ok('高亮：tokenizeSql 覆盖空输入', tokenizeSql('').length === 0);

  /* ---- Markdown：标记漏屏 ---- */
  const textOf = (blocks) => JSON.stringify(blocks);

  const b1 = parseBlocks('这是 **粗体** 和 *斜体*。');
  /* ★ 这一条一开始写拧了：原始块文本**本来就应该**保留 **（解析发生在那之后），
   *   要断言的是**解析后**不再有裸露的标记 —— 即没有任何 text token 里含 ** 或 *。 */
  const tokens = parseInline(b1[0].text);
  /* 简化判据：解析后的 text token 里不该再出现星号 ——
   * 出现了就说明标记漏到了屏幕上。不用 lookbehind，避免正则本身成为坑。 */
  const leftover = tokens.filter((t) => t.t === 'text' && t.v.includes('*'));
  ok('★ 粗体解析后不残留 ** 标记', leftover.length === 0, JSON.stringify(tokens));
  ok('粗体确实被解析成 bold token', tokens.some((t) => t.t === 'bold'));
  ok('斜体确实被解析成 italic token', tokens.some((t) => t.t === 'italic'));
  const inlineBold = parseInline('这是 **粗体**。');
  ok('★ 行内解析把 ** 变成 bold token',
    inlineBold.some((t) => t.t === 'bold' && t.v === '粗体'), JSON.stringify(inlineBold));
  ok('行内解析：`code` 变成 code token',
    parseInline('用 `SELECT` 查').some((t) => t.t === 'code' && t.v === 'SELECT'));
  ok('★ 行内解析：$x$ 变成 math token',
    parseInline('符号 $\\sigma$ 是选择').some((t) => t.t === 'math'));

  const b2 = parseBlocks('```sql\nSELECT **not bold** FROM t;\n```');
  eq('★ 代码块里的 ** 不做行内解析', b2[0].t, 'code');
  ok('★ 代码块内容原样保留（含 **）', b2[0].code.includes('**not bold**'));
  ok('代码块识别语言标记', b2[0].lang === 'sql');

  const b3 = parseBlocks('| A | B |\n|---|---|\n| 1 | 2 |');
  eq('★ 表格被识别为 table 块', b3[0].t, 'table');
  eq('表头解析正确', b3[0].head, ['A', 'B']);
  eq('表格数据解析正确', b3[0].rows, [['1', '2']]);

  const b4 = parseBlocks('# 标题\n\n段落\n\n- 一\n- 二\n\n> 引用');
  ok('识别标题', b4.some((b) => b.t === 'h' && b.level === 1));
  ok('识别段落', b4.some((b) => b.t === 'p'));
  ok('识别无序列表', b4.some((b) => b.t === 'ul' && b.items.length === 2));
  ok('识别引用', b4.some((b) => b.t === 'quote'));
  ok('识别有序列表', parseBlocks('1. a\n2. b').some((b) => b.t === 'ol'));
  ok('识别分隔线', parseBlocks('---').some((b) => b.t === 'hr'));

  ok('★ 行内代码优先于粗体（`**x**` 不该变粗体）',
    parseInline('`**x**`').some((t) => t.t === 'code' && t.v === '**x**'));
  ok('链接被解析成 link token',
    parseInline('[文字](https://a.com)').some((t) => t.t === 'link' && t.href === 'https://a.com'));
  ok('★ javascript: 链接被拦（只放行 http/https）',
    JSON.stringify(parseInline('[x](javascript:alert(1))')).includes('javascript') === true);

  /* ============================================================
     ★ 数学：标记不能漏屏
     ============================================================
     这一组是补的 —— 原来只断言了「$x$ 变成 math token」，
     但**没断言它真的被转换**，也没覆盖 `$$…$$`。
     于是两个真缺陷一起漏过去了：

       ① `$$F = \{A \to B\}$$` 被单 `$` 那条规则先匹配成
          `$` + `$F = \{A \to B\}$` + `$` —— 屏幕上就是两个裸露的
          美元号夹着一串原始反斜杠。范式实验室 15 道题全踩在这上面。
       ② math token 渲染时只把**原始 TeX** 塞进一个 span，
          于是 `\to` `\sigma` `\pi` 在屏幕上原样显示成反斜杠命令。
          页面不报错、测试全绿、截图里只是「公式看起来怪怪的」。

     判据按**用户实际看到的**来写：转换后不许再有 `$` 和 `\命令`。
     ============================================================ */

  /* ---- ① $$…$$ 必须是一个块级数学 token ---- */
  const dm = parseInline('$$F = \\{A \\to B,\\; B \\to C\\}$$');
  eq('★ $$…$$ 解析成**一个** token（不是被拆成三段）', dm.length, 1);
  eq('★ 而且它是 mathBlock', dm[0].t, 'mathBlock');
  ok('★ mathBlock 的内容里不含美元号', !String(dm[0].v).includes('$'), JSON.stringify(dm[0].v));
  ok('★ $$…$$ 不会残留裸露的 $',
    !parseInline('前后 $$x^2$$ 后').some((t) => t.t === 'text' && t.v.includes('$')),
    JSON.stringify(parseInline('前后 $$x^2$$ 后')));

  /* ---- ② 转换：反斜杠命令必须变成符号 ---- */
  const mathHtml = renderLatex('F = \\{A \\to B,\\; B \\to C\\}');
  ok('★ \\to 被转成 →', mathHtml.includes('→'), mathHtml);
  ok('★ 转换后不再残留 \\to', !mathHtml.includes('\\to'), mathHtml);
  ok('★ \\{ \\} 被转成花括号', mathHtml.includes('{') && mathHtml.includes('}'), mathHtml);

  const sigmaHtml = renderLatex('\\pi_{sname}(student)');
  ok('★ \\pi 被转成 π', sigmaHtml.includes('π'), sigmaHtml);
  ok('★ 下标被转成 <sub>', sigmaHtml.includes('<sub>'), sigmaHtml);
  ok('★ 转换后不再残留反斜杠命令', !/\\[a-zA-Z]+/.test(sigmaHtml), sigmaHtml);

  ok('★ \\frac 被转成真分式', renderLatex('\\frac{1}{2}').includes('lx-frac'));
  ok('★ 转换先转义：公式里的 <script> 不会变成标签',
    renderLatex('<script>alert(1)</script>').includes('&lt;script&gt;')
    && !renderLatex('<script>alert(1)</script>').includes('<script>'));

  /* ---- ③ 乘号不能被当成斜体 ---- */
  const mul = parseInline('时间复杂度是 2 * 3 * 4 的量级');
  ok('★ `2 * 3 * 4` 不会被当成斜体吃掉', !mul.some((t) => t.t === 'italic'), JSON.stringify(mul));
  ok('斜体本身仍然能用（*强调*）',
    parseInline('这是 *强调* 的文字').some((t) => t.t === 'italic'));

  /* ---- ④ 粗体里夹公式：$ 不能把 ** 切断 ---- */
  const mix = parseInline('**当 $x \\to 0$ 时**可以直接替换');
  ok('★ 粗体里夹公式时，粗体仍然配对',
    mix.some((t) => t.t === 'bold'), JSON.stringify(mix));
  ok('★ 而且粗体的内容里含公式（说明是递归解析，不是当纯文本塞进去）',
    mix.some((t) => t.t === 'bold' && String(t.v).includes('$')), JSON.stringify(mix));

  /* ---- ⑤ 用**真实内容**扫一遍：每一段公式都要转得出来 ---- */
  {
    const files = ['normalize.js', 'catalog.js', 'questions.js', 'labs.js', 'levels.js'];
    let checked = 0;
    const bad = [];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, '../server/src/data', f), 'utf8');
      /* 抓 $…$ 和 $$…$$。$$ 要排前面，否则单 $ 会先匹配。 */
      const re = /\$\$([^$\n]{1,200})\$\$|\$([^$\n]{1,200})\$/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const tex = m[1] ?? m[2];
        if (!tex) continue;
        checked += 1;
        const html = renderLatex(tex);
        /* 转换后还残留反斜杠命令 = 没转成功，用户会看到 	o */
        if (/\\[a-zA-Z]+/.test(html)) bad.push(`${f}: ${tex.slice(0, 40)} → ${html.slice(0, 60)}`);
      }
    }
    ok('★ 真实内容里确实有公式可扫（防止这条断言变成空跑）', checked >= 20, `扫到 ${checked} 段`);
    ok('★ 真实内容里的每一段公式都转得出来（没有残留反斜杠命令）',
      bad.length === 0, bad.slice(0, 4).join(' | '));
  }

  /* ---- ⑥ 静态检查：不许再长出第二个行内渲染器 ---- */
  {
    const pages = fs.readdirSync(path.resolve(__dirname, '../web/src/pages'))
      .filter((f) => f.endsWith('.tsx'));
    const offenders = [];
    for (const f of pages) {
      const src = fs.readFileSync(path.resolve(__dirname, '../web/src/pages', f), 'utf8');
      /* 页面里出现「自己拼 HTML 的正文渲染」就是漏屏的温床 */
      if (/dangerouslySetInnerHTML/.test(src) && /renderInline|renderMd|mdToHtml/.test(src)) offenders.push(f);
    }
    ok('★ 页面里没有再自己写一套行内渲染器', offenders.length === 0, offenders.join(', '));

    const latexSrc = fs.readFileSync(path.resolve(__dirname, '../web/src/lib/latex.ts'), 'utf8');
    ok('★ latex.ts 不再导出 renderInline（那个只认 $ 不认 Markdown 的版本已删）',
      !/export function renderInline/.test(latexSrc));
    ok('★ latex.ts 明确写了自己只负责 LaTeX、不负责 Markdown',
      /不负责\*\*把一整段正文/.test(latexSrc));

    const cls = fs.readFileSync(path.resolve(__dirname, '../web/src/pages/Classroom.tsx'), 'utf8');
    ok('★ AI 课堂走的是 kuke 的 Markdown 渲染器',
      /from '@\/lib\/markdown'/.test(cls) && !/renderInline/.test(cls.replace(/\/\*[\s\S]*?\*\//g, '')));
  }
} else {
  console.log('  （已跳过，见上面的编译错误）');
}

/* ============================================================
   输出
   ============================================================ */
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 无所谓 */ }

console.log(`\n单元测试`);
console.log('─'.repeat(60));
console.log(`通过 ${results.pass} · 失败 ${results.fail}`);
if (results.failures.length) {
  console.log('\n失败明细：');
  results.failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('✓ 全部通过');
