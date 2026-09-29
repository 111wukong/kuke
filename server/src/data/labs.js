/* 实验台：索引实验 + 事务实验
 *
 * ── 为什么这两类题值得单独做 ────────────────────────────────────
 * 「索引失效」和「可串行化判定」是数据库课里最"纸上谈兵"的两块 ——
 * 教材上讲一堆规则，学生背下来了，但从没见过规则跑起来的样子。
 * 而这两块恰恰**可以被真实执行验证**：
 *   · 索引：\`EXPLAIN QUERY PLAN\` 会告诉你优化器到底用没用索引
 *   · 事务：优先图有没有环，是可以算出来的
 *
 * 所以本实验台的答案不是"我写的"，是**引擎给的**。
 * tests/content.mjs 会真的跑一遍 EXPLAIN、真的算一遍优先图，
 * 和数据里声明的答案对账 —— 对不上就失败。这意味着题目不可能配错答案。
 *
 * ── payload 结构 ────────────────────────────────────────────────
 * kind='index':
 *   payload.dataset_id  用哪个数据集
 *   payload.query       要分析的查询
 *   payload.options[]   { key, label, ddl|null, helps }
 *                       helps 是"这个索引能否让查询从 SCAN 变成 SEARCH"的声明，
 *                       由 content.mjs 实际验证
 *   answer.pick         正确选项
 *
 * kind='txn':
 *   payload.schedule[]  { t: 'T1', op: 'r'|'w', item: 'A' }
 *   payload.ask         'serializable' | 'anomaly'
 *   payload.options[]   { key, label }
 *   answer.pick
 *   对 ask='serializable'，正确答案由优先图算出（content.mjs 验证）
 */

export const LABS = [
  /* ==================== 索引实验 ==================== */
  {
    id: 'IX01', kind: 'index', kid: 'k-index-use', difficulty: 3,
    title: '哪个索引能让这条查询快起来？',
    brief: `数据集：**学生选课库**。查询：

\`\`\`sql
SELECT * FROM student WHERE sdept = '计算机系';
\`\`\`

现在 \`student\` 表上**没有任何索引**（只有主键 sno）。

下面四个选项，哪个能让这条查询从**全表扫描**变成**索引查找**？

> 提示：索引要建在**条件用到的列**上才有用。
> 建在别的列上，优化器根本不会考虑它。`,
    payload: {
      dataset_id: 'school',
      query: "SELECT * FROM student WHERE sdept = '计算机系'",
      options: [
        { key: 'A', label: 'CREATE INDEX idx_s_dept ON student(sdept)', ddl: 'CREATE INDEX idx_s_dept ON student(sdept)', helps: true },
        { key: 'B', label: 'CREATE INDEX idx_s_sage ON student(sage)', ddl: 'CREATE INDEX idx_s_sage ON student(sage)', helps: false },
        { key: 'C', label: 'CREATE INDEX idx_s_name ON student(sname)', ddl: 'CREATE INDEX idx_s_name ON student(sname)', helps: false },
        { key: 'D', label: 'CREATE INDEX idx_s_sex ON student(ssex)', ddl: 'CREATE INDEX idx_s_sex ON student(ssex)', helps: false },
      ],
    },
    answer: { pick: 'A' },
    explanation: '索引必须建在**条件用到的列**上。这条查询的条件是 `sdept = \'计算机系\'`，所以只有 `student(sdept)` 上的索引会被优化器考虑。建在 sage / sname / ssex 上的索引对这条查询毫无帮助 —— 优化器不会因为它"存在"就去用它。',
  },
  {
    id: 'IX02', kind: 'index', kid: 'k-index-use', difficulty: 4,
    title: '范围查询 + 排序：一个索引解决两件事',
    brief: `数据集：**员工部门库**。查询：

\`\`\`sql
SELECT * FROM emp WHERE sal > 20000 ORDER BY sal;
\`\`\`

哪个索引最合适？

> 想一想：这条查询有两个"贵"的地方 —— 筛选和排序。
> 有没有一个索引能同时帮上忙？`,
    payload: {
      dataset_id: 'company',
      query: 'SELECT * FROM emp WHERE sal > 20000 ORDER BY sal',
      options: [
        { key: 'A', label: 'CREATE INDEX idx_e_ename ON emp(ename)', ddl: 'CREATE INDEX idx_e_ename ON emp(ename)', helps: false },
        { key: 'B', label: 'CREATE INDEX idx_e_sal ON emp(sal)', ddl: 'CREATE INDEX idx_e_sal ON emp(sal)', helps: true },
        { key: 'C', label: 'CREATE INDEX idx_e_job ON emp(job)', ddl: 'CREATE INDEX idx_e_job ON emp(job)', helps: false },
        { key: 'D', label: 'CREATE INDEX idx_e_deptno ON emp(deptno)', ddl: 'CREATE INDEX idx_e_deptno ON emp(deptno)', helps: false },
      ],
    },
    answer: { pick: 'B' },
    explanation: 'B+ 树索引是**有序**的，所以 `emp(sal)` 上的索引一次解决两件事：① 范围条件 `sal > 20000` 可以直接定位到起点往后扫；② 结果本身就是按 sal 有序的，`ORDER BY sal` 不用再额外排序。这就是"范围查询 + 排序用同一个索引"的典型场景 —— 如果排序方向和要求相反（如 `ORDER BY sal DESC` 配 `WHERE sal > 20000`），索引仍然有用，但优化器可能需要反向扫描。',
  },
  {
    id: 'IX03', kind: 'index', kid: 'k-index-use', difficulty: 4,
    title: '★ 建了索引也没用的查询',
    brief: `数据集：**电商订单库**。查询：

\`\`\`sql
SELECT * FROM product WHERE pname LIKE '%键盘';
\`\`\`

下面哪个索引能让这条查询用上索引？

> 仔细看那个 \`%\` 的位置。`,
    payload: {
      dataset_id: 'shop',
      query: "SELECT * FROM product WHERE pname LIKE '%键盘'",
      options: [
        { key: 'A', label: 'CREATE INDEX idx_p_name ON product(pname)', ddl: 'CREATE INDEX idx_p_name ON product(pname)', helps: false },
        { key: 'B', label: 'CREATE INDEX idx_p_price ON product(price)', ddl: 'CREATE INDEX idx_p_price ON product(price)', helps: false },
        { key: 'C', label: 'CREATE INDEX idx_p_stock ON product(stock)', ddl: 'CREATE INDEX idx_p_stock ON product(stock)', helps: false },
        { key: 'D', label: '以上都不能 —— 前导通配符让索引失效', ddl: null, helps: false },
      ],
    },
    answer: { pick: 'D' },
    explanation: '`LIKE \'%键盘\'` 是**前导通配符**。B+ 树索引是按字符串**前缀**排序的，所以能回答"以 X 开头的是哪些"，但回答不了"以 X 结尾的是哪些" —— 因为所有以"键盘"结尾的字符串在索引里是分散的，无法定位到一个连续区间。所以即使建了 `product(pname)` 索引，优化器也不会用它（选项 A 的实际计划仍然是 SCAN）。\n\n**如果确实需要这种查询**，三个方向：① 改成后缀匹配 `LIKE \'键盘%\'`；② 存一个反向字符串列并建索引；③ 上全文索引（FTS）。',
  },
  {
    id: 'IX04', kind: 'index', kid: 'k-bplus', difficulty: 5,
    title: '复合索引的最左前缀',
    brief: `数据集：**学生选课库**。查询：

\`\`\`sql
SELECT * FROM sc WHERE cno = 'C01' AND grade > 80;
\`\`\`

已知 \`sc\` 表的主键是 \`(sno, cno)\`（这会产生一个隐式索引）。
下面哪个复合索引能最好地服务这条查询？

> 关键概念：**最左前缀原则**。复合索引 \`(a, b)\` 能支持按 \`a\` 查、
> 按 \`(a, b)\` 查，但**不支持只按 \`b\` 查**。`,
    payload: {
      dataset_id: 'school',
      query: "SELECT * FROM sc WHERE cno = 'C01' AND grade > 80",
      options: [
        { key: 'A', label: 'CREATE INDEX idx_sc_cg ON sc(cno, grade)', ddl: 'CREATE INDEX idx_sc_cg ON sc(cno, grade)', helps: true },
        { key: 'B', label: 'CREATE INDEX idx_sc_gc ON sc(grade, cno)', ddl: 'CREATE INDEX idx_sc_gc ON sc(grade, cno)', helps: true },
        { key: 'C', label: 'CREATE INDEX idx_sc_sno_cno ON sc(sno, cno)', ddl: 'CREATE INDEX idx_sc_sno_cno ON sc(sno, cno)', helps: false },
        { key: 'D', label: '以上都不能，只能全表扫描', ddl: null, helps: false },
      ],
    },
    answer: { pick: 'A' },
    explanation: 'A 和 B 都能让优化器用上索引（所以本题的"能不能用上"两个都对），但 **A 明显更好**：\n\n- **A `(cno, grade)`**：先按 `cno` 精确定位到 `\'C01\'` 那一段，再在段内用 `grade > 80` 做范围扫描。**两个条件都用在索引上**。\n- **B `(grade, cno)`**：最左列是 `grade`，而 `grade > 80` 是范围条件。索引范围扫描一旦在某一列上用了范围条件，**后面所有列就无法再用于定位** —— 所以 `cno` 只能当过滤条件在回表后检查。\n\n**规则**：复合索引里，**等值条件列放前面，范围条件列放后面**。\n\nC 是主键已有的索引（前缀是 sno），而这条查询不涉及 sno，所以用不上。',
  },

  /* ==================== 事务实验 ==================== */
  {
    id: 'TX01', kind: 'txn', kid: 'k-serializable', difficulty: 4,
    title: '这个调度可串行化吗？（一）',
    brief: `有两个事务 T1、T2 并发执行，调度如下（从左到右是时间顺序）：

| 顺序 | 操作 |
|---|---|
| 1 | $r_1(A)$ |
| 2 | $w_2(A)$ |
| 3 | $r_2(B)$ |
| 4 | $w_1(B)$ |

这个调度是**冲突可串行化**的吗？

> 做法：找出所有**冲突操作对**（不同事务 + 同一数据 + 至少一个是写），
> 按发生顺序画边，然后看有没有环。`,
    payload: {
      ask: 'serializable',
      schedule: [
        { t: 'T1', op: 'r', item: 'A' },
        { t: 'T2', op: 'w', item: 'A' },
        { t: 'T2', op: 'r', item: 'B' },
        { t: 'T1', op: 'w', item: 'B' },
      ],
      options: [
        { key: 'A', label: '可串行化，等价于 T1 → T2' },
        { key: 'B', label: '可串行化，等价于 T2 → T1' },
        { key: 'C', label: '不可串行化，优先图中有环' },
        { key: 'D', label: '信息不足，无法判断' },
      ],
    },
    answer: { pick: 'C' },
    explanation: '逐个找冲突对：\n\n- $r_1(A)$ 与 $w_2(A)$：不同事务、同一数据 A、$w_2$ 是写 → **冲突**，$r_1$ 在前 → 边 $T_1 \\to T_2$\n- $r_2(B)$ 与 $w_1(B)$：不同事务、同一数据 B、$w_1$ 是写 → **冲突**，$r_2$ 在前 → 边 $T_2 \\to T_1$\n\n两条边形成环 $T_1 \\to T_2 \\to T_1$，**优先图有环 ⟹ 不可串行化**。\n\n注意 $r_1(A)$ 和 $r_2(B)$ 之间没有边（不同数据），$w_2(A)$ 和 $r_2(B)$ 之间也没有（同一事务）。**读-读不冲突**是这里的关键。',
  },
  {
    id: 'TX02', kind: 'txn', kid: 'k-serializable', difficulty: 4,
    title: '这个调度可串行化吗？（二）',
    brief: `调度如下：

| 顺序 | 操作 |
|---|---|
| 1 | $r_2(A)$ |
| 2 | $r_1(B)$ |
| 3 | $w_1(A)$ |
| 4 | $w_2(B)$ |

这个调度是冲突可串行化的吗？`,
    payload: {
      ask: 'serializable',
      schedule: [
        { t: 'T2', op: 'r', item: 'A' },
        { t: 'T1', op: 'r', item: 'B' },
        { t: 'T1', op: 'w', item: 'A' },
        { t: 'T2', op: 'w', item: 'B' },
      ],
      options: [
        { key: 'A', label: '可串行化，等价于 T1 → T2' },
        { key: 'B', label: '可串行化，等价于 T2 → T1' },
        { key: 'C', label: '不可串行化，优先图中有环' },
        { key: 'D', label: '信息不足，无法判断' },
      ],
    },
    answer: { pick: 'C' },
    explanation: '冲突对：\n\n- $r_2(A)$ 与 $w_1(A)$：冲突，$r_2$ 在前 → 边 $T_2 \\to T_1$\n- $r_1(B)$ 与 $w_2(B)$：冲突，$r_1$ 在前 → 边 $T_1 \\to T_2$\n\n环 $T_1 \\to T_2 \\to T_1$，**不可串行化**。\n\n两个事务各自读了一项、又各自写了对方读过的那一项 —— 这就是典型的"交叉读写"造成的不可串行化。',
  },
  {
    id: 'TX03', kind: 'txn', kid: 'k-serializable', difficulty: 3,
    title: '这个调度可串行化吗？（三）',
    brief: `调度如下：

| 顺序 | 操作 |
|---|---|
| 1 | $r_1(A)$ |
| 2 | $w_1(A)$ |
| 3 | $r_2(A)$ |
| 4 | $w_2(A)$ |

这个调度是冲突可串行化的吗？`,
    payload: {
      ask: 'serializable',
      schedule: [
        { t: 'T1', op: 'r', item: 'A' },
        { t: 'T1', op: 'w', item: 'A' },
        { t: 'T2', op: 'r', item: 'A' },
        { t: 'T2', op: 'w', item: 'A' },
      ],
      options: [
        { key: 'A', label: '可串行化，等价于 T1 → T2' },
        { key: 'B', label: '可串行化，等价于 T2 → T1' },
        { key: 'C', label: '不可串行化，优先图中有环' },
        { key: 'D', label: '信息不足，无法判断' },
      ],
    },
    answer: { pick: 'A' },
    explanation: '冲突对只有一处：$w_1(A)$ 与 $r_2(A)$（或 $w_2(A)$），方向都是 $T_1$ 在前 → 只有边 $T_1 \\to T_2$。\n\n**没有环 ⟹ 冲突可串行化**，等价于串行调度 $T_1, T_2$。\n\n这个调度看起来是"并发"的，但实际执行顺序和"先跑完 T1 再跑 T2"完全一样 —— 这正是可串行化的含义：**并发执行的结果等价于某个串行执行**。',
  },
  {
    id: 'TX04', kind: 'txn', kid: 'k-isolation', difficulty: 4,
    title: '这个并发异常是什么？',
    brief: `考虑下面这个并发执行（初始时 A = 100）：

| 顺序 | T1 | T2 |
|---|---|---|
| 1 | 读 A = 100 | |
| 2 | | 读 A = 100 |
| 3 | | 写 A = 80 |
| 4 | | **提交** |
| 5 | 写 A = 120 | |
| 6 | **提交** | |

最终 A 的值是什么？这属于哪种并发异常？`,
    payload: {
      ask: 'anomaly',
      options: [
        { key: 'A', text: '' , label: 'A = 120，属于丢失修改（T2 的更新被 T1 覆盖）' },
        { key: 'B', label: 'A = 80，属于脏读（T1 读到了 T2 未提交的值）' },
        { key: 'C', label: 'A = 120，属于脏写（T1 覆盖了已提交的数据）' },
        { key: 'D', label: 'A = 100，两个事务互相抵消了' },
      ],
    },
    answer: { pick: 'A' },
    explanation: '**A = 120**。\n\n执行过程：T2 先读到 A = 100，算出 80 并写回；T2 提交后 T1 才写 A = 120。T1 是**基于过期的读**（第 1 步读到的 100）做的计算，它不知道 T2 已经把 A 改成了 80 —— 所以 T2 的修改被完全覆盖掉了，这就是**丢失修改（Lost Update）**。\n\n注意区分几个概念：\n- **丢失修改**：两个事务基于同一个旧值计算，后写的覆盖先写的 → 本题\n- **脏读**：读到别人**未提交**的修改。本题 T2 在第 4 步就提交了，T1 读到的是旧值 100，不是脏数据\n- **脏写**：覆盖别人未提交的数据。本题 T1 写的时候 T2 已经提交\n\n**防止丢失修改**的最低要求是「一级封锁协议」：写之前加排他锁并保持到事务结束。这样 T2 在第 3 步持有 A 的 X 锁时，T1 在第 5 步就得等 —— 等它拿到锁时重新读到的就是 80，而不是 100。',
  },
  {
    id: 'TX05', kind: 'txn', kid: 'k-isolation', difficulty: 5,
    title: '这个并发异常是什么？（进阶）',
    brief: `考虑下面这个执行（初始时 A = 50）：

| 顺序 | T1 | T2 |
|---|---|---|
| 1 | | 写 A = 200 |
| 2 | 读 A | |
| 3 | | **回滚** |

T1 在第 2 步读到的值是什么？这属于哪种异常？`,
    payload: {
      ask: 'anomaly',
      options: [
        { key: 'A', label: 'T1 读到 200，属于脏读（读到了未提交且最终被回滚的数据）' },
        { key: 'B', label: 'T1 读到 50，因为 T2 还没提交' },
        { key: 'C', label: 'T1 读到 200，属于丢失修改' },
        { key: 'D', label: 'T1 读操作会阻塞，直到 T2 结束' },
      ],
    },
    answer: { pick: 'A' },
    explanation: '如果**没有任何并发控制**，T1 在第 2 步会读到 **200** —— 那是 T2 写入但**从未提交**、而且最终被**回滚**的值。这就是**脏读（Dirty Read）**：读到了一个"从来没真正存在过"的数据。\n\n为什么它比丢失修改更危险：丢失修改至少是"基于真实数据算错了"，而脏读是**基于一个不存在的世界做的所有决策**。如果 T1 依据这个 200 去写别的表、发通知、扣库存，那些副作用全都建立在幻觉上，而且回滚 T2 不会撤销它们。\n\n**防止脏读**需要「二级封锁协议」：读之前加共享锁（S 锁），读完立即释放。这样 T2 在第 1 步持有 A 的排他锁（X 锁）时，T1 拿不到 S 锁，必须等待 —— 而 T2 回滚后，T1 拿到的就是正确的 50。\n\n> 现实中绝大多数数据库默认的 **READ COMMITTED** 级别就是靠这个机制防住脏读的，这也是它被认为"最低可用"的隔离级别的原因。',
  },
];

export default LABS;
