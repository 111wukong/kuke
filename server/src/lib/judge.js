/* 客观题判题器
 *
 * 覆盖四种题型：choice 单选 / multi 多选 / judge 判断 / blank 填空。
 * 简答题（short）不自动判分，返回 needsManual 交给教师批改。
 *
 * ── 判题器的职责边界 ────────────────────────────────────────────
 * 它只做一件事：把「学生的输入」和「标准答案」都归一化到同一种形态，再比。
 * 归一化必须**只吸收噪声，不吸收差异**。这个边界很容易越界：
 *   · 认全角 Ａ → 对。学生用中文输入法敲出来的就是全角。
 *   · 认「对/错/√/×/正确/错误/T/F/1/0」→ 对。都是同一个意思。
 *   · 认「1/2」和「0.5」→ 对。数学等价。
 *   · 把「BCNF」和「3NF」都归一化成「NF」→ **错**。那是把答案判没了。
 * 最后一条听起来荒谬，但「统一大小写」和「统一后缀」之间只隔一层窗户纸，
 * 所以这里每个归一化函数都写清楚它吸收的是什么噪声。
 */

/** 全角转半角。中文输入法下敲出来的字母数字标点全是全角，必须统一。 */
export function toHalfWidth(s) {
  return String(s).replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

/**
 * 填空答案归一化。
 * 吸收的噪声：全角、首尾空白、内部多余空格、中文标点、大小写。
 * 不吸收的：数字本身的值（'007' ≠ '7'）、语义（'1/2' 与 '0.5' 的等价在 cellEq 里做）。
 */
export function normalizeBlank(s) {
  let v = toHalfWidth(s).trim();
  v = v.replace(/\s+/g, ' ');
  v = v.replace(/[，、；：（）【】《》]/g, (c) => ({ '，': ',', '、': ',', '；': ';', '：': ':', '（': '(', '）': ')', '【': '[', '】': ']', '《': '<', '》': '>' }[c] || c));
  return v.toLowerCase();
}

/** 判断答案归一化：把各种真假写法收敛到 T / F。 */
const TRUE_WORDS = new Set(['t', 'true', 'y', 'yes', '1', '对', '是', '正确', '√', '✓', 'v', '真']);
const FALSE_WORDS = new Set(['f', 'false', 'n', 'no', '0', '错', '否', '错误', '×', 'x', '✗', '假']);
export function normalizeBool(s) {
  const v = toHalfWidth(s).trim().toLowerCase().replace(/\s/g, '');
  if (TRUE_WORDS.has(v)) return 'T';
  if (FALSE_WORDS.has(v)) return 'F';
  return v;
}

/** 选项答案归一化：'a' / 'Ａ' / 'A' 都是 A。 */
export function normalizeChoice(s) {
  return toHalfWidth(s).trim().toUpperCase().replace(/[^A-Z]/g, '');
}

/** 多选答案归一化：去重 + 排序。顺序无意义。 */
export function normalizeMulti(s) {
  const letters = toHalfWidth(s).trim().toUpperCase().replace(/[^A-Z]/g, '');
  return [...new Set(letters.split(''))].sort().join('');
}

/** 数值容差比较：'0.5' 与 '1/2' 等价，'1.00' 与 '1' 等价。 */
function numericEqual(a, b, tol = 1e-6) {
  const parse = (s) => {
    const v = toHalfWidth(String(s)).trim();
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    const frac = v.match(/^(-?\d+)\s*\/\s*(\d+)$/);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    return null;
  };
  const x = parse(a);
  const y = parse(b);
  if (x === null || y === null) return false;
  return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
}

/**
 * 判一道客观题。
 * @returns {{pass:boolean, score:number, message:string, needsManual?:boolean, correctAnswer?:any}}
 */
export function judgeQuestion(q, answer) {
  const type = q.type;
  const raw = answer == null ? '' : String(answer);

  if (type === 'choice') {
    const got = normalizeChoice(raw);
    const want = normalizeChoice(q.answer);
    if (!got) return { pass: false, score: 0, message: '没有作答。', correctAnswer: want };
    const pass = got === want;
    return {
      pass, score: pass ? 100 : 0,
      message: pass ? '正确。' : `选错了，正确答案是 ${want}。`,
      correctAnswer: want,
    };
  }

  if (type === 'multi') {
    const got = normalizeMulti(raw);
    const want = normalizeMulti(q.answer);
    if (!got) return { pass: false, score: 0, message: '没有作答。', correctAnswer: want };
    if (got === want) return { pass: true, score: 100, message: '正确。', correctAnswer: want };
    /* 多选给部分分：选对但不全得 50 分，选错任何一项得 0。
     * 为什么不给「选对 2 个得 40」这种线性分：那会让「全选」成为一种策略 ——
     * 选项全勾能拿分，但没学会任何东西。选错即零，全对才满分，
     * 中间只有「漏选」一档，这样才逼学生真的判断每一项。 */
    const gotSet = new Set(got.split(''));
    const wantSet = new Set(want.split(''));
    const wrongPicked = [...gotSet].some((c) => !wantSet.has(c));
    if (wrongPicked) {
      return { pass: false, score: 0, message: `选错项了，正确答案是 ${want}。多选里选错任何一项都不给分。`, correctAnswer: want };
    }
    return { pass: false, score: 50, message: `漏选了，正确答案是 ${want}。选对但不全，给一半分。`, correctAnswer: want };
  }

  if (type === 'judge') {
    const got = normalizeBool(raw);
    const want = normalizeBool(q.answer);
    if (!got) return { pass: false, score: 0, message: '没有作答。', correctAnswer: want };
    const pass = got === want;
    return {
      pass, score: pass ? 100 : 0,
      message: pass ? '正确。' : `判断错了，正确答案是「${want === 'T' ? '正确' : '错误'}」。`,
      correctAnswer: want,
    };
  }

  if (type === 'blank') {
    if (!raw.trim()) return { pass: false, score: 0, message: '没有作答。', correctAnswer: q.answer };
    /* 多空题：标准答案用 | 分隔，学生也用 | 分隔（前端按空渲染）。
     * 支持这个是因为「求候选键」这类题天然是多空的。 */
    const wants = String(q.answer).split('|');
    const gots = raw.split('|');
    if (wants.length > 1) {
      if (gots.length !== wants.length) {
        return { pass: false, score: 0, message: `这道题有 ${wants.length} 个空，你填了 ${gots.length} 个。`, correctAnswer: q.answer };
      }
      const results = wants.map((w, i) => normalizeBlank(gots[i]) === normalizeBlank(w) || numericEqual(gots[i], w));
      const hits = results.filter(Boolean).length;
      const pass = hits === wants.length;
      return {
        pass, score: Math.round((hits / wants.length) * 100),
        message: pass ? '全部正确。' : `对了 ${hits}/${wants.length} 个空。`,
        correctAnswer: q.answer,
        perBlank: results,
      };
    }
    const pass = normalizeBlank(raw) === normalizeBlank(q.answer) || numericEqual(raw, q.answer);
    return {
      pass, score: pass ? 100 : 0,
      message: pass ? '正确。' : `答案不对，正确答案是 ${q.answer}。`,
      correctAnswer: q.answer,
    };
  }

  if (type === 'short') {
    return {
      pass: false, score: 0, needsManual: true,
      message: '简答题需要人工批改，已提交。',
      correctAnswer: q.answer,
    };
  }

  return { pass: false, score: 0, message: `未知题型：${type}` };
}

/** 错因归类（供教师看「这个学生到底卡在哪」）。 */
export function guessErrorType(q, answer, verdict) {
  if (verdict.pass) return '';
  const raw = String(answer || '').trim();
  if (!raw) return 'unanswered';

  if (q.type === 'choice' || q.type === 'multi' || q.type === 'judge') return 'concept';
  if (q.type === 'blank') {
    const want = normalizeBlank(q.answer);
    const got = normalizeBlank(raw);
    // 形状相似但值不同 → 更像算错/记错，而不是完全不懂
    if (want && got && want.length && Math.abs(want.length - got.length) <= 1) return 'recall';
    return 'concept';
  }
  return 'unknown';
}
