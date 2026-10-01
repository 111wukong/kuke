/* 知识树
 *
 * 三级结构：分类 → 章 → 知识点。
 *
 * ── 组织原则 ────────────────────────────────────────────────────
 * 分类对应「课程大纲的一级标题」，章对应「一次课」，知识点对应
 * 「一次课里的一个可考、可练、可判定的单元」。
 *
 * 「可练」是硬标准：一个知识点如果没法出一道题，它就不该出现在这里 ——
 * 那是课程介绍，不是知识点。所以「数据库发展史」没有单列，
 * 它被并进「数据库系统概述」的正文里。
 *
 * ── 内容格式 ────────────────────────────────────────────────────
 * content 是 Markdown。本课程的渲染管线支持：
 *   ```sql 围栏代码块（带高亮 + 一键送去实训场）
 *   表格、引用、加粗、列表
 *   $...$ 行内数学（关系代数符号 σ π ⋈ ρ ÷ 用得到）
 * sql_demo 是可选的「本知识点的示例 SQL」，前端会给一个「在实训场里跑」按钮。
 * 它必须能在他所属的 dataset 上跑通 —— tests/content.mjs 会验证。
 */

export const CATEGORIES = [
  { id: 'db-basics', name: '基础理论', color: '#3b82f6', description: '数据库系统的概念、数据模型、关系模型与关系代数', sort_order: 1 },
  { id: 'sql', name: 'SQL 语言', color: '#22d3ee', description: '数据定义、查询、更新、视图与约束', sort_order: 2 },
  { id: 'design', name: '数据库设计', color: '#a855f7', description: 'E-R 模型、函数依赖、范式与规范化分解', sort_order: 3 },
  { id: 'storage', name: '存储与索引', color: '#34d399', description: '存储结构、B+ 树索引、散列索引', sort_order: 4 },
  { id: 'query', name: '查询优化', color: '#fbbf24', description: '查询处理流程、代数优化、物理优化与执行计划', sort_order: 5 },
  { id: 'txn', name: '事务与并发', color: '#fb7185', description: '事务 ACID、并发问题、封锁协议、可串行化与死锁', sort_order: 6 },
  { id: 'recovery', name: '恢复与安全', color: '#e879f9', description: '日志与恢复、备份策略、权限与安全', sort_order: 7 },
];

export const CHAPTERS = [
  /* 基础理论 */
  { id: 'ch-db-intro', category_id: 'db-basics', name: '数据库系统概述', summary: '数据、数据库、DBMS、数据独立性', sort_order: 1 },
  { id: 'ch-db-model', category_id: 'db-basics', name: '数据模型', summary: '概念模型、逻辑模型、物理模型', sort_order: 2 },
  { id: 'ch-rel-model', category_id: 'db-basics', name: '关系模型', summary: '关系、元组、属性、键、完整性约束', sort_order: 3 },
  { id: 'ch-rel-algebra', category_id: 'db-basics', name: '关系代数', summary: '选择、投影、连接、除、并差交', sort_order: 4 },

  /* SQL */
  { id: 'ch-sql-basic', category_id: 'sql', name: '单表查询', summary: 'SELECT / WHERE / ORDER BY / LIMIT', sort_order: 1 },
  { id: 'ch-sql-agg', category_id: 'sql', name: '聚合与分组', summary: '聚合函数、GROUP BY、HAVING、窗口函数', sort_order: 2 },
  { id: 'ch-sql-join', category_id: 'sql', name: '多表连接', summary: '内连接、外连接、自连接、非等值连接', sort_order: 3 },
  { id: 'ch-sql-sub', category_id: 'sql', name: '子查询', summary: '不相关子查询、相关子查询、EXISTS、IN', sort_order: 4 },
  { id: 'ch-sql-null', category_id: 'sql', name: 'NULL 与三值逻辑', summary: 'NULL 语义、IS NULL、COALESCE、外连接里的 NULL', sort_order: 5 },
  { id: 'ch-sql-ddl', category_id: 'sql', name: '数据定义与约束', summary: 'CREATE / ALTER / DROP、主键、外键、CHECK', sort_order: 6 },
  { id: 'ch-sql-dml', category_id: 'sql', name: '数据更新', summary: 'INSERT / UPDATE / DELETE 与事务安全', sort_order: 7 },
  { id: 'ch-sql-view', category_id: 'sql', name: '视图', summary: '视图定义、可更新视图、物化视图', sort_order: 8 },

  /* 设计 */
  { id: 'ch-er', category_id: 'design', name: 'E-R 模型', summary: '实体、属性、联系、基数、弱实体', sort_order: 1 },
  { id: 'ch-fd', category_id: 'design', name: '函数依赖', summary: '函数依赖、闭包、候选键、最小覆盖', sort_order: 2 },
  { id: 'ch-nf', category_id: 'design', name: '范式', summary: '1NF / 2NF / 3NF / BCNF', sort_order: 3 },
  { id: 'ch-decomp', category_id: 'design', name: '分解与规范化', summary: '无损连接、保持依赖、分解算法', sort_order: 4 },

  /* 存储 */
  { id: 'ch-storage', category_id: 'storage', name: '存储结构', summary: '磁盘、页、记录组织、缓冲池', sort_order: 1 },
  { id: 'ch-index', category_id: 'storage', name: '索引结构', summary: 'B+ 树、聚集索引、覆盖索引、索引选择', sort_order: 2 },
  { id: 'ch-hash', category_id: 'storage', name: '散列索引', summary: '静态散列、可扩展散列、位图索引', sort_order: 3 },

  /* 查询优化 */
  { id: 'ch-qp', category_id: 'query', name: '查询处理', summary: '查询编译、语法分析、执行算子', sort_order: 1 },
  { id: 'ch-qo', category_id: 'query', name: '查询优化', summary: '代数优化规则、代价估算、执行计划', sort_order: 2 },

  /* 事务 */
  { id: 'ch-txn-basic', category_id: 'txn', name: '事务基础', summary: 'ACID、事务状态、隔离级别', sort_order: 1 },
  { id: 'ch-concurrency', category_id: 'txn', name: '并发问题', summary: '丢失修改、脏读、不可重复读、幻读', sort_order: 2 },
  { id: 'ch-lock', category_id: 'txn', name: '封锁协议', summary: '共享锁、排他锁、三级封锁协议', sort_order: 3 },
  { id: 'ch-serial', category_id: 'txn', name: '可串行化调度', summary: '冲突可串行化、优先图、两段锁协议', sort_order: 4 },
  { id: 'ch-deadlock', category_id: 'txn', name: '死锁', summary: '死锁检测、预防、等待图', sort_order: 5 },

  /* 恢复与安全 */
  { id: 'ch-log', category_id: 'recovery', name: '日志与恢复', summary: 'WAL、Undo/Redo、检查点、ARIES', sort_order: 1 },
  { id: 'ch-backup', category_id: 'recovery', name: '备份与故障恢复', summary: '转储、故障类型、介质恢复', sort_order: 2 },
  { id: 'ch-security', category_id: 'recovery', name: '安全与权限', summary: '自主存取控制、角色、视图机制、审计', sort_order: 3 },
];

export const KNOWLEDGE = [
  /* ==================== 基础理论 ==================== */
  {
    id: 'k-dbms', category_id: 'db-basics', chapter_id: 'ch-db-intro', sort_order: 1,
    title: '数据库与数据库管理系统',
    summary: '数据库是数据的集合，DBMS 是管理它的软件，两者不是一回事',
    difficulty: 1, importance: 3, tags: ['概念'],
    content: `**数据库（DB）**是长期存储在计算机内、有组织、可共享的数据集合。
**数据库管理系统（DBMS）**是位于用户与操作系统之间的一层数据管理软件。

日常说话时人们把两者混着说（"装个数据库"其实是指装 DBMS），但考试和设计文档里必须分清：

| | 是什么 | 例子 |
|---|---|---|
| 数据库 | 数据的集合 | 一个 \`kuke.db\` 文件、一个 schema |
| DBMS | 管理数据的软件 | MySQL、PostgreSQL、Oracle、SQLite |

**DBMS 提供的关键能力**，也就是"为什么不直接用文件存数据"的答案：

- **数据独立性**：逻辑结构变了，应用程序不用改
- **并发控制**：多个用户同时改同一条数据不会互相破坏
- **完整性约束**：外键、非空、唯一，由系统强制而不是靠程序员自觉
- **故障恢复**：断电、崩溃之后数据仍是一致的
- **安全与授权**：谁能看哪张表、能做什么操作

> 一个常见的误解：以为 SQLite"不算数据库"。它是完整的 DBMS，
> 只是把整个数据库放在一个文件里、没有客户端/服务端分离。
> 本平台所有实训都在 SQLite 上跑 —— 教学用的 SQL 语法它全都有。`,
  },
  {
    id: 'k-3level', category_id: 'db-basics', chapter_id: 'ch-db-intro', sort_order: 2,
    title: '三级模式与两级映像',
    summary: '外模式 / 模式 / 内模式，以及由此得到的两种数据独立性',
    difficulty: 2, importance: 3, tags: ['概念', '考点'],
    content: `三级模式是数据库体系结构的基础，也是"数据独立性"的来源。

| 模式 | 面向谁 | 描述什么 |
|---|---|---|
| **外模式**（用户模式/子模式） | 最终用户、应用程序 | 每个用户能看到的那部分数据 |
| **模式**（逻辑模式） | 设计者 | 全体数据的逻辑结构 |
| **内模式**（存储模式） | 系统 | 数据在磁盘上怎么放 |

**两级映像**把三层解耦：

- **外模式/模式映像** → **逻辑独立性**：模式改了（比如加了一列），
  只要调整映像，外模式和应用程序不用动
- **模式/内模式映像** → **物理独立性**：加个索引、换个存储结构，
  逻辑模式和应用程序都不用动

> 这两条独立性的实际价值：一个跑了十年的系统，底层从机械硬盘换到 SSD、
> 从单机换到分布式，业务代码一行没改 —— 靠的就是这两层映像。
> 反过来说，如果应用直接读文件、自己解析二进制，换一次存储格式就得重写一遍。`,
  },
  {
    id: 'k-datamodel', category_id: 'db-basics', chapter_id: 'ch-db-model', sort_order: 1,
    title: '三类数据模型',
    summary: '概念模型、逻辑模型、物理模型，各自服务于谁',
    difficulty: 1, importance: 2, tags: ['概念'],
    content: `数据模型是"现实世界 → 计算机世界"的翻译过程，分三个层次：

1. **概念模型**（信息模型）：面向用户，不依赖任何 DBMS。
   代表是 **E-R 模型**。这是和业务方沟通用的语言。
2. **逻辑模型**：面向 DBMS，有严格的形式化定义。
   代表是**关系模型**，此外还有层次模型、网状模型、面向对象模型。
3. **物理模型**：面向存储，描述数据在磁盘上的组织方式（页、块、索引结构）。

**为什么要分三层而不是直接跳到关系表**：
现实世界的"一个学生可以选多门课"这句话里没有主键、没有外键、没有范式。
先画 E-R 图把它表达清楚，再按规则转成关系表 ——
这个中间步骤让"设计对不对"可以分两段来检查。
跳过 E-R 直接建表，等于把业务理解和物理设计混在一起，
一旦出错分不清是理解错了还是实现错了。`,
  },
  {
    id: 'k-rel-concept', category_id: 'db-basics', chapter_id: 'ch-rel-model', sort_order: 1,
    title: '关系模型的基本术语',
    summary: '关系、元组、属性、域、码 —— 和通俗说法的对应关系',
    difficulty: 1, importance: 3, tags: ['概念', '考点'],
    content: `关系模型用严格的数学语言描述数据，日常说法和术语要能对上：

| 学术术语 | 通俗说法 | 实际是什么 |
|---|---|---|
| 关系 | 表 | 一张二维表 |
| 元组 | 行 / 记录 | 一条数据 |
| 属性 | 列 / 字段 | 一个数据项 |
| 域 | 取值范围 | 列的数据类型 + 约束 |
| 分量 | 单元格 | 元组在某个属性上的值 |
| 候选码 | 候选键 | 能唯一标识元组的最小属性组 |
| 主码 | 主键 | 从候选码里选一个当"官方"标识 |
| 外码 | 外键 | 引用另一张表主码的属性 |

**关系的两条硬性要求**（考试常考）：

1. **分量必须是原子的** —— 不允许表里套表。
   这就是第一范式（1NF）。把"电话号码"存成"138xx,139xx"违反了它。
2. **不允许出现完全相同的元组** —— 关系是集合，集合里没有重复元素。
   实践中靠主键保证。

> 注意"关系的行列顺序无关"这一条：关系是**集合**，集合无序。
> 所以 \`SELECT\` 不加 \`ORDER BY\` 时结果顺序不确定，
> 这不是数据库的 bug，是关系模型的定义决定的。`,
  },
  {
    id: 'k-integrity', category_id: 'db-basics', chapter_id: 'ch-rel-model', sort_order: 2,
    title: '三类完整性约束',
    summary: '实体完整性、参照完整性、用户定义完整性',
    difficulty: 2, importance: 3, tags: ['考点'],
    content: `关系模型自带三类完整性约束，前两类由系统自动强制：

**1. 实体完整性**
主码的值**唯一且非空**。
为什么非空：主码的作用是标识元组，如果可以为空，就没法区分两个"空标识"的元组。

**2. 参照完整性**
外码的值要么是 NULL，要么必须等于被引用表中某个已存在的主码值。
\`\`\`sql
-- sc.sno 引用 student.sno，插入一个不存在的学号会被拒绝
INSERT INTO sc (sno, cno) VALUES ('9999999', 'C01');
-- 报错：FOREIGN KEY constraint failed
\`\`\`

**3. 用户定义完整性**
业务规则，比如"成绩必须在 0–100 之间"。
\`\`\`sql
CHECK (grade BETWEEN 0 AND 100)
\`\`\`

**外键的三个级联选项**，这是设计时最容易忽略的地方：

| 选项 | 删掉被引用的父行时 |
|---|---|
| \`ON DELETE CASCADE\` | 子行跟着一起删 |
| \`ON DELETE SET NULL\` | 子行的外码置 NULL |
| \`ON DELETE RESTRICT\`（默认） | 拒绝删除 |

> 选错级联行为的代价很具体：一个班的学生被删号，如果 \`attempts\` 表
> 没配 CASCADE，要么删不掉学生（报外键错），要么留下一堆指向不存在用户的
> 孤儿作答记录 —— 后者更糟，因为它**不报错**。`,
  },
  {
    id: 'k-algebra-basic', category_id: 'db-basics', chapter_id: 'ch-rel-algebra', sort_order: 1,
    title: '关系代数的五个基本运算',
    summary: '选择、投影、并、差、笛卡尔积',
    difficulty: 2, importance: 3, tags: ['考点'],
    content: `关系代数是 SQL 的**理论基础**，也是查询优化的操作对象。
五个基本运算（其余都由它们导出）：

| 运算 | 符号 | 含义 | 对应 SQL |
|---|---|---|---|
| 选择 | $\\sigma_{条件}(R)$ | 挑出满足条件的**行** | \`WHERE\` |
| 投影 | $\\pi_{属性}(R)$ | 挑出指定的**列** | \`SELECT 列\` |
| 并 | $R \\cup S$ | 两关系的并集 | \`UNION\` |
| 差 | $R - S$ | 在 R 中不在 S 中 | \`EXCEPT\` |
| 笛卡尔积 | $R \\times S$ | 所有组合 | \`CROSS JOIN\` |

**最容易混淆的一对：选择和投影**

- $\\sigma$（sigma）选**行** —— 对应 WHERE
- $\\pi$（pi）选**列** —— 对应 SELECT 列表

记忆法：$\\pi$ 长得像"投影仪把一列打出来"。

**导出运算**：
- 交 $R \\cap S = R - (R - S)$
- 连接 $R \\bowtie_{条件} S = \\sigma_{条件}(R \\times S)$
- 除 $R \\div S$ —— 用来表达"对所有的"这类全称量词

> **投影会自动去重**。这是关系代数（集合语义）和 SQL（多重集语义）的
> 第一个分歧点：$\\pi_{sdept}(student)$ 不会有重复的系名，
> 而 \`SELECT sdept FROM student\` 会有。要等价必须写 \`SELECT DISTINCT\`。`,
    sql_demo: 'SELECT DISTINCT sdept FROM student;',
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-algebra-join', category_id: 'db-basics', chapter_id: 'ch-rel-algebra', sort_order: 2,
    title: '连接运算与除运算',
    summary: 'θ 连接、自然连接、外连接、除运算的语义',
    difficulty: 3, importance: 3, tags: ['考点', '难点'],
    content: `**θ 连接**：$R \\bowtie_{A \\theta B} S$ —— 从笛卡尔积里挑出满足条件的元组。
θ 可以是 \`=\`、\`<\`、\`>\` 等任意比较符。

**等值连接**：θ 为 \`=\` 的特例。

**自然连接**：$R \\bowtie S$ —— 在**同名属性**上做等值连接，并去掉重复的同名列。
注意它比等值连接多做了一步"去重列"。

**外连接**：保留不匹配的元组，另一侧填 NULL。
- 左外连接 ⟕：保留左表全部
- 右外连接 ⟖：保留右表全部
- 全外连接 ⟗：两边都保留

**除运算** $R \\div S$ 是关系代数里最难理解、但表达力最强的一个。

设 $R(A, B)$、$S(B)$，则 $R \\div S$ 得到所有这样的 $A$ 值：它对 $S$ 中的**每一个** $B$ 值，在 $R$ 中都有对应的元组。

**典型用途**：查询"选修了**全部**课程的学生"
\`\`\`sql
-- 关系代数：π_sno,cno(sc) ÷ π_cno(course)
-- SQL 等价写法（双重 NOT EXISTS）
SELECT s.sno FROM student s
WHERE NOT EXISTS (
  SELECT 1 FROM course c
  WHERE NOT EXISTS (
    SELECT 1 FROM sc WHERE sc.sno = s.sno AND sc.cno = c.cno
  )
);
\`\`\`

> 除运算对应 SQL 里的"双重否定"结构。
> 自然语言里的"全部"、"所有"、"每一"都翻译成它 ——
> 而"存在某个"翻译成单层 EXISTS。这一对是考试的重点。`,
  },

  /* ==================== SQL ==================== */
  {
    id: 'k-select', category_id: 'sql', chapter_id: 'ch-sql-basic', sort_order: 1,
    title: 'SELECT 的基本结构',
    summary: '查询块的完整语法骨架与各子句的执行顺序',
    difficulty: 1, importance: 3, tags: ['语法'],
    content: `SQL 查询的完整骨架：

\`\`\`sql
SELECT   [DISTINCT] 列表达式
FROM     表 [JOIN 表 ON 条件]
WHERE    行条件
GROUP BY 分组列
HAVING   组条件
ORDER BY 排序列 [ASC|DESC]
LIMIT    n [OFFSET m];
\`\`\`

**执行顺序和书写顺序不一样** —— 这是理解 SQL 的关键：

\`\`\`
FROM → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT
\`\`\`

由这个顺序能推出三件初学者常踩的事：

1. **WHERE 里不能写聚合函数** —— 那时还没分组，没有"组"可言
2. **ORDER BY 里可以用别名** —— 它最后执行
3. **别名在 WHERE 里能不能用，取决于数据库** —— 见下

\`\`\`sql
-- ✗ 聚合函数不能出现在 WHERE 里
SELECT COUNT(*) AS 人数 FROM student WHERE 人数 > 3;
--   SQLite 报的是：misuse of aggregate: COUNT()
--   注意它认得"人数"这个别名（否则会报 no such column），
--   只是别名展开后是个聚合函数，而 WHERE 阶段还没有"组"。
-- ✓ 筛聚合结果要用 HAVING
SELECT COUNT(*) AS 人数 FROM student GROUP BY sdept HAVING COUNT(*) > 3;
-- ✓ ORDER BY 可以用别名
SELECT sdept, COUNT(*) AS 人数 FROM student GROUP BY sdept ORDER BY 人数 DESC;
\`\`\`

> **⚠️ 一个必须说清楚的分歧：普通别名在 WHERE 里到底能不能用？**
>
> 标准 SQL（以及 PostgreSQL、SQL Server、MySQL）**不允许** ——
> 理由是"WHERE 比 SELECT 先执行，别名还不存在"。
>
> 但**本平台的 SQLite 允许**。下面这句在本平台的实训场里能正常返回结果：
>
> \`\`\`sql
> SELECT sage AS 年龄 FROM student WHERE 年龄 > 20;   -- SQLite：正常返回
> \`\`\`
>
> SQLite 会把 SELECT 列表里的别名提前解析好，所以 WHERE 里看得到。
> 这不是标准行为，是 SQLite 的宽松之处 —— 和它允许
> \`SELECT sdept, sname, COUNT(*) ... GROUP BY sdept\` 是同一类"宽容"。
>
> 所以：**考试按标准 SQL 答（不能用），写代码别依赖 SQLite 的宽容**
> （换到 PostgreSQL 上那句就直接挂）。要跨库可移植，就重复写表达式，
> 或者用派生表 / CTE 把计算包一层。`,
    sql_demo: 'SELECT sdept, COUNT(*) AS 人数 FROM student GROUP BY sdept ORDER BY 人数 DESC;',
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-where', category_id: 'sql', chapter_id: 'ch-sql-basic', sort_order: 2,
    title: '条件表达式与谓词',
    summary: '比较、BETWEEN、IN、LIKE、逻辑组合与优先级',
    difficulty: 2, importance: 3, tags: ['语法', '考点'],
    content: `**比较运算**：\`= != <> > >= < <=\`（\`!=\` 和 \`<>\` 等价）

**范围**：\`BETWEEN a AND b\` —— **闭区间**，等价于 \`a <= x <= b\`。

**集合**：\`IN (v1, v2, ...)\`，否定是 \`NOT IN\`。

> ⚠️ \`NOT IN\` 遇到 NULL 会**整体变成未知**，返回空集。
> \`WHERE cno NOT IN (SELECT cno FROM sc)\`，如果子查询结果里有 NULL，
> 整个条件就永远是 UNKNOWN —— 不报错，只是返回 0 行。
> 这是 SQL 里最阴的坑之一，用 \`NOT EXISTS\` 可以完全绕开。

**模式匹配**：\`LIKE\`
- \`%\` 匹配任意长度（含 0）的字符串
- \`_\` 匹配恰好一个字符
- 转义：\`ESCAPE '\\'\`，用来匹配真的 \`%\` 字符

**逻辑组合的优先级**：\`NOT\` > \`AND\` > \`OR\`

\`\`\`sql
-- 这句的本意多半不是作者想的那样：
WHERE sdept = '计算机系' OR sdept = '软件工程系' AND sage > 20
-- 实际等价于：
WHERE sdept = '计算机系' OR (sdept = '软件工程系' AND sage > 20)
\`\`\`

> **AND 比 OR 结合得紧**。要表达"两个系里年龄大于 20 的"必须加括号。
> 这一条每年都有学生在考试里栽。`,
  },
  {
    id: 'k-orderby', category_id: 'sql', chapter_id: 'ch-sql-basic', sort_order: 3,
    title: '排序与分页',
    summary: 'ORDER BY 的稳定性、NULL 的位置、LIMIT/OFFSET 分页的陷阱',
    difficulty: 2, importance: 3, tags: ['语法', '实践'],
    content: `**ORDER BY 可以多列**，前面的列优先：

\`\`\`sql
ORDER BY sdept ASC, sage DESC
\`\`\`

**排序必须"完全确定"**。只写一个排序键时，键值相同的行之间顺序是**任意**的 ——
今天跑和明天跑可能不一样。

\`\`\`sql
-- ✗ 工资并列第二的两个人，谁先谁后不确定
ORDER BY sal DESC LIMIT 3
-- ✓ 加一个唯一列兜底，结果可复现
ORDER BY sal DESC, empno ASC LIMIT 3
\`\`\`

> 这在生产里会造成真实的 bug：分页接口 \`LIMIT 20 OFFSET 40\`，
> 如果排序不稳定，第 3 页可能出现第 1 页已经看过的数据，
> 而另一条数据永远看不到。

**NULL 的排序位置**：SQLite 和 MySQL 把 NULL 当最小值（升序时排最前），
PostgreSQL 把 NULL 当最大值（升序时排最后）。
标准 SQL 提供 \`NULLS FIRST\` / \`NULLS LAST\` 显式指定，但各数据库支持不一。

> **跨数据库时不要依赖 NULL 的默认位置**，显式写出来。

**分页的 OFFSET 性能问题**：\`LIMIT 20 OFFSET 100000\` 需要先扫描并丢弃
前 10 万行。数据量大时应该用"游标分页"（记住上一页最后一个排序键的值，
下次从它之后开始取）。`,
    sql_demo: 'SELECT ename, sal FROM emp ORDER BY sal DESC, empno ASC LIMIT 5;',
    sql_demo_dataset: 'company',
  },
  {
    id: 'k-aggregate', category_id: 'sql', chapter_id: 'ch-sql-agg', sort_order: 1,
    title: '聚合函数与 NULL 的交互',
    summary: 'COUNT(*) 与 COUNT(列) 的区别，聚合函数如何处理 NULL',
    difficulty: 2, importance: 3, tags: ['考点', '易错'],
    content: `五个标准聚合函数：\`COUNT\` / \`SUM\` / \`AVG\` / \`MAX\` / \`MIN\`

**关键规则：除 \`COUNT(*)\` 外，所有聚合函数都忽略 NULL。**

| 写法 | 数的是什么 |
|---|---|
| \`COUNT(*)\` | 行数，**包含**含 NULL 的行 |
| \`COUNT(列)\` | 该列**非 NULL** 的行数 |
| \`SUM(列)\` | 非 NULL 值之和 |
| \`AVG(列)\` | 非 NULL 值之和 ÷ 非 NULL 的**个数** |
| \`COUNT(DISTINCT 列)\` | 非 NULL 的不同值个数 |

\`\`\`sql
-- 用 company 库实际看一下差别
SELECT COUNT(*), COUNT(comm) FROM emp;          -- 14 行 vs 6 个有奖金的
SELECT AVG(comm), AVG(COALESCE(comm, 0)) FROM emp;  -- 2616.67 vs 1121.43
\`\`\`

> \`AVG(comm)\` 回答的是"**有奖金的人**平均拿多少"（2616.67）；
> \`AVG(COALESCE(comm,0))\` 回答的是"**所有人**平均拿多少"（1121.43）。
> 两个数都对，取决于你要回答哪个问题 —— 但选错就是错的答案。

**空集上的聚合**：\`COUNT\` 返回 0，而 \`SUM\`/\`AVG\`/\`MAX\`/\`MIN\` 返回 **NULL**。
所以 \`AVG(grade)\` 在没有任何成绩时是 NULL 而不是 0 ——
前端拿到 NULL 要显示成"—"而不是"0 分"。`,
    sql_demo: 'SELECT COUNT(*) AS 总人数, COUNT(comm) AS 有奖金人数, AVG(comm) AS 非空均值, AVG(COALESCE(comm,0)) AS 补零均值 FROM emp;',
    sql_demo_dataset: 'company',
  },
  {
    id: 'k-groupby', category_id: 'sql', chapter_id: 'ch-sql-agg', sort_order: 2,
    title: 'GROUP BY 的语义与常见错误',
    summary: '为什么 SELECT 里只能出现分组列和聚合函数',
    difficulty: 3, importance: 3, tags: ['考点', '易错'],
    content: `**规则**：\`GROUP BY\` 之后，\`SELECT\` 列表里**只能**出现
① 分组列 ② 聚合函数。

\`\`\`sql
-- ✗ 标准 SQL 里是错的
SELECT sdept, sname, COUNT(*) FROM student GROUP BY sdept;
\`\`\`

为什么错：一个系有多个学生，\`sname\` 该取哪一个？
这个查询**在语义上就是没有定义的**。

各数据库的处理方式不同，这恰恰是危险所在：

| 数据库 | 行为 |
|---|---|
| SQLite / MySQL（默认） | **不报错**，随便取组内第一行的值 |
| PostgreSQL / MySQL（\`ONLY_FULL_GROUP_BY\`） | 报错 |

> SQLite 不报错这件事本身是个陷阱：本机跑得好好的查询，
> 换到生产环境的 PostgreSQL 上直接挂。
> 本平台用 SQLite 是为了教学方便，但**不要养成依赖它的宽松语义的习惯**。

**函数依赖可以放宽这条规则**：如果分组列是某张表的主键，
那么该表的所有列在函数上都依赖于它，出现在 SELECT 里是安全的。
PostgreSQL 支持这种推断，SQLite 不支持。

**正确的写法**是把要展示的列也放进 GROUP BY，或者用聚合函数包起来：
\`\`\`sql
SELECT sdept, COUNT(*) FROM student GROUP BY sdept;
SELECT sdept, MAX(sage) FROM student GROUP BY sdept;   -- 每个系最大年龄
SELECT sdept, sname, COUNT(*) OVER (PARTITION BY sdept) FROM student;  -- 窗口函数
\`\`\``,
    sql_demo: 'SELECT sdept, COUNT(*) AS 人数, MAX(sage) AS 最大年龄, ROUND(AVG(sage),1) AS 平均年龄 FROM student GROUP BY sdept;',
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-having', category_id: 'sql', chapter_id: 'ch-sql-agg', sort_order: 3,
    title: 'HAVING 与 WHERE 的分工',
    summary: '两者执行时机不同，能写的东西也不同',
    difficulty: 2, importance: 3, tags: ['考点'],
    content: `**一句话区分**：
- \`WHERE\` 在**分组前**筛行，作用于原始数据
- \`HAVING\` 在**分组后**筛组，作用于聚合结果

\`\`\`sql
-- 找出平均分超过 85 的课程，且只统计成绩非空的选课
SELECT cno, AVG(grade) AS 平均分
FROM sc
WHERE grade IS NOT NULL          -- 分组前：先剔掉没出分的
GROUP BY cno
HAVING AVG(grade) > 85;          -- 分组后：再筛掉平均分不够的
\`\`\`

**能不能互换**：
- \`HAVING\` 能写 \`WHERE\` 能写的东西（但不该那么写 —— 会多算很多无用的组）
- \`WHERE\` **不能**写聚合函数（那时还没有组）

**性能上的差别是实打实的**：
\`\`\`sql
-- ✗ 先把 100 万行分成 10 万组，再丢掉 9.9 万组
SELECT cno FROM sc GROUP BY cno HAVING cno = 'C01';
-- ✓ 先过滤到只剩 C01 的行，再分组
SELECT cno FROM sc WHERE cno = 'C01' GROUP BY cno;
\`\`\`

> 一个实用判据：**能写 WHERE 就别写 HAVING**。
> WHERE 在分组前执行，越早缩小数据量，后续所有步骤都跟着便宜。`,
  },
  {
    id: 'k-window', category_id: 'sql', chapter_id: 'ch-sql-agg', sort_order: 4,
    title: '窗口函数',
    summary: '保留明细行的同时做聚合，与 GROUP BY 的本质区别',
    difficulty: 4, importance: 2, tags: ['进阶', '难点'],
    content: `**核心区别**：
- \`GROUP BY\` 把多行**合并**成一行
- 窗口函数**保留每一行**，只给每行附加一个"它在自己组里的位置/累计值"

\`\`\`sql
SELECT ename, deptno, sal,
       RANK()       OVER (PARTITION BY deptno ORDER BY sal DESC) AS 排名,
       SUM(sal)     OVER (PARTITION BY deptno) AS 部门总额,
       ROUND(sal * 100.0 / SUM(sal) OVER (PARTITION BY deptno), 1) AS 占比
FROM emp;
\`\`\`

**语法结构**：\`函数() OVER (PARTITION BY 分区 ORDER BY 排序 [窗口范围])\`
- \`PARTITION BY\` ≈ GROUP BY，但只是"划组"不"合并"
- \`ORDER BY\` 决定组内顺序（对排名和累计函数是必需的）

**三个排名函数的区别**（考试常考）：

| 函数 | 并列时的行为 | 结果示例 |
|---|---|---|
| \`ROW_NUMBER()\` | 强行不并列 | 1, 2, 3, 4 |
| \`RANK()\` | 并列后**跳号** | 1, 2, 2, **4** |
| \`DENSE_RANK()\` | 并列后**不跳号** | 1, 2, 2, **3** |

**最典型的用途：分组取 Top-N**
\`\`\`sql
WITH ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY cid ORDER BY price DESC) AS rn
  FROM product
)
SELECT * FROM ranked WHERE rn <= 3;
\`\`\`

> 用相关子查询也能做（见「分组内的最值」那一关），
> 但窗口函数只需扫一遍表，子查询是 O(n²)。
> 数据量一大，差别是秒级和分钟级的差别。`,
    sql_demo: 'SELECT ename, deptno, sal, RANK() OVER (PARTITION BY deptno ORDER BY sal DESC) AS 部门排名 FROM emp;',
    sql_demo_dataset: 'company',
  },
  {
    id: 'k-join', category_id: 'sql', chapter_id: 'ch-sql-join', sort_order: 1,
    title: '内连接与连接条件',
    summary: 'JOIN ... ON 的语义、笛卡尔积事故、别名的作用',
    difficulty: 2, importance: 3, tags: ['语法', '实践'],
    content: `**内连接**只保留两边都匹配上的行：

\`\`\`sql
SELECT s.sname, c.cname, sc.grade
FROM student s
JOIN sc     ON s.sno = sc.sno
JOIN course c ON c.cno = sc.cno;
\`\`\`

**忘记写 ON 的后果**：\`FROM a JOIN b\`（无 ON）等价于笛卡尔积。
两张各 1 万行的表连起来是 **1 亿行** —— 这不是"结果多了点"，
是数据库会跑到超时或者把内存吃光。

> 本平台的 SQL 沙箱对这种情况有 4 秒超时保护，并且会提示
> "多半是连接条件写漏了，产生了笛卡尔积"。生产环境没有这层保护。

**别名是必需的，不是可选的**。当两张表有同名列时：

\`\`\`sql
-- ✗ ambiguous column name: sno
SELECT sno FROM student JOIN sc ON student.sno = sc.sno;
-- ✓
SELECT s.sno FROM student s JOIN sc ON s.sno = sc.sno;
\`\`\`

**ON 和 WHERE 在 INNER JOIN 里等价，但在 OUTER JOIN 里不等价** ——
这一条单独见「外连接」那个知识点，是最容易出错的地方。

**旧式逗号连接**（\`FROM a, b WHERE a.x = b.x\`）是 SQL-92 之前的写法。
它能用，但把连接条件和过滤条件混在一起，可读性差，
而且漏写条件时是静默产生笛卡尔积而不是语法错误。**别用**。`,
    sql_demo: 'SELECT s.sname, c.cname, sc.grade FROM student s JOIN sc ON s.sno = sc.sno JOIN course c ON c.cno = sc.cno LIMIT 10;',
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-outer-join', category_id: 'sql', chapter_id: 'ch-sql-join', sort_order: 2,
    title: '外连接与 ON / WHERE 的位置陷阱',
    summary: 'LEFT JOIN 里把条件写在 ON 还是 WHERE，结果完全不同',
    difficulty: 4, importance: 3, tags: ['难点', '易错'],
    content: `**外连接保留不匹配的行**，另一侧补 NULL：

\`\`\`sql
-- 所有学生，没选课的也在，cno 为 NULL
SELECT s.sname, sc.cno FROM student s LEFT JOIN sc ON s.sno = sc.sno;
\`\`\`

**★ 本知识点最重要的一条：LEFT JOIN 里，条件写在 ON 和写在 WHERE 结果完全不同。**

\`\`\`sql
-- 写法 A：条件在 ON —— 保留所有学生，只有 C01 的成绩被填上
SELECT s.sname, sc.cno, sc.grade
FROM student s LEFT JOIN sc ON s.sno = sc.sno AND sc.cno = 'C01';
-- 没选 C01 的学生仍然出现，grade 为 NULL

-- 写法 B：条件在 WHERE —— 退化成内连接
SELECT s.sname, sc.cno, sc.grade
FROM student s LEFT JOIN sc ON s.sno = sc.sno
WHERE sc.cno = 'C01';
-- 没选 C01 的学生被 WHERE 筛掉了，因为他们那行的 cno 是 NULL，
-- 而 NULL = 'C01' 是 UNKNOWN，不是 TRUE
\`\`\`

**记忆规则**：
- **ON** 决定"右表哪些行参与连接"（在补 NULL 之前）
- **WHERE** 决定"最终结果保留哪些行"（在补 NULL 之后）

**找"没有 X 的记录"的标准写法**：
\`\`\`sql
-- 没选任何课的学生
SELECT s.* FROM student s LEFT JOIN sc ON s.sno = sc.sno WHERE sc.sno IS NULL;
-- 等价且通常更快（大表上）
SELECT s.* FROM student s WHERE NOT EXISTS (SELECT 1 FROM sc WHERE sc.sno = s.sno);
\`\`\``,
    sql_demo: "SELECT s.sname, sc.cno FROM student s LEFT JOIN sc ON s.sno = sc.sno AND sc.cno = 'C01';",
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-selfjoin', category_id: 'sql', chapter_id: 'ch-sql-join', sort_order: 3,
    title: '自连接与非等值连接',
    summary: '同一张表连自己，以及连接条件不是 = 的情况',
    difficulty: 3, importance: 2, tags: ['进阶'],
    content: `**自连接**：一张表和自己连接，**必须起两个不同的别名**，
否则无法区分"作为员工的自己"和"作为经理的自己"。

\`\`\`sql
SELECT e.ename AS 员工, m.ename AS 经理
FROM emp e
JOIN emp m ON e.mgr = m.empno;
\`\`\`

把 e 和 m 想象成"emp 表的两份副本"就理解了。

**非等值连接**：连接条件不一定是 \`=\`。

\`\`\`sql
-- 员工落在哪个工资等级区间
SELECT e.ename, e.sal, s.grade
FROM emp e
JOIN salgrade s ON e.sal BETWEEN s.losal AND s.hisal;
\`\`\`

这类连接在**等值连接优化器失效**时性能会差 —— 因为它没法用哈希连接，
只能嵌套循环。所以区间表通常很小（几十行），大表之间的连接尽量用等值。

**自连接的典型场景**：
- 层次结构（员工→经理、分类→父分类、评论→父评论）
- 同一张表内的比较（"找出比直属经理工资还高的员工"）
- 找重复（"找出同名的人"）

> **递归层次用自连接只能查一层**。查"整个汇报链"需要
> 递归 CTE（\`WITH RECURSIVE\`），那是另一个话题。`,
    sql_demo: 'SELECT e.ename AS 员工, m.ename AS 经理 FROM emp e JOIN emp m ON e.mgr = m.empno;',
    sql_demo_dataset: 'company',
  },
  {
    id: 'k-subquery', category_id: 'sql', chapter_id: 'ch-sql-sub', sort_order: 1,
    title: '不相关子查询与相关子查询',
    summary: '子查询什么时候只算一次，什么时候要算 N 次',
    difficulty: 3, importance: 3, tags: ['考点', '难点'],
    content: `**不相关子查询**：子查询不引用外层的列，**只求值一次**。

\`\`\`sql
SELECT * FROM sc WHERE grade > (SELECT AVG(grade) FROM sc);
-- 内层算出一个数，外层拿它当常量用
\`\`\`

**相关子查询**：子查询引用了外层的列，**外层每行都要重新求值**。

\`\`\`sql
SELECT * FROM sc x
WHERE grade = (SELECT MAX(grade) FROM sc y WHERE y.cno = x.cno);
--                     ↑ 引用了外层的 x.cno，所以每行都要重算
\`\`\`

> 相关子查询的复杂度是 **O(外层行数 × 内层代价)**。
> 上面这个例子里，外层 26 行、内层要扫 26 行，还好；
> 但如果外层是 10 万行、内层也是 10 万行，那就是 100 亿次比较。
> 现代优化器很多情况下会自动改写（"相关子查询去相关化"），但不能指望。

**三类子查询按返回形态分**：

| 返回 | 用法 | 例子 |
|---|---|---|
| 标量（1 行 1 列） | 当值用 | \`WHERE x > (SELECT AVG(y) ...)\` |
| 一列多行 | 配 \`IN\` / \`ANY\` / \`ALL\` | \`WHERE x IN (SELECT ...)\` |
| 多列多行 | 配 \`EXISTS\` / 派生表 | \`FROM (SELECT ...) t\` |

**标量子查询返回多行会直接报错** —— 这是好事，比静默取第一行安全。`,
  },
  {
    id: 'k-exists', category_id: 'sql', chapter_id: 'ch-sql-sub', sort_order: 2,
    title: 'EXISTS 与 IN 的选择',
    summary: '语义差异、NULL 陷阱、性能取舍',
    difficulty: 4, importance: 3, tags: ['难点', '易错'],
    content: `**语义上的关键差异在 \`NOT\` 上**：

\`\`\`sql
-- IN：先算出子查询的完整结果集，再逐个比对
WHERE cno IN (SELECT cno FROM sc)

-- EXISTS：对每一行问"存在吗"，找到一条就停
WHERE EXISTS (SELECT 1 FROM sc WHERE sc.cno = course.cno)
\`\`\`

**★ NOT IN 的 NULL 陷阱**（最值得记住的一条）：

\`\`\`sql
-- 想找"没被任何人选过的课"
SELECT * FROM course WHERE cno NOT IN (SELECT cno FROM sc);
\`\`\`

如果 \`sc.cno\` 里有任何 NULL，这个查询返回**空集**，而且**不报错**。
原因：\`x NOT IN (a, b, NULL)\` 展开成 \`x<>a AND x<>b AND x<>NULL\`，
而 \`x <> NULL\` 是 UNKNOWN，整个 AND 结果就是 UNKNOWN（不是 FALSE），
WHERE 只保留 TRUE 的行，所以一行都不剩。

**NOT EXISTS 没有这个问题**，因为它不比较值，只判断"存不存在"。

\`\`\`sql
SELECT * FROM course c WHERE NOT EXISTS (SELECT 1 FROM sc WHERE sc.cno = c.cno);
\`\`\`

**性能取舍**（现代优化器里差距已经不大，但仍值得知道）：
- 子查询结果**小**：\`IN\` 通常更快（一次算完做成哈希表）
- 子查询结果**大**、外表**小**：\`EXISTS\` 通常更快（半连接，找到就停）
- **有 NULL 风险**：无条件选 \`NOT EXISTS\`

> 一条实用规则：**\`NOT IN\` 只在你能保证子查询列非空时用**。
> 而"能保证"这件事，往往在半年后某次需求变更里就不成立了。`,
  },
  {
    id: 'k-null', category_id: 'sql', chapter_id: 'ch-sql-null', sort_order: 1,
    title: 'NULL 与三值逻辑',
    summary: 'NULL 不是 0、不是空串，任何与它的比较都是 UNKNOWN',
    difficulty: 3, importance: 3, tags: ['考点', '易错'],
    content: `**NULL 的语义是"未知"**，不是"空"、不是"0"、不是"没有"。

SQL 采用**三值逻辑**：TRUE / FALSE / **UNKNOWN**。

\`\`\`sql
NULL = NULL      -- UNKNOWN，不是 TRUE
NULL <> NULL     -- 也是 UNKNOWN
1 + NULL         -- NULL（算术传播）
'abc' || NULL    -- NULL（字符串连接也传播）
NULL AND FALSE   -- FALSE   ← 注意这条：AND 有短路性
NULL AND TRUE    -- UNKNOWN
NULL OR TRUE     -- TRUE    ← OR 也有
\`\`\`

**WHERE 只保留结果为 TRUE 的行**，UNKNOWN 和 FALSE 一样被丢掉。
这就是为什么 \`WHERE return_date = NULL\` 返回 0 行 —— 它不报错，只是全不匹配。

**正确写法**：
\`\`\`sql
WHERE return_date IS NULL
WHERE return_date IS NOT NULL
\`\`\`

**处理 NULL 的函数**：
| 函数 | 作用 | 哪来的 |
|---|---|---|
| \`COALESCE(a, b, c)\` | 返回第一个非 NULL 的值 | **标准 SQL**，到处都有 |
| \`IFNULL(a, b)\` | 两参数版 | SQLite / MySQL |
| \`ISNULL(a)\` | 判断是不是 NULL，等价于 \`a IS NULL\`，返回 0/1 | SQLite / MySQL，**只接受一个参数** |
| \`NULLIF(a, b)\` | a = b 时返回 NULL，否则返回 a | 标准 SQL |

> ⚠️ **\`ISNULL\` 是个容易记混的名字**：
> SQLite 和 MySQL 的 \`isnull(x)\` 是**单参数**的判空函数，
> 而**两参数**的 \`ISNULL(a, b)\`（"为空就换成 b"）是 **SQL Server** 的写法。
> 在 SQLite 里写 \`ISNULL(NULL, 1)\` 会直接报语法错误 —— 实测如此。
> 要跨库可移植，一律用标准的 \`COALESCE\`。

\`\`\`sql
-- 奖金显示：没有奖金时显示 0 而不是空白
SELECT ename, COALESCE(comm, 0) AS 奖金 FROM emp;
-- 防止除零：分母为 0 时返回 NULL 而不是报错
SELECT a / NULLIF(b, 0) FROM t;
\`\`\`

> **唯一性约束和 NULL**：\`UNIQUE\` 列上可以有多行 NULL，
> 因为"未知"和"未知"不算相等。主键则**不允许** NULL（实体完整性）。`,
    sql_demo: 'SELECT ename, comm, COALESCE(comm, 0) AS 奖金补零 FROM emp ORDER BY comm IS NULL, comm DESC;',
    sql_demo_dataset: 'company',
  },
  {
    id: 'k-ddl', category_id: 'sql', chapter_id: 'ch-sql-ddl', sort_order: 1,
    title: '数据定义：CREATE / ALTER / DROP',
    summary: '建表、改表结构、删除表，以及约束的写法',
    difficulty: 2, importance: 3, tags: ['语法'],
    content: `\`\`\`sql
CREATE TABLE sc (
  sno   TEXT NOT NULL,
  cno   TEXT NOT NULL,
  grade INTEGER CHECK (grade BETWEEN 0 AND 100),
  PRIMARY KEY (sno, cno),
  FOREIGN KEY (sno) REFERENCES student(sno) ON DELETE CASCADE,
  FOREIGN KEY (cno) REFERENCES course(cno)
);
\`\`\`

**约束的五个种类**：
| 约束 | 作用 |
|---|---|
| \`PRIMARY KEY\` | 唯一 + 非空，一张表只能有一个 |
| \`UNIQUE\` | 唯一，但允许 NULL，可以有多个 |
| \`NOT NULL\` | 非空 |
| \`CHECK\` | 自定义条件 |
| \`FOREIGN KEY\` | 参照完整性 |

**复合主键 vs 代理主键**：
- 复合主键 \`(sno, cno)\`：自然、语义清晰、自动保证不重复选课
- 代理主键 \`id AUTOINCREMENT\`：单列、便于引用、插入快

> 选哪个取决于这张表会不会被**别的表引用**。
> 会被引用的表建议用单列代理主键 —— 否则引用方要背上两个列，
> 而且那两列的业务含义一旦变化（比如学号规则改了），改动面很大。

**ALTER TABLE** 在 SQLite 里支持有限：\`ADD COLUMN\` / \`RENAME TABLE\` /
\`RENAME COLUMN\`，**3.35 起也支持 \`DROP COLUMN\`**（但删列有额外限制，
比如被索引或视图引用的列删不掉）。MySQL 支持 \`MODIFY\` / \`CHANGE\` /
\`DROP COLUMN\` / \`ADD INDEX\`。**跨数据库迁移时这是最容易踩的差异**。

**DROP TABLE 是不可逆的**。生产环境里的标准做法是先 \`RENAME\` 加个时间戳后缀
观察一周，确认没人用再真删。`,
  },
  {
    id: 'k-dml', category_id: 'sql', chapter_id: 'ch-sql-dml', sort_order: 1,
    title: 'INSERT / UPDATE / DELETE 的安全实践',
    summary: '写操作的三条纪律：先 SELECT、用事务、检查影响行数',
    difficulty: 2, importance: 3, tags: ['实践', '易错'],
    content: `\`\`\`sql
INSERT INTO student (sno, sname, ssex, sage, sdept)
VALUES ('2021011', '钱进', '男', 20, '计算机系');

UPDATE sc SET grade = grade + 5 WHERE grade < 60;

DELETE FROM sc WHERE grade IS NULL;
\`\`\`

**三条纪律，每一条都是血的教训**：

**1. 写之前先 \`SELECT\` 一遍同样的 WHERE**
\`\`\`sql
SELECT * FROM sc WHERE grade < 60;   -- 先看会影响多少行
UPDATE  sc SET grade = grade + 5 WHERE grade < 60;
\`\`\`
看一眼行数和内容，再改。这一步只花两秒。

**2. 包在事务里，确认后再提交**
\`\`\`sql
BEGIN;
UPDATE sc SET grade = grade + 5 WHERE grade < 60;
SELECT * FROM sc WHERE sno = '2021007';   -- 检查一下
-- 没问题：COMMIT;   有问题：ROLLBACK;
\`\`\`

**3. 检查影响行数**
\`UPDATE\` 忘记写 \`WHERE\` 会把整张表改掉。
如果返回的影响行数是"全部行数"，那就说明 WHERE 写漏了或条件永远为真。

> \`UPDATE t SET x = 1\` 和 \`UPDATE t SET x = 1 WHERE 1=1\` 是一样的效果。
> 前者是手滑，后者可能是拼接 SQL 时的残留 —— 两种都要在提交前发现。

**DELETE 和 TRUNCATE 的区别**：
\`DELETE\` 是 DML，逐行删除、记日志、可回滚、触发触发器；
\`TRUNCATE\` 是 DDL，直接释放数据页、极快、**通常不可回滚**。
生产环境里删全表数据，\`DELETE\` 慢但安全。`,
    sql_demo: 'SELECT COUNT(*) AS 待处理行数 FROM sc WHERE grade < 60;',
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-view', category_id: 'sql', chapter_id: 'ch-sql-view', sort_order: 1,
    title: '视图：逻辑封装与权限控制',
    summary: '视图的定义、可更新条件、物化视图的取舍',
    difficulty: 3, importance: 2, tags: ['进阶'],
    content: `**视图是命名的查询**，不存数据（普通视图）：

\`\`\`sql
CREATE VIEW v_student_grade AS
SELECT s.sno, s.sname, s.sdept, c.cname, sc.grade
FROM student s
JOIN sc ON s.sno = sc.sno
JOIN course c ON c.cno = sc.cno;

-- 之后像表一样查它
SELECT * FROM v_student_grade WHERE grade >= 90;
\`\`\`

**视图的三个实际用途**：

1. **简化复杂查询**：把五表连接封装成一个视图，
   业务代码不用每次重写
2. **权限隔离**：只把视图授权给某个角色，
   让他看不到底层表的敏感列（比如工资）
3. **逻辑独立性**：底层表结构调整时，改视图定义即可，
   上层查询不用动

**可更新视图的条件**（考试常考）：
视图可以 \`INSERT\`/\`UPDATE\`/\`DELETE\` 的前提是**每一行都能唯一对应到基表的一行**。
不满足的典型情况：
- 用了聚合函数（\`GROUP BY\` / \`SUM\`）
- 用了 \`DISTINCT\`
- 用了 \`UNION\`
- 有计算列（\`SELECT sal * 12 AS 年薪\`）
- 多表连接时只更新其中一张表 —— 各数据库支持不同

**物化视图**（Materialized View）**存数据**，需要刷新。
- 适合：聚合结果、跨库数据、查询代价极高的场景
- 代价：数据可能过期；刷新要么定时（有延迟）要么增量（实现复杂）

> **物化视图本质是"用空间和一致性换查询速度"**。
> 引入它之前先问：这个查询真的慢到需要缓存吗？
> 加索引、改 SQL 往往能解决 90% 的问题，而物化视图带来的一致性
> 问题会一直跟着你。`,
  },

  /* ==================== 数据库设计 ==================== */
  {
    id: 'k-er', category_id: 'design', chapter_id: 'ch-er', sort_order: 1,
    title: 'E-R 模型与转换规则',
    summary: '实体、联系、基数，以及怎么转成关系表',
    difficulty: 2, importance: 3, tags: ['考点', '设计'],
    content: `**E-R 图的三要素**：

| 元素 | 图形 | 含义 |
|---|---|---|
| 实体 | 矩形 | 客观存在的事物，如"学生" |
| 属性 | 椭圆 | 实体的特征，如"学号" |
| 联系 | 菱形 | 实体间的关联，如"选修" |

**联系的基数**：1:1、1:n、m:n

**转关系表的四条规则**：

| 情况 | 转换方式 |
|---|---|
| 实体 | 一个实体一张表，属性作列，码作主键 |
| 1:1 联系 | 可以并入任一端（**建议并入"完全参与"的那一端**，见下） |
| 1:n 联系 | **把 1 端的码加到 n 端**当外键 |
| m:n 联系 | **必须单独建一张表**，主键是两端码的组合 |

**为什么 1:1 建议并入"完全参与"的一端**：

"完全参与"指这一端的**每个实体都必然参与**这个联系。并入它，
新加的那一列不会有 NULL；并入部分参与的那一端，就会留下一堆 NULL。

> 例：\`系\` 与 \`系主任\` 是 1:1。如果规定"每个系必须有主任"（系完全参与），
> 那 \`系主任\` 这边一定找得到对应的系 —— 把 \`系号\` 加到 \`系主任\` 表里，
> 列列有值。反过来并入 \`系\` 表，那些还没任命主任的系就会留一个 NULL。
>
> 教材上通常写"并入任意一端均可"，那是在**不考虑 NULL 和空值统计**的
> 前提下说的。实际建模时，"哪一端不产生 NULL"才是那个决定性的判据。

**为什么 m:n 必须单独建表** —— 这是本节最重要的一条：

一个学生选多门课，一门课被多个学生选。如果想把"选修"塞进
\`student\` 表，那一列要存什么？存"数据库,数据结构,操作系统"这种
逗号分隔的字符串，就违反了第一范式（分量不原子），
而且"查询选修了数据库的学生"需要字符串匹配，无法建索引。

所以必须拆成 \`sc(sno, cno, grade)\` 三张表。
**联系上的属性（成绩）跟着联系走** —— 成绩既不属于学生，也不属于课程，
它属于"这个学生选了这门课"这件事。

**弱实体**：没有自己的码、必须依附于某个实体存在的实体
（如"订单明细"依附于"订单"）。转表时它的主键是"所属实体的码 + 自己的部分码"。`,
  },
  {
    id: 'k-fd', category_id: 'design', chapter_id: 'ch-fd', sort_order: 1,
    title: '函数依赖与属性闭包',
    summary: '函数依赖的定义、Armstrong 公理、闭包算法',
    difficulty: 3, importance: 3, tags: ['考点', '难点'],
    content: `**函数依赖** $X \\to Y$：对任意两个元组，若它们在 $X$ 上的值相同，
则它们在 $Y$ 上的值也必然相同。记作 $X$ 决定 $Y$。

例：$sno \\to sname$ —— 学号定了，姓名就定了。

**Armstrong 公理**（三条基本规则）：
- **自反律**：$Y \\subseteq X \\Rightarrow X \\to Y$
- **增广律**：$X \\to Y \\Rightarrow XZ \\to YZ$
- **传递律**：$X \\to Y, Y \\to Z \\Rightarrow X \\to Z$

由它们可导出：合并律、分解律、伪传递律。

**属性闭包 $X^+$**：从 $X$ 出发，用 $F$ 能推出的全部属性。

**算法**：
\`\`\`
result = X
循环直到 result 不再变化：
    对 F 中每条依赖 A → B：
        若 A ⊆ result，则 result = result ∪ B
\`\`\`

> ⚠️ **必须循环到不动点**。初学者最常犯的错是只扫一遍：
> $F = \\{A \\to B, B \\to C\\}$ 求 $A^+$，
> 扫一遍只得到 $AB$（因为扫到 $B \\to C$ 时 $B$ 还没进结果）。
> 正确答案是 $ABC$。

**闭包的三个用途**：
1. 判断 $X$ 是否是**超键**：$X^+$ 包含全部属性即可
2. 判断 $X \\to Y$ 是否可由 $F$ 推出：$Y \\subseteq X^+$ 即可
3. 求**候选键**：找出所有"极小超键"

**候选键求法**：
- 从不出现在任何依赖右部的属性，**必在每一个候选键中**
- 只在右部出现、不在左部出现的属性，**一定不在键中**
- 其余属性枚举组合，逐个验闭包

本平台的「范式实验室」会把这套推导一步步算给你看。`,
  },
  {
    id: 'k-key', category_id: 'design', chapter_id: 'ch-fd', sort_order: 2,
    title: '候选键与最小覆盖',
    summary: '怎么找全部候选键、怎么求最小函数依赖集',
    difficulty: 4, importance: 3, tags: ['难点', '考点'],
    content: `**候选键**：能唯一标识元组、且不含多余属性的属性组。

**四类属性的划分**（这是快速求键的关键）：

| 类别 | 定义 | 在键中的位置 |
|---|---|---|
| **L 类** | 只在依赖左部出现 | **必在**每个候选键中 |
| **R 类** | 只在依赖右部出现 | **必不在**键中 |
| **LR 类** | 左右都出现 | 需要枚举 |
| **N 类** | 两边都不出现 | **必在**每个候选键中 |

求法：先取 $L \\cup N$ 求闭包。若已是全集，则它是唯一候选键；
否则枚举 $LR$ 的子集逐个加进去试。

**最小覆盖（最小依赖集）$F_c$** 的三步：

1. **右部单属性化**：$X \\to AB$ 拆成 $X \\to A$ 和 $X \\to B$
2. **去掉冗余依赖**：试着删掉某条，看剩下的能否推出它
3. **去掉左部冗余属性**：$XY \\to A$ 中若 $X \\to A$ 已成立，则 $Y$ 多余

> **顺序不能换**：第 1 步必须最先。否则第 3 步"去掉左部多余属性"时，
> 会碰到 $XY \\to AB$ 这种右部多属性的情况，判断标准就说不清了。

**最小覆盖不唯一** —— 取决于第 2、3 步的扫描顺序。
所以判分时**不能比对最小覆盖本身**，只能比对"两者是否等价"
（互相能推出对方的每一条）。

本平台的范式实验室正是按"等价性"判分的，不是按字符串匹配。`,
  },
  {
    id: 'k-nf', category_id: 'design', chapter_id: 'ch-nf', sort_order: 1,
    title: '范式：1NF / 2NF / 3NF / BCNF',
    summary: '四个等级的判定条件，以及它们之间的关系',
    difficulty: 4, importance: 3, tags: ['考点', '难点'],
    content: `**逐级严格**：满足 BCNF ⇒ 满足 3NF ⇒ 满足 2NF ⇒ 满足 1NF。

| 范式 | 条件 | 消除的问题 |
|---|---|---|
| **1NF** | 每个分量都是原子的 | 表里套表、多值列 |
| **2NF** | 1NF + 非主属性**完全**依赖于候选键 | 部分依赖 |
| **3NF** | 2NF + 非主属性不**传递**依赖于候选键 | 传递依赖 |
| **BCNF** | 每条非平凡依赖的左部都是**超键** | 主属性对码的部分/传递依赖 |

**严格的判定条件（做题用这个）**：

- **BCNF**：对每条非平凡依赖 $X \\to A$，$X$ 是超键
- **3NF**：对每条非平凡依赖 $X \\to A$，$X$ 是超键 **或** $A$ 是主属性
- **2NF**：不存在非主属性**部分依赖**于候选键

> **3NF 比 BCNF 宽松的全部原因就是那个"或 A 是主属性"**。
> 它允许"主属性之间互相依赖"，而这在实践中往往是可以接受的。

**部分依赖 vs 传递依赖**：
- **部分依赖**：$X$ 是候选键的**真子集**，却决定了非主属性。
  例：$R(\\underline{sno}, \\underline{cno}, sname)$，$sno \\to sname$ 就是部分依赖 ——
  $sno$ 只是候选键 $(sno, cno)$ 的一部分。
- **传递依赖**：$A \\to B, B \\to C$，且 $B \\not\\to A$。
  例：$R(\\underline{sno}, sname, sdept, dhead)$，$sno \\to sdept, sdept \\to dhead$ ——
  系主任通过"系"这个中间属性传递依赖于学号。

**判断顺序不能颠倒**：从 BCNF 往下判，第一个满足的就是最高等级。
反过来先判 2NF，一个 3NF 的关系会被错判成 2NF。`,
  },
  {
    id: 'k-decomp', category_id: 'design', chapter_id: 'ch-decomp', sort_order: 1,
    title: '无损连接与保持依赖',
    summary: '分解的两个正确性标准，以及为什么两者不能兼得（BCNF）',
    difficulty: 5, importance: 3, tags: ['难点', '考点'],
    content: `**分解要满足两个条件**才算好：

**1. 无损连接**：分解后的表自然连接回来，必须能还原原表（不多不少）。

> "有损"不是"丢数据"，而是**多出虚假元组**。
> 例：$R(\\underline{sno}, sdept, dhead)$ 按 $sdept$ 分成
> $R_1(sno, sdept)$ 和 $R_2(sdept, dhead)$ 是无损的；
> 但如果分成 $R_1(sno, sdept)$ 和 $R_2(sno, dhead)$，
> 连接回来会凭空产生"某个学生对应别的系的主任"这种不存在的组合。

**判定方法：矩阵法（chase）**
1. 建一个 k 行 n 列的矩阵，$R_i$ 含属性 $A_j$ 则填 $a_j$，否则填 $b_{ij}$
2. 对每条依赖 $X \\to Y$：找 $X$ 列上取值相同的行，把它们的 $Y$ 列统一
3. 反复直到不动点
4. **若某一行全变成 $a$，则无损**

> ⚠️ 那个"$R_1 \\cap R_2 \\to (R_1 - R_2)$ 就无损"的定理
> **只对二分解成立**。三分解以上必须用矩阵法。

**2. 保持依赖**：$F$ 的每条依赖都能从分解后的各个关系上推出来。

不保持依赖的后果很具体：$F$ 里有一条 $\\text{教师} \\to \\text{系}$，
分解后这条依赖跨了两个关系，数据库**没法在插入时自动检查它**了 ——
只能在应用层手工保证，而应用层总会有人漏。

**★ 关键结论（考试重点）**：
- **3NF 分解**：可以同时做到无损 + 保持依赖（用合成法）
- **BCNF 分解**：保证无损，但**可能不保持依赖**

所以存在"无法既 BCNF 又保持依赖"的关系模式。
这时要在两者间取舍：实践上通常**优先保持依赖**（数据正确性更基本），
接受 3NF 而不是 BCNF。

本平台的范式实验室会实时验算你给出的分解是否满足这两个条件 ——
而且**不比对标准答案**，因为正确的分解通常不唯一。`,
  },

  /* ==================== 存储与索引 ==================== */
  {
    id: 'k-storage', category_id: 'storage', chapter_id: 'ch-storage', sort_order: 1,
    title: '磁盘、页与缓冲池',
    summary: '数据库为什么按页读写，缓冲池怎么减少磁盘 I/O',
    difficulty: 3, importance: 2, tags: ['原理'],
    content: `**磁盘 I/O 是数据库性能的主要瓶颈**，因为它的速度比内存慢几个数量级：

| 层级 | 典型延迟 |
|---|---|
| CPU 缓存 | ~1 ns |
| 内存 | ~100 ns |
| SSD | ~100 μs |
| 机械硬盘寻道 | ~10 ms |

**所以数据库的基本策略是"减少磁盘访问次数"**，一切设计都围绕这个目标。

**页（Page / Block）**是数据库读写磁盘的最小单位，通常 4KB–16KB。
为什么不是按"行"读写：

- 磁盘控制器按扇区（512B–4KB）读写，按行读会读入大量无用数据
- 一次寻道的时间可以读很多页，**把随机 I/O 变成顺序 I/O**
- 页是加锁、日志、缓存的统一单位

**缓冲池（Buffer Pool）**：内存里的一块区域，缓存磁盘页。
访问一页时先在池里找（命中），找不到才读磁盘（未命中）并替换掉某一页。

**替换算法**：数据库不用**朴素 LRU**，主要因为两个问题：
1. **顺序扫描污染**：一次全表扫描会把整个池冲掉，
   而那个大表页**再也不会被访问**
2. **脏页不能随便淘汰**：被改过还没写回的页要先刷盘

实际用的是 **LRU-K**（看第 K 次访问的时间，而不是最后一次）或
**时钟算法 + 分区**（把池分成几块，防止一类访问冲掉另一类）。

**B+ 树和缓冲池的配合**：B+ 树把树高控制在 3–4 层，
根节点和上层节点几乎总在缓冲池里，所以一次查找只需 1–2 次磁盘 I/O。
这是 B+ 树成为索引标准结构的核心原因。`,
  },
  {
    id: 'k-bplus', category_id: 'storage', chapter_id: 'ch-index', sort_order: 1,
    title: 'B+ 树索引',
    summary: '为什么用 B+ 树、它的结构、以及一次查找要几次 I/O',
    difficulty: 4, importance: 3, tags: ['考点', '重点'],
    content: `**B+ 树的定义**（m 阶）：
- 每个节点最多 m 个孩子
- 根节点至少 2 个孩子，其他非叶节点至少 $\\lceil m/2 \\rceil$ 个
- **所有数据都在叶子节点**，非叶节点只存索引键
- **叶子节点用指针串成链表**（这是 B+ 树相对 B 树最大的优势）

**为什么用 B+ 树而不是别的**：

| 结构 | 为什么不用 |
|---|---|
| 二叉搜索树 | 树高 $O(\\log_2 n)$，100 万条数据要 20 次 I/O |
| B 树 | 数据分散在所有节点，**范围查询要中序遍历**，随机 I/O 多 |
| 哈希索引 | 不支持范围查询和排序 |
| 跳表 | 内存结构，不适合磁盘 |

**B+ 树的关键优势**：
- **树高低**：一个节点存几百个键，100 万条数据树高只有 3 层
- **范围查询高效**：叶子链表串起来，扫到起点后顺序读即可
- **I/O 次数可预测**：每次查找都是"根到叶"的固定层数

**实际 I/O 次数估算**（这是常考的算术题）：
设块大小 4KB，键 8 字节 + 指针 8 字节 = 16 字节/项，
则一个节点能放 $4096 / 16 = 256$ 个键。

- 第 1 层：1 个节点，256 个指针
- 第 2 层：256 个节点，$256^2 = 65536$ 个指针
- 第 3 层：$256^3 = 1677$ 万个指针

**所以 3 层 B+ 树能索引约 1600 万条记录**，一次查找最多 3 次磁盘 I/O。
而如果根节点常驻缓冲池，实际只需 2 次。

**插入导致的分裂**：节点满了要一分为二，并把中间键上推到父节点。
分裂是 B+ 树维护平衡的机制，也是写入放大（write amplification）的来源。`,
  },
  {
    id: 'k-index-use', category_id: 'storage', chapter_id: 'ch-index', sort_order: 2,
    title: '索引的选择与失效场景',
    summary: '什么时候该建索引、什么写法会让索引失效',
    difficulty: 3, importance: 3, tags: ['实践', '重点'],
    content: `**索引不是越多越好**：
- 每个索引都要占空间
- **每次写操作都要维护所有索引** —— 一张表 10 个索引，
  插入一行要更新 10 棵 B+ 树

**该建索引的情况**：
- 经常出现在 \`WHERE\` 里的列
- \`JOIN\` 的连接列
- \`ORDER BY\` / \`GROUP BY\` 的列
- 选择性高（不同值多）的列

**不该建索引的情况**：
- 选择性低的列（如"性别"，只有两个值 —— 走索引还不如全表扫）
- 很少被查询的列
- 表本身很小（全表扫只要一次 I/O，走索引反而要多次）

**★ 索引失效的常见写法**（本节的实用重点）

下面每条都标了「在 SQLite 上实测是什么结果」—— 因为**很多流传很广的
"索引失效"说法是 MySQL 的经验，在 SQLite 上并不成立**。
本平台的实验台跑的是 SQLite，所以这里以实测为准。

\`\`\`sql
-- ① 列上做运算/函数 —— ✅ 确实失效（SQLite 实测 SCAN）
WHERE substr(hiredate, 1, 4) = '2022'     -- hiredate 是 TEXT，取年份
WHERE sal + 100 > 20000
-- ✓ 改写：把运算挪到常量侧
WHERE hiredate >= '2022-01-01' AND hiredate < '2023-01-01'
WHERE sal > 19900

-- ② 前导通配符 —— ✅ 确实失效
WHERE ename LIKE '%伟'
-- ✓ 后缀通配符**在 SQLite 上也不走索引**（下面单独说）
WHERE ename LIKE '张%'
\`\`\`

> \`substr\` 是 SQLite 的函数。MySQL/PostgreSQL 里这一步通常写成
> \`YEAR(hiredate)\` —— 但 SQLite **没有** \`YEAR\` 这个函数，
> 照抄会直接报 \`no such function\`。这也是"换库要重测"的一个小例子。

**② 需要展开说：\`LIKE '张%'\` 在 SQLite 上也不走索引。**

这是最容易搞错的一条 —— 教材和 MySQL 的经验都说"前缀匹配能用索引"，
但 SQLite 有个额外前提：**索引必须建成 \`COLLATE NOCASE\`**。
因为 SQLite 的 \`LIKE\` 默认大小写不敏感，而普通索引是按 \`BINARY\` 排的，
优化器没法拿它来回答一个大小写不敏感的匹配。

\`\`\`sql
-- 实测（EXPLAIN QUERY PLAN）：
--   CREATE INDEX i ON emp(ename);            → LIKE '张%' 是 SCAN
--   CREATE INDEX i ON emp(ename COLLATE NOCASE); → LIKE '张%' 是 SEARCH
\`\`\`

要在 SQLite 上做前缀匹配，有三个真正可行的写法：

\`\`\`sql
-- ① 索引加 COLLATE NOCASE
CREATE INDEX idx_name_nocase ON emp(ename COLLATE NOCASE);
-- ② 用 GLOB（默认区分大小写，能直接用 BINARY 索引）
WHERE ename GLOB '张*'
-- ③ 手工写成范围条件 —— 最通用，任何数据库都认
WHERE ename >= '张' AND ename < '张' || char(0x10FFFF)
\`\`\`

**③ 类型不匹配（\`WHERE sno = 2021001\`，sno 是 TEXT）—— 在 SQLite 上不失效。**

MySQL 上这条会让列发生隐式转换，索引用不上，是经典陷阱。
但 SQLite 的规则相反：**没有亲和性的字面量会被"拉"到列的类型上**，
所以 \`2021001\` 被当成 \`'2021001'\` 处理，索引照用、结果也完全一致（实测）。

> 跨库写代码时仍然建议类型写对 —— 这条在 MySQL 上是真会翻车的。
> 但**别在本平台的实验台上断言"它失效了"**，实测是 SEARCH。

**④ \`OR\` 连接不同列（\`WHERE deptno = 10 OR sal > 20000\`）—— 在 SQLite 上也不失效。**

SQLite 有 **MULTI-INDEX OR** 优化：它会对 \`OR\` 两边分别走各自的索引，
再把结果合并（实测计划里能看到 \`MULTI-INDEX OR\` + 两个 \`SEARCH\`）。

> MySQL 老版本确实会退化成全表扫描，"拆成 UNION" 那条建议就是从那儿来的。
> 在 SQLite 上没必要拆 —— 但拆了也不会错。

> **一条比"记住失效写法清单"更耐用的判据**：
> **"索引失效"的本质是优化器无法用索引的有序性来缩小扫描范围。**
> 只要你能回答"这个条件能不能让我直接跳到某一段"，
> 就知道索引能不能用 —— 而不用去背某个数据库某个版本的清单。
> 清单会过期，判据不会。

**最左前缀原则**（复合索引）：索引 \`(a, b, c)\` 能支持
\`a\`、\`(a,b)\`、\`(a,b,c)\` 的查询，但**不支持单独的 \`b\` 或 \`c\`**。
所以复合索引的列顺序很重要：**选择性高的放前面**。`,
    sql_demo: "EXPLAIN QUERY PLAN SELECT * FROM emp WHERE deptno = 10;",
    sql_demo_dataset: 'company',
  },
  {
    id: 'k-hash', category_id: 'storage', chapter_id: 'ch-hash', sort_order: 1,
    title: '散列索引与位图索引',
    summary: '散列索引为什么不能做范围查询，位图索引适合什么场景',
    difficulty: 3, importance: 2, tags: ['原理'],
    content: `**散列索引**：用哈希函数把键映射到桶。

\`\`\`
h(key) = bucket_no
\`\`\`

**优点**：等值查询是 O(1)，比 B+ 树的 O(log n) 还快。

**致命缺点**：**哈希打乱了顺序**，所以：
- ✗ 不支持范围查询（\`WHERE sal > 20000\` 只能全表扫）
- ✗ 不支持排序（\`ORDER BY\` 用不上）
- ✗ 不支持最左前缀（复合键必须全匹配）
- ✗ 不支持 \`LIKE '张%'\` 这种前缀匹配

> 所以数据库里**绝大多数索引都是 B+ 树**。
> 哈希索引只在极少数纯等值查询场景（如内存数据库、临时表）里用。

**动态散列（可扩展散列）**：桶数量随数据增长动态调整，
用"全局深度 / 局部深度"控制分裂。解决的问题是静态散列的
"桶数固定，数据涨了就溢出一堆溢出链"。

**位图索引**：对**低基数**列（不同值很少）特别有效。

对"性别"这种列，位图索引为每个值存一个位向量：
\`\`\`
男: 1 0 1 1 0 0 1 ...
女: 0 1 0 0 1 1 0 ...
\`\`\`
每个向量只占 1 bit/行。查"男性"就是把对应位向量取出来。

**位图索引的优势**：
- 空间极小（100 万行只需 125KB）
- **多个条件的位运算极快**（\`WHERE 性别='男' AND 城市='成都'\` 就是两个位图求 AND）

**位图索引的致命限制**：**不适合写密集的场景**。
一个位向量是共享的，改一行要锁**整段**（不是一个 bit）——
并发写入会严重串行化。所以它只用在数据仓库（只读或批量导入）里，
OLTP 系统里绝对不能用。`,
  },

  /* ==================== 查询优化 ==================== */
  {
    id: 'k-query-process', category_id: 'query', chapter_id: 'ch-qp', sort_order: 1,
    title: '查询处理流程',
    summary: '从 SQL 文本到结果，中间经历了哪几步',
    difficulty: 3, importance: 2, tags: ['原理'],
    content: `一条 SQL 从提交到返回结果，要经过四个阶段：

\`\`\`
SQL 文本
  ↓ ① 语法分析
语法树
  ↓ ② 语义分析（查数据字典，检查表和列是否存在）
查询树（关系代数表达式）
  ↓ ③ 代数优化（基于规则的等价变换）
优化后的查询树
  ↓ ④ 物理优化（基于代价，选具体算法和索引）
执行计划
  ↓ ⑤ 执行
结果
\`\`\`

**① 语法分析**：用词法/语法分析器检查 SQL 是否符合语法。
失败就是"语法错误"，带位置信息。

**② 语义分析**：把名字解析成实际的表/列，
检查类型是否兼容、权限是否足够。
失败是"表不存在 / 列不存在 / 权限不足"。

**③ 代数优化**：**与具体数据无关**的等价变换，
比如"选择下推"、"投影下推"。规则固定，不看数据量。

**④ 物理优化**：**依赖统计信息**决定具体怎么做：
用不用索引？连接用嵌套循环还是哈希连接？
这一步的输入是数据字典里的统计信息（行数、不同值个数、直方图）。

> **统计信息过期是执行计划突然变差的最常见原因**。
> 表里数据翻了一倍但没重新收集统计信息，
> 优化器还在按老数据估算代价，可能选出一个灾难性的计划。
> 这就是为什么生产环境要定期 \`ANALYZE\`。

**执行算子**：物理优化输出的是算子树，常见算子有：
- 扫描：全表扫描、索引扫描、索引范围扫描
- 连接：嵌套循环连接、排序合并连接、哈希连接
- 其他：排序、分组、去重、物化`,
    sql_demo: 'EXPLAIN QUERY PLAN SELECT s.sname, c.cname FROM student s JOIN sc ON s.sno = sc.sno JOIN course c ON c.cno = sc.cno;',
    sql_demo_dataset: 'school',
  },
  {
    id: 'k-algebra-opt', category_id: 'query', chapter_id: 'ch-qo', sort_order: 1,
    title: '代数优化：启发式规则',
    summary: '选择下推、投影下推、连接顺序 —— 不依赖统计信息的等价变换',
    difficulty: 4, importance: 3, tags: ['考点', '难点'],
    content: `代数优化的核心思想：**尽早缩小中间结果集**。
因为后续每一步的代价都和输入规模成正比。

**四条主要规则**：

**① 选择下推（Selection Pushdown）**
把 $\\sigma$ 尽量往树叶方向推，让它在最早的位置过滤掉行。

\`\`\`
σ_{条件}(R ⋈ S)  ⟹  σ_{条件}(R) ⋈ S        （条件只涉及 R 时）
\`\`\`

**② 投影下推（Projection Pushdown）**
只保留后续用得到的列，减少每行宽度。

**③ 连接交换律**
$R \\bowtie S = S \\bowtie R$ —— 所以可以重排连接顺序。

**④ 连接结合律**
$(R \\bowtie S) \\bowtie T = R \\bowtie (S \\bowtie T)$ —— 可以改变连接树形状。

**为什么"先做选择"如此重要**（用具体数字看）：

\`\`\`
student 10000 行，sc 100000 行，要查"计算机系学生的选课"

优化前：student ⋈ sc（先做笛卡尔积再筛）
       中间结果 ≈ 10000 × 100000 的匹配 → 假设 10 万行
优化后：σ_{sdept='计算机系'}(student) ⋈ sc
       中间结果 ≈ 2000 × 100000 → 假设 2 万行
\`\`\`

**中间结果小了 5 倍，后续每一步都快 5 倍。**

**连接的顺序为什么关键**：
$A \\bowtie B \\bowtie C$ 有两种执行顺序。
如果 $A \\bowtie B$ 产生 100 万行，而 $A \\bowtie C$ 只产生 100 行，
那先做后者再和 B 连接会快得多。

> **代数优化不看数据量，所以它给出的顺序不一定是最好**。
> 真正的连接顺序由物理优化根据统计信息决定 ——
> 但代数优化先把那些"显然更差"的形状消掉了，
> 给物理优化留出更小的搜索空间。`,
  },
  {
    id: 'k-plan', category_id: 'query', chapter_id: 'ch-qo', sort_order: 2,
    title: '读懂执行计划',
    summary: 'EXPLAIN 输出怎么看，全表扫描何时是合理的',
    difficulty: 3, importance: 3, tags: ['实践', '重点'],
    content: `**\`EXPLAIN QUERY PLAN\`（SQLite）或 \`EXPLAIN\`（MySQL/PG）**
会告诉你优化器打算怎么执行这条查询。

\`\`\`sql
EXPLAIN QUERY PLAN
SELECT e.ename, d.dname FROM emp e JOIN dept d ON e.deptno = d.deptno;
\`\`\`

**SQLite 的输出关键词**：

| 输出 | 含义 |
|---|---|
| \`SCAN 表名\` | 全表扫描 |
| \`SEARCH 表名 USING INDEX 索引名\` | 走索引查找 |
| \`SEARCH 表名 USING INTEGER PRIMARY KEY\` | 走主键 |
| \`USE TEMP B-TREE FOR ORDER BY\` | 排序没法用索引，要临时建树 |
| \`CO-ROUTINE\` | 子查询被物化 |

**看执行计划的三个要点**：

**① 大表上的 \`SCAN\` 是危险信号，但不是绝对的错**

全表扫描在下面这些情况是**正确的选择**：
- 表本身很小（几页，一次 I/O 就读完）
- 查询要返回大部分行（走索引反而更慢 —— 索引扫完还要回表）
- 没有可用的索引

**② 连接顺序**：执行计划里表的出现顺序就是嵌套顺序。
第一张表通常是"驱动表"，**应该是最小的那个**。

**③ 临时 B 树**：出现 \`USE TEMP B-TREE\` 说明有排序/分组没能利用索引。
如果这个查询在高频路径上，值得考虑加索引。

**代价估算的三要素**（物理优化的输入）：
1. **选择率**：条件能筛掉多少行。\`WHERE deptno = 10\` 如果
   只有 5 个部门，选择率约 1/5
2. **行数统计**：表有多少行、索引有多少不同值
3. **I/O 代价模型**：顺序读一页 vs 随机读一页的代价比

> **统计信息不准，执行计划就会错**。
> 一个典型现象：表从 1000 行涨到 100 万行，但没重新 ANALYZE，
> 优化器还以为是小表，选了嵌套循环连接 —— 结果跑几个小时。
> 这类问题排查的第一步永远是：**看统计信息多久没更新了**。`,
    sql_demo: 'EXPLAIN QUERY PLAN SELECT * FROM sc WHERE sno = \'2021001\';',
    sql_demo_dataset: 'school',
  },

  /* ==================== 事务与并发 ==================== */
  {
    id: 'k-acid', category_id: 'txn', chapter_id: 'ch-txn-basic', sort_order: 1,
    title: '事务与 ACID',
    summary: '四个特性的含义，以及各自靠什么机制实现',
    difficulty: 2, importance: 3, tags: ['考点', '重点'],
    content: `**事务**是一组要么全做、要么全不做的操作序列。

\`\`\`sql
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 'A';
UPDATE account SET balance = balance + 100 WHERE id = 'B';
COMMIT;
\`\`\`

**ACID 四个特性，以及各自靠什么实现**：

| 特性 | 含义 | 实现机制 |
|---|---|---|
| **A** 原子性 | 要么全做要么全不做 | **Undo 日志**（回滚未完成的操作） |
| **C** 一致性 | 事务前后数据库都满足约束 | 由 A、I、D 共同保证 + 应用逻辑 |
| **I** 隔离性 | 并发事务互不干扰 | **锁 / MVCC**（并发控制） |
| **D** 持久性 | 提交后即使断电也不丢 | **Redo 日志**（先写日志再写数据） |

> **一致性（C）是唯一不能靠单一机制保证的**。
> 数据库能保证"转账前后总额不变"吗？不能 ——
> 如果应用逻辑写成"只扣不加"，数据库拦不住。
> 数据库能保证的是：不会出现"扣了但没加"这种**中间状态被看到**。
> 所以 C 是 A、I、D 加上**正确的应用逻辑**共同的结果。

**事务的五个状态**：
\`\`\`
         ┌── 读/写 ──→ 活动态 ──→ 部分提交态 ──→ 提交态
开始 ────┤                │
         └── 出错 ──→ 失败态 ──→ 中止态（已回滚）
\`\`\`

**"部分提交"这个状态为什么存在**：
事务的最后一条语句执行完了，但**日志可能还没刷到磁盘**。
此时断电，重启后要能根据日志判断"这个事务该提交还是该回滚"。
这就是 WAL（Write-Ahead Logging）要解决的问题。`,
  },
  {
    id: 'k-isolation', category_id: 'txn', chapter_id: 'ch-txn-basic', sort_order: 2,
    title: '隔离级别与并发异常',
    summary: '四种隔离级别分别能防住哪些异常',
    difficulty: 4, importance: 3, tags: ['考点', '重点'],
    content: `**四种并发异常**：

| 异常 | 现象 |
|---|---|
| **丢失修改** | 两个事务读同一数据并修改，后写的覆盖先写的 |
| **脏读** | 读到另一个事务**未提交**的修改 |
| **不可重复读** | 同一事务内两次读同一行，结果不同（别人改了并提交） |
| **幻读** | 同一事务内两次查同一范围，行数变了（别人插入/删除了） |

**四种隔离级别**（从低到高）：

| 级别 | 丢失修改 | 脏读 | 不可重复读 | 幻读 |
|---|---|---|---|---|
| READ UNCOMMITTED | ✗ | ✗ | ✗ | ✗ |
| READ COMMITTED | ✓ | ✓ | ✗ | ✗ |
| REPEATABLE READ | ✓ | ✓ | ✓ | ✗ |
| SERIALIZABLE | ✓ | ✓ | ✓ | ✓ |

（✓ = 能防止，✗ = 防不住）

> **⚠️ 表格里"丢失修改"这一列按教材口径写，但有个必须知道的边界。**
>
> 教材的推理链是：一级封锁协议（写前加 X 锁、保持到事务结束）
> 能防丢失修改 → 读已提交至少有一级的强度 → 所以能防。
> 这条链在"两个事务各自 \`UPDATE\` 同一行"时是对的 ——
> 第二个写会被第一个的 X 锁挡住，直到它提交。
>
> 但**如果应用是"先读、在代码里算、再写回"**（读-改-写），
> 读已提交就防不住了：
>
>       T1: SELECT balance → 100     T2: SELECT balance → 100
>       T1: 代码算 100-10=90         T2: 代码算 100-20=80
>       T1: UPDATE balance = 90  ✓
>                                    T2: UPDATE balance = 80  ✓  ← T1 的修改丢了
>
> 两次读都在各自事务里拿到了旧值 100，写的时候 X 锁只保证"不并发写"，
> 保证不了"写的是最新值"。**这正是 \`SELECT ... FOR UPDATE\` 存在的理由** ——
> 它把读锁保持到事务结束，让第二个事务读到的是新值。
>
> 所以：考试按表格答；写代码时记住"读-改-写要显式加锁"。

**各级别的实现思路**：
- **READ UNCOMMITTED**：不加读锁，直接读 —— 所以能读到未提交数据
- **READ COMMITTED**：读时加**短锁**，读完立即释放
- **REPEATABLE READ**：读时加锁**保持到事务结束**（所以别人改不了）
- **SERIALIZABLE**：范围也加锁，防止别人插入新行

> **MySQL InnoDB 的默认级别是 REPEATABLE READ，
> 但它用 MVCC 而不是锁实现了"可重复读"** ——
> 而且通过间隙锁（Gap Lock）连幻读也基本防住了。
> 所以"默认 RR"在 MySQL 里比标准更严格。

**一个实践上的提醒**：
隔离级别越高，并发度越低。**大部分应用用 READ COMMITTED 就够了** ——
它防住了脏读（最危险的那个），性能也比 RR/SERIALIZABLE 好。
真正需要 RR 的场景通常是"同一事务里要多次读同一数据做判断"。`,
  },
  {
    id: 'k-lock', category_id: 'txn', chapter_id: 'ch-lock', sort_order: 1,
    title: '封锁与三级封锁协议',
    summary: '共享锁 / 排他锁，以及三个级别的协议各自防住什么',
    difficulty: 4, importance: 3, tags: ['考点', '难点'],
    content: `**两种基本锁**：

| 锁 | 别名 | 允许的操作 | 兼容性 |
|---|---|---|---|
| **共享锁（S 锁）** | 读锁 | 读 | S 与 S 兼容，S 与 X 不兼容 |
| **排他锁（X 锁）** | 写锁 | 读 + 写 | X 与任何锁都不兼容 |

**相容矩阵**：

|  | 已加 S | 已加 X |
|---|---|---|
| **请求 S** | ✓ | ✗ |
| **请求 X** | ✗ | ✗ |

**三级封锁协议**（逐级加强）：

**一级封锁协议**：写之前加 X 锁，**事务结束才释放**
→ 防住**丢失修改**。但读操作不加锁，所以仍会脏读。

**二级封锁协议**：在一级基础上，**读之前加 S 锁，读完立即释放**
→ 再防住**脏读**。因为别人写的时候持有 X 锁，你拿不到 S 锁。
但读完就释放了，所以别人还能改 → 不可重复读仍存在。

**三级封锁协议**：在一级基础上，**读之前加 S 锁，保持到事务结束**
→ 再防住**不可重复读**。因为整个事务期间你都持着 S 锁，
别人拿不到 X 锁，改不了。

**三级协议都防不住幻读** —— 因为它们是**按行加锁**的，
而你查的是"某个范围"，别人可以插入一条新行（那行没有锁）。

**两段锁协议（2PL）**：
- **增长阶段**：只能加锁，不能解锁
- **收缩阶段**：只能解锁，不能加锁

> **2PL 是"可串行化"的充分条件**（不是必要条件）——
> 遵守 2PL 的调度一定是冲突可串行化的。
>
> **但 2PL 不能防死锁** —— 两个事务互相等对方释放锁就会死锁。
> 这正是为什么需要死锁检测或预防机制。`,
  },
  {
    id: 'k-serializable', category_id: 'txn', chapter_id: 'ch-serial', sort_order: 1,
    title: '可串行化调度与优先图',
    summary: '冲突操作、优先图、以及怎么判断一个调度是否可串行化',
    difficulty: 5, importance: 3, tags: ['难点', '考点'],
    content: `**可串行化**：一个并发调度的执行结果，等价于**某个串行调度**的结果。

注意"某个"—— 不要求等价于某个**特定**的串行顺序，只要存在一个即可。

**冲突操作**：两个操作满足以下三条才叫冲突：
1. 来自不同的事务
2. 操作同一个数据项
3. **至少有一个是写操作**

所以：
- 读-读**不冲突**（可以任意交换顺序）
- 读-写、写-读、写-写**冲突**

**优先图（前趋图）判定法**：

1. 为每个事务画一个节点
2. 若存在冲突操作 $T_i$ 先于 $T_j$，画一条有向边 $T_i \\to T_j$
3. **图中无环 ⟺ 冲突可串行化**

有环说明调度不可串行化。

**举个具体例子**：

调度 $S$：$r_1(A)\\; w_2(A)\\; r_2(B)\\; w_1(B)$

- $r_1(A)$ 与 $w_2(A)$ 冲突，且 $r_1$ 在前 → 边 $T_1 \\to T_2$
- $r_2(B)$ 与 $w_1(B)$ 冲突，且 $r_2$ 在前 → 边 $T_2 \\to T_1$

两条边形成环 $T_1 \\to T_2 \\to T_1$，所以**不可串行化**。

**冲突可串行化 vs 视图可串行化**：
- **冲突可串行化**：通过交换相邻的**非冲突**操作能否变成串行 —— 判定简单（优先图），是充分条件
- **视图可串行化**：结果等价（读到的值相同、最终写相同）—— 判定是 **NP 完全**的

实践上只用冲突可串行化，因为它有多项式时间的判定算法。
视图可串行化在理论上有意义（冲突可串行化 ⊂ 视图可串行化），但没法实用。

> **2PL ⟹ 冲突可串行化，反之不成立**。
> 存在冲突可串行化但不遵守 2PL 的调度。`,
  },
  {
    id: 'k-deadlock', category_id: 'txn', chapter_id: 'ch-deadlock', sort_order: 1,
    title: '死锁的检测与预防',
    summary: '死锁的四个必要条件、等待图检测、以及预防策略',
    difficulty: 4, importance: 3, tags: ['考点'],
    content: `**死锁**：两个或多个事务互相等待对方持有的锁，谁也无法推进。

\`\`\`
T1: LOCK(A) → 请求 B  ←──────┐
T2: LOCK(B) → 请求 A  ←──┐   │
         ↑                │   │
         └────────────────┴───┘  互相等待
\`\`\`

**死锁的四个必要条件**（缺一不可）：
1. **互斥**：资源同一时刻只能被一个事务持有
2. **持有并等待**：持有资源的同时还在请求新资源
3. **不可剥夺**：不能强行夺走别人持有的资源
4. **循环等待**：存在一个事务的环形等待链

**检测方法：等待图（Wait-for Graph）**
- 节点是事务，边 $T_i \\to T_j$ 表示 $T_i$ 在等 $T_j$ 释放锁
- **图中有环 ⟺ 有死锁**
- 检测到环后，**选一个牺牲者回滚**（通常选代价最小的：改动最少、
  已运行时间最短的那个）

**预防策略**（破坏四个必要条件之一）：

| 策略 | 破坏哪个条件 | 代价 |
|---|---|---|
| **一次封锁法** | 持有并等待 | 并发度极低，且要预知所有需要的锁 |
| **顺序封锁法** | 循环等待 | 要预先规定所有资源的加锁顺序 |
| **超时法** | — | 简单但可能误判（长事务被当成死锁） |
| **事务时间戳法** | 循环等待 | 见下 |

**时间戳法（预防死锁的经典方案）**：
给每个事务一个时间戳，**老事务优先**。

- **Wait-Die（等待-死亡）**：老事务请求新事务持有的锁 → **等待**；
  新事务请求老事务持有的锁 → **回滚（死亡）**，稍后用原时间戳重来
- **Wound-Wait（伤害-等待）**：老事务请求新事务持有的锁 → **抢占**（新事务回滚）；
  新事务请求老事务持有的锁 → **等待**

> 两者的共同点：**方向永远是"老的赢"**，所以不可能形成环。
> 区别在于谁回滚 —— Wait-Die 回滚请求者，Wound-Wait 回滚持有者。
> Wound-Wait 通常回滚次数更少，因为老事务（通常更重要）不会被回滚。

**实践中**：多数数据库用**检测 + 回滚牺牲者**，而不是预防。
因为预防策略要么牺牲并发度（一次封锁法），要么增加无谓的回滚（时间戳法）。`,
  },

  /* ==================== 恢复与安全 ==================== */
  {
    id: 'k-wal', category_id: 'recovery', chapter_id: 'ch-log', sort_order: 1,
    title: '日志与 WAL 原则',
    summary: '为什么"先写日志再写数据"，Undo/Redo 各自解决什么',
    difficulty: 4, importance: 3, tags: ['考点', '重点'],
    content: `**日志**是恢复的基础。每条日志记录一个操作：
\`\`\`
<T1, A, 1000, 900>   -- 事务 T1 把 A 从 1000 改成 900
<T1, COMMIT>
\`\`\`
格式是 \`<事务号, 数据项, 旧值, 新值>\`。

**★ WAL 原则（Write-Ahead Logging）：日志必须先于数据写盘。**

为什么：如果数据先写盘、日志还没写，此时断电，
**这次修改既没日志记录、又已经生效** —— 恢复时无从判断该不该撤销它。
反过来先写日志：即使数据没写盘，也能靠 Redo 重做。

**两条配套的强制规则**：
1. **Undo 规则**：数据页写盘前，**它的旧值对应的日志必须先落盘**（保证能撤销）
2. **Redo 规则**：事务提交前，**它的所有日志必须先落盘**（保证能重做）

> 第 2 条是"提交"这个动作真正做的事：
> \`COMMIT\` 并不等数据写盘，它等的是**日志写盘**。
> 这就是为什么数据库的提交能很快，同时又能保证持久性。

**Undo 和 Redo 分别解决什么**：

| 机制 | 处理的情况 | 做法 |
|---|---|---|
| **Undo** | 未提交事务的影响 | 反向扫描日志，把新值改回旧值 |
| **Redo** | 已提交但可能没写盘的事务 | 正向扫描日志，把新值再写一遍 |

**检查点（Checkpoint）**：定期把缓冲池的脏页刷盘并记一条检查点日志。
恢复时**只需从最近的检查点开始扫描**，不用从头扫全部日志。

没有检查点的话，恢复时间会随日志增长无限增长 ——
一个跑了一年的系统重启要几小时。

**ARIES 恢复算法**（现代数据库的标准）三个阶段：
1. **分析阶段**：从最后一个检查点开始扫，确定崩溃时的活跃事务和脏页
2. **重做阶段**：从检查点开始重做**所有**操作（包括未提交事务的）——
   这样能恢复崩溃前的完整状态
3. **撤销阶段**：把未提交事务的操作全部撤销

> ARIES 的巧妙之处：**先全部重做再撤销未提交的**，
> 而不是只重做已提交的。这样避免了"哪些该重做"的复杂判断 ——
> 反正最后要撤销，不如先统一恢复到一个确定状态。`,
  },
  {
    id: 'k-failure', category_id: 'recovery', chapter_id: 'ch-backup', sort_order: 1,
    title: '故障类型与备份策略',
    summary: '事务故障、系统故障、介质故障，以及各自的恢复手段',
    difficulty: 3, importance: 3, tags: ['考点'],
    content: `**三类故障，恢复手段完全不同**：

| 故障类型 | 例子 | 影响范围 | 恢复手段 |
|---|---|---|---|
| **事务故障** | 除零、约束冲突 | 单个事务 | **Undo**（回滚该事务） |
| **系统故障** | 断电、进程崩溃 | 内存全丢，磁盘完好 | **Redo + Undo** |
| **介质故障** | 磁盘损坏 | 数据文件丢了 | **备份 + Redo** |

**关键区别**：前两类**磁盘上的数据还在**，靠日志就能恢复；
介质故障磁盘本身坏了，**必须靠备份** —— 日志也在那块盘上的话，一起没了。

**备份的两类**：

| 类型 | 做法 | 特点 |
|---|---|---|
| **全量备份** | 复制全部数据 | 简单、恢复快、占空间大、耗时长 |
| **增量备份** | 只备份上次备份后的变化 | 省空间、备份快、**恢复要重放所有增量** |
| **差异备份** | 备份上次**全量**后的变化 | 折中方案 |

**备份策略的三个实际考量**：

1. **备份要异机存放**。备份和数据库放在同一块盘上，
   等于没有备份 —— 一次介质故障两样一起丢。
2. **必须定期做恢复演练**。没验证过的备份等于没有备份。
   常见的事故是：备份文件是坏的、或者恢复步骤少了一步，
   到真出事时才发现。
3. **WAL 模式下不要直接 \`cp\` 数据库文件**。
   此时数据库由 \`.db\` + \`.db-wal\` + \`.db-shm\` 三个文件共同构成，
   只复制主文件会得到一份**不一致**的副本。
   正确做法是用数据库自带的备份命令，或者先做检查点再复制。

**故障恢复的 RTO 与 RPO**：
- **RTO**（恢复时间目标）：多久能恢复服务
- **RPO**（恢复点目标）：能容忍丢多少数据

> 这两个指标决定备份频率和架构选型。
> RPO 要求"一秒都不能丢"，就只能做主从同步复制 ——
> 而同步复制会让写延迟变高。**没有免费的高可用**。`,
  },
  {
    id: 'k-security', category_id: 'recovery', chapter_id: 'ch-security', sort_order: 1,
    title: '权限控制与安全',
    summary: '自主存取控制、角色、视图隔离、审计',
    difficulty: 2, importance: 2, tags: ['实践'],
    content: `**自主存取控制（DAC）**：用 \`GRANT\` / \`REVOKE\` 授权。

\`\`\`sql
GRANT SELECT, INSERT ON sc TO student_role;
GRANT ALL PRIVILEGES ON student TO teacher_role;
REVOKE DELETE ON sc FROM student_role;
\`\`\`

**权限的粒度**：
- 表级：\`GRANT SELECT ON 表\`
- 列级：\`GRANT UPDATE(grade) ON sc\` —— 只允许改成绩列
- 行级：靠**视图**实现（\`WHERE deptno = 本部门\`）

**角色**：一组权限的命名集合，是权限管理的核心手段。

\`\`\`sql
CREATE ROLE teacher_role;
GRANT SELECT, INSERT, UPDATE ON student TO teacher_role;
GRANT teacher_role TO zhangsan;
\`\`\`

> **为什么必须用角色而不是直接给用户授权**：
> 一所学校 3000 个学生，如果逐人授权，
> "给所有学生加一个查成绩的权限"就是 3000 条 GRANT，
> 而且半年后你根本说不清"学生到底有哪些权限"。
> 用角色，权限清单只有一份。

**视图机制做行级隔离**：
\`\`\`sql
CREATE VIEW v_my_students AS
SELECT * FROM student WHERE dept = current_dept();
-- 只把这个视图授权给老师，他看不到别的系的学生
\`\`\`

**审计（Audit）**：记录"谁在什么时候对什么做了什么"。

审计表本身要**独立于业务表**，而且要注意两条：
1. **审计日志要防篡改**（至少应用层不允许删除）
2. **审计里不能记敏感信息**。比如"重置密码"这个操作，
   审计应该记"管理员 X 重置了用户 Y 的密码"，
   **不能记新密码本身** —— 审计日志会被导出、会被截图，
   记进去等于把密码留在一个比密码本身更不安全的地方。

**SQL 注入**：最经典的数据库安全问题。防御方法只有一个：
**用参数化查询，永远不要拼接 SQL 字符串**。

\`\`\`js
// ✗ 拼接：输入 ' OR '1'='1 就能绕过
db.query(\`SELECT * FROM users WHERE name = '\${name}'\`);
// ✓ 参数化：输入被当作值，不是 SQL 片段
db.prepare('SELECT * FROM users WHERE name = ?').get(name);
\`\`\``,
  },
  {
    id: 'k-mysql-engine', category_id: 'sql', chapter_id: 'ch-sql-ddl', sort_order: 10,
    title: 'MySQL 存储引擎（InnoDB vs MyISAM）',
    summary: 'InnoDB 与 MyISAM 的核心差异：事务、锁粒度、外键、聚簇索引、崩溃恢复',
    difficulty: 2, importance: 3, tags: ['MySQL', '存储引擎'],
    content: `MySQL 是插件式存储引擎架构：表的数据怎么存、怎么索引、支不支持事务，全由存储引擎决定。
默认引擎 InnoDB 支持事务、行级锁、外键、崩溃恢复、聚簇索引；老引擎 MyISAM 读快，但不支持事务和外键、只有表级锁。

选错引擎是很多性能与一致性问题的根因：
- 在线交易、需要外键/回滚的表一律用 InnoDB
- 只读或读多写少的报表可以容忍 MyISAM，但新项目几乎都该用 InnoDB
- 聚簇索引让 InnoDB 按主键查极快，但自增主键比随机 UUID 更适合做主键`,
  },
  {
    id: 'k-mysql-type', category_id: 'sql', chapter_id: 'ch-sql-ddl', sort_order: 11,
    title: 'MySQL 数据类型选型',
    summary: 'INT/VARCHAR/DECIMAL/DATETIME/ENUM 等类型的选型与常见坑',
    difficulty: 2, importance: 3, tags: ['MySQL', '数据类型'],
    content: `字段类型选错，轻则浪费空间、重则算错数据。

- 整数用 INT / BIGINT，主键和可能暴涨的计数宁大勿小（钱和主键别用 INT 赌上限）
- 定长编码（身份证、MD5）用 CHAR，变长文本用 VARCHAR
- 金额必须用 DECIMAL，绝不用 FLOAT / DOUBLE（二进制浮点不精确）
- 时间用 DATETIME（不带时区）或 TIMESTAMP（带时区、范围窄到 2038）
- emoji 与生僻字需要 utf8mb4 字符集，旧的 utf8 只支持 3 字节装不下`,
  },
  {
    id: 'k-mysql-func', category_id: 'sql', chapter_id: 'ch-sql-basic', sort_order: 5,
    title: 'MySQL 常用函数与方言',
    summary: 'GROUP_CONCAT、LIMIT、CASE WHEN、IFNULL/COALESCE 等常用函数与方言',
    difficulty: 2, importance: 2, tags: ['MySQL', '函数'],
    content: `MySQL 的函数分两类：标量函数（每行独立算，如 CONCAT、NOW、CASE WHEN）和聚合函数（一组行算一个值，如 COUNT、GROUP_CONCAT）。

- GROUP_CONCAT 把分组内的值拼成逗号分隔的字符串
- IFNULL(a, b) 二选一，COALESCE(a, b, c, ...) 取第一个非 NULL
- LIMIT 做分页，深分页用延迟关联优化
- 坑：CONCAT 遇 NULL 整体变 NULL；COUNT(*) 统计含 NULL 的行，COUNT(列) 排除 NULL`,
  },
  {
    id: 'k-mysql-tune', category_id: 'query', chapter_id: 'ch-qo', sort_order: 3,
    title: 'MySQL 实战优化',
    summary: 'utf8mb4、EXPLAIN、索引最佳实践、最左前缀、深分页优化',
    difficulty: 3, importance: 3, tags: ['MySQL', '优化'],
    content: `MySQL 实战优化是「以写入换读取」的权衡艺术。

- 新建库表一律用 utf8mb4 字符集
- 用 EXPLAIN 看执行计划：key 看是否用索引、type 看访问方式、rows 看估算扫描量
- 索引建在高频查询列、优先高选择性列、遵循最左前缀原则
- 避免对列套函数、隐式类型转换、前导通配符导致索引失效
- 深分页（LIMIT 100000, 20）用延迟关联：先取 id 再回表
- SELECT * 不利于覆盖索引，明确列出需要的列`,
  },
];

export default { CATEGORIES, CHAPTERS, KNOWLEDGE };
