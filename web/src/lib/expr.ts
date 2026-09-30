/* 表达式求值器（浏览器侧）
 *
 * ── 为什么要和 server/src/ai/expr.js 各存一份 ────────────────────
 * 服务端那份是给模型用的（`calc` 工具、出题时的验算）；
 * 这份是给**拖动参数时实时重绘曲线**用的 —— 拖一下要立刻出图，
 * 不可能走网络。
 *
 * 而 npm workspace 里没有一个能被两边同时 import 的共享包位置：
 * 服务端是 Node ESM（.js），前端是 Vite + TS（.ts），
 * 硬凑一个共享目录要么给服务端加 TS 加载器，要么给前端加跨 root 的构建配置 ——
 * 两种都比「两份 + 一条一致性测试」更脆。
 *
 * ★ 所以 `tests/unit.mjs` 里有一条**跨实现一致性断言**：
 *   同一批表达式喂给两边，结果必须逐位相同。
 *   两份实现本身可以接受，**悄悄漂移**不能接受。
 *
 * 语法子集：+ - * / ^、括号、隐式乘法、一元正负、常用函数与常数。
 * 两个做错了会静默算错的地方：
 *   · `-x^2` 必须是 `-(x^2)`，不是 `(-x)^2`
 *   · `x^2^3` 必须是 `x^(2^3)`，右结合
 */

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign,
};
const FUNCS2: Record<string, (...a: number[]) => number> = {
  pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max, mod: (a, b) => a % b,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

type Tok = { t: string; v?: number | string };
type Scope = Record<string, number>;

function tokenize(src: string): Tok[] {
  const s = String(src);
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }

    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k++;
        if (/[0-9]/.test(s[k] || '')) {
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          j = k;
        }
      }
      const raw = s.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new SyntaxError(`不是合法的数字：${raw}`);
      toks.push({ t: 'num', v });
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

export type Compiled = (x: number, scope?: Scope) => number;

export function compile(src: string, varNames?: string[]): Compiled {
  const vars = Array.isArray(varNames) ? varNames.map(String) : [];
  const varSet = new Set(vars);

  for (const v of vars) {
    if (v === 'x') throw new Error('参数名不能叫 x（x 是自变量）');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error(`参数名不合法：${v}`);
    if (Object.prototype.hasOwnProperty.call(CONSTS, v)) throw new Error(`参数名「${v}」和内置常数重名`);
    if (FUNCS[v] || FUNCS2[v]) throw new Error(`参数名「${v}」和内置函数重名`);
  }

  const toks = tokenize(src);
  let pos = 0;
  const isTok = (t: string) => toks[pos].t === t;
  const eat = (t: string) => {
    if (toks[pos].t !== t) {
      const got = toks[pos].t === 'end' ? '表达式结束' : `「${toks[pos].v ?? toks[pos].t}」`;
      throw new SyntaxError(`这里应该是「${t}」，实际是${got}`);
    }
    pos++;
  };

  type Node = (sc: Scope) => number;

  function parseExpr(): Node {
    let left = parseTerm();
    while (isTok('+') || isTok('-')) {
      const op = toks[pos].t; pos++;
      const right = parseTerm();
      const l = left, r = right;
      left = op === '+' ? (sc) => l(sc) + r(sc) : (sc) => l(sc) - r(sc);
    }
    return left;
  }

  const startsAtom = () => ['num', 'id', '('].includes(toks[pos].t);

  function parseTerm(): Node {
    let left = parseUnary();
    for (;;) {
      if (isTok('*') || isTok('/')) {
        const op = toks[pos].t; pos++;
        const right = parseUnary();
        const l = left, r = right;
        left = op === '*' ? (sc) => l(sc) * r(sc) : (sc) => l(sc) / r(sc);
      } else if (startsAtom()) {
        // 隐式乘法：2x、3log2(x)、2(x+1)、x(x-1)
        const right = parseUnary();
        const l = left, r = right;
        left = (sc) => l(sc) * r(sc);
      } else break;
    }
    return left;
  }

  function parseUnary(): Node {
    // ★ 先吃掉一元负号，再交给 parsePower —— 这样 -x^2 = -(x^2)
    if (isTok('-')) { pos++; const inner = parseUnary(); return (sc) => -inner(sc); }
    if (isTok('+')) { pos++; return parseUnary(); }
    return parsePower();
  }

  function parsePower(): Node {
    const base = parseAtom();
    if (isTok('^')) {
      pos++;
      // ★ 指数位回调 parseUnary，保证右结合：x^2^3 = x^(2^3)
      const exp = parseUnary();
      return (sc) => Math.pow(base(sc), exp(sc));
    }
    return base;
  }

  function parseAtom(): Node {
    const tk = toks[pos];

    if (tk.t === 'num') { pos++; const v = tk.v as number; return () => v; }

    if (tk.t === '(') {
      pos++;
      const inner = parseExpr();
      eat(')');
      return inner;
    }

    if (tk.t === 'id') {
      pos++;
      const name = String(tk.v);
      const isVar = name === 'x' || varSet.has(name);
      const isConst = Object.prototype.hasOwnProperty.call(CONSTS, name);
      const fn1 = FUNCS[name];
      const fn2 = FUNCS2[name];

      /* ★ 顺序要紧：先判「这是不是变量」。
       *   反过来先看后面有没有 `(` 的话，`x(x-1)` 会被当成函数调用 x(...)，
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
        const args: Node[] = [];
        if (!isTok(')')) {
          args.push(parseExpr());
          while (isTok(',')) { pos++; args.push(parseExpr()); }
        }
        eat(')');
        if (fn1) {
          if (args.length !== 1) throw new SyntaxError(`${name} 只接受 1 个参数`);
          const a = args[0];
          return (sc) => fn1(a(sc));
        }
        if (args.length < 2) throw new SyntaxError(`${name} 需要至少 2 个参数`);
        return (sc) => fn2(...args.map((f) => f(sc)));
      }

      throw new SyntaxError(`表达式里用了没声明的符号「${name}」`);
    }

    throw new SyntaxError(tk.t === 'end' ? '表达式不完整' : `表达式里出现了意外的「${tk.v ?? tk.t}」`);
  }

  const ast = parseExpr();
  if (!isTok('end')) throw new SyntaxError(`表达式在「${toks[pos].v ?? toks[pos].t}」之后有多余的内容`);

  return function run(x: number, scope?: Scope) {
    const sc: Scope = { x: typeof x === 'number' ? x : NaN };
    /* ★ scope 只采纳**声明过**的参数名。照单全收的话，
     *   一个叫 pi 的 key 能把内置常数顶掉，而那是模型够得着的输入。 */
    if (scope && typeof scope === 'object') {
      for (const k of vars) {
        const v = scope[k];
        if (v !== undefined) sc[k] = Number(v);
      }
    }
    return ast(sc);
  };
}

export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** 采样。返回 [x, y|null]；不连续处用 null 标记，让渲染层断开路径。 */
export function samplePoints(fn: Compiled, xmin: number, xmax: number, n = 240, scope?: Scope): [number, number | null][] {
  const pts: [number, number | null][] = [];
  const N = Math.max(8, Math.min(1200, n));
  for (let i = 0; i <= N; i++) {
    const x = xmin + ((xmax - xmin) * i) / N;
    let y: number;
    try { y = fn(x, scope); } catch { y = NaN; }
    pts.push([round6(x), !Number.isFinite(y) || Math.abs(y) > 1e5 ? null : round6(y)]);
  }
  return pts;
}
