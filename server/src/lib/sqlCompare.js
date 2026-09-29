/* 结果集比对判题
 *
 * ── 核心决定：不比对 SQL 文本，比对结果集 ──────────────────────────
 * 同一道「查出所有姓张的学生」，下面四句都是对的：
 *     SELECT * FROM student WHERE name LIKE '张%';
 *     select * from student where name like '张%'
 *     SELECT id,name FROM student WHERE substr(name,1,1)='张';
 *     SELECT * FROM student WHERE name GLOB '张*';
 * 文本比对会把后三句判错 —— 那是在考拼写，不是在考 SQL。
 * 所以判题流程是：把参考答案和学生的答案**分别在同一份数据集上跑一遍**，
 * 比对两份结果表。这样「怎么写」不重要，「查对了没有」才重要。
 *
 * ── 但结果集比对有三个坑，必须一个个填 ──────────────────────────
 *
 * 坑 1：行序。
 *   SQL 标准里没有 ORDER BY 的结果集**无序**，引擎可以按任意顺序返回。
 *   所以默认必须按行排序后比对（当作多重集），否则
 *   `SELECT name FROM student` 和参考答案会因为物理顺序不同而误判。
 *   反过来，题目里出现 ORDER BY / LIMIT 时行序**就是答案的一部分**，
 *   此时必须按序比对 —— 否则「取工资最高的 3 个人」不写 ORDER BY 也能过。
 *   这就是 level.order_matters 存在的全部理由。
 *
 * 坑 2：列名。
 *   参考答案写 `SELECT COUNT(*)`，列名是 "COUNT(*)"；
 *   学生写 `SELECT COUNT(*) AS 人数`，列名是 "人数"。数据完全一致。
 *   把列名当硬性条件会大面积误伤，当完全不管又漏掉「要求输出指定列名」的题。
 *   折中：**列数硬比、列名默认只警告**，题目需要时用 require_columns 打开。
 *
 * 坑 3：值的类型。
 *   SQLite 是动态类型。`SELECT 1` 和 `SELECT 1.0` 和 `SELECT '1'` 拿到的是
 *   number / number / string。按 === 比会把 1 和 '1' 判成不同。
 *   所以先做数值化尝试：两边都能转成数字就按数字比，否则按字符串比。
 *   NULL 单独处理（NULL !== NULL，但作为查询结果它们「相同」）。
 */

/** 把单元格归一化成可比较的标量。 */
export function normalizeCell(v) {
  if (v === null || v === undefined) return { t: 'null' };
  if (typeof v === 'number') return { t: 'num', v };
  if (typeof v === 'bigint') return { t: 'num', v: Number(v) };
  if (typeof v === 'boolean') return { t: 'num', v: v ? 1 : 0 };

  if (typeof v === 'string') {
    const s = v;
    /* 纯数字字符串按数字比。为什么必须做：
     * `WHERE price > 10` 在 SQLite 里如果 price 是 TEXT 列，
     * 比较走的是字符串序；不同写法的参考答案可能得到 '10' 也可能得到 10。
     * 这是类型亲和性造成的，不是学生写错了 —— 判题器要吸收这个噪声。
     * 但只处理「看起来确实是数字」的串，避免把 '007' 和 '7' 混为一谈……
     * 而 '007' 与 '7' 的取舍：本课程里学号 '007' 和 '7' 是不同答案，
     * 所以只对「无前导零」的串做数值化。 */
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return { t: 'num', v: n };
    }
    return { t: 'str', v: s };
  }

  return { t: 'str', v: String(v) };
}

function cellEq(a, b) {
  const x = normalizeCell(a);
  const y = normalizeCell(b);
  if (x.t === 'null' || y.t === 'null') return x.t === y.t;
  if (x.t === 'num' && y.t === 'num') {
    // 浮点容差：AVG() 这类聚合的结果，两种等价写法可能差在最后一位
    return Math.abs(x.v - y.v) < 1e-9;
  }
  return String(x.v) === String(y.v);
}

function rowEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!cellEq(a[i], b[i])) return false;
  return true;
}

/** 行指纹，用于排序 + 快速找差异。 */
const rowKey = (r) => r.map((c) => {
  const n = normalizeCell(c);
  return n.t === 'null' ? '\u0000NULL' : `${n.t}:${n.v}`;
}).join('\u0001');

/**
 * 多重集差异：找出「多了哪些行」「少了哪些行」。
 * 用计数而不是集合，因为结果里出现重复行是合法的
 * （`SELECT dept FROM emp` 一个部门有多个人就重复）。
 */
function multisetDiff(actual, expected) {
  const count = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = rowKey(r);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const A = count(actual);
  const B = count(expected);
  const missing = [];
  const extra = [];

  for (const [k, n] of B) {
    const have = A.get(k) || 0;
    if (have < n) missing.push({ key: k, n: n - have });
  }
  for (const [k, n] of A) {
    const want = B.get(k) || 0;
    if (n > want) extra.push({ key: k, n: n - want });
  }
  return { missing, extra };
}

/** 从执行结果里取「最后一条有结果集的语句」——那才是学生想让我们看的。 */
export function finalResultSet(exec) {
  if (!exec?.results?.length) return null;
  for (let i = exec.results.length - 1; i >= 0; i--) {
    const r = exec.results[i];
    if (r.error) return { error: r.error, sql: r.sql };
    if (r.columns && r.columns.length) return r;
  }
  // 全是写操作（INSERT/UPDATE/CREATE）——没有结果集可看
  const last = exec.results[exec.results.length - 1];
  return last ? { error: '', sql: last.sql, columns: [], rows: [], writeOnly: true } : null;
}

/**
 * 比对两份结果集。
 *
 * @param {object} actual    学生答案的结果集
 * @param {object} expected  参考答案的结果集
 * @param {object} opts
 *   orderMatters   行序是否参与判定（题目含 ORDER BY / LIMIT 时为 true）
 *   requireColumns 列名是否必须一致
 *   maxDiffRows    反馈里最多列几行差异
 */
export function compareResults(actual, expected, opts = {}) {
  const { orderMatters = false, requireColumns = false, maxDiffRows = 5 } = opts;

  if (!expected) return { pass: false, reason: 'NO_REFERENCE', message: '这道题的参考答案有问题，请联系老师。' };
  if (!actual) return { pass: false, reason: 'NO_RESULT', message: '没有拿到执行结果。' };
  if (actual.error) return { pass: false, reason: 'SQL_ERROR', message: actual.error };

  const aCols = actual.columns || [];
  const eCols = expected.columns || [];
  const aRows = actual.rows || [];
  const eRows = expected.rows || [];

  if (expected.writeOnly) {
    /* 参考答案本身就是写操作（INSERT/UPDATE/CREATE 类关卡）。
     * 这类题没法用结果集判，必须靠 check_sql 自定义校验 —— 走到这里说明
     * 题目配错了，如实报告，别硬判。 */
    return { pass: false, reason: 'REFERENCE_NOT_QUERY', message: '这道题的参考答案不是查询语句，无法用结果集判定。' };
  }

  if (aCols.length !== eCols.length) {
    return {
      pass: false,
      reason: 'COLUMN_COUNT',
      message: `列数不对：你输出了 ${aCols.length} 列（${aCols.join(', ')}），期望 ${eCols.length} 列（${eCols.join(', ')}）。`,
      actualColumns: aCols, expectedColumns: eCols,
    };
  }

  const colNameWarn = !aCols.every((c, i) => String(c).toLowerCase() === String(eCols[i]).toLowerCase());
  if (colNameWarn && requireColumns) {
    return {
      pass: false,
      reason: 'COLUMN_NAME',
      message: `列名不对：你的是 ${aCols.join(', ')}，期望 ${eCols.join(', ')}。`,
      actualColumns: aCols, expectedColumns: eCols,
    };
  }

  if (orderMatters) {
    if (aRows.length !== eRows.length) {
      return {
        pass: false, reason: 'ROW_COUNT',
        message: `行数不对：你返回 ${aRows.length} 行，期望 ${eRows.length} 行。`,
        actualRows: aRows, expectedRows: eRows,
      };
    }
    for (let i = 0; i < eRows.length; i++) {
      if (!rowEq(aRows[i], eRows[i])) {
        return {
          pass: false, reason: 'ROW_ORDER',
          message: `第 ${i + 1} 行对不上（本题要求按指定顺序输出）。\n你的：${fmtRow(aRows[i])}\n期望：${fmtRow(eRows[i])}`,
          actualRows: aRows, expectedRows: eRows, diffAt: i,
        };
      }
    }
    return {
      pass: true,
      reason: 'OK',
      message: colNameWarn ? '结果正确。列名与参考答案不同（数据一致，本题不要求列名）。' : '结果正确。',
      warnings: colNameWarn ? [`列名不同：${aCols.join(', ')} vs ${eCols.join(', ')}`] : [],
      actualColumns: aCols, expectedColumns: eCols,
    };
  }

  // 无序比对：当多重集处理
  if (aRows.length !== eRows.length) {
    const { missing, extra } = multisetDiff(aRows, eRows);
    return {
      pass: false, reason: 'ROW_COUNT',
      message: `行数不对：你返回 ${aRows.length} 行，期望 ${eRows.length} 行。` + describeDiff(missing, extra, maxDiffRows),
      actualRows: aRows, expectedRows: eRows,
    };
  }

  const { missing, extra } = multisetDiff(aRows, eRows);
  if (missing.length || extra.length) {
    return {
      pass: false, reason: 'ROW_CONTENT',
      message: '行数对了，但内容有出入。' + describeDiff(missing, extra, maxDiffRows),
      actualRows: aRows, expectedRows: eRows,
    };
  }

  return {
    pass: true,
    reason: 'OK',
    message: colNameWarn ? '结果正确。列名与参考答案不同（数据一致，本题不要求列名）。' : '结果正确。',
    warnings: colNameWarn ? [`列名不同：${aCols.join(', ')} vs ${eCols.join(', ')}`] : [],
    actualColumns: aCols, expectedColumns: eCols,
  };
}

function fmtRow(r) {
  return `(${r.map((c) => (c === null || c === undefined ? 'NULL' : String(c))).join(', ')})`;
}

function describeDiff(missing, extra, maxRows) {
  const parts = [];
  if (missing.length) {
    parts.push(`\n少了 ${missing.reduce((s, m) => s + m.n, 0)} 行，例如：` +
      missing.slice(0, maxRows).map((m) => `\n  缺 ${m.key.replace(/\u0001/g, ' | ').replace(/[a-z]+:/g, '')}`).join(''));
  }
  if (extra.length) {
    parts.push(`\n多了 ${extra.reduce((s, m) => s + m.n, 0)} 行，例如：` +
      extra.slice(0, maxRows).map((m) => `\n  多 ${m.key.replace(/\u0001/g, ' | ').replace(/[a-z]+:/g, '')}`).join(''));
  }
  if (missing.length > maxRows || extra.length > maxRows) parts.push('\n（只列出前几行）');
  return parts.join('');
}

/** 便利封装：从两次执行结果直接判定。 */
export function judgeSql(actualExec, expectedExec, opts = {}) {
  const a = finalResultSet(actualExec);
  const e = finalResultSet(expectedExec);
  const res = compareResults(a, e, opts);
  return {
    ...res,
    actual: a ? { columns: a.columns, rows: (a.rows || []).slice(0, 50), rowCount: (a.rows || []).length } : null,
    expected: e ? { columns: e.columns, rows: (e.rows || []).slice(0, 50), rowCount: (e.rows || []).length } : null,
  };
}
