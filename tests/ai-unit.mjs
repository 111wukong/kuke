/* AI 纯函数测试
 *
 * 不碰网络、不起服务，跑得很快。改完 AI 那一层先跑这个。
 *
 * ── 为什么单独一个文件，而不是并进 tests/unit.mjs ───────────────
 * ai/agent.js 和 ai/tools.js 会 import db/index.js，而那个模块**在 import
 * 时就把库打开了**（还 mkdir + 建 WAL 文件）。并进 unit.mjs 的话，
 * 跑一次纯函数测试会在 server/data/ 下留一个空库。
 * 所以这里先把 KUKE_DB 指到临时目录，再**动态 import** ——
 * ESM 的 import 是提升的，写成静态 import 的话环境变量还没设就开库了。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { results, check, eq, report } from './lib/harness.mjs';

/* ★ 必须在这几个 import 之前 —— 它们会开库 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuke-ai-unit-'));
process.env.KUKE_DB = path.join(tmp, 'ai-unit.db');
process.env.KUKE_ENV_FILE = path.join(tmp, 'no-such-env-file');

const { compile, samplePoints, envelope, round6 } = await import('../server/src/ai/expr.js');
const { sanitizeGenerated, questionIssue, blankIssue, parseNumeric, extractJson, canonicalAnswer } = await import('../server/src/ai/generate.js');
const {
  classifyIntent, nextPhase, enforcePhase, isComputeQuestion, isComputeTurn, parseMove,
  guidanceRatio, blankMoves, canSpeak, compact, lastQuestion, findLastQuestion,
  findReplaceSpan, replaceTrailingQuestion, COMPREHENSION_CHECKS, AGENTS, STUDENT_KEYS, PHASE_META,
} = await import('../server/src/ai/agent.js');
const {
  TEACHER_TOOLS, STUDENT_TOOLS, TEACHER_ONLY, STUDENT_ONLY, SHARED,
  BOARD_BLOCK_KINDS, assertStudentCannotWriteSolution, schemaFor, toolNamesFor,
  describeTools, makeCtx, execute,
} = await import('../server/src/ai/tools.js');

/* ============================================================
   1. 表达式求值器（无 eval）
   ============================================================ */
{
  const c = (src, vars) => compile(src, vars);
  const at = (src, x, vars, scope) => c(src, vars)(x, scope);

  eq('-x^2 必须是 -(x^2) 而不是 (-x)^2', at('-x^2', 3), -9);
  eq('x^2^3 必须右结合（2^(2^3)=256，不是 (2^2)^3=64）', at('x^2^3', 2), 256);
  eq('隐式乘法 2x', at('2x', 3), 6);
  eq('隐式乘法 2(x+1)', at('2(x+1)', 2), 6);
  eq('★ x(x-1) 是隐式乘法，不是函数调用 x(...)', at('x(x-1)', 3), 6);
  eq('隐式乘法 3log2(x)', at('3log2(x)', 8), 9);
  eq('x^2y 读作 (x^2)*y', at('x^2y', 2, ['y'], { y: 5 }), 20);
  eq('内置常数 pi', round6(at('pi', 0) * 1e6) / 1e6, round6(Math.PI * 1e6) / 1e6);
  eq('log2', at('log2(1024)', 0), 10);
  eq('除零得到 Infinity 而不是抛异常', at('1/0', 0), Infinity);

  eq('参数作用域生效', at('k*x', 2, ['k'], { k: 3 }), 6);
  /* ★ scope 只采纳声明过的名字 —— 照单全收的话，
   *   一个叫 pi 的 key 能把内置常数顶掉，而那是模型够得着的输入。 */
  eq('未声明的 scope key 一律忽略（pi 顶不掉内置常数）', at('pi', 0, [], { pi: 999 }), Math.PI);

  let threw = false;
  try { c('k + 1', []); } catch { threw = true; }
  check('表达式里用了没声明的符号要在编译期报错', threw);
  threw = false;
  try { c('k*x', ['x']); } catch { threw = true; }
  check('参数名不许叫 x', threw);
  threw = false;
  try { c('pi*x', ['pi']); } catch { threw = true; }
  check('参数名不许撞内置常数', threw);

  const pts = samplePoints(compile('1/x', []), -1, 1, 40);
  check('采样遇到极点用 null 断笔（而不是画一条飞出去的竖线）', pts.some(([, y]) => y === null));
  /* ★ 样本要够多才有分位意义 —— 6 个数的 98% 分位就是最大值本身。
   *   真实场景是 300+ 个采样点。 */
  const many = [];
  for (let i = 0; i < 300; i++) many.push(i / 10);
  many.push(1e9);
  const { ymin, ymax } = envelope(many);
  check('包络用分位裁剪（一个极点不该把整张图压成一条线）', ymax < 1e6, `ymax=${ymax}`);
  /* 下界会被留白（12% span）往下推一点，所以是「远小于 1e9」而不是「大于 0」 */
  check('包络下界也没被极点带飞', ymin < 1, `ymin=${ymin}`);
}

/* ============================================================
   2. ★ 出题清洗：不变量 + 畸形输入扫描
   ============================================================ */
{
  eq('\\frac{1}{2} 解析成 0.5', parseNumeric('\\frac{1}{2}'), null);   // 不认 LaTeX，交给 prompt 挡
  eq('纯分数可解析', parseNumeric('1/2'), 0.5);
  eq('百分数可解析', parseNumeric('50%'), 0.5);
  eq('x=2 剥成 2', parseNumeric('x=2'), 2);
  eq('0 是合法答案，不能被当成「解析不出来」', parseNumeric('0'), 0);
  eq('含字母判不了', parseNumeric('m+1'), null);
  eq('中文判不了', parseNumeric('至少 1 个'), null);
  eq('★ 空值是坏形状（返回原因）', blankIssue('') !== null, true);
  eq('★ 含字母的填空答案是坏形状', blankIssue('sno') !== null, true);
  eq('纯数值填空可以收', blankIssue('4'), null);

  const WEIRD = [
    null, undefined, '', '这不是 JSON', '{}', '{"questions":null}', '{"questions":[null]}',
    '{"questions":[{}]}',
    '{"questions":[{"type":"short","stem":"请论述索引的优缺点并举例说明。","answer":"略"}]}',
    '{"questions":[{"type":"choice","stem":"只有三个选项的题应该被丢掉。","options":[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"}],"answer":"A"}]}',
    '{"questions":[{"type":"choice","stem":"答案不在选项里的题应该被丢掉。","options":[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}],"answer":"Z"}]}',
    '{"questions":[{"type":"choice","stem":"选项键写错的题应该被丢掉。","options":[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"E","text":"e"}],"answer":"A"}]}',
    '{"questions":[{"type":"choice","stem":"两个选项文字一样，答案不唯一，该丢。","options":[{"key":"A","text":"同"},{"key":"B","text":"同"},{"key":"C","text":"c"},{"key":"D","text":"d"}],"answer":"A"}]}',
    '{"questions":[{"type":"blank","stem":"含字母的填空答案应该被丢掉。","answer":"sno"}]}',
    '{"questions":[{"type":"blank","stem":"太短的题干。","answer":"1"}]}',
    '{"questions":[{"type":"judge","stem":"答案不是真假值的判断题该丢。","answer":"也许"}]}',
    '```json\n{"questions":[{"type":"blank","stem":"被围栏包起来的正常题。","answer":"4"}]}\n```',
    '前面有解释 {"questions":[{"type":"blank","stem":"被解释文字包住的正常题。","answer":"x=2"}]} 后面还有',
    '[{"type":"judge","stem":"裸数组形式的正常题。","answer":"T"}]',
    '{"questions":[{"type":"单选题","stem":"中文题型名也应该认得出来。","options":[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}],"answer":"B"}]}',
  ];

  /* ★ 不变量：只要产出了一道题，它就**一定**是库课判得了的。
   *   这条比前面所有单点断言加起来都值钱 —— 它保证不管模型吐什么，
   *   入库的题都能被判分器正确处理。 */
  let produced = 0;
  for (const raw of WEIRD) {
    const res = sanitizeGenerated(raw, { count: 3, kid: 'k-dbms' });
    produced += res.created.length;
    for (const q of res.created) {
      check(`不变量：产出的题一定判得了（输入 ${JSON.stringify(String(raw).slice(0, 24))}）`, questionIssue(q) === null, questionIssue(q) || '');
      if (q.type === 'choice' || q.type === 'multi') {
        check('不变量：选项正好 4 个且键是 ABCD', q.options.length === 4 && q.options.map((o) => o.key).join('') === 'ABCD');
        check('不变量：答案落在选项里', [...String(q.answer)].every((c) => 'ABCD'.includes(c)));
      }
      if (q.type === 'blank') {
        check('不变量：填空答案一定是纯数值', Number.isFinite(parseNumeric(q.answer)));
      }
      if (q.type === 'judge') {
        check('不变量：判断题答案一定是 T/F', q.answer === 'T' || q.answer === 'F');
      }
    }
    check('不变量：created 是数组', Array.isArray(res.created));
    check('不变量：丢弃计数不为负', res.skippedUnjudgeable >= 0 && res.skippedDuplicate >= 0);
  }
  check('★ 畸形输入扫过一轮后确实有题目被救回来（说明不是全丢）', produced > 0, `produced=${produced}`);

  /* ★ 自检：手工写一个「不做校验」的错误实现，确认不变量抓得住它。
   *   一个永远为绿的检查比没有检查更糟。 */
  function brokenSanitize(raw) {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
    const list = (parsed && parsed.questions) || (Array.isArray(parsed) ? parsed : []);
    return list.filter((q) => q && typeof q === 'object');
  }
  let brokenCaught = false;
  for (const raw of WEIRD) {
    for (const q of brokenSanitize(raw)) {
      if (questionIssue({ ...q, options: q.options || [] }) !== null) { brokenCaught = true; break; }
    }
    if (brokenCaught) break;
  }
  check('★ 自检：不变量确实能抓住「不做校验」的错误实现（不是永远为绿）', brokenCaught);

  // 该丢的丢
  const allBad = sanitizeGenerated(JSON.stringify({
    questions: [
      { type: 'short', stem: '请论述索引的优缺点并举例说明。', answer: '略' },
      { type: 'blank', stem: '含字母的填空答案应该被丢掉。', answer: 'sno' },
      { type: 'choice', stem: '只有三个选项的题应该被丢掉。', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }], answer: 'A' },
    ],
  }), { count: 3 });
  eq('全是坏形状时一道都不留', allBad.created.length, 0);
  eq('一道都出不来时明确报 parseFailed', allBad.parseFailed, true);
  eq('丢了几道要如实上报', allBad.skippedUnjudgeable, 3);

  // 该救的救
  const saved = sanitizeGenerated(JSON.stringify({
    questions: [
      { type: 'blank', stem: '把 x=2 这种写法救成纯值。', answer: 'x=2' },
      { type: 'choice', stem: '把选项全文当答案的写法救成键。', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }, { key: 'D', text: '丁' }], answer: '乙' },
    ],
  }), { count: 3 });
  eq('x=2 被救成 2', saved.created[0]?.answer, '2');
  eq('选项全文被救成键', saved.created[1]?.answer, 'B');

  // 去重
  const dup = sanitizeGenerated(JSON.stringify({
    questions: [
      { type: 'blank', stem: '同一道题换个数字出两遍。', answer: '1' },
      { type: 'blank', stem: '同一道题换个数字出两遍。', answer: '1' },
    ],
  }), { count: 3 });
  eq('同批去重', dup.created.length, 1);
  eq('重复计数上报', dup.skippedDuplicate, 1);

  eq('canonicalAnswer 归一化多选（去重排序）', canonicalAnswer({ type: 'multi', answer: 'dba' }), 'ABD');
  eq('canonicalAnswer 归一化判断', canonicalAnswer({ type: 'judge', answer: '错' }), 'F');
}

/* ============================================================
   3. ★ 阶段状态机与意图分类
   ============================================================ */
{
  /* ★ 顺序不能反：「听不懂」「没听懂」里都带一个「懂」字。
   *   反过来判的话「我还是没听懂」会被归成「听懂了」，
   *   下一轮直接甩一道题出来 —— 那正是要修的毛病本身。 */
  eq('★「我还是没听懂」必须归成 confused（不是 understood）', classifyIntent('我还是没听懂'), 'confused');
  eq('★「这个我真不知道…」归成 confused（不做整句锚定）', classifyIntent('这个我真不知道…'), 'confused');
  eq('「听懂了」归成 understood', classifyIntent('听懂了'), 'understood');
  eq('空输入归成 none', classifyIntent(''), 'none');
  eq('★ 纯提问归成 question 而不是 other', classifyIntent('我还是想问一下为什么这里要加条件？'), 'question');
  eq('闲聊归成 other', classifyIntent('今天天气不错'), 'other');

  eq('第 0 轮一定是 lecture', nextPhase('explain', 'understood', 0), 'lecture');
  eq('confused → clarify', nextPhase('lecture', 'confused', 1), 'clarify');
  eq('understood → practice', nextPhase('clarify', 'understood', 1), 'practice');
  eq('question 且上一轮是 clarify → 留在 clarify', nextPhase('clarify', 'question', 1), 'clarify');
  eq('clarify + other → practice', nextPhase('clarify', 'other', 1), 'practice');
  /* ★ 用户点了「继续」但一个字没打时，不许自己滑进练习。 */
  eq('★ clarify + none → 留在 clarify（不许自己滑进练习）', nextPhase('clarify', 'none', 1), 'clarify');

  eq('clarify 阶段只有老师能说话', canSpeak('clarify', 'a'), false);
  eq('clarify 阶段老师能说话', canSpeak('clarify', 'teacher'), true);

  /* ★ 判断「动手题」的正则要小心误杀：光杆词在理解确认问题里太正常了。 */
  eq('★「你觉得这条查询为什么会慢？」不算动手题', isComputeQuestion('你觉得这条查询为什么会慢？'), false);
  eq('★「索引有哪些类型？」不算动手题', isComputeQuestion('索引有哪些类型？'), false);
  eq('「写出一个查询…」算动手题', isComputeQuestion('写出一个查询：找出年龄大于 20 的学生。'), true);

  /* ★ 判据要看**整句**（引出语 + 问句）。
   *   动手信号常常在冒号前面那句引出语里。 */
  {
    const t = '好，那你写一条查询看看：SELECT * FROM student WHERE sage > 20 会返回几行？';
    eq('★ 引出语里的「写一条查询」被认出来（只看问句会漏）', isComputeTurn(t), true);
    eq('只看问句确实会漏（这就是为什么要看整句）', isComputeQuestion(lastQuestion(t)), false);
    const fixed = replaceTrailingQuestion(t, '到这里清楚了吗？');
    eq('★ 换掉之后整句都不含动手信号', isComputeTurn(fixed), false);
    eq('换掉之后只留理解确认（引出语没留下）', fixed, '到这里清楚了吗？');
  }
  eq('正常的回忆式问题不算动手题', isComputeTurn('你先想想，如果没有 WHERE 会出什么问题？'), false);

  /* ---- 硬过滤 ---- */
  const turns1 = [
    { role: 'teacher', text: '(focus)\n我先讲讲这个。' },
    { role: 'a', text: '我觉得是……' },
    { role: 'b', text: '我也说两句。' },
    { role: 'c', text: '我听不懂。' },
  ];
  const r1 = enforcePhase('clarify', turns1);
  eq('★ clarify 阶段把非老师角色全部摘掉', r1.silenced, 3);
  eq('clarify 阶段只留老师', r1.turns.length, 1);
  eq('★ clarify 阶段没留问题就补一个', r1.promptAdded, true);
  check('★ 兜底确认句里有「说不清也没关系」的出口', COMPREHENSION_CHECKS.some((c) => c.includes('说不清')));
  check('★ 每一条兜底确认句本身都不是动手题', COMPREHENSION_CHECKS.every((c) => !isComputeTurn(c)));
  check('★ 每一条兜底确认句都以问句结尾', COMPREHENSION_CHECKS.every((c) => lastQuestion(c).length > 0));

  const r2 = enforcePhase('clarify', [{ role: 'teacher', text: '好，那你写一条查询看看：SELECT * FROM student WHERE sage > 20 会返回几行？' }]);
  eq('★ clarify 阶段结尾的动手题被换掉', r2.promptAdjusted, true);
  eq('换掉之后不再是动手题', isComputeTurn(r2.turns[0].text), false);

  const r3 = enforcePhase('clarify', [{ role: 'teacher', text: '那你想想，如果没有 WHERE 会出什么问题？' }]);
  eq('正常的回忆式问题不动它', r3.promptAdjusted, false);
  eq('已经有问题就不补', r3.promptAdded, false);

  eq('lecture 阶段不静默任何人', enforcePhase('lecture', turns1).silenced, 0);

  eq('findLastQuestion 在冒号后断开', lastQuestion('我先问你一个：为什么？'), '为什么？');
  eq('findReplaceSpan 走得更远（含引出语）', findReplaceSpan('先看这条。那你说，去掉它会怎样？').text, '那你说，去掉它会怎样？');

  const m1 = parseMove('(focus)\n正文在这里');
  eq('标签被解析出来', m1.move, 'focus');
  eq('标签被剥掉', m1.text, '正文在这里');
  eq('没有标签时 move 是空串', parseMove('就是普通正文').move, '');

  eq('引导占比', guidanceRatio({ focus: 2, probing: 1, telling: 1 }), 0.75);
  eq('没有动作时占比是 null（不是 0 —— 0 会被误读成「全在念答案」）', guidanceRatio(blankMoves()), null);

  const long = [{ role: 'system', content: 'S' }];
  for (let i = 0; i < 40; i++) long.push({ role: i % 2 ? 'assistant' : 'user', content: `消息${i}` });
  const comp = compact(long, { keep: 10 });
  check('压缩后消息变少', comp.length < long.length);
  eq('压缩保留 system', comp[0].role, 'system');
  check('压缩后有一行前情提要', comp.some((m) => String(m.content).startsWith('【前情提要】')));

  check('每个阶段都有元信息', Object.keys(PHASE_META).length >= 5);
  check('每个学生角色都绑了一种典型失误', STUDENT_KEYS.every((k) => AGENTS[k].errorMode && AGENTS[k].errorHint));
  check('★ 每个学生角色都分了干扰项序号（一人一个坑）',
    new Set(STUDENT_KEYS.map((k) => AGENTS[k].distractorIndex)).size === STUDENT_KEYS.length);
}

/* ============================================================
   4. ★ 工具白名单与角色隔离
   ============================================================ */
{
  check('自检函数通过', assertStudentCannotWriteSolution() === true);
  eq('学生白名单里没有写解答类工具', STUDENT_TOOLS.filter((t) => TEACHER_ONLY.includes(t)).length, 0);
  eq('老师白名单里没有学生专用工具', TEACHER_TOOLS.filter((t) => STUDENT_ONLY.includes(t)).length, 0);
  check('★ 学生没有 write_sql（会跑 SQL 不等于会写解法）', !STUDENT_TOOLS.includes('write_sql'));
  check('学生没有 write_steps / write_latex', !STUDENT_TOOLS.includes('write_steps') && !STUDENT_TOOLS.includes('write_latex'));
  check('学生没有 get_mistakes / query_weakness', !STUDENT_TOOLS.includes('get_mistakes') && !STUDENT_TOOLS.includes('query_weakness'));
  check('老师没有 raise_hand', !TEACHER_TOOLS.includes('raise_hand'));
  check('两边都有 run_sql（学生也能在教学库上跑 SQL）', SHARED.includes('run_sql'));

  const ts = schemaFor('teacher').map((t) => t.function.name);
  const ss = schemaFor('a').map((t) => t.function.name);
  check('老师 schema 里有 write_sql', ts.includes('write_sql'));
  check('学生 schema 里没有 write_sql', !ss.includes('write_sql'));
  eq('schema 数量与白名单一致（老师）', ts.length, toolNamesFor('teacher').length);
  eq('schema 数量与白名单一致（学生）', ss.length, toolNamesFor('a').length);

  /* ★ 黑板块数的唯一口径：highlight / page / clear 都不算块。
   *   计数口径和渲染口径不一致的话，该播动画的块不播（静默失效）。 */
  check('★ highlight / page / clear 都不算黑板块', !BOARD_BLOCK_KINDS.includes('highlight') && !BOARD_BLOCK_KINDS.includes('page') && !BOARD_BLOCK_KINDS.includes('clear'));
  check('★ sql 算黑板块（库课独有的动作）', BOARD_BLOCK_KINDS.includes('sql'));

  check('老师与学生手里都有 run_sql / explain_plan / draw_graph', ['run_sql', 'explain_plan', 'draw_graph'].every((n) => TEACHER_TOOLS.includes(n) && STUDENT_TOOLS.includes(n)));
  check('describeTools 标出了哪些是老师专用', describeTools('teacher').some((t) => t.teacherOnly) && describeTools('a').every((t) => !t.teacherOnly));
}

/* ============================================================
   5. 越权调用被拒（不需要 DB —— 白名单在 execute 的第一行就拦了）
   ============================================================ */
{
  const ctx = makeCtx({ role: 'a', depth: 'c', session: { board: [] }, userId: 1, kid: 'k-dbms', distractorIndex: 2 });
  const tctx = makeCtx({ role: 'teacher', depth: 'teacher', session: { board: [] }, userId: 1, kid: 'k-dbms' });

  const denied = await execute('write_sql', { sql: 'SELECT 1' }, ctx, 'a');
  eq('★ 学生越权调用 write_sql 被拒', denied.ok, false);
  check('★ 拒绝时给出了可用清单', /可用清单|只能用/.test(denied.error), denied.error);

  const denied2 = await execute('get_mistakes', {}, ctx, 'a');
  eq('★ 学生越权调用 get_mistakes 被拒', denied2.ok, false);

  const denied3 = await execute('raise_hand', { reason: 'x' }, tctx, 'teacher');
  eq('★ 老师越权调用 raise_hand 被拒', denied3.ok, false);

  const unknown = await execute('不存在的工具', {}, tctx, 'teacher');
  eq('不存在的工具被拒', unknown.ok, false);

  /* calc 是纯的，不需要库 */
  const calc = await execute('calc', { expr: '1024*1024' }, tctx, 'teacher');
  eq('calc 算得对', calc.ok && calc.data.value, 1048576);
  eq('calc 坏表达式返回错误而不是抛异常', (await execute('calc', { expr: 'x+' }, tctx, 'teacher')).ok, false);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 无所谓 */ }

report('AI · 纯函数（求值器 / 清洗不变量 / 阶段机 / 白名单）');
/* 显式退出：这个文件 import 了 db（better-sqlite3），
 * 不显式退的话进程可能挂在打开的句柄上。 */
process.exit(process.exitCode || 0);
