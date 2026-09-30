/* AI · 出题的可消费性守卫
 *
 * ── 这个文件为什么必须存在 ───────────────────────────────────────
 * 模型生成的题目**要交给程序判分**。一条判不了分的题，
 * 学生答对了系统说错 —— 页面不报错、测试全绿、学生直接失去信任。
 * 这比「生成失败」严重得多。
 *
 * ── 第一步是读下游的接受范围（lib/judge.js）──────────────────────
 * 不凭感觉写校验，去看消费方的代码。库课的判题器接受这些形状：
 *
 *   题型      | 能收的答案形状                    | 判分方式
 *   ----------|-----------------------------------|------------------
 *   choice    | 单个字母 A–D（归一化后）           | 严格相等
 *   multi     | 字母组合，如 ABD（去重排序后比对）  | 全对 100，漏选 50，选错 0
 *   judge     | T / F（对错/√×/1/0 都会归一化）    | 严格相等
 *   blank     | 字符串；纯数值或分数按容差比        | 数值容差 1e-6
 *   short     | —— **不自动判分**，交教师批改      | 生成时一律不收
 *
 * 于是判据就很清楚：**只出 choice / judge / blank（纯数值）三种**，
 * 简答题一律不要，含字母或根号的填空一律不要。
 *
 * ── 两道防线 ────────────────────────────────────────────────────
 *   防线一：提示词写死边界（见 agent.js 的 GENERATE_SYSTEM）
 *   防线二：这个文件的清洗函数兜底
 * 提示词管住**大多数**，但管不住全部 —— 小模型基本不听枚举约束。
 */

import { toHalfWidth, normalizeChoice, normalizeMulti, normalizeBool } from '../lib/judge.js';

/* ============================================================
   归一化：先做**能救的**，再卡最终判据
   ============================================================ */

/** 纯数值或分数？返回数值，否则 null。 */
export function parseNumeric(raw) {
  const v = toHalfWidth(String(raw ?? '')).trim().replace(/^[a-zA-Z][_a-zA-Z0-9]*\s*=\s*/, '');
  if (!v) return null;
  const pct = v.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (pct) return Number(pct[1]) / 100;
  const frac = v.match(/^\(?(-?\d+(?:\.\d+)?)\)?\s*\/\s*\(?(-?\d+(?:\.\d+)?)\)?$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return null;
}

/** 填空答案的可判性：库课的判题器能拿它和学生的输入比吗。 */
export function blankIssue(answer) {
  const v = String(answer ?? '').trim();
  if (!v) return '填空答案为空';
  if (v.length > 40) return '填空答案太长，多半是句子而不是值';
  /* ★ 只收纯数值。文字答案在库课的判题器里是**严格字面相等**，
   *   「至少 1 个」和「至少一个」判不了 —— 与其放过去让判分偶尔出错，
   *   不如在生成时就丢掉。宁可少给，不给坏的。 */
  if (parseNumeric(v) === null) return `填空答案不是纯数值（「${v}」），库课的判题器只能严格字面比对，容易判错`;
  return null;
}

/** 这道题在库课里判得了分吗。返回 null = 判得了。 */
export function questionIssue(q) {
  if (!q || typeof q !== 'object') return '题目对象不存在';
  const stem = String(q.stem || '').trim();
  if (stem.length < 8) return '题干太短，条件说不完整';

  if (q.type === 'choice' || q.type === 'multi') {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length !== 4) return `选择题必须正好 4 个选项（现在 ${opts.length} 个）`;
    const keys = opts.map((o) => String(o && o.key || '').toUpperCase()).join('');
    if (keys !== 'ABCD') return `选项键必须正好是 ABCD（现在是「${keys}」）`;
    const texts = opts.map((o) => String(o && o.text || '').trim());
    if (texts.some((t) => !t)) return '有选项是空的';
    if (new Set(texts).size !== texts.length) return '有两个选项的文字完全一样，答案不唯一';

    if (q.type === 'choice') {
      const a = normalizeChoice(q.answer);
      if (a.length !== 1 || !'ABCD'.includes(a)) return `单选题答案必须是 A/B/C/D 之一（现在是「${q.answer}」）`;
    } else {
      const a = normalizeMulti(q.answer);
      if (a.length < 2 || a.length > 4) return `多选题答案要有 2–4 个选项（现在是「${q.answer}」）`;
      if ([...a].some((c) => !'ABCD'.includes(c))) return `多选题答案只能由 ABCD 组成（现在是「${q.answer}」）`;
      /* 全选等于没考 —— 库课的多选是「选错任何一项得 0」，
       * 但 ABCD 全选在语义上仍然是一道废题。 */
      if (a === 'ABCD') return '多选题答案不能是全部四项';
    }
    return null;
  }

  if (q.type === 'judge') {
    const a = normalizeBool(q.answer);
    if (a !== 'T' && a !== 'F') return `判断题答案只能是 T/F 或对/错（现在是「${q.answer}」）`;
    return null;
  }

  if (q.type === 'blank') return blankIssue(q.answer);

  return `不支持的题型「${q.type}」（只能出 choice / multi / judge / blank）`;
}

/** 归一化后的标准答案（入库用）。
 *
 * ★ 入库的答案必须和 blankIssue 的判据**用同一套归一化**。
 *   真踩过：blankIssue 认 `x=2`（parseNumeric 会剥掉 `x=`），
 *   但这里只做了 trim，于是库里存的是 `x=2`。
 *   学生答「2」时，库课的判题器按字面比 —— `x=2` ≠ `2`，
 *   判错。**一道标准答案本身判不了分的题进了库**，而且不会有任何报错。
 *
 *   通则：校验函数和归一化函数必须共用同一个「什么算合法」的定义，
 *   否则就会出现「过了校验但下游用不了」的缝。
 */
export function canonicalAnswer(q) {
  if (!q) return '';
  if (q.type === 'choice') return normalizeChoice(q.answer);
  if (q.type === 'multi') return normalizeMulti(q.answer);
  if (q.type === 'judge') return normalizeBool(q.answer);
  /* blank：把 `x=2` 剥成 `2`，和 parseNumeric 接受的范围对齐 */
  return String(q.answer ?? '').trim().replace(/^[a-zA-Z][_a-zA-Z0-9]*\s*=\s*/, '');
}

/* ============================================================
   从模型输出里抠 JSON
   ============================================================ */
export function extractJson(text) {
  let s = String(text || '').trim();
  if (!s) return null;

  const fence = s.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  try { return JSON.parse(s); } catch { /* 继续 */ }

  const objStart = s.indexOf('{');
  const objEnd = s.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    try { return JSON.parse(s.slice(objStart, objEnd + 1)); } catch { /* 继续 */ }
  }
  const arrStart = s.indexOf('[');
  const arrEnd = s.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    try { return JSON.parse(s.slice(arrStart, arrEnd + 1)); } catch { /* 继续 */ }
  }
  return null;
}

function normalizeStem(s) {
  return String(s || '').replace(/[\s\u00A0]+/g, '').replace(/[。．.？?！!，,、；;：:]/g, '').toLowerCase();
}

/** 把模型给的一条原始对象整形。整形失败返回 null（不抛异常）。 */
function coerceQuestion(item, forceKid) {
  const stem = String(item.stem || item.question || '').trim();
  if (stem.length < 8) return null;

  let type = String(item.type || '').toLowerCase();
  /* 模型爱写「单选」「选择」「判断」「填空」这种中文题型名。 */
  const alias = { 单选: 'choice', 选择: 'choice', 选择题: 'choice', 多选: 'multi', 判断: 'judge', 判断题: 'judge', 填空: 'blank', 填空题: 'blank' };
  type = alias[type] || type;
  if (!['choice', 'multi', 'judge', 'blank'].includes(type)) return null;

  const base = {
    stem,
    kid: forceKid || String(item.kid || item.pointId || '').trim() || null,
    type,
    difficulty: Math.min(5, Math.max(1, Number(item.difficulty) || 2)),
    analysis: String(item.analysis || item.explain || item.explanation || '').trim().slice(0, 600),
    source: 'ai',
  };

  if (type === 'choice' || type === 'multi') {
    const raw = item.options || item.choices || [];
    const options = (Array.isArray(raw) ? raw : []).slice(0, 4).map((o, i) => {
      if (o && typeof o === 'object') {
        return {
          key: String(o.key || o.k || 'ABCD'[i]).trim().toUpperCase(),
          text: String(o.text || o.t || '').trim(),
        };
      }
      return { key: 'ABCD'[i], text: String(o || '').trim() };
    });
    let answer = String(item.answer ?? '').trim();
    /* 模型有时给选项全文而不是键 —— 救一下。
     * ★ 判据是「这个答案看起来不像选项键」，**不能写成 length > 1**：
     *   选项文字可能正好是一个汉字（「甲」），那样 length 是 1，
     *   救援就被跳过了，然后卡在 questionIssue 那一关被丢掉。 */
    if (!/^[A-Da-d]$/.test(answer)) {
      const hit = options.find((o) => o.text === answer);
      if (hit) answer = hit.key;
    }
    return { ...base, options, answer };
  }

  if (type === 'judge') return { ...base, answer: String(item.answer ?? '').trim() };
  return { ...base, answer: String(item.answer ?? item.a ?? '').trim() };
}

/**
 * 清洗模型生成的题目。
 *
 * @param {string|object} raw
 * @param {object} opts { count, knownStems, kid }
 * @returns {{created, skippedDuplicate, skippedUnjudgeable, parseFailed, total}}
 */
export function sanitizeGenerated(raw, opts = {}) {
  const count = Number(opts.count) || 3;
  const knownStems = new Set((opts.knownStems || []).map(normalizeStem));

  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  const list = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.questions)) ? parsed.questions
      : (parsed && parsed.stem) ? [parsed]
        : [];

  const created = [];
  let skippedDuplicate = 0;
  let skippedUnjudgeable = 0;

  /* ★ 缓冲：要 3 道就让它出 5 道。模型总会出一两道不可判的，
   *   按 count 精确取的话，用户点了「3 道」会拿到 1 道。
   *   （测试夹具要把坏题**放在前面**，否则这条路径一行都跑不到。） */
  for (const item of list.slice(0, count + 2)) {
    if (created.length >= count) break;
    if (!item || typeof item !== 'object') { skippedUnjudgeable += 1; continue; }

    const q = coerceQuestion(item, opts.kid);
    if (!q) { skippedUnjudgeable += 1; continue; }

    const issue = questionIssue(q);
    if (issue) { skippedUnjudgeable += 1; continue; }

    const key = normalizeStem(q.stem);
    if (knownStems.has(key)) { skippedDuplicate += 1; continue; }
    knownStems.add(key);

    created.push({ ...q, answer: canonicalAnswer(q) });
  }

  return {
    created,
    skippedDuplicate,
    skippedUnjudgeable,
    parseFailed: created.length === 0,
    total: list.length,
  };
}

/** 给前端用的一句话结论。 */
export function describeGeneration(res) {
  if (res.parseFailed) return '这次一道都没生成出来，再点一次试试（模型偶尔会输出不成形的 JSON）';
  const bits = [`生成了 ${res.created.length} 道题`];
  if (res.skippedUnjudgeable) bits.push(`有 ${res.skippedUnjudgeable} 道因为判不了分被丢掉了`);
  if (res.skippedDuplicate) bits.push(`${res.skippedDuplicate} 道和已有题目重复`);
  return bits.join(' · ');
}
