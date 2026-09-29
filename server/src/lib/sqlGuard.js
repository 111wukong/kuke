/* SQL 语句切分与安全闸门
 *
 * ── 一、为什么要自己写切分器 ─────────────────────────────────────
 * 学生提交的是一段脚本：`CREATE TABLE t(...); INSERT INTO t VALUES(1); SELECT * FROM t;`
 * 要逐条执行、逐条取结果，就必须按分号切。而 `sql.split(';')` 是错的：
 *   SELECT ';' AS semi;                    -- 分号在字符串里
 *   SELECT "a;b";                          -- 分号在标识符里
 *   SELECT 1 -- 注释里的分号 ; 不是分隔符
 *   SELECT 1 /* 块注释里的 ; 也不是 *\/;
 * 上面四条都会被朴素 split 切坏，而症状是「报语法错误」——
 * 学生会以为是自己写错了。所以必须有一个认字符串和注释的切分器。
 *
 * 本切分器处理：单引号字符串（含 '' 转义）、双引号标识符、
 * 反引号、方括号、-- 行注释、块注释。触发器里的 BEGIN...END 不处理
 * —— 本课程的实训范围不含触发器，遇到会自然切错并报语法错，
 * 这比写一个半吊子的 BEGIN/END 配对器更诚实。
 *
 * ── 二、安全闸门 ────────────────────────────────────────────────
 * 沙箱是「每次执行都新建一个内存库」，所以写操作本身无害 ——
 * 改的是一份用完就扔的副本。教学上也必须允许写：
 * 不让学生写 INSERT/UPDATE/DELETE/CREATE，SQL 就只教了一半。
 *
 * 真正必须拦的是**能逃出内存库**的东西：
 *   ATTACH / DETACH      —— 能把任意磁盘文件挂成数据库，然后读它。
 *                           这是本沙箱唯一真正的逃逸路径。
 *   load_extension()     —— 加载 .so/.dylib 并执行其代码，等于任意代码执行。
 *   PRAGMA 的危险子集     —— writable_schema 能直接改 sqlite_master 绕过一切约束；
 *                           temp_store_directory / data_store_directory 能改落盘位置。
 *   VACUUM INTO          —— 能把库写成磁盘文件。
 *
 * 另外拦一类「不是攻击但是事故」的：写操作里的 WHERE 缺失。
 * 不做强制，只在结果里给个提醒（见 analyze 的 warnings）——
 * 学生写 UPDATE t SET x=1 忘了 WHERE 把整表刷了，在内存库上无害，
 * 但这个习惯带到生产库就是事故。教学系统有义务指出来。
 */

/* ---------- 语句切分 ---------- */

export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];

    // 行注释
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') buf += sql[i++];
      continue;
    }
    // 块注释
    if (c === '/' && sql[i + 1] === '*') {
      buf += sql[i++]; buf += sql[i++];
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) buf += sql[i++];
      if (i < n) { buf += sql[i++]; buf += sql[i++]; }
      continue;
    }
    // 单引号字符串（'' 是转义的单引号）
    if (c === "'") {
      buf += sql[i++];
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += sql[i++]; buf += sql[i++]; continue; }
        if (sql[i] === "'") { buf += sql[i++]; break; }
        buf += sql[i++];
      }
      continue;
    }
    // 双引号 / 反引号标识符
    if (c === '"' || c === '`') {
      const q = c;
      buf += sql[i++];
      while (i < n) {
        if (sql[i] === q && sql[i + 1] === q) { buf += sql[i++]; buf += sql[i++]; continue; }
        if (sql[i] === q) { buf += sql[i++]; break; }
        buf += sql[i++];
      }
      continue;
    }
    // 方括号标识符
    if (c === '[') {
      buf += sql[i++];
      while (i < n && sql[i] !== ']') buf += sql[i++];
      if (i < n) buf += sql[i++];
      continue;
    }
    // 语句分隔
    if (c === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += sql[i++];
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** 去掉注释和字符串后的「骨架」，用于关键词匹配（避免注释里写个 DROP 就被拦）。 */
export function stripLiterals(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { i += 2; while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (sql[i] === q && sql[i + 1] === q) { i += 2; continue; }
        if (sql[i] === q) { i++; break; }
        i++;
      }
      out += ' ? ';
      continue;
    }
    if (c === '[') { while (i < n && sql[i] !== ']') i++; i++; out += ' ? '; continue; }
    out += c; i++;
  }
  return out;
}

/* ---------- 语句分类 ---------- */

const READ_HEADS = new Set(['select', 'with', 'values', 'explain']);
const WRITE_HEADS = new Set(['insert', 'update', 'delete', 'replace']);
const DDL_HEADS = new Set(['create', 'drop', 'alter']);

/** 取一条语句的「头部关键词」（可能有两三个词，如 CREATE TABLE / DROP INDEX）。 */
export function statementKind(stmt) {
  const s = stripLiterals(stmt).trim();
  const m = s.match(/^([a-zA-Z_]+)(?:\s+([a-zA-Z_]+))?/);
  if (!m) return 'unknown';
  return (m[1] + (m[2] ? ' ' + m[2] : '')).toLowerCase();
}

const BLOCKED_PATTERNS = [
  { re: /\battach\s+(database\s+)?/i, why: 'ATTACH 能把磁盘上的任意文件挂成数据库再读出来，沙箱里禁止' },
  { re: /\bdetach\s+(database\s+)?/i, why: 'DETACH 与 ATTACH 配套，沙箱里禁止' },
  { re: /\bload_extension\s*\(/i, why: 'load_extension 会加载并执行本地动态库，等于任意代码执行，禁止' },
  { re: /\bvacuum\s+into\b/i, why: 'VACUUM INTO 会把数据库写成磁盘文件，禁止' },
  { re: /\bwritable_schema\b/i, why: 'writable_schema 能直接改写系统表绕过所有约束，禁止' },
  { re: /\bdata_store_directory\b/i, why: '该 PRAGMA 会改变落盘目录，禁止' },
  { re: /\btemp_store_directory\b/i, why: '该 PRAGMA 会改变落盘目录，禁止' },
  { re: /\bsqlite_master\b/i, why: '直接读写系统表不在本课程范围内，且容易被用来绕过约束' },
  { re: /\bsqlite_schema\b/i, why: '直接读写系统表不在本课程范围内' },
  { re: /\bpragma\s+(journal_mode|locking_mode|page_size|mmap_size)\b/i, why: '这条 PRAGMA 会影响数据库文件本身的行为，沙箱里禁止' },
];

/** 允许的 PRAGMA 白名单（教学上真正有用的那几个）。 */
const PRAGMA_ALLOW = /^pragma\s+(table_info|index_list|index_info|foreign_key_list|table_xinfo|database_list|compile_options|encoding)\b/i;

export function checkStatement(stmt, { allowWrite = true } = {}) {
  const kind = statementKind(stmt);

  for (const { re, why } of BLOCKED_PATTERNS) {
    if (re.test(stripLiterals(stmt))) return { ok: false, kind, reason: why, code: 'BLOCKED' };
  }

  if (kind.startsWith('pragma')) {
    if (!PRAGMA_ALLOW.test(stripLiterals(stmt).trim())) {
      return { ok: false, kind, reason: '只允许查询型的 PRAGMA（table_info / index_list / foreign_key_list 等）', code: 'PRAGMA_NOT_ALLOWED' };
    }
    return { ok: true, kind };
  }

  const head = kind.split(' ')[0];
  if (READ_HEADS.has(head)) return { ok: true, kind, readonly: true };

  if (WRITE_HEADS.has(head) || DDL_HEADS.has(head)) {
    if (!allowWrite) {
      return { ok: false, kind, reason: '本关只允许写查询语句（SELECT / WITH）。要练写操作请去「SQL 实训场」的自由模式。', code: 'READONLY_MODE' };
    }
    return { ok: true, kind, readonly: false, mutating: true };
  }

  if (head === 'begin' || head === 'commit' || head === 'rollback' || head === 'savepoint') {
    // 事务由沙箱自己管理，学生手动开事务会和外层的执行流程打架
    return { ok: false, kind, reason: '沙箱会自动管理事务，不需要手写 BEGIN / COMMIT', code: 'NO_MANUAL_TXN' };
  }

  return { ok: false, kind, reason: `不支持的语句类型：${kind}`, code: 'UNSUPPORTED' };
}

/* ---------- 静态分析（给学生看的提醒）---------- */

export function analyze(sql, { allowWrite = true } = {}) {
  const statements = splitStatements(sql);
  const errors = [];
  const warnings = [];
  const kinds = [];

  if (!statements.length) errors.push('没有可执行的语句');

  for (const st of statements) {
    const r = checkStatement(st, { allowWrite });
    kinds.push(r.kind);
    if (!r.ok) errors.push(r.reason);
    else if (r.mutating) {
      const s = stripLiterals(st);
      if (/^(update|delete)/i.test(s.trim()) && !/\bwhere\b/i.test(s)) {
        warnings.push(`这条 ${r.kind.toUpperCase()} 没有 WHERE —— 在生产库里会改动全表。沙箱里只影响你的临时副本，但习惯要养对。`);
      }
    }
  }

  /* SELECT * 不是错，但在课程里值得提一句：
   * 「*」会让结果列依赖表结构，表加一列答案就变了 —— 判题时尤其明显。 */
  if (statements.some((s) => /select\s+\*/i.test(stripLiterals(s)))) {
    warnings.push('用了 SELECT *。列顺序和列名会随表结构变化，做练习时建议显式列出需要的列。');
  }

  return { statements, kinds, errors, warnings };
}
