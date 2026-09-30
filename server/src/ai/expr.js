/* AI · 表达式求值器（无 eval）
 *
 * ── 为什么不用 eval / new Function ──────────────────────────────
 * 表达式来自**模型输出**。用 eval 的话，模型输出 `process.exit()`
 * 就是一次任意代码执行。自己写递归下降 parser 大约一百行，
 * 换来的是「最坏情况只是一个算错的数」。
 *
 * ── 两个做错了会静默算错的地方 ──────────────────────────────────
 *   · `-x^2` 必须是 `-(x^2)`，不是 `(-x)^2`
 *   · `x^2^3` 必须是 `x^(2^3)`，右结合
 * 两条都有回归断言钉着。
 */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign,
};
const FUNCS2 = { pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max, mod: (a, b) => a % b };
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(src) {
  const s = String(src);
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }

    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // 科学计数法 1e-3 / 2.5E6
      if (s[j] === 'e' || s[j] === 'E') {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k++;
        if (/[0-9]/.test(s[k] || '')) {
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          j = k;
        }
      }
      const rawStr = s.slice(i, j);
      const v = Number(rawStr);
      if (!Number.isFinite(v)) throw new SyntaxError(`不是合法的数字：${rawStr}`);
      toks.push({ t: 'num', v, raw: rawStr });
      i = j; continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: 'id', v: s.slice(i, j) });
      i = j; continue;
    }

    if ('+-*/^(),'.includes(c)) { toks.push({ t: c }); i++; continue; }
    throw new SyntaxError(`表达式里有不认识的字符「${c}」`);
  }
  toks.push({ t: 'end' });
  return toks;
}

/**
 * 编译一个表达式。
 * @param {string} src
 * @param {string[]} varNames 允许出现的参数名（自变量 x 总是允许）
 * @returns {(x:number, scope?:object) => number}
 * @throws 任何语法/符号问题都在**编译期**抛出，而不是等到求值时 ——
 *   画图时每个采样点抛一次异常，报错会淹没在噪声里。
 */
export function compile(src, varNames) {
  const vars = Array.isArray(varNames) ? varNames.map(String) : [];
  const varSet = new Set(vars);

  /* ★ 校验放编译期：参数名不许叫 x、不许撞内置常数/函数名 */
  for (const v of vars) {
    if (v === 'x') throw new Error('参数名不能叫 x（x 是自变量）');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error(`参数名不合法：${v}`);
    if (Object.prototype.hasOwnProperty.call(CONSTS, v)) throw new Error(`参数名「${v}」和内置常数重名`);
    if (FUNCS[v] || FUNCS2[v]) throw new Error(`参数名「${v}」和内置函数重名`);
  }

  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isTok = (t) => toks[pos].t === t;
  const eat = (t) => {
    if (toks[pos].t !== t) {
      const got = toks[pos].t === 'end' ? '表达式结束' : `「${toks[pos].v ?? toks[pos].t}」`;
      throw new SyntaxError(`这里应该是「${t}」，实际是${got}`);
    }
    pos++;
  };

  function parseExpr() {
    let left = parseTerm();
    while (isTok('+') || isTok('-')) {
      const op = toks[pos].t; pos++;
      const right = parseTerm();
      const l = left, r = right;
      left = op === '+' ? (sc) => l(sc) + r(sc) : (sc) => l(sc) - r(sc);
    }
    return left;
  }

  function startsAtom() {
    const t = toks[pos].t;
    return t === 'num' || t === 'id' || t === '(';
  }

  function parseTerm() {
    let left = parseUnary();
    for (;;) {
      if (isTok('*') || isTok('/')) {
        const op = toks[pos].t; pos++;
        const right = parseUnary();
        const l = left, r = right;
        left = op === '*' ? (sc) => l(sc) * r(sc) : (sc) => l(sc) / r(sc);
      } else if (startsAtom()) {
        /* 隐式乘法：2x、3sin(x)、2(x+1)、x(x-1)。
         * 在 term 层做而不是在 atom 层，这样 `x^2y` 会读成 (x^2)*y。 */
        const right = parseUnary();
        const l = left, r = right;
        left = (sc) => l(sc) * r(sc);
      } else break;
    }
    return left;
  }

  function parseUnary() {
    // ★ 先吃掉一元负号，再交给 parsePower —— 这样 -x^2 = -(x^2)
    if (isTok('-')) { pos++; const inner = parseUnary(); return (sc) => -inner(sc); }
    if (isTok('+')) { pos++; return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (isTok('^')) {
      pos++;
      // ★ 指数位回调 parseUnary，保证右结合：x^2^3 = x^(2^3)
      const exp = parseUnary();
      return (sc) => Math.pow(base(sc), exp(sc));
    }
    return base;
  }

  function parseAtom() {
    const tk = peek();

    if (tk.t === 'num') { pos++; const v = tk.v; return () => v; }

    if (tk.t === '(') {
      pos++;
      const inner = parseExpr();
      eat(')');
      return inner;
    }

    if (tk.t === 'id') {
      pos++;
      const name = tk.v;
      const isVar = name === 'x' || varSet.has(name);
      const isConst = Object.prototype.hasOwnProperty.call(CONSTS, name);
      const fn1 = FUNCS[name];
      const fn2 = FUNCS2[name];

      /* ★ 顺序要紧：先判「这是不是变量」。
       *   反过来先看后面有没有 `(` 的话，`x(x-1)` 会被当成函数调用 `x(...)`，
       *   报出「没有这个函数 x」—— 而它明明是隐式乘法。 */
      if (isVar) {
        return (sc) => {
          const v = sc[name];
          return typeof v === 'number' ? v : NaN;
        };
      }

      if (isConst) { const v = CONSTS[name]; return () => v; }

      if (fn1 || fn2) {
        if (!isTok('(')) throw new SyntaxError(`${name} 是函数，后面要跟括号`);
        pos++;
        const args = [];
        if (!isTok(')')) {
          args.push(parseExpr());
          while (isTok(',')) { pos++; args.push(parseExpr()); }
        }
        eat(')');
        if (fn1) {
          if (args.length !== 1) throw new SyntaxError(`${name} 只接受 1 个参数，给了 ${args.length} 个`);
          const a = args[0];
          return (sc) => fn1(a(sc));
        }
        if (args.length < 2) throw new SyntaxError(`${name} 需要至少 2 个参数`);
        const as = args;
        return (sc) => fn2(...as.map((f) => f(sc)));
      }

      throw new SyntaxError(`表达式里用了没声明的符号「${name}」`);
    }

    if (tk.t === 'end') throw new SyntaxError('表达式不完整');
    throw new SyntaxError(`表达式里出现了意外的「${tk.v ?? tk.t}」`);
  }

  const ast = parseExpr();
  if (!isTok('end')) {
    const tk = toks[pos];
    throw new SyntaxError(`表达式在「${tk.v ?? tk.t}」之后有多余的内容`);
  }

  return function run(x, scope) {
    const sc = { x: typeof x === 'number' ? x : NaN };
    /* ★ scope 只采纳**声明过**的参数名。
     *   照单全收的话，一个叫 pi 或 e 的 key 能把内置常数顶掉，
     *   而那是调用方（模型）完全够得着的输入。 */
    if (scope && typeof scope === 'object') {
      for (const k of vars) {
        const v = scope[k];
        if (v !== undefined) sc[k] = Number(v);
      }
    }
    return ast(sc);
  };
}

export function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

/** 采样。返回 [x, y|null]；不连续处用 null 标记，让渲染层断开路径。 */
export function samplePoints(fn, xmin, xmax, n, scope) {
  const pts = [];
  const N = Math.max(8, Math.min(1200, Number(n) || 240));
  for (let i = 0; i <= N; i++) {
    const x = xmin + ((xmax - xmin) * i) / N;
    let y;
    try { y = fn(x, scope); } catch { y = NaN; }
    if (!Number.isFinite(y) || Math.abs(y) > 1e5) y = null;
    pts.push([round6(x), y === null ? null : round6(y)]);
  }
  return pts;
}

/** 2%–98% 分位裁剪 + 留白。不用 min/max 是因为一个极点会把整张图压成一条线。 */
export function envelope(values, pad = 0.12) {
  const ys = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ys.length) return { ymin: -1, ymax: 1 };
  const lo = ys[Math.floor(ys.length * 0.02)];
  const hi = ys[Math.min(ys.length - 1, Math.ceil(ys.length * 0.98))];
  let span = hi - lo;
  if (!(span > 0)) span = Math.max(1, Math.abs(hi) * 0.5);
  return { ymin: round6(lo - span * pad), ymax: round6(hi + span * pad) };
}
