/* SQL 语法高亮
 *
 * ── 为什么不用 CodeMirror / Monaco ──────────────────────────────
 * CodeMirror 6 + lang-sql 约 200KB，Monaco 是 2MB 级。
 * 而本课程要的高亮只有六类（关键字、字符串、数字、注释、函数、运算符），
 * 一个 100 行的分词器就够了。
 *
 * ── ★ 安全：这是整个前端最需要注意的一处 ────────────────────────
 * 高亮结果要通过 dangerouslySetInnerHTML 塞进 DOM，
 * 而输入是**学生自己写的 SQL**。所以每一个字符都必须先转义再包 span ——
 * 顺序反了（先包 span 再转义）会把 span 标签也转义掉，
 * 而漏掉转义则是教科书级的 XSS：
 *   SELECT '<img src=x onerror=alert(1)>'
 * 上面这行字符串字面量里的内容会被当成 HTML 执行。
 *
 * 本实现的做法是：**先切 token，再对每个 token 的原文转义，最后拼 HTML**。
 * 拼的时候只用我们自己生成的固定标签名和类名，不含任何用户输入。
 */

const KEYWORDS = new Set([
  'select', 'from', 'where', 'group', 'by', 'having', 'order', 'limit', 'offset',
  'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'on', 'using',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'replace',
  'create', 'table', 'view', 'index', 'unique', 'drop', 'alter', 'add', 'column',
  'primary', 'key', 'foreign', 'references', 'check', 'default', 'not', 'null',
  'and', 'or', 'in', 'exists', 'between', 'like', 'glob', 'is', 'as', 'distinct',
  'union', 'all', 'except', 'intersect', 'case', 'when', 'then', 'else', 'end',
  'asc', 'desc', 'with', 'recursive', 'over', 'partition', 'window', 'filter',
  'auto_increment', 'cascade', 'restrict', 'constraint', 'begin', 'commit',
  'rollback', 'transaction', 'explain', 'analyze', 'vacuum', 'attach', 'detach',
  'pragma', 'if', 'temporary', 'temp', 'without', 'rowid', 'conflict', 'do',
  'nothing', 'excluded', 'returning', 'true', 'false', 'cast', 'collate',
]);

const FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'max', 'min', 'total', 'group_concat',
  'abs', 'round', 'ceil', 'floor', 'random', 'sign',
  'length', 'lower', 'upper', 'substr', 'substring', 'trim', 'ltrim', 'rtrim',
  'replace', 'instr', 'printf', 'format', 'hex', 'quote', 'char', 'unicode',
  'coalesce', 'ifnull', 'nullif', 'iif',
  'date', 'time', 'datetime', 'julianday', 'strftime', 'unixepoch', 'localtime',
  'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead',
  'first_value', 'last_value', 'nth_value', 'cume_dist', 'percent_rank',
  'json_extract', 'json_object', 'json_array', 'typeof', 'changes', 'last_insert_rowid',
]);

const OPERATORS = new Set(['=', '<>', '!=', '<', '>', '<=', '>=', '||', '+', '-', '*', '/', '%']);

export interface Token {
  t: 'kw' | 'str' | 'num' | 'cmt' | 'fn' | 'op' | 'plain' | 'ws';
  v: string;
}

/** 把 SQL 切成 token。不抛错 —— 半截的语句（学生正在打字）也要能高亮。 */
export function tokenizeSql(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;

  const push = (t: Token['t'], v: string) => { if (v) out.push({ t, v }); };

  while (i < n) {
    const c = sql[i];

    // 空白
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(sql[j])) j++;
      push('ws', sql.slice(i, j));
      i = j;
      continue;
    }

    // 行注释
    if (c === '-' && sql[i + 1] === '-') {
      let j = i;
      while (j < n && sql[j] !== '\n') j++;
      push('cmt', sql.slice(i, j));
      i = j;
      continue;
    }

    // 块注释
    if (c === '/' && sql[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      push('cmt', sql.slice(i, j));
      i = j;
      continue;
    }

    // 字符串字面量（'' 是转义的单引号）
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      push('str', sql.slice(i, j));
      i = j;
      continue;
    }

    // 引号标识符 / 反引号
    if (c === '"' || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === q && sql[j + 1] === q) { j += 2; continue; }
        if (sql[j] === q) { j++; break; }
        j++;
      }
      push('plain', sql.slice(i, j));
      i = j;
      continue;
    }

    // 方括号标识符
    if (c === '[') {
      let j = i + 1;
      while (j < n && sql[j] !== ']') j++;
      j = Math.min(n, j + 1);
      push('plain', sql.slice(i, j));
      i = j;
      continue;
    }

    // 数字
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9.eE]/.test(sql[j])) {
        // 处理 1e-5 这种指数里的符号
        if ((sql[j] === 'e' || sql[j] === 'E') && /[+-]/.test(sql[j + 1] || '')) j++;
        j++;
      }
      push('num', sql.slice(i, j));
      i = j;
      continue;
    }

    // 标识符 / 关键字 / 函数
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$\u4e00-\u9fa5]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const low = word.toLowerCase();
      // 函数判定：后面（跳过空白）紧跟左括号
      let k = j;
      while (k < n && /\s/.test(sql[k])) k++;
      const isCall = sql[k] === '(';
      if (KEYWORDS.has(low)) push('kw', word);
      else if (isCall || FUNCTIONS.has(low)) push('fn', word);
      else push('plain', word);
      i = j;
      continue;
    }

    // 运算符
    const two = sql.slice(i, i + 2);
    if (OPERATORS.has(two)) { push('op', two); i += 2; continue; }
    if (OPERATORS.has(c)) { push('op', c); i += 1; continue; }

    push('plain', c);
    i += 1;
  }

  return out;
}

/** HTML 转义。★ 顺序上必须在包 span **之前** —— 先包再转会把标签也转掉。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CLASS: Record<Token['t'], string> = {
  kw: 'tok-kw', str: 'tok-str', num: 'tok-num', cmt: 'tok-cmt',
  fn: 'tok-fn', op: 'tok-op', plain: '', ws: '',
};

/** 把 SQL 转成可安全 innerHTML 的高亮 HTML。 */
export function highlightSql(sql: string): string {
  return tokenizeSql(sql)
    .map((tok) => {
      const safe = escapeHtml(tok.v);
      const cls = CLASS[tok.t];
      return cls ? `<span class="${cls}">${safe}</span>` : safe;
    })
    .join('');
}

/** 简易 SQL 格式化（够用版：按主要子句换行 + 缩进）。
 *  不追求完美排版 —— 它只是给学生一个"看得清"的起点。 */
export function formatSql(sql: string): string {
  const BREAK = [
    'select', 'from', 'where', 'group by', 'having', 'order by', 'limit', 'offset',
    'join', 'inner join', 'left join', 'right join', 'full join', 'cross join',
    'union', 'union all', 'except', 'intersect', 'values', 'set',
  ];
  let out = String(sql).replace(/\s+/g, ' ').trim();
  for (const kw of BREAK) {
    out = out.replace(new RegExp(`\\s*\\b(${kw})\\b`, 'gi'), `\n${kw.toUpperCase()}`);
  }
  out = out.replace(/\s*,\s*/g, ',\n  ');
  out = out.replace(/^\n+/, '');
  // 缩进 JOIN 之后的行
  return out.split('\n').map((line, idx) => {
    const t = line.trim();
    if (!t) return '';
    if (/^(join|inner join|left join|right join|full join|cross join)\b/i.test(t)) return `  ${t}`;
    if (/^(on|and|or)\b/i.test(t)) return `    ${t}`;
    return idx === 0 ? t : t;
  }).join('\n');
}
