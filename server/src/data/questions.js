/* 客观题库
 *
 * 五种题型，判分口径见 lib/judge.js：
 *   choice 单选   答案 'A'
 *   multi  多选   答案 'ACD'（顺序无关，去重排序后比对；选错任何一项得 0，漏选得 50）
 *   judge  判断   答案 'T' / 'F'（判题器认 对/错/√/×/正确/错误）
 *   blank  填空   答案 '1/2'（数值容差），多空用 | 分隔
 *   short  简答   不自动判分，交教师批改
 *
 * ── 出题原则 ────────────────────────────────────────────────────
 * 干扰项要**来自真实的错误理解**，不能是随手编的。
 * 每道题的 analysis 都要说明"为什么错的那个看起来对"——
 * 否则学生看完解析只知道答案，下次换个形式还会错。
 */

export const QUESTIONS = [
  /* ==================== 基础理论 ==================== */
  {
    id: 'Q001', kid: 'k-dbms', type: 'choice', difficulty: 1,
    stem: '关于「数据库」和「数据库管理系统（DBMS）」，下列说法正确的是：',
    options: [
      { key: 'A', text: '数据库就是 DBMS，两者是同一个东西的两种叫法' },
      { key: 'B', text: '数据库是数据的集合，DBMS 是管理这些数据的软件' },
      { key: 'C', text: 'DBMS 是数据的集合，数据库是管理软件' },
      { key: 'D', text: '两者都不是软件，而是标准规范' },
    ],
    answer: 'B',
    analysis: '日常口语里人们把两者混着说（"装个数据库"其实指装 DBMS），但概念上必须分清：数据库是数据的集合（一个 .db 文件、一个 schema），DBMS 是管理它的软件（MySQL、PostgreSQL）。选项 C 把两者对调了，是最常见的混淆方式。',
  },
  {
    id: 'Q002', kid: 'k-dbms', type: 'multi', difficulty: 2,
    stem: '以下哪些是 DBMS 相对「直接用文件存数据」提供的关键能力？（多选）',
    options: [
      { key: 'A', text: '数据独立性：逻辑结构变了应用不用改' },
      { key: 'B', text: '并发控制：多人同时改数据不会互相破坏' },
      { key: 'C', text: '自动写业务代码' },
      { key: 'D', text: '故障恢复：崩溃后数据仍一致' },
    ],
    answer: 'ABD',
    analysis: 'DBMS 提供数据独立性、并发控制、完整性约束、故障恢复、安全授权五项能力。C 明显不属于（DBMS 不生成业务逻辑），列在这里是为了测试你是否在凭"看起来相关"选项。',
  },
  {
    id: 'Q003', kid: 'k-3level', type: 'choice', difficulty: 2,
    stem: '数据库的三级模式结构中，直接面向最终用户和应用程序的是：',
    options: [
      { key: 'A', text: '外模式（用户模式 / 子模式）' },
      { key: 'B', text: '模式（逻辑模式）' },
      { key: 'C', text: '内模式（存储模式）' },
      { key: 'D', text: '物理模式' },
    ],
    answer: 'A',
    analysis: '外模式描述的是"每个用户能看到的那部分数据"，直接面向用户。模式是全体数据的逻辑结构（面向设计者），内模式是数据在磁盘上怎么放（面向系统）。',
  },
  {
    id: 'Q004', kid: 'k-3level', type: 'judge', difficulty: 2,
    stem: '「外模式/模式映像」保证了数据的物理独立性。',
    answer: 'F',
    analysis: '反了。外模式/模式映像保证的是**逻辑独立性**（模式变了应用不用改）；模式/内模式映像保证的才是**物理独立性**（存储结构变了逻辑模式不用改）。这两个映像的作用对调是高频错误。',
  },
  {
    id: 'Q005', kid: 'k-datamodel', type: 'choice', difficulty: 2,
    stem: 'E-R 模型属于数据模型三个层次中的哪一层？',
    options: [
      { key: 'A', text: '概念模型（信息模型）' },
      { key: 'B', text: '逻辑模型' },
      { key: 'C', text: '物理模型' },
      { key: 'D', text: '不属于任何一层，它是独立的第四层' },
    ],
    answer: 'A',
    analysis: 'E-R 模型是概念模型，特点是**面向用户、不依赖任何 DBMS**。这正是它的价值：和业务方沟通时不需要对方懂 SQL。关系模型才是逻辑模型，B+ 树、页结构是物理模型。',
  },
  {
    id: 'Q006', kid: 'k-rel-concept', type: 'choice', difficulty: 2,
    stem: '在关系模型中，一个「关系」对应通俗说法中的：',
    options: [
      { key: 'A', text: '一行记录' },
      { key: 'B', text: '一张二维表' },
      { key: 'C', text: '一个字段' },
      { key: 'D', text: '一个数据库文件' },
    ],
    answer: 'B',
    analysis: '关系 = 表；元组 = 行；属性 = 列；分量 = 单元格。这四个术语的对应关系是入门必背的，考试和文档里都会直接用学术术语。',
  },
  {
    id: 'Q007', kid: 'k-rel-concept', type: 'judge', difficulty: 3,
    stem: '关系模型中，元组之间的顺序是有意义的，查询结果会按插入顺序返回。',
    answer: 'F',
    analysis: '关系是**集合**，集合里的元素无序。所以 `SELECT` 不加 `ORDER BY` 时结果顺序**不确定**，不同数据库、不同执行计划、同一天的不同时刻都可能不同。这不是 bug，是关系模型的定义决定的。要确定顺序必须显式 `ORDER BY`。',
  },
  {
    id: 'Q008', kid: 'k-integrity', type: 'choice', difficulty: 2,
    stem: '外键约束属于哪一类完整性？',
    options: [
      { key: 'A', text: '实体完整性' },
      { key: 'B', text: '参照完整性' },
      { key: 'C', text: '用户定义完整性' },
      { key: 'D', text: '域完整性' },
    ],
    answer: 'B',
    analysis: '外码（外键）约束的是"引用关系"，所以是参照完整性。实体完整性是主码唯一且非空；用户定义完整性是业务规则（如成绩 0–100）。',
  },
  {
    id: 'Q009', kid: 'k-integrity', type: 'multi', difficulty: 3,
    stem: '删除一个被 \`sc\` 表引用的学生记录时，如果外键定义了 \`ON DELETE\` 行为，可能的结果有：（多选）',
    options: [
      { key: 'A', text: 'CASCADE —— 该学生的所有选课记录一起被删' },
      { key: 'B', text: 'SET NULL —— 选课记录的外键被置为 NULL' },
      { key: 'C', text: 'RESTRICT —— 拒绝删除，报外键约束错误' },
      { key: 'D', text: '数据库会自动备份被删的数据到回收站表' },
    ],
    answer: 'ABC',
    analysis: '三个标准级联选项是 CASCADE / SET NULL / RESTRICT（NO ACTION 与 RESTRICT 类似）。D 不是标准行为，列在这里是为了测试你是否在凭印象选。选错级联行为的代价很具体：该删的没删，或者留下指向不存在用户的孤儿记录 —— 后者更糟，因为它不报错。',
  },
  {
    id: 'Q010', kid: 'k-algebra-basic', type: 'choice', difficulty: 2,
    stem: '关系代数中，运算 $\\pi_{sname, sage}(student)$ 的含义是：',
    options: [
      { key: 'A', text: '选出 sname 和 sage 满足某个条件的行' },
      { key: 'B', text: '从 student 中取出 sname 和 sage 这两列' },
      { key: 'C', text: '把 sname 和 sage 两列连接起来' },
      { key: 'D', text: '按 sname 和 sage 排序' },
    ],
    answer: 'B',
    analysis: '$\\pi$（pi）是**投影**，选的是**列**；$\\sigma$（sigma）是**选择**，选的是**行**。两者极易记反 —— 记住"投影仪把一列打出来"这个联想。另外投影会自动去重（集合语义），SQL 里要等价必须写 `SELECT DISTINCT`。',
  },
  {
    id: 'Q011', kid: 'k-algebra-basic', type: 'blank', difficulty: 3,
    stem: '关系代数中，交运算可以用基本运算表示为：$R \\cap S = R - ($  ______  $)$（填入用 R、S 和差运算表示的部分）',
    answer: 'R-S',
    analysis: '交的导出公式是 $R \\cap S = R - (R - S)$。含义："在 R 中但不在（在 R 中但不在 S 中）的元素"，即两边都在的。填 R-S 或 (R-S) 均可。',
  },
  {
    id: 'Q012', kid: 'k-algebra-join', type: 'choice', difficulty: 3,
    stem: '自然连接 $R \\bowtie S$ 与等值连接 $R \\bowtie_{R.A=S.A} S$ 的主要区别是：',
    options: [
      { key: 'A', text: '自然连接会去掉重复的同名列，等值连接不会' },
      { key: 'B', text: '自然连接不需要连接条件，所以结果行数一定更多' },
      { key: 'C', text: '等值连接会去掉重复列，自然连接不会' },
      { key: 'D', text: '两者完全等价，只是写法不同' },
    ],
    answer: 'A',
    analysis: '自然连接 = 在同名属性上做等值连接 + **去掉重复的同名列**。所以等值连接 `SELECT *` 会看到两个 A 列，自然连接只保留一个。B 错在"结果行数更多"——行数是一样的，差别在列。',
  },
  {
    id: 'Q013', kid: 'k-algebra-join', type: 'short', difficulty: 4,
    stem: '用关系代数表达「查询选修了全部课程的学生学号」，并说明为什么必须用除运算（或等价的嵌套否定）而不能用简单的连接 + 计数。',
    answer: '表达式：$\\pi_{sno, cno}(sc) \\div \\pi_{cno}(course)$。理由：题目要求的是"对**每一门**课程都存在选课记录"，这是一个全称量词（∀）。连接 + 计数只能表达"选课数量等于课程总数"这类**依赖具体数字**的条件，一旦课程表增删课程，这个数字就要跟着改，而且它表达不出"针对每一门"的语义。除运算（及其 SQL 等价形式双重 NOT EXISTS）是关系代数中表达全称量词的唯一手段。',
    steps: [
      { t: '写出正确的除运算表达式 π_sno,cno(sc) ÷ π_cno(course)', pts: 40 },
      { t: '指出"全部"对应全称量词 ∀，这是除运算表达的语义', pts: 30 },
      { t: '说明为什么"连接 + 计数"不等价（依赖具体数字、语义不同）', pts: 30 },
    ],
  },

  /* ==================== SQL ==================== */
  {
    id: 'Q014', kid: 'k-select', type: 'choice', difficulty: 2,
    stem: '下列 SQL 子句的**执行顺序**，正确的是：',
    options: [
      { key: 'A', text: 'SELECT → FROM → WHERE → GROUP BY → ORDER BY' },
      { key: 'B', text: 'FROM → WHERE → GROUP BY → SELECT → ORDER BY' },
      { key: 'C', text: 'FROM → SELECT → WHERE → GROUP BY → ORDER BY' },
      { key: 'D', text: 'WHERE → FROM → SELECT → GROUP BY → ORDER BY' },
    ],
    answer: 'B',
    analysis: '实际执行顺序是 FROM → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT。**书写顺序和执行顺序不一样**，这是理解 SQL 的关键。由它可推出：WHERE 里不能用 SELECT 的别名（那时还没算），但 ORDER BY 里可以（它最后执行）。',
  },
  {
    id: 'Q015', kid: 'k-select', type: 'judge', difficulty: 3,
    stem: '在 WHERE 子句中可以使用 SELECT 列表中定义的列别名，例如 `SELECT sal*12 AS 年薪 FROM emp WHERE 年薪 > 100000`。',
    answer: 'F',
    analysis: '不能。WHERE 在 SELECT **之前**执行，那时"年薪"这个别名还不存在。报错信息通常是 `no such column: 年薪`。解决方式：重复写表达式，或者用派生表/CTE 包一层。**但 ORDER BY 里可以用别名**，因为它最后执行 —— 这一正一反是高频考点。',
  },
  {
    id: 'Q016', kid: 'k-where', type: 'choice', difficulty: 2,
    stem: '表达式 `WHERE sdept = \'A\' OR sdept = \'B\' AND sage > 20` 的实际含义是：',
    options: [
      { key: 'A', text: 'A 系或 B 系中年龄大于 20 的' },
      { key: 'B', text: 'A 系的全部，或 B 系中年龄大于 20 的' },
      { key: 'C', text: 'A 系中年龄大于 20 的，或 B 系中年龄大于 20 的' },
      { key: 'D', text: '语法错误，必须加括号' },
    ],
    answer: 'B',
    analysis: '`AND` 的优先级**高于** `OR`，所以实际等价于 `sdept=\'A\' OR (sdept=\'B\' AND sage>20)`。要表达选项 A 的意思必须加括号：`(sdept=\'A\' OR sdept=\'B\') AND sage>20`。这一条每年都有学生栽。',
  },
  {
    id: 'Q017', kid: 'k-where', type: 'multi', difficulty: 2,
    stem: '下列哪些写法可以正确匹配「所有姓张的学生」？（多选）',
    options: [
      { key: 'A', text: "sname LIKE '张%'" },
      { key: 'B', text: "sname LIKE '%张%'" },
      { key: 'C', text: "substr(sname, 1, 1) = '张'" },
      { key: 'D', text: "sname = '张%'" },
    ],
    answer: 'AC',
    analysis: "A 是标准写法。C 用函数也能达到同样效果（但**会导致索引失效**）。B 匹配的是「名字里含张」，会把「小张」也选进来，语义不同。D 是等值比较，只会匹配名字字面等于「张%」这个三个字符的人 —— 一个都匹配不到。",
  },
  {
    id: 'Q018', kid: 'k-orderby', type: 'judge', difficulty: 3,
    stem: '`SELECT * FROM emp ORDER BY sal DESC LIMIT 3` 在任何情况下都能稳定返回工资最高的 3 个人。',
    answer: 'F',
    analysis: '只有在工资**没有并列**时才稳定。如果第 3、4 名工资相同，谁进前 3 是**不确定**的 —— 排序键值相同的行之间顺序任意，今天跑和明天跑可能不一样。正确做法是加一个唯一列兜底：`ORDER BY sal DESC, empno ASC`。这在分页接口里会造成真实 bug：第 3 页出现第 1 页看过的数据，而另一条永远看不到。',
  },
  {
    id: 'Q019', kid: 'k-aggregate', type: 'choice', difficulty: 2,
    stem: '表 emp 有 14 行，其中 comm 列有 5 行为 NULL。`SELECT COUNT(*), COUNT(comm) FROM emp` 的结果是：',
    options: [
      { key: 'A', text: '14, 14' },
      { key: 'B', text: '14, 9' },
      { key: 'C', text: '9, 9' },
      { key: 'D', text: '14, 5' },
    ],
    answer: 'B',
    analysis: '`COUNT(*)` 数的是**行数**，包含含 NULL 的行 → 14。`COUNT(列)` 数的是该列**非 NULL** 的行数 → 14-5 = 9。这是最常考的聚合函数细节。',
  },
  {
    id: 'Q020', kid: 'k-aggregate', type: 'blank', difficulty: 3,
    stem: '对一个**没有任何行**的表执行 `SELECT AVG(x), COUNT(*), SUM(x) FROM t`，三个结果分别是 ______、______、______（填 NULL 或 0，用 | 分隔）',
    answer: 'NULL|0|NULL',
    analysis: '空集上：`COUNT` 返回 **0**，而 `SUM`/`AVG`/`MAX`/`MIN` 全部返回 **NULL**。原因是 COUNT 数的是"有多少个"，0 是准确的答案；而 AVG 要"求和再除以个数"，没有数可平均，答案是"未知"而不是 0。前端拿到 NULL 应显示"—"而不是"0 分"。',
  },
  {
    id: 'Q021', kid: 'k-groupby', type: 'choice', difficulty: 3,
    stem: '`SELECT sdept, sname, COUNT(*) FROM student GROUP BY sdept` 这条语句：',
    options: [
      { key: 'A', text: '在 SQLite 里能跑出结果，但语义上是无定义的，换到 PostgreSQL 会报错' },
      { key: 'B', text: '在任何数据库里都会报语法错误' },
      { key: 'C', text: '等价于 `SELECT DISTINCT sdept, sname, COUNT(*)`' },
      { key: 'D', text: '会返回每个系的第一个学生姓名，这是标准行为' },
    ],
    answer: 'A',
    analysis: '一个系有多个学生，`sname` 该取哪一个？这个查询**在语义上就是无定义的**。SQLite 和 MySQL（默认）不报错，随便取组内第一行的值；PostgreSQL 和 MySQL 的 `ONLY_FULL_GROUP_BY` 模式会报错。危险之处在于：本机跑得好好的查询换到生产环境直接挂。',
  },
  {
    id: 'Q022', kid: 'k-having', type: 'choice', difficulty: 2,
    stem: '要筛选「平均成绩大于 85 的课程」，正确的写法是：',
    options: [
      { key: 'A', text: 'WHERE AVG(grade) > 85' },
      { key: 'B', text: 'GROUP BY cno HAVING AVG(grade) > 85' },
      { key: 'C', text: 'GROUP BY cno WHERE AVG(grade) > 85' },
      { key: 'D', text: 'HAVING cno GROUP BY AVG(grade) > 85' },
    ],
    answer: 'B',
    analysis: '`WHERE` 在分组**之前**执行，那时还没有"组"，所以不能用聚合函数。筛选聚合结果必须用 `HAVING`（在分组之后执行）。C 的语法顺序也是错的 —— 子句顺序是固定的，不能调换。',
  },
  {
    id: 'Q023', kid: 'k-having', type: 'judge', difficulty: 3,
    stem: '`SELECT cno FROM sc GROUP BY cno HAVING cno = \'C01\'` 与 `SELECT cno FROM sc WHERE cno = \'C01\' GROUP BY cno` 结果相同，性能也相同。',
    answer: 'F',
    analysis: '**结果相同，性能差很多**。前者先把全部行分组，再丢掉不满足的组；后者先过滤到只剩 C01 的行，再分组。数据量大时前者可能要多做几百倍的功。实用判据：**能写 WHERE 就别写 HAVING** —— 越早缩小数据量，后续所有步骤都跟着便宜。',
  },
  {
    id: 'Q024', kid: 'k-window', type: 'choice', difficulty: 4,
    stem: '某部门工资为 20000, 18000, 18000, 15000。用 `RANK()` 和 `DENSE_RANK()` 按工资降序编号，第四个人的编号分别是：',
    options: [
      { key: 'A', text: '4 和 3' },
      { key: 'B', text: '3 和 3' },
      { key: 'C', text: '4 和 4' },
      { key: 'D', text: '3 和 4' },
    ],
    answer: 'A',
    analysis: '`RANK()` 并列后**跳号**：1, 2, 2, **4**（两个并列第 2，所以下一个是第 4）。`DENSE_RANK()` 并列后**不跳号**：1, 2, 2, **3**。另有 `ROW_NUMBER()` 强行不并列：1, 2, 3, 4。三者语义不同，选哪个取决于业务上"并列第二之后的下一个算第三还是第四"。',
  },
  {
    id: 'Q025', kid: 'k-join', type: 'judge', difficulty: 3,
    stem: '`SELECT * FROM a JOIN b` 不写 ON 子句会报语法错误。',
    answer: 'F',
    analysis: '不会报错，它会执行**笛卡尔积**。两张各 1 万行的表连起来是 **1 亿行** —— 这不是"结果多了点"，是数据库会跑到超时或者把内存吃光。这是一个静默的严重事故，比报错危险得多。本平台的 SQL 沙箱有 4 秒超时保护并会提示"多半是连接条件写漏了"。',
  },
  {
    id: 'Q026', kid: 'k-outer-join', type: 'choice', difficulty: 4,
    stem: '下列哪个查询能查出「所有学生及其选了 C01 课的成绩，没选 C01 的学生也要出现」？',
    options: [
      { key: 'A', text: "FROM student s LEFT JOIN sc ON s.sno = sc.sno WHERE sc.cno = 'C01'" },
      { key: 'B', text: "FROM student s LEFT JOIN sc ON s.sno = sc.sno AND sc.cno = 'C01'" },
      { key: 'C', text: "FROM student s JOIN sc ON s.sno = sc.sno AND sc.cno = 'C01'" },
      { key: 'D', text: "FROM student s RIGHT JOIN sc ON s.sno = sc.sno AND sc.cno = 'C01'" },
    ],
    answer: 'B',
    analysis: 'A 把条件写在 WHERE 里 —— 没选 C01 的学生那行的 cno 是 NULL，而 `NULL = \'C01\'` 是 UNKNOWN 不是 TRUE，所以被筛掉了，**LEFT JOIN 静默退化成 INNER JOIN**。C 和 D 都是内连接语义。记住规则：**ON 决定右表哪些行参与连接（补 NULL 之前），WHERE 决定最终保留哪些行（补 NULL 之后）**。',
  },
  {
    id: 'Q027', kid: 'k-outer-join', type: 'choice', difficulty: 4,
    stem: '统计每门课的选课人数（没人选的课要显示 0），`course LEFT JOIN sc` 之后，聚合函数应该用：',
    options: [
      { key: 'A', text: 'COUNT(*)' },
      { key: 'B', text: 'COUNT(sc.sno)' },
      { key: 'C', text: 'SUM(sc.sno)' },
      { key: 'D', text: 'COUNT(DISTINCT course.cno)' },
    ],
    answer: 'B',
    analysis: '`COUNT(*)` 会把"没匹配上的那一行"也算成 1，所以没人选的课会显示 1 而不是 0。`COUNT(sc.sno)` 只数非 NULL 的，正好排除掉补出来的 NULL 行。这是 LEFT JOIN + COUNT 的经典陷阱。C 对文本列求和没有意义；D 数的是课程数不是选课人数。',
  },
  {
    id: 'Q028', kid: 'k-selfjoin', type: 'judge', difficulty: 3,
    stem: '自连接时可以用同一个表别名两次，例如 `FROM emp e JOIN emp e ON ...`。',
    answer: 'F',
    analysis: '必须用**两个不同的别名**（如 `emp e JOIN emp m`），否则无法区分"作为员工的自己"和"作为经理的自己"，会报重复别名的错误。把两个别名想象成"emp 表的两份副本"就理解了。',
  },
  {
    id: 'Q029', kid: 'k-subquery', type: 'choice', difficulty: 4,
    stem: '关于相关子查询（correlated subquery），正确的说法是：',
    options: [
      { key: 'A', text: '它只求值一次，然后当常量使用' },
      { key: 'B', text: '它引用了外层的列，所以外层每一行都要重新求值' },
      { key: 'C', text: '它的执行效率一定比不相关子查询高' },
      { key: 'D', text: '它不能用 EXISTS 改写' },
    ],
    answer: 'B',
    analysis: '相关子查询的判定标准就是"内层是否引用了外层的列"。A 描述的是不相关子查询。C 反了 —— 相关子查询复杂度是 O(外层行数 × 内层代价)，通常更慢（虽然现代优化器会做"去相关化"改写）。D 也反了，`EXISTS` 恰恰是相关子查询最常用的形式。',
  },
  {
    id: 'Q030', kid: 'k-exists', type: 'choice', difficulty: 5,
    stem: '若 `sc.cno` 列中存在 NULL 值，`SELECT * FROM course WHERE cno NOT IN (SELECT cno FROM sc)` 的结果是：',
    options: [
      { key: 'A', text: '正常返回所有没被选过的课程' },
      { key: 'B', text: '返回空集，且不报错' },
      { key: 'C', text: '报语法错误' },
      { key: 'D', text: '返回 NULL 值' },
    ],
    answer: 'B',
    analysis: '这是 SQL 里最阴的坑之一。`x NOT IN (a, b, NULL)` 展开成 `x<>a AND x<>b AND x<>NULL`，而 `x <> NULL` 是 **UNKNOWN**，整个 AND 结果就是 UNKNOWN（不是 FALSE），WHERE 只保留 TRUE 的行 —— 所以一行都不剩，**而且不报错**。正确做法是用 `NOT EXISTS`，它只判断"存不存在"，不比较值。',
  },
  {
    id: 'Q031', kid: 'k-null', type: 'multi', difficulty: 3,
    stem: '下列关于 NULL 的说法，正确的有：（多选）',
    options: [
      { key: 'A', text: 'NULL = NULL 的结果是 UNKNOWN，不是 TRUE' },
      { key: 'B', text: 'NULL 等价于空字符串 \'\'' },
      { key: 'C', text: '1 + NULL 的结果是 NULL' },
      { key: 'D', text: 'WHERE 子句只保留结果为 TRUE 的行，UNKNOWN 和 FALSE 都被丢弃' },
    ],
    answer: 'ACD',
    analysis: 'NULL 的语义是"**未知**"，不是空串、不是 0。B 是常见误解 —— 空串是一个确定的值，NULL 是"不知道"。A、C 是三值逻辑和算术传播的规则；D 解释了为什么 `WHERE x = NULL` 返回 0 行。',
  },
  {
    id: 'Q032', kid: 'k-null', type: 'blank', difficulty: 3,
    stem: '要查询「奖金 comm 为空的员工」，WHERE 子句应写成：`WHERE comm ______`（填写完整的条件）',
    answer: 'IS NULL',
    analysis: '**不能写 `= NULL`**。NULL 表示"未知"，"未知 = 未知"的结果还是"未知"（UNKNOWN），不是 TRUE，所以 WHERE 会返回零行 —— 而且不报错。这是 SQL 里最隐蔽的错误之一。',
  },
  {
    id: 'Q033', kid: 'k-ddl', type: 'choice', difficulty: 2,
    stem: '关于 `PRIMARY KEY` 和 `UNIQUE` 的区别，正确的是：',
    options: [
      { key: 'A', text: 'PRIMARY KEY 允许 NULL，UNIQUE 不允许' },
      { key: 'B', text: 'PRIMARY KEY 唯一且非空、一张表只能有一个；UNIQUE 允许 NULL、可以有多个' },
      { key: 'C', text: '两者完全等价' },
      { key: 'D', text: 'UNIQUE 只能建在单列上' },
    ],
    answer: 'B',
    analysis: 'PRIMARY KEY = 唯一 + 非空，且一张表只能有一个（实体完整性）。UNIQUE = 唯一但**允许多行 NULL**（因为"未知"和"未知"不算相等），一张表可以有多个。D 错 —— UNIQUE 也可以建在复合列上。',
  },
  {
    id: 'Q034', kid: 'k-dml', type: 'multi', difficulty: 3,
    stem: '执行 `UPDATE` 或 `DELETE` 之前，推荐的做法有：（多选）',
    options: [
      { key: 'A', text: '先用同样的 WHERE 条件 SELECT 一遍，确认影响范围' },
      { key: 'B', text: '包在事务里，确认无误后再 COMMIT' },
      { key: 'C', text: '检查影响行数是否符合预期' },
      { key: 'D', text: '直接执行，反正数据库有日志可以回滚' },
    ],
    answer: 'ABC',
    analysis: 'D 是危险的想当然：日志能回滚的前提是**你发现了错误并及时回滚**。`UPDATE` 忘写 WHERE 改掉全表，等你发现时可能已经过了几小时、日志已经被覆盖、或者事务早就提交了。"先 SELECT 看一眼"这一步只花两秒，能避免的事故却是灾难级的。',
  },
  {
    id: 'Q035', kid: 'k-view', type: 'multi', difficulty: 3,
    stem: '下列哪种视图**不能**直接执行 INSERT/UPDATE/DELETE？（多选）',
    options: [
      { key: 'A', text: '定义中用了 GROUP BY / 聚合函数' },
      { key: 'B', text: '定义中用了 DISTINCT' },
      { key: 'C', text: '定义中用了 UNION' },
      { key: 'D', text: '定义中只做了 WHERE 过滤的单表查询' },
    ],
    answer: 'ABC',
    analysis: '可更新视图的前提是**每一行都能唯一对应到基表的一行**。聚合、DISTINCT、UNION 都会让"一行"失去明确的来源。D 是可以更新的 —— 单表 + WHERE 过滤是最典型的可更新视图。',
  },

  /* ==================== 数据库设计 ==================== */
  {
    id: 'Q036', kid: 'k-er', type: 'choice', difficulty: 3,
    stem: 'E-R 图中，m:n 的联系转换为关系模式时应该：',
    options: [
      { key: 'A', text: '把一端的码加到另一端作外键' },
      { key: 'B', text: '单独建立一个关系模式，主键为两端码的组合' },
      { key: 'C', text: '合并进任意一端，不需要单独建表' },
      { key: 'D', text: '用一个逗号分隔的字符串字段存另一端的所有码' },
    ],
    answer: 'B',
    analysis: 'm:n 必须单独建表（如 `sc(sno, cno, grade)`）。A 是 1:n 的转换规则。D 是初学者常见的错误做法 —— 它违反第一范式（分量不原子），而且"查询选了某课的学生"需要字符串匹配，**无法建索引**。联系上的属性（成绩）跟着联系走，它既不属于学生也不属于课程。',
  },
  {
    id: 'Q037', kid: 'k-fd', type: 'choice', difficulty: 4,
    stem: '设 F = {A→B, B→C}，属性集 U = {A,B,C,D}。则 A⁺（A 的属性闭包）是：',
    options: [
      { key: 'A', text: '{A, B}' },
      { key: 'B', text: '{A, B, C}' },
      { key: 'C', text: '{A, B, C, D}' },
      { key: 'D', text: '{A}' },
    ],
    answer: 'B',
    analysis: '必须**循环到不动点**：第一轮 A→B 使结果变成 {A,B}；但此时 B→C 的条件刚被满足，**第二轮**才能推出 C，得到 {A,B,C}。D 不在任何依赖的右部，也推不出来。选 A 的人正是犯了"只扫一遍"的错 —— 这是属性闭包最常见的错误。',
  },
  {
    id: 'Q038', kid: 'k-fd', type: 'judge', difficulty: 3,
    stem: '属性闭包 X⁺ 包含全部属性，是 X 成为超键的充分必要条件。',
    answer: 'T',
    analysis: '正确。X⁺ = U（全部属性）⟺ X 是超键。这也是判断候选键的核心步骤：先验证 X⁺ 是否等于 U，再验证极小性。另外 X⁺ 还能判断依赖是否可推导：X→Y 可由 F 推出 ⟺ Y ⊆ X⁺。',
  },
  {
    id: 'Q039', kid: 'k-key', type: 'choice', difficulty: 5,
    stem: '设 R(A,B,C,D)，F = {AB→C, C→D, D→A}。下列哪个是 R 的候选键？',
    options: [
      { key: 'A', text: 'AB' },
      { key: 'B', text: 'BC' },
      { key: 'C', text: 'CD' },
      { key: 'D', text: 'ACD' },
    ],
    answer: 'B',
    analysis: '逐个验：AB⁺ = {A,B,C,D}（AB→C，C→D）→ AB 是超键，且 A、B 单独都不是（A⁺={A}，B⁺={B}），所以 AB 是候选键。BC⁺ = {B,C,D,A} = 全集，且 B、C 单独都不是超键 → BC 也是候选键。CD⁺ = {C,D,A}，缺 B → 不是。ACD 包含 BC 但多一个 A，**不是极小的** → 是超键但不是候选键。所以正确答案 B。本题考的是"候选键必须是极小超键"。',
  },
  {
    id: 'Q040', kid: 'k-key', type: 'blank', difficulty: 4,
    stem: '求候选键时，**从不出现在任何函数依赖右部**的属性，一定 ______（填"在"或"不在"）每一个候选键中。',
    answer: '在',
    analysis: '这类属性（叫 L 类）只能由自己决定自己，所以缺了它就凑不齐全集，**必须**出现在每一个候选键里。同理，只在右部出现、不在左部出现的属性（R 类）**一定不在**任何候选键中。这两条规则能把枚举量砍掉一大半。',
  },
  {
    id: 'Q041', kid: 'k-nf', type: 'choice', difficulty: 4,
    stem: '关系 R(学号, 姓名, 课程号, 成绩) 中，候选键是 (学号, 课程号)，且存在 学号→姓名。该关系最高达到：',
    options: [
      { key: 'A', text: '1NF' },
      { key: 'B', text: '2NF' },
      { key: 'C', text: '3NF' },
      { key: 'D', text: 'BCNF' },
    ],
    answer: 'A',
    analysis: '「姓名」是非主属性，而它只依赖候选键的**一部分**（学号）—— 这是**部分依赖**，违反 2NF。所以最高只到 1NF。修正方法是把 学号→姓名 拆出去单独成表。这是 2NF 最典型的例子。',
  },
  {
    id: 'Q042', kid: 'k-nf', type: 'choice', difficulty: 5,
    stem: '关于 3NF 和 BCNF 的关系，正确的是：',
    options: [
      { key: 'A', text: '3NF 比 BCNF 严格，满足 3NF 必然满足 BCNF' },
      { key: 'B', text: 'BCNF 比 3NF 严格，满足 BCNF 必然满足 3NF' },
      { key: 'C', text: '两者互相独立，没有包含关系' },
      { key: 'D', text: '两者等价，只是叫法不同' },
    ],
    answer: 'B',
    analysis: 'BCNF ⊂ 3NF ⊂ 2NF ⊂ 1NF，**逐级严格**。3NF 的条件是"X 是超键 **或** A 是主属性"，BCNF 去掉了后面那个"或"。所以满足 BCNF 一定满足 3NF，反之不成立 —— 存在只满足 3NF 不满足 BCNF 的关系。',
  },
  {
    id: 'Q043', kid: 'k-nf', type: 'short', difficulty: 5,
    stem: '解释「部分依赖」和「传递依赖」的区别，各举一个例子，并说明它们分别违反第几范式。',
    answer: '**部分依赖**：非主属性依赖于候选键的**真子集**。例：R(学号, 课程号, 姓名, 成绩)，候选键是 (学号,课程号)，而 学号→姓名 —— 姓名只依赖键的一部分。违反 **2NF**。\n\n**传递依赖**：非主属性通过另一个非主属性间接依赖于候选键，即 A→B、B→C 且 B↛A。例：R(学号, 姓名, 系名, 系主任)，学号→系名，系名→系主任，所以 学号→系主任 是传递依赖。违反 **3NF**。\n\n区别在于：部分依赖是"键的一部分就能决定"，传递依赖是"要绕一个中间属性才能决定"。前者看键的结构，后者看属性之间的链条。',
    steps: [
      { t: '正确解释部分依赖并举例', pts: 30 },
      { t: '正确解释传递依赖并举例', pts: 30 },
      { t: '指出部分依赖违反 2NF', pts: 20 },
      { t: '指出传递依赖违反 3NF', pts: 20 },
    ],
  },
  {
    id: 'Q044', kid: 'k-decomp', type: 'judge', difficulty: 5,
    stem: '把一个关系模式分解为若干 BCNF 的子模式，一定能同时做到无损连接和保持函数依赖。',
    answer: 'F',
    analysis: '这是本节最重要的结论：**BCNF 分解保证无损连接，但可能不保持函数依赖**。存在"无法既 BCNF 又保持依赖"的关系模式。而 **3NF 分解可以同时做到无损 + 保持依赖**（用合成法）。实践中遇到冲突时通常优先保持依赖 —— 数据正确性比消除冗余更基本。',
  },
  {
    id: 'Q045', kid: 'k-decomp', type: 'choice', difficulty: 5,
    stem: '判定一个分解是否为无损连接，最通用的方法是：',
    options: [
      { key: 'A', text: '检查 R1 ∩ R2 → (R1 - R2) 是否成立' },
      { key: 'B', text: '矩阵法（chase 算法）：建表、按依赖统一取值、看是否有行全为 a' },
      { key: 'C', text: '检查分解后的表能否连接回来不报错' },
      { key: 'D', text: '比较分解前后表的行数是否相等' },
    ],
    answer: 'B',
    analysis: 'A 的那条定理**只对二分解成立**（分解成两个关系时）。三分解以上必须用矩阵法。这是最容易被误用的定理 —— 用错会给出"看起来很专业"的错误结论。C 是实际执行，不能作为判定方法（有损分解连接回来也不会报错，只是会多出虚假元组）。D 也不对：有损分解连接后行数通常**变多**（产生虚假组合），但不一定。',
  },

  /* ==================== 存储与索引 ==================== */
  {
    id: 'Q046', kid: 'k-storage', type: 'choice', difficulty: 3,
    stem: '数据库读写磁盘的最小单位是：',
    options: [
      { key: 'A', text: '一个字节' },
      { key: 'B', text: '一行记录' },
      { key: 'C', text: '一页（Page / Block），通常 4KB–16KB' },
      { key: 'D', text: '一列' },
    ],
    answer: 'C',
    analysis: '页是数据库 I/O 的基本单位，也是加锁、日志、缓存的统一单位。为什么不是按行读：磁盘控制器按扇区读写，按行读会读入大量无用数据；而且一次寻道的时间足够读很多页，**按页读能把随机 I/O 变成顺序 I/O**。',
  },
  {
    id: 'Q047', kid: 'k-storage', type: 'judge', difficulty: 4,
    stem: '数据库的缓冲池替换算法通常直接使用 LRU。',
    answer: 'F',
    analysis: '不用朴素 LRU，主要因为**顺序扫描污染**：一次全表扫描会把整个缓冲池冲掉，而那些被换出去的页**再也不会被访问**（因为大表只扫一次）。另外脏页不能随便淘汰（要先刷盘）。实际用的是 LRU-K（看第 K 次访问时间）或时钟算法 + 分区。',
  },
  {
    id: 'Q048', kid: 'k-bplus', type: 'choice', difficulty: 4,
    stem: 'B+ 树索引相对 B 树索引的核心优势是：',
    options: [
      { key: 'A', text: 'B+ 树更矮，所以查找更快' },
      { key: 'B', text: 'B+ 树所有数据都在叶子节点且叶子串成链表，范围查询只需顺序扫描' },
      { key: 'C', text: 'B+ 树不需要分裂节点' },
      { key: 'D', text: 'B+ 树不需要维护平衡' },
    ],
    answer: 'B',
    analysis: 'B+ 树把数据全部放到叶子层、非叶节点只存索引键，带来两个好处：① 非叶节点能放更多键 → 树更矮；② **叶子节点用指针串成链表** → 范围查询扫到起点后顺序读即可。B 树的数据分散在所有节点，做范围查询要中序遍历，随机 I/O 多。C 和 D 都是错的 —— B+ 树插入时同样会分裂，也一直维护平衡。',
  },
  {
    id: 'Q049', kid: 'k-bplus', type: 'blank', difficulty: 5,
    stem: '设块大小 4KB，B+ 树节点中每个「键 + 指针」占 16 字节，则一个节点能放 ______ 个指针。这样的三层 B+ 树最多能索引约 ______ 万条记录（填整数，取三位有效数字以内）。',
    answer: '256|1677',
    analysis: '4096 ÷ 16 = **256** 个键/指针。三层结构：第 1 层 1 个节点（256 个指针），第 2 层 256 个节点（256² = 65536），第 3 层是叶子，共 256³ = **16,777,216 ≈ 1677 万**条记录。这就是为什么 B+ 树只需 3 层就能索引千万级数据 —— 一次查找最多 3 次磁盘 I/O，若根节点常驻缓冲池则只需 2 次。',
  },
  {
    id: 'Q050', kid: 'k-index-use', type: 'multi', difficulty: 4,
    stem: '下列哪些写法会导致索引失效？（多选）',
    options: [
      { key: 'A', text: "WHERE YEAR(hiredate) = 2022" },
      { key: 'B', text: "WHERE ename LIKE '张%'" },
      { key: 'C', text: "WHERE ename LIKE '%伟'" },
      { key: 'D', text: "WHERE sal + 100 > 20000" },
    ],
    answer: 'ACD',
    analysis: 'A 和 D 都是在**列上做运算**，索引存的是列的原始值，运算后的结果没法用有序性定位。C 是**前导通配符**，无法确定从哪开始扫。B 是后缀通配符，可以用索引（从"张"开始扫）。改法：A 改成 `hiredate >= \'2022-01-01\' AND hiredate < \'2023-01-01\'`，D 改成 `sal > 19900` —— 把运算挪到常量侧。',
  },
  {
    id: 'Q051', kid: 'k-index-use', type: 'judge', difficulty: 3,
    stem: '在「性别」这种只有两个取值的列上建索引，能显著提升查询速度。',
    answer: 'F',
    analysis: '**选择性太低**的列不适合建索引。假设男女各占一半，走索引要定位一半的行（还要回表），比全表扫描还慢 —— 因为索引扫描是随机 I/O，全表扫描是顺序 I/O。该建索引的是**选择性高**（不同值多）的列，比如学号、订单号。',
  },
  {
    id: 'Q052', kid: 'k-hash', type: 'choice', difficulty: 3,
    stem: '关于哈希索引，下列说法正确的是：',
    options: [
      { key: 'A', text: '它支持范围查询，而且比 B+ 树快' },
      { key: 'B', text: '等值查询 O(1) 很快，但不支持范围查询和排序' },
      { key: 'C', text: '它比 B+ 树更常用' },
      { key: 'D', text: '它支持最左前缀匹配' },
    ],
    answer: 'B',
    analysis: '哈希函数**打乱了顺序**，所以范围查询（`sal > 20000`）、排序（`ORDER BY`）、前缀匹配（`LIKE \'张%\'`）、最左前缀统统用不上。虽然等值查询 O(1) 比 B+ 树的 O(log n) 快，但代价太大 —— 所以数据库里**绝大多数索引都是 B+ 树**，哈希索引只用在纯等值查询的极少数场景。',
  },
  {
    id: 'Q053', kid: 'k-hash', type: 'judge', difficulty: 4,
    stem: '位图索引空间占用极小，而且很适合高并发的在线交易（OLTP）系统。',
    answer: 'F',
    analysis: '前半句对，后半句错。位图索引的空间优势是真的（100 万行只需 125KB），多条件位运算也极快。**但它不适合写密集的场景**：一个位向量是共享的，改一行要锁**整段**（不是一个 bit），并发写入会严重串行化。所以它只用在数据仓库（只读或批量导入）里，OLTP 系统里绝对不能用。',
  },

  /* ==================== 查询优化 ==================== */
  {
    id: 'Q054', kid: 'k-query-process', type: 'choice', difficulty: 3,
    stem: '查询处理流程中，**需要依赖统计信息**的是哪一步？',
    options: [
      { key: 'A', text: '语法分析' },
      { key: 'B', text: '语义分析' },
      { key: 'C', text: '代数优化（基于规则的等价变换）' },
      { key: 'D', text: '物理优化（选择具体算法和索引）' },
    ],
    answer: 'D',
    analysis: '代数优化是**基于规则**的等价变换（选择下推、投影下推），规则固定，不看数据量。物理优化**基于代价**，要用统计信息（行数、不同值个数、直方图）估算每种方案的代价。这就是为什么统计信息过期会让执行计划突然变差。',
  },
  {
    id: 'Q055', kid: 'k-algebra-opt', type: 'choice', difficulty: 4,
    stem: '「选择下推」这条优化规则的作用是：',
    options: [
      { key: 'A', text: '把选择运算尽量推到查询树的叶端，尽早缩小中间结果集' },
      { key: 'B', text: '把选择运算推迟到最后执行，减少中间计算' },
      { key: 'C', text: '把多个选择运算合并成一个' },
      { key: 'D', text: '把选择运算改写成连接运算' },
    ],
    answer: 'A',
    analysis: '核心思想是**尽早缩小中间结果集**，因为后续每一步的代价都和输入规模成正比。例如先筛出"计算机系学生"再连接选课表，中间结果从 10 万行降到 2 万行，后面每一步都快 5 倍。B 完全反了。C 是"选择合并"，是另一条规则。',
  },
  {
    id: 'Q056', kid: 'k-plan', type: 'multi', difficulty: 4,
    stem: '执行计划里出现「全表扫描」，下列哪些情况下这是**合理**的选择？（多选）',
    options: [
      { key: 'A', text: '表本身很小，一次 I/O 就能读完' },
      { key: 'B', text: '查询要返回表里大部分行' },
      { key: 'C', text: '没有可用的索引' },
      { key: 'D', text: '只要是全表扫描就一定是优化器选错了' },
    ],
    answer: 'ABC',
    analysis: 'D 是常见的误解。全表扫描在很多情况下是**正确的**：表小的时候（走索引的额外开销还不如直接扫）、要返回大部分行的时候（走索引要回表，随机 I/O 反而更慢）、没有可用索引的时候。判断标准是"优化器估算的代价"，不是"有没有 SCAN 这个词"。',
  },
  {
    id: 'Q057', kid: 'k-plan', type: 'judge', difficulty: 3,
    stem: '数据库的统计信息过期后，查询结果会变错。',
    answer: 'F',
    analysis: '统计信息只影响**执行计划的选择**（怎么查），不影响**查询结果**（查什么）。结果永远是对的，只是可能变得极慢 —— 比如优化器以为表只有 1000 行，选了嵌套循环连接，实际有 100 万行，结果跑几个小时。所以症状是"突然变慢"而不是"结果不对"，排查时容易走错方向。',
  },

  /* ==================== 事务与并发 ==================== */
  {
    id: 'Q058', kid: 'k-acid', type: 'choice', difficulty: 3,
    stem: '事务的 ACID 特性中，**持久性（D）**主要依靠什么机制实现？',
    options: [
      { key: 'A', text: 'Undo 日志' },
      { key: 'B', text: 'Redo 日志' },
      { key: 'C', text: '锁机制' },
      { key: 'D', text: 'MVCC 多版本并发控制' },
    ],
    answer: 'B',
    analysis: '**原子性（A）靠 Undo**（回滚未完成的操作），**持久性（D）靠 Redo**（把已提交的操作重做一遍）。C 和 D 是隔离性（I）的实现手段。记法：Undo 是"撤销"，对应"要么全不做"；Redo 是"重做"，对应"做了就不能丢"。',
  },
  {
    id: 'Q059', kid: 'k-acid', type: 'short', difficulty: 4,
    stem: '为什么说「一致性（C）」是 ACID 中唯一不能靠单一机制保证的特性？举例说明。',
    answer: '一致性要求事务前后数据库都满足所有完整性约束和业务规则。数据库能保证的是：不会出现"扣了钱但没加钱"这种中间状态被其他事务看到（这是 A、I、D 共同做到的）。但它**无法保证应用逻辑本身正确**。例如转账事务如果写成"只扣不加"，数据库不会报错——扣款语句完全合法，约束也都满足。所以一致性 = A + I + D 的机制保障 + **正确的应用逻辑**，缺一不可。这也是为什么"数据库层面的一致性"和"业务层面的一致性"要分开讨论。',
    steps: [
      { t: '指出数据库能保证的是"中间状态不被看到"', pts: 30 },
      { t: '给出应用逻辑错误导致不一致的具体例子（如只扣不加）', pts: 40 },
      { t: '得出结论：一致性 = 机制保障 + 正确的应用逻辑', pts: 30 },
    ],
  },
  {
    id: 'Q060', kid: 'k-isolation', type: 'choice', difficulty: 4,
    stem: '「幻读」现象是指：',
    options: [
      { key: 'A', text: '读到另一个事务未提交的修改' },
      { key: 'B', text: '同一事务内两次读同一行，结果不同' },
      { key: 'C', text: '同一事务内两次查同一范围，行数变了' },
      { key: 'D', text: '两个事务互相等待对方的锁' },
    ],
    answer: 'C',
    analysis: '幻读的关键词是"**范围**"和"**行数变化**"—— 别人插入或删除了一行，导致你两次查询的结果集大小不同。A 是脏读，B 是不可重复读（针对**同一行**的值变化），D 是死锁。幻读需要 SERIALIZABLE 级别（或 MySQL 的间隙锁）才能防住。',
  },
  {
    id: 'Q061', kid: 'k-isolation', type: 'multi', difficulty: 4,
    stem: '在 READ COMMITTED 隔离级别下，下列哪些异常**能够**被防止？（多选）',
    options: [
      { key: 'A', text: '脏读' },
      { key: 'B', text: '丢失修改' },
      { key: 'C', text: '不可重复读' },
      { key: 'D', text: '幻读' },
    ],
    answer: 'AB',
    analysis: 'READ COMMITTED 能防**脏读**（只读已提交的数据）和**丢失修改**（写的时候加锁），但防不住**不可重复读**和**幻读** —— 因为它读的时候加的是**短锁**，读完立即释放，别人随后就能改。要防不可重复读需要 REPEATABLE READ（读锁保持到事务结束），防幻读需要 SERIALIZABLE。',
  },
  {
    id: 'Q062', kid: 'k-lock', type: 'choice', difficulty: 4,
    stem: '「二级封锁协议」相比一级，额外防住了什么？',
    options: [
      { key: 'A', text: '丢失修改' },
      { key: 'B', text: '脏读' },
      { key: 'C', text: '不可重复读' },
      { key: 'D', text: '幻读' },
    ],
    answer: 'B',
    analysis: '一级：写前加 X 锁保持到结束 → 防丢失修改。二级：在一级基础上，**读前加 S 锁、读完立即释放** → 因为别人写时持有 X 锁，你拿不到 S 锁，所以读不到未提交的数据 → **防脏读**。三级：读锁**保持到事务结束** → 防不可重复读。三级协议**都防不住幻读**，因为它们是按行加锁的，而幻读涉及范围。',
  },
  {
    id: 'Q063', kid: 'k-lock', type: 'judge', difficulty: 4,
    stem: '遵守两段锁协议（2PL）的调度一定是可串行化的，而且一定不会发生死锁。',
    answer: 'F',
    analysis: '前半句对，后半句错。2PL 是**冲突可串行化的充分条件**（遵守它一定可串行化，但不遵守也可能可串行化）。**但 2PL 不能防死锁** —— 两个事务各自持有对方需要的锁、互相等待，就死锁了。2PL 只保证"加锁解锁分两段"，不保证"等待顺序不构成环"。这正是为什么需要额外的死锁检测或预防机制。',
  },
  {
    id: 'Q064', kid: 'k-serializable', type: 'choice', difficulty: 5,
    stem: '调度 S = r1(A) w2(A) r2(B) w1(B)。关于它的可串行化，正确的判断是：',
    options: [
      { key: 'A', text: '冲突可串行化，等价于 T1→T2' },
      { key: 'B', text: '冲突可串行化，等价于 T2→T1' },
      { key: 'C', text: '不可串行化，优先图中有环' },
      { key: 'D', text: '无法判断，信息不足' },
    ],
    answer: 'C',
    analysis: '看冲突对：`r1(A)` 与 `w2(A)` 冲突（不同事务、同一数据、有写），且 r1 在前 → 边 **T1→T2**；`r2(B)` 与 `w1(B)` 冲突，且 r2 在前 → 边 **T2→T1**。两条边形成环 T1→T2→T1，**优先图有环 ⟹ 不可串行化**。注意读-读不冲突，所以 `r1(A)` 和 `r2(A)` 之间没有边。',
  },
  {
    id: 'Q065', kid: 'k-deadlock', type: 'choice', difficulty: 5,
    stem: '在 Wait-Die（等待-死亡）策略中，当一个**较新**的事务请求一个**较老**事务持有的锁时：',
    options: [
      { key: 'A', text: '较新的事务等待' },
      { key: 'B', text: '较新的事务被回滚（死亡）' },
      { key: 'C', text: '较老的事务被回滚' },
      { key: 'D', text: '两者都不动，等待超时' },
    ],
    answer: 'B',
    analysis: 'Wait-Die 的规则是"**老的事务等待，新的事务死亡**"：老请求新 → 等待；**新请求老 → 回滚**。对比 Wound-Wait（伤害-等待）：老请求新 → **抢占**（新的回滚）；新请求老 → 等待。两者的共同点是"**方向永远是老的赢**"，所以不可能形成环。区别在于谁回滚 —— Wait-Die 回滚请求者，Wound-Wait 回滚持有者。',
  },
  {
    id: 'Q066', kid: 'k-deadlock', type: 'multi', difficulty: 4,
    stem: '下列哪些是产生死锁的必要条件？（多选）',
    options: [
      { key: 'A', text: '互斥：资源同一时刻只能被一个事务持有' },
      { key: 'B', text: '持有并等待：持有资源的同时还在请求新资源' },
      { key: 'C', text: '不可剥夺：不能强行夺走别人持有的资源' },
      { key: 'D', text: '事务的隔离级别是 SERIALIZABLE' },
    ],
    answer: 'ABC',
    analysis: '死锁的四个必要条件是：互斥、持有并等待、不可剥夺、**循环等待**。ABC 是其中三条。D 不是必要条件 —— 任何隔离级别下只要加锁就可能死锁。破坏四个条件中的任何一个就能预防死锁，比如"一次封锁法"破坏"持有并等待"、"顺序封锁法"破坏"循环等待"。',
  },

  /* ==================== 恢复与安全 ==================== */
  {
    id: 'Q067', kid: 'k-wal', type: 'choice', difficulty: 4,
    stem: 'WAL（Write-Ahead Logging）原则要求：',
    options: [
      { key: 'A', text: '数据页必须先于日志写盘' },
      { key: 'B', text: '日志必须先于数据页写盘' },
      { key: 'C', text: '日志和数据页必须同时写盘' },
      { key: 'D', text: '日志只写内存，不落盘' },
    ],
    answer: 'B',
    analysis: '如果数据先写盘、日志还没写，此时断电 —— 这次修改**既没有日志记录、又已经生效**，恢复时无从判断该不该撤销它。反过来先写日志，即使数据没写盘也能靠 Redo 重做。**这就是为什么 `COMMIT` 等的是"日志写盘"而不是"数据写盘"** —— 也解释了为什么数据库的提交能很快同时又能保证持久性。',
  },
  {
    id: 'Q068', kid: 'k-wal', type: 'choice', difficulty: 4,
    stem: 'Undo 和 Redo 分别处理什么情况？',
    options: [
      { key: 'A', text: 'Undo 处理已提交事务，Redo 处理未提交事务' },
      { key: 'B', text: 'Undo 撤销未提交事务的影响，Redo 重做已提交但可能未写盘的事务' },
      { key: 'C', text: '两者都只处理已提交事务' },
      { key: 'D', text: 'Undo 用于介质故障，Redo 用于系统故障' },
    ],
    answer: 'B',
    analysis: '**Undo 反向扫描日志，把未提交事务的新值改回旧值**（保证原子性）。**Redo 正向扫描日志，把已提交但可能没写盘的操作再写一遍**（保证持久性）。A 把两者对调了。D 也不对 —— 介质故障要靠**备份**恢复，因为日志和数据可能在同一块盘上一起丢了。',
  },
  {
    id: 'Q069', kid: 'k-wal', type: 'judge', difficulty: 4,
    stem: 'ARIES 恢复算法在重做阶段只重做已提交事务的操作。',
    answer: 'F',
    analysis: 'ARIES 的重做阶段**重做所有操作，包括未提交事务的**，然后在撤销阶段把未提交的撤销掉。这看起来绕，但好处很大：避免"哪些该重做"的复杂判断 —— 反正最后要撤销，不如先统一恢复到崩溃前的完整状态，再做撤销。这是 ARIES 设计的巧妙之处。',
  },
  {
    id: 'Q070', kid: 'k-failure', type: 'choice', difficulty: 3,
    stem: '磁盘物理损坏（介质故障）的恢复必须依靠：',
    options: [
      { key: 'A', text: 'Undo 日志' },
      { key: 'B', text: 'Redo 日志' },
      { key: 'C', text: '备份副本 + 日志' },
      { key: 'D', text: '重启数据库服务' },
    ],
    answer: 'C',
    analysis: '介质故障磁盘本身坏了，**日志也在那块盘上的话就一起丢了**。所以必须靠**异机存放的备份**，再用备份之后的日志重做到故障点。这也是为什么"备份必须异机存放"是一条铁律 —— 备份和数据库放同一块盘等于没有备份。',
  },
  {
    id: 'Q071', kid: 'k-failure', type: 'judge', difficulty: 4,
    stem: '在 WAL 模式下，直接用 `cp` 命令复制数据库主文件（.db）就能得到一份可用的备份。',
    answer: 'F',
    analysis: 'WAL 模式下数据库由 `.db` + `.db-wal` + `.db-shm` **三个文件**共同构成，只复制主文件会得到一份**不一致**的副本（最新的修改还在 wal 里没合并进去）。正确做法是用数据库自带的备份命令（SQLite 的 `.backup`），或者先做检查点（checkpoint）把 wal 合并进主文件再复制。',
  },
  {
    id: 'Q072', kid: 'k-security', type: 'choice', difficulty: 3,
    stem: '在权限管理中大量使用「角色」而不是逐用户授权，主要好处是：',
    options: [
      { key: 'A', text: '角色能让查询跑得更快' },
      { key: 'B', text: '权限清单只有一份，便于管理、审计和批量调整' },
      { key: 'C', text: '角色可以绕过权限检查' },
      { key: 'D', text: '用角色就不需要密码了' },
    ],
    answer: 'B',
    analysis: '一所学校 3000 个学生，逐人授权意味着"给所有学生加一个查成绩的权限"要执行 3000 条 GRANT，而且半年后你根本说不清"学生到底有哪些权限"。用角色，权限清单只有一份，改一处全局生效。A、C、D 都是无稽之谈 —— 角色是权限的**组织方式**，不影响性能，更不能绕过检查。',
  },
  {
    id: 'Q073', kid: 'k-security', type: 'choice', difficulty: 4,
    stem: '关于「管理员重置用户密码」这个操作，审计日志里应该记录：',
    options: [
      { key: 'A', text: '管理员是谁、重置了谁的密码、时间' },
      { key: 'B', text: '管理员是谁、被重置的新密码、时间' },
      { key: 'C', text: '只记录时间' },
      { key: 'D', text: '不需要记录，这是常规操作' },
    ],
    answer: 'A',
    analysis: '**审计日志里绝对不能记密码**，连脱敏形式都不该记。审计日志会被导出、会被截图、会被同步到日志系统 —— 记进去等于把新密码留在一个比密码本身更不安全的地方。正确做法是记"谁对谁做了什么"，而不是"内容是什么"。这也是本平台教师端的设计原则。',
  },
  {
    id: 'Q074', kid: 'k-security', type: 'blank', difficulty: 3,
    stem: '防御 SQL 注入的根本方法是使用 ______ 查询（把用户输入当作值传递，而不是拼进 SQL 字符串）。',
    answer: '参数化|预处理|prepared',
    analysis: '参数化查询（也叫预处理语句）把 SQL 语句的**结构**和**数据**分开传递，用户输入永远不会被当成 SQL 语法解析。任何形式的字符串拼接都是漏洞 —— 包括看似"过滤了引号"的那些。这是防御 SQL 注入唯一可靠的方法。',
  },
];

export default QUESTIONS;
