/* SQL 关卡
 *
 * 判题口径见 lib/sqlCompare.js：跑参考 SQL、跑学生 SQL、比结果集。
 *
 * ── 写关卡时最容易配错的两件事 ──────────────────────────────────
 * 1. **order_matters**。题目里出现 ORDER BY / LIMIT /「取前 N」时
 *    必须置 1。否则「取工资最高的 3 个人」这道题，学生写
 *    `SELECT ... ORDER BY sal DESC` 和 `SELECT ... ORDER BY sal ASC`
 *    都会通过 —— 因为无序比对会把行序忽略掉。
 *
 * 2. **列名要求**。默认 0（只警告）。只有当题目明确说
 *    「输出列名为 xxx」时才置 1，否则 `COUNT(*)` 和 `COUNT(*) AS 人数`
 *    会被判成不同答案，而它们数据完全一致。
 *
 * starter_sql 是编辑器初始内容。留一句能跑的骨架（不是答案），
 * 让学生有个起点 —— 空编辑器对着空白页面会卡住初学者。
 */

export const LEVELS = [
  /* ==================== 第一部分：单表查询（school） ==================== */
  {
    id: 'L01', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-select', seq: 1,
    title: '查询全部学生',
    brief: `最简单的查询：把 \`student\` 表的**所有列、所有行**取出来。

\`\`\`sql
SELECT * FROM 表名;
\`\`\`

这一关只要求你能跑通语法。注意看结果里每一列的名字和类型。`,
    hint: 'SELECT * FROM student;',
    starter_sql: 'SELECT * FROM student;',
    reference_sql: 'SELECT * FROM student;',
    difficulty: 1,
  },
  {
    id: 'L02', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-select', seq: 2,
    title: '只取需要的列',
    brief: `列出所有学生的**学号、姓名、所在系**三列，列顺序按这个顺序。

> 提示：把 \`SELECT *\` 里的 \`*\` 换成用逗号分隔的列名。
> 生产代码里几乎不该出现 \`SELECT *\` —— 表加一列，你的结果就多一列，
> 依赖这份结果的程序可能因此崩掉。`,
    hint: 'SELECT sno, sname, sdept FROM student;',
    starter_sql: 'SELECT sno, sname, sdept\nFROM student;',
    reference_sql: 'SELECT sno, sname, sdept FROM student;',
    require_columns: 1,
    difficulty: 1,
  },
  {
    id: 'L03', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-where', seq: 3,
    title: '条件筛选',
    brief: `查询**计算机系**的全部学生信息。

\`\`\`sql
SELECT 列 FROM 表 WHERE 条件;
\`\`\`

字符串要用**单引号**包起来。双引号在 SQL 里是标识符（列名/表名）的意思，
不是字符串 —— 这是初学者最常见的错误之一。`,
    hint: "SELECT * FROM student WHERE sdept = '计算机系';",
    starter_sql: 'SELECT *\nFROM student\nWHERE sdept = \'计算机系\';',
    reference_sql: "SELECT * FROM student WHERE sdept = '计算机系';",
    difficulty: 1,
  },
  {
    id: 'L04', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-where', seq: 4,
    title: '多条件与范围',
    brief: `查询**计算机系**或**软件工程系**中，年龄在 **20 到 21 岁之间**（含两端）的学生的姓名和年龄。

可以用 \`IN\` 代替多个 OR，用 \`BETWEEN ... AND ...\` 表示闭区间。`,
    hint: "WHERE sdept IN ('计算机系','软件工程系') AND sage BETWEEN 20 AND 21",
    starter_sql: "SELECT sname, sage\nFROM student\nWHERE sdept IN ('计算机系','软件工程系')\n  AND sage BETWEEN 20 AND 21;",
    reference_sql: "SELECT sname, sage FROM student WHERE sdept IN ('计算机系','软件工程系') AND sage BETWEEN 20 AND 21;",
    difficulty: 2,
  },
  {
    id: 'L05', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-where', seq: 5,
    title: '模糊匹配',
    brief: `查询所有**姓「张」或姓「李」**的学生。

\`LIKE\` 配合通配符：\`%\` 匹配任意多个字符，\`_\` 匹配恰好一个字符。

> 注意 \`'张%'\` 和 \`'%张%'\` 的区别：前者是「以张开头」，
> 后者是「名字里含张」，会把「张三丰」和「小张」都匹配上。`,
    hint: "WHERE sname LIKE '张%' OR sname LIKE '李%'",
    starter_sql: "SELECT *\nFROM student\nWHERE sname LIKE '张%'\n   OR sname LIKE '李%';",
    reference_sql: "SELECT * FROM student WHERE sname LIKE '张%' OR sname LIKE '李%';",
    difficulty: 2,
  },
  {
    id: 'L06', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-orderby', seq: 6,
    title: '排序 + 取前几名',
    brief: `查询年龄**最大的 3 名学生**的姓名和年龄。

需要 \`ORDER BY ... DESC\` 配合 \`LIMIT\`。

> ⚠️ 本题**要求行序**：年龄必须从大到小排。
> 只写 LIMIT 不写 ORDER BY，拿到的「前 3 行」是随机的 ——
> SQL 不保证任何默认顺序，今天跑和明天跑可能不一样。`,
    hint: 'ORDER BY sage DESC LIMIT 3',
    starter_sql: 'SELECT sname, sage\nFROM student\nORDER BY sage DESC\nLIMIT 3;',
    reference_sql: 'SELECT sname, sage FROM student ORDER BY sage DESC LIMIT 3;',
    order_matters: 1,
    difficulty: 2,
  },

  /* ==================== 第二部分：聚合与分组 ==================== */
  {
    id: 'L07', dataset_id: 'school', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 7,
    title: '计数与求平均',
    brief: `统计学生**总人数**，以及所有学生选课成绩的**平均分**（结果保留原始精度即可）。

\`\`\`sql
SELECT COUNT(*) FROM student;
SELECT AVG(grade) FROM sc;
\`\`\`

> \`COUNT(*)\` 数的是**行数**，包含 NULL；
> \`COUNT(grade)\` 数的是 grade **非 NULL** 的行数。两者不一样。`,
    hint: 'SELECT COUNT(*) FROM student; 然后 SELECT AVG(grade) FROM sc;',
    starter_sql: '-- 第一个结果集要是人数，第二个是平均分\nSELECT COUNT(*) FROM student;\nSELECT AVG(grade) FROM sc;',
    reference_sql: 'SELECT COUNT(*) FROM student; SELECT AVG(grade) FROM sc;',
    difficulty: 2,
  },
  {
    id: 'L08', dataset_id: 'school', chapter_id: 'ch-sql-agg', kid: 'k-groupby', seq: 8,
    title: '按系分组统计',
    brief: `统计**每个系**的学生人数和平均年龄，输出两列：系名、人数。

\`\`\`sql
SELECT 分组列, 聚合函数(...)
FROM 表
GROUP BY 分组列;
\`\`\`

> **SELECT 里只能出现「分组列」和「聚合函数」**，不能出现其他裸列。
> 写 \`SELECT sdept, sname, COUNT(*)\` 在标准 SQL 里是错的 ——
> 一个系有多个学生，那个 sname 该取哪一个？SQLite 会随便给你一个，
> 但 MySQL 严格模式、PostgreSQL 会直接报错。`,
    hint: 'SELECT sdept, COUNT(*) FROM student GROUP BY sdept;',
    starter_sql: 'SELECT sdept, COUNT(*) AS 人数\nFROM student\nGROUP BY sdept;',
    reference_sql: 'SELECT sdept, COUNT(*) FROM student GROUP BY sdept;',
    difficulty: 2,
  },
  {
    id: 'L09', dataset_id: 'school', chapter_id: 'ch-sql-agg', kid: 'k-having', seq: 9,
    title: '分组后再筛选',
    brief: `找出**选课门数超过 2 门**（即 ≥ 3 门）的学生学号及其选课门数。

> ⚠️ 这里**不能用 WHERE**。WHERE 在分组**之前**执行，
> 那时还没有「每个学生几门课」这个值。筛选聚合结果必须用 \`HAVING\`。
>
> 执行顺序要记住：
> \`FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT\``,
    hint: 'GROUP BY sno HAVING COUNT(*) >= 3',
    starter_sql: 'SELECT sno, COUNT(*) AS 门数\nFROM sc\nGROUP BY sno\nHAVING COUNT(*) >= 3;',
    reference_sql: 'SELECT sno, COUNT(*) FROM sc GROUP BY sno HAVING COUNT(*) >= 3;',
    difficulty: 3,
  },
  {
    id: 'L10', dataset_id: 'school', chapter_id: 'ch-sql-agg', kid: 'k-groupby', seq: 10,
    title: '按多列分组',
    brief: `统计**每个系、每种性别**各有多少人，输出三列：系、性别、人数。

\`GROUP BY\` 后面可以跟多个列，含义是「按这个组合分组」。`,
    hint: 'GROUP BY sdept, ssex',
    starter_sql: 'SELECT sdept, ssex, COUNT(*)\nFROM student\nGROUP BY sdept, ssex;',
    reference_sql: 'SELECT sdept, ssex, COUNT(*) FROM student GROUP BY sdept, ssex;',
    difficulty: 2,
  },

  /* ==================== 第三部分：多表连接 ==================== */
  {
    id: 'L11', dataset_id: 'school', chapter_id: 'ch-sql-join', kid: 'k-join', seq: 11,
    title: '两表内连接',
    brief: `查询每个学生的姓名和他选的**课程号**，只要选了课的学生。

两张表通过 \`sno\` 关联：

\`\`\`sql
SELECT s.sname, sc.cno
FROM student s
JOIN sc ON s.sno = sc.sno;
\`\`\`

\`s\` 是表别名。多表连接时**一定要用别名限定列名** ——
\`sno\` 在两张表里都有，不限定会报 \`ambiguous column name\`。`,
    hint: 'FROM student s JOIN sc ON s.sno = sc.sno',
    starter_sql: 'SELECT s.sname, sc.cno\nFROM student s\nJOIN sc ON s.sno = sc.sno;',
    reference_sql: 'SELECT s.sname, sc.cno FROM student s JOIN sc ON s.sno = sc.sno;',
    difficulty: 2,
  },
  {
    id: 'L12', dataset_id: 'school', chapter_id: 'ch-sql-join', kid: 'k-join', seq: 12,
    title: '三表连接',
    brief: `查询**每个学生选的课程名和成绩**，输出：姓名、课程名、成绩。

需要 \`student → sc → course\` 三张表连起来。`,
    hint: 'FROM student s JOIN sc ON ... JOIN course c ON ...',
    starter_sql: 'SELECT s.sname, c.cname, sc.grade\nFROM student s\nJOIN sc ON s.sno = sc.sno\nJOIN course c ON c.cno = sc.cno;',
    reference_sql: 'SELECT s.sname, c.cname, sc.grade FROM student s JOIN sc ON s.sno = sc.sno JOIN course c ON c.cno = sc.cno;',
    difficulty: 3,
  },
  {
    id: 'L13', dataset_id: 'school', chapter_id: 'ch-sql-join', kid: 'k-join', seq: 13,
    title: '左外连接：找出没选课的学生',
    brief: `查询**所有学生**的姓名和他选的课程号。**没选任何课的学生也要出现在结果里**，
此时课程号那一列是 NULL。

\`\`\`sql
FROM student s
LEFT JOIN sc ON s.sno = sc.sno
\`\`\`

> \`JOIN\`（内连接）只保留两边都匹配的行；\`LEFT JOIN\` 保留左表全部行，
> 右表没匹配上就填 NULL。这就是「找出没有 X 的记录」的标准写法。`,
    hint: 'LEFT JOIN sc ON s.sno = sc.sno',
    starter_sql: 'SELECT s.sname, sc.cno\nFROM student s\nLEFT JOIN sc ON s.sno = sc.sno;',
    reference_sql: 'SELECT s.sname, sc.cno FROM student s LEFT JOIN sc ON s.sno = sc.sno;',
    difficulty: 3,
  },
  {
    id: 'L14', dataset_id: 'school', chapter_id: 'ch-sql-join', kid: 'k-join', seq: 14,
    title: '统计每门课的选课人数（含没人选的课）',
    brief: `输出**每门课**的课程号和选课人数。**没人选的课人数记为 0**，也必须出现。

这是 \`LEFT JOIN\` + \`COUNT\` 的组合拳。注意一个坑：
\`COUNT(*)\` 会把「没匹配上的那一行 NULL」也算成 1，所以人数会错。
应该用 \`COUNT(sc.sno)\` —— 它不数 NULL。`,
    hint: 'COUNT(sc.sno) 而不是 COUNT(*)',
    starter_sql: 'SELECT c.cno, COUNT(sc.sno) AS 人数\nFROM course c\nLEFT JOIN sc ON c.cno = sc.cno\nGROUP BY c.cno;',
    reference_sql: 'SELECT c.cno, COUNT(sc.sno) FROM course c LEFT JOIN sc ON c.cno = sc.cno GROUP BY c.cno;',
    difficulty: 4,
  },

  /* ==================== 第四部分：子查询 ==================== */
  {
    id: 'L15', dataset_id: 'school', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 15,
    title: '不相关子查询',
    brief: `查询**成绩高于全体平均分**的学生学号、课程号和成绩。

先算出平均分，再拿它当条件。子查询的结果是一个标量（单个值）：

\`\`\`sql
WHERE grade > (SELECT AVG(grade) FROM sc)
\`\`\`

注意括号不能省。`,
    hint: 'WHERE grade > (SELECT AVG(grade) FROM sc)',
    starter_sql: 'SELECT sno, cno, grade\nFROM sc\nWHERE grade > (SELECT AVG(grade) FROM sc);',
    reference_sql: 'SELECT sno, cno, grade FROM sc WHERE grade > (SELECT AVG(grade) FROM sc);',
    difficulty: 3,
  },
  {
    id: 'L16', dataset_id: 'school', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 16,
    title: 'IN 子查询',
    brief: `查询**选修了「数据库系统原理」这门课**的学生的学号和姓名。

思路：先用子查询拿到这门课的课程号，再在 \`sc\` 里筛出选了它的学号，
最后回到 \`student\` 拿姓名。`,
    hint: "WHERE sno IN (SELECT sno FROM sc WHERE cno IN (SELECT cno FROM course WHERE cname = '数据库系统原理'))",
    starter_sql: "SELECT sno, sname\nFROM student\nWHERE sno IN (\n  SELECT sno FROM sc\n  WHERE cno = (SELECT cno FROM course WHERE cname = '数据库系统原理')\n);",
    reference_sql: "SELECT sno, sname FROM student WHERE sno IN (SELECT sno FROM sc WHERE cno IN (SELECT cno FROM course WHERE cname = '数据库系统原理'));",
    difficulty: 4,
  },
  {
    id: 'L17', dataset_id: 'school', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 17,
    title: '相关子查询 / NOT EXISTS',
    brief: `查询**一门课都没选**的学生的学号和姓名。

两种写法都对：
- \`NOT EXISTS\` + 相关子查询
- \`LEFT JOIN ... WHERE sc.sno IS NULL\`

\`EXISTS\` 是「存在性」判断，子查询返回什么列不重要，\`SELECT 1\` 就够了。
它比 \`IN\` 更适合大表，因为找到第一条匹配就能停。`,
    hint: 'NOT EXISTS (SELECT 1 FROM sc WHERE sc.sno = s.sno)',
    starter_sql: 'SELECT s.sno, s.sname\nFROM student s\nWHERE NOT EXISTS (\n  SELECT 1 FROM sc WHERE sc.sno = s.sno\n);',
    reference_sql: 'SELECT s.sno, s.sname FROM student s WHERE NOT EXISTS (SELECT 1 FROM sc WHERE sc.sno = s.sno);',
    difficulty: 4,
  },
  {
    id: 'L18', dataset_id: 'school', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 18,
    title: '分组内的最值（相关子查询）',
    brief: `查询**每门课成绩最高的那个学生**的课程号、学号和成绩。

难点：\`MAX(grade)\` 只能给出最高分，给不出「谁」。所以要用相关子查询：
对每一行，检查它的成绩是否等于「同课程号下的最高分」。

> 这是「分组取 Top-1」的经典解法。更现代的写法是窗口函数
> （\`ROW_NUMBER() OVER (PARTITION BY ...)\`），但相关子查询是理解它的基础。`,
    hint: 'WHERE grade = (SELECT MAX(grade) FROM sc x WHERE x.cno = sc.cno)',
    starter_sql: 'SELECT cno, sno, grade\nFROM sc\nWHERE grade = (\n  SELECT MAX(x.grade) FROM sc x WHERE x.cno = sc.cno\n);',
    reference_sql: 'SELECT cno, sno, grade FROM sc WHERE grade = (SELECT MAX(x.grade) FROM sc x WHERE x.cno = sc.cno);',
    difficulty: 5,
  },

  /* ==================== 第五部分：电商库（实战） ==================== */
  {
    id: 'L19', dataset_id: 'shop', chapter_id: 'ch-sql-join', kid: 'k-join', seq: 19,
    title: '订单明细展开',
    brief: `切换到**电商订单库**。查询每个订单的商品明细：订单号、商品名、数量、成交单价。

需要 \`order_item\` 连接 \`product\`。`,
    hint: 'FROM order_item oi JOIN product p ON oi.pid = p.pid',
    starter_sql: 'SELECT oi.oid, p.pname, oi.qty, oi.unit_price\nFROM order_item oi\nJOIN product p ON oi.pid = p.pid;',
    reference_sql: 'SELECT oi.oid, p.pname, oi.qty, oi.unit_price FROM order_item oi JOIN product p ON oi.pid = p.pid;',
    difficulty: 2,
  },
  {
    id: 'L20', dataset_id: 'shop', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 20,
    title: '算每个订单的总额',
    brief: `计算**每个订单的总额**（数量 × 成交单价，再按订单求和），输出订单号和总额。

> 注意用 \`order_item.unit_price\`（成交价）而不是 \`product.price\`（现价）。
> 订单 1012 的商品 103 成交价是 1199，现价已经改成 1299 ——
> 如果按现价算，历史订单的金额会凭空变多。这就是「订单要存价格快照」的原因。`,
    hint: 'SUM(oi.qty * oi.unit_price) GROUP BY oi.oid',
    starter_sql: 'SELECT oi.oid, SUM(oi.qty * oi.unit_price) AS 总额\nFROM order_item oi\nGROUP BY oi.oid;',
    reference_sql: 'SELECT oi.oid, SUM(oi.qty * oi.unit_price) FROM order_item oi GROUP BY oi.oid;',
    difficulty: 3,
  },
  {
    id: 'L21', dataset_id: 'shop', chapter_id: 'ch-sql-agg', kid: 'k-having', seq: 21,
    title: '消费超过 1000 元的顾客',
    brief: `找出**累计消费金额超过 1000 元**的顾客姓名和累计金额。

需要连四张表：\`customer → orders → order_item\`，
并且**只统计已完成（done）的订单**（取消的不算消费）。

这是 \`JOIN + WHERE + GROUP BY + HAVING\` 的完整组合。`,
    hint: "WHERE o.status = 'done' ... GROUP BY u.uid HAVING SUM(...) > 1000",
    starter_sql: "SELECT u.uname, SUM(oi.qty * oi.unit_price) AS 累计\nFROM customer u\nJOIN orders o ON o.uid = u.uid\nJOIN order_item oi ON oi.oid = o.oid\nWHERE o.status = 'done'\nGROUP BY u.uid, u.uname\nHAVING SUM(oi.qty * oi.unit_price) > 1000;",
    reference_sql: "SELECT u.uname, SUM(oi.qty * oi.unit_price) FROM customer u JOIN orders o ON o.uid = u.uid JOIN order_item oi ON oi.oid = o.oid WHERE o.status = 'done' GROUP BY u.uid, u.uname HAVING SUM(oi.qty * oi.unit_price) > 1000;",
    difficulty: 4,
  },
  {
    id: 'L22', dataset_id: 'shop', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 22,
    title: '按分类统计销售额',
    brief: `统计**每个商品分类**的总销售额（按成交价算，所有订单都算），
输出分类名和销售额，**销售额从高到低排序**。

> ⚠️ 本题要求行序。`,
    hint: 'JOIN product → category，GROUP BY c.cname，ORDER BY SUM(...) DESC',
    starter_sql: 'SELECT c.cname, SUM(oi.qty * oi.unit_price) AS 销售额\nFROM category c\nJOIN product p ON p.cid = c.cid\nJOIN order_item oi ON oi.pid = p.pid\nGROUP BY c.cid, c.cname\nORDER BY 销售额 DESC;',
    reference_sql: 'SELECT c.cname, SUM(oi.qty * oi.unit_price) FROM category c JOIN product p ON p.cid = c.cid JOIN order_item oi ON oi.pid = p.pid GROUP BY c.cid, c.cname ORDER BY SUM(oi.qty * oi.unit_price) DESC;',
    order_matters: 1,
    difficulty: 4,
  },
  {
    id: 'L23', dataset_id: 'shop', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 23,
    title: '没被买过的商品',
    brief: `找出**从来没有出现在任何订单里**的商品名和现价。

两种思路都行：\`LEFT JOIN ... IS NULL\` 或 \`NOT IN\` / \`NOT EXISTS\`。`,
    hint: 'LEFT JOIN order_item ... WHERE oi.pid IS NULL',
    starter_sql: 'SELECT p.pname, p.price\nFROM product p\nLEFT JOIN order_item oi ON oi.pid = p.pid\nWHERE oi.pid IS NULL;',
    reference_sql: 'SELECT p.pname, p.price FROM product p LEFT JOIN order_item oi ON oi.pid = p.pid WHERE oi.pid IS NULL;',
    difficulty: 3,
  },
  {
    id: 'L24', dataset_id: 'shop', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 24,
    title: '月度销售统计',
    brief: `按**月份**统计订单数和销售额，输出月份（形如 \`2025-10\`）、订单数、销售额，按月份升序。

SQLite 用 \`strftime('%Y-%m', odate)\` 取年月。

> 订单数要数**订单**，不是明细行 —— 用 \`COUNT(DISTINCT o.oid)\`。`,
    hint: "strftime('%Y-%m', o.odate)",
    starter_sql: "SELECT strftime('%Y-%m', o.odate) AS 月份,\n       COUNT(DISTINCT o.oid) AS 订单数,\n       SUM(oi.qty * oi.unit_price) AS 销售额\nFROM orders o\nJOIN order_item oi ON oi.oid = o.oid\nGROUP BY 月份\nORDER BY 月份;",
    reference_sql: "SELECT strftime('%Y-%m', o.odate), COUNT(DISTINCT o.oid), SUM(oi.qty * oi.unit_price) FROM orders o JOIN order_item oi ON oi.oid = o.oid GROUP BY strftime('%Y-%m', o.odate) ORDER BY strftime('%Y-%m', o.odate);",
    order_matters: 1,
    difficulty: 5,
  },

  /* ==================== 第六部分：NULL 与外连接（library） ==================== */
  {
    id: 'L25', dataset_id: 'library', chapter_id: 'ch-sql-null', kid: 'k-null', seq: 25,
    title: '找出未归还的书',
    brief: `切换到**图书借阅库**。查询所有**尚未归还**的借阅记录：
流水号、借书证号、书名、借出日期。

\`return_date\` 为 NULL 表示还没还。

> ⚠️ 必须写 \`IS NULL\`，**不能写 \`= NULL\`**。
> NULL 表示「未知」，而「未知 = 未知」的结果还是「未知」，不是 true。
> 所以 \`WHERE return_date = NULL\` 会返回**零行**，而且不报错 ——
> 这是 SQL 里最隐蔽的坑之一。`,
    hint: 'WHERE b.return_date IS NULL',
    starter_sql: 'SELECT b.id, b.rno, bk.title, b.borrow_date\nFROM borrow b\nJOIN book bk ON bk.isbn = b.isbn\nWHERE b.return_date IS NULL;',
    reference_sql: 'SELECT b.id, b.rno, bk.title, b.borrow_date FROM borrow b JOIN book bk ON bk.isbn = b.isbn WHERE b.return_date IS NULL;',
    difficulty: 3,
  },
  {
    id: 'L26', dataset_id: 'library', chapter_id: 'ch-sql-null', kid: 'k-null', seq: 26,
    title: '逾期未还',
    brief: `找出**已经逾期且仍未归还**的记录：借书证号、书名、应还日期。

逾期的判断是「应还日期 < 2025-11-15」（假定今天是 2025-11-15）**并且**尚未归还。

日期在 SQLite 里是 TEXT，但 ISO 格式（\`YYYY-MM-DD\`）的字符串比较**恰好等于**
日期比较 —— 因为年月日的位数固定。这是 ISO 8601 格式被设计成这样的原因之一。`,
    hint: "WHERE b.due_date < '2025-11-15' AND b.return_date IS NULL",
    starter_sql: "SELECT b.rno, bk.title, b.due_date\nFROM borrow b\nJOIN book bk ON bk.isbn = b.isbn\nWHERE b.due_date < '2025-11-15'\n  AND b.return_date IS NULL;",
    reference_sql: "SELECT b.rno, bk.title, b.due_date FROM borrow b JOIN book bk ON bk.isbn = b.isbn WHERE b.due_date < '2025-11-15' AND b.return_date IS NULL;",
    difficulty: 4,
  },
  {
    id: 'L27', dataset_id: 'library', chapter_id: 'ch-sql-null', kid: 'k-join', seq: 27,
    title: '从没被借过的书',
    brief: `找出**从来没有被借阅过**的书名和定价。

用 \`LEFT JOIN\` 找出「在借阅表里没有对应记录」的书。`,
    hint: 'LEFT JOIN borrow ... WHERE b.isbn IS NULL',
    starter_sql: 'SELECT bk.title, bk.price\nFROM book bk\nLEFT JOIN borrow b ON b.isbn = bk.isbn\nWHERE b.isbn IS NULL;',
    reference_sql: 'SELECT bk.title, bk.price FROM book bk LEFT JOIN borrow b ON b.isbn = bk.isbn WHERE b.isbn IS NULL;',
    difficulty: 3,
  },
  {
    id: 'L28', dataset_id: 'library', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 28,
    title: '借书最多的读者',
    brief: `统计每位读者的借阅次数，输出读者姓名和次数，**按次数从高到低、次数相同按姓名升序**。

> ⚠️ 本题要求行序。二级排序键（姓名）不能省 ——
> 只按次数排时，次数相同的几行顺序不确定，结果不可复现。`,
    hint: 'ORDER BY COUNT(*) DESC, r.rname ASC',
    starter_sql: 'SELECT r.rname, COUNT(*) AS 次数\nFROM reader r\nJOIN borrow b ON b.rno = r.rno\nGROUP BY r.rno, r.rname\nORDER BY 次数 DESC, r.rname ASC;',
    reference_sql: 'SELECT r.rname, COUNT(*) FROM reader r JOIN borrow b ON b.rno = r.rno GROUP BY r.rno, r.rname ORDER BY COUNT(*) DESC, r.rname ASC;',
    order_matters: 1,
    difficulty: 4,
  },
  {
    id: 'L29', dataset_id: 'library', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 29,
    title: '计算借阅天数',
    brief: `查询**已归还**的记录，输出书名和实际借阅天数（归还日期 − 借出日期）。

SQLite 用 \`julianday(a) - julianday(b)\` 算两个日期相差的天数。`,
    hint: 'julianday(b.return_date) - julianday(b.borrow_date)',
    starter_sql: 'SELECT bk.title,\n       julianday(b.return_date) - julianday(b.borrow_date) AS 天数\nFROM borrow b\nJOIN book bk ON bk.isbn = b.isbn\nWHERE b.return_date IS NOT NULL;',
    reference_sql: 'SELECT bk.title, julianday(b.return_date) - julianday(b.borrow_date) FROM borrow b JOIN book bk ON bk.isbn = b.isbn WHERE b.return_date IS NOT NULL;',
    difficulty: 4,
  },

  /* ==================== 第七部分：自连接与区间连接（company） ==================== */
  {
    id: 'L30', dataset_id: 'company', chapter_id: 'ch-sql-join', kid: 'k-selfjoin', seq: 30,
    title: '自连接：找出每个员工的经理',
    brief: `切换到**员工部门库**。查询每个员工的姓名和他**上级的姓名**，
只列出有上级的员工（总经理没有上级，不出现）。

\`emp\` 表里的 \`mgr\` 指向同一张表的 \`empno\`，所以要把 \`emp\` 和它自己连起来。
关键是**用两个不同的别名**（\`e\` 和 \`m\`），否则无法区分「员工」和「经理」。`,
    hint: 'FROM emp e JOIN emp m ON e.mgr = m.empno',
    starter_sql: 'SELECT e.ename AS 员工, m.ename AS 经理\nFROM emp e\nJOIN emp m ON e.mgr = m.empno;',
    reference_sql: 'SELECT e.ename, m.ename FROM emp e JOIN emp m ON e.mgr = m.empno;',
    difficulty: 4,
  },
  {
    id: 'L31', dataset_id: 'company', chapter_id: 'ch-sql-join', kid: 'k-selfjoin', seq: 31,
    title: '区间连接：员工对应的工资等级',
    brief: `查询每个员工的姓名、月薪，以及他的**工资等级**。

\`salgrade\` 表存的是区间（\`losal\` ~ \`hisal\`），所以连接条件不是等值而是范围：

\`\`\`sql
JOIN salgrade s ON e.sal BETWEEN s.losal AND s.hisal
\`\`\`

> 连接条件不一定是 \`=\`。范围连接、不等连接都是合法且常用的。`,
    hint: 'ON e.sal BETWEEN s.losal AND s.hisal',
    starter_sql: 'SELECT e.ename, e.sal, s.grade\nFROM emp e\nJOIN salgrade s ON e.sal BETWEEN s.losal AND s.hisal;',
    reference_sql: 'SELECT e.ename, e.sal, s.grade FROM emp e JOIN salgrade s ON e.sal BETWEEN s.losal AND s.hisal;',
    difficulty: 4,
  },
  {
    id: 'L32', dataset_id: 'company', chapter_id: 'ch-sql-agg', kid: 'k-aggregate', seq: 32,
    title: '部门薪资统计',
    brief: `统计**每个部门**的部门名、人数、最高工资、平均工资，**按平均工资从高到低**排序。

> ⚠️ 要求行序。`,
    hint: 'GROUP BY d.deptno, d.dname ORDER BY AVG(e.sal) DESC',
    starter_sql: 'SELECT d.dname, COUNT(*) AS 人数, MAX(e.sal) AS 最高, AVG(e.sal) AS 平均\nFROM dept d\nJOIN emp e ON e.deptno = d.deptno\nGROUP BY d.deptno, d.dname\nORDER BY 平均 DESC;',
    reference_sql: 'SELECT d.dname, COUNT(*), MAX(e.sal), AVG(e.sal) FROM dept d JOIN emp e ON e.deptno = d.deptno GROUP BY d.deptno, d.dname ORDER BY AVG(e.sal) DESC;',
    order_matters: 1,
    difficulty: 3,
  },
  {
    id: 'L33', dataset_id: 'company', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 33,
    title: '比本部门平均工资高的人',
    brief: `查询**工资高于本部门平均工资**的员工姓名、月薪。

注意：不是「高于全公司平均」，是「高于**他自己所在部门**的平均」。
所以子查询必须和外部查询**相关联**（\`d2.deptno = e.deptno\`）——
这叫相关子查询，它会对外层的每一行重新求值。`,
    hint: 'WHERE e.sal > (SELECT AVG(x.sal) FROM emp x WHERE x.deptno = e.deptno)',
    starter_sql: 'SELECT e.ename, e.sal\nFROM emp e\nWHERE e.sal > (\n  SELECT AVG(x.sal) FROM emp x WHERE x.deptno = e.deptno\n);',
    reference_sql: 'SELECT e.ename, e.sal FROM emp e WHERE e.sal > (SELECT AVG(x.sal) FROM emp x WHERE x.deptno = e.deptno);',
    difficulty: 5,
  },
  {
    id: 'L34', dataset_id: 'company', chapter_id: 'ch-sql-null', kid: 'k-null', seq: 34,
    title: 'NULL 不是 0',
    brief: `查询**没有奖金**的员工的姓名和职位。

\`comm\` 为 NULL 表示没有奖金，注意**不是 0**。

> 这个区别在算总数时很要命：
> \`AVG(comm)\` 只对非 NULL 求平均（分母不含没有奖金的人），
> \`AVG(COALESCE(comm, 0))\` 才是「把没奖金的人算成 0」。
> 两个结果差很多，选哪个取决于你要回答什么问题。`,
    hint: 'WHERE comm IS NULL',
    starter_sql: 'SELECT ename, job\nFROM emp\nWHERE comm IS NULL;',
    reference_sql: 'SELECT ename, job FROM emp WHERE comm IS NULL;',
    difficulty: 3,
  },
  {
    id: 'L35', dataset_id: 'company', chapter_id: 'ch-sql-agg', kid: 'k-groupby', seq: 35,
    title: '既算非空平均，也算补零平均',
    brief: `输出**一行两列**：所有员工奖金的「非 NULL 平均」和「补 0 后的平均」。

\`\`\`sql
SELECT AVG(comm), AVG(COALESCE(comm, 0)) FROM emp;
\`\`\`

看看两个数字差多少，想想各自回答的是什么问题。`,
    hint: 'AVG(comm) 和 AVG(COALESCE(comm,0))',
    starter_sql: 'SELECT AVG(comm), AVG(COALESCE(comm, 0))\nFROM emp;',
    reference_sql: 'SELECT AVG(comm), AVG(COALESCE(comm, 0)) FROM emp;',
    difficulty: 3,
  },

  /* ==================== 第八部分：数据更新（写操作） ==================== */
  {
    id: 'L36', dataset_id: 'school', chapter_id: 'ch-sql-dml', kid: 'k-dml', seq: 36,
    title: '插入一条记录',
    brief: `向 \`student\` 表插入一名新学生：
学号 \`2021011\`，姓名 \`钱进\`，性别 \`男\`，年龄 \`20\`，所在系 \`计算机系\`。

插入后**把整张 student 表查出来**验证。

> 本题没有「正确答案的结果集」可比（参考答案是 INSERT），
> 判题器会用自定义校验检查这条记录**是否真的进去了**。`,
    hint: "INSERT INTO student (sno, sname, ssex, sage, sdept) VALUES ('2021011','钱进','男',20,'计算机系');",
    starter_sql: "-- 先插入，再 SELECT 验证\nINSERT INTO student (sno, sname, ssex, sage, sdept)\nVALUES ('2021011', '钱进', '男', 20, '计算机系');\n\nSELECT * FROM student;",
    reference_sql: "INSERT INTO student (sno, sname, ssex, sage, sdept) VALUES ('2021011','钱进','男',20,'计算机系');",
    check_sql: "SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END FROM student WHERE sno = '2021011' AND sname = '钱进' AND sdept = '计算机系'",
    difficulty: 2,
  },
  {
    id: 'L37', dataset_id: 'school', chapter_id: 'ch-sql-dml', kid: 'k-dml', seq: 37,
    title: '更新成绩',
    brief: `把所有 \`grade < 60\` 的成绩**加 5 分**（平时分补偿）。

更新后查询 \`sc\` 表验证。

> ⚠️ \`UPDATE\` 忘记写 \`WHERE\` 会把**整张表**改掉。
> 沙箱里只影响你的临时副本，但这个习惯带到生产库就是事故。`,
    hint: 'UPDATE sc SET grade = grade + 5 WHERE grade < 60;',
    starter_sql: 'UPDATE sc\nSET grade = grade + 5\nWHERE grade < 60;\n\nSELECT * FROM sc;',
    reference_sql: 'UPDATE sc SET grade = grade + 5 WHERE grade < 60;',
    check_sql: "SELECT CASE WHEN MIN(grade) >= 60 OR COUNT(*) = 0 THEN 1 ELSE 0 END FROM sc WHERE grade < 60",
    difficulty: 2,
  },
  {
    id: 'L38', dataset_id: 'shop', chapter_id: 'ch-sql-ddl', kid: 'k-ddl', seq: 38,
    title: '建表 + 插数据',
    brief: `新建一张表 \`review\`（商品评论），包含：

| 列名 | 类型 | 约束 |
|---|---|---|
| id | INTEGER | 主键 |
| pid | INTEGER | 不能为空 |
| uid | INTEGER | 不能为空 |
| stars | INTEGER | 不能为空 |
| content | TEXT | |

然后插入一条评论：id=1, pid=101, uid=1, stars=5, content='手感很好'。

最后 \`SELECT * FROM review\` 验证。`,
    hint: 'CREATE TABLE review (id INTEGER PRIMARY KEY, pid INTEGER NOT NULL, ...);',
    starter_sql: 'CREATE TABLE review (\n  id      INTEGER PRIMARY KEY,\n  pid     INTEGER NOT NULL,\n  uid     INTEGER NOT NULL,\n  stars   INTEGER NOT NULL,\n  content TEXT\n);\n\nINSERT INTO review (id, pid, uid, stars, content)\nVALUES (1, 101, 1, 5, \'手感很好\');\n\nSELECT * FROM review;',
    reference_sql: 'CREATE TABLE review (id INTEGER PRIMARY KEY, pid INTEGER NOT NULL, uid INTEGER NOT NULL, stars INTEGER NOT NULL, content TEXT); INSERT INTO review (id, pid, uid, stars, content) VALUES (1, 101, 1, 5, \'手感很好\');',
    check_sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM review) = 1 AND (SELECT stars FROM review WHERE id = 1) = 5 THEN 1 ELSE 0 END",
    difficulty: 3,
  },
  {
    id: 'L39', dataset_id: 'school', chapter_id: 'ch-sql-dml', kid: 'k-dml', seq: 39,
    title: '删除记录',
    brief: `从 \`sc\` 表中删除**成绩为 NULL** 的选课记录（还没出分的）。

删除后查询 \`sc\` 验证：结果里不应再有 grade 为 NULL 的行。

> 删除前先 \`SELECT\` 一遍确认范围，是生产环境的标准动作。
> 在这个沙箱里养成习惯，比在生产环境里学要便宜得多。`,
    hint: 'DELETE FROM sc WHERE grade IS NULL;',
    starter_sql: '-- 先看一眼要删什么\nSELECT * FROM sc WHERE grade IS NULL;\n\nDELETE FROM sc WHERE grade IS NULL;\n\nSELECT * FROM sc;',
    reference_sql: 'DELETE FROM sc WHERE grade IS NULL;',
    check_sql: 'SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM sc WHERE grade IS NULL',
    difficulty: 2,
  },

  /* ==================== 第九部分：进阶 ==================== */
  {
    id: 'L40', dataset_id: 'shop', chapter_id: 'ch-sql-agg', kid: 'k-window', seq: 40,
    title: '窗口函数：各分类最贵的商品',
    brief: `查询**每个分类里价格最高的商品**的分类名、商品名、价格。

可以用窗口函数：

\`\`\`sql
ROW_NUMBER() OVER (PARTITION BY cid ORDER BY price DESC)
\`\`\`

它会按分类分区、按价格降序给每行编号，编号为 1 的就是最贵的那个。

> 窗口函数和 \`GROUP BY\` 的区别：\`GROUP BY\` 把多行**合并**成一行，
> 窗口函数**保留每一行**，只是给每行附加一个「它在自己组里的排名」。`,
    hint: 'WITH ranked AS (SELECT ..., ROW_NUMBER() OVER (PARTITION BY cid ORDER BY price DESC) rn FROM product) SELECT ... WHERE rn = 1',
    starter_sql: 'WITH ranked AS (\n  SELECT p.pid, p.pname, p.price, p.cid,\n         ROW_NUMBER() OVER (PARTITION BY p.cid ORDER BY p.price DESC) AS rn\n  FROM product p\n)\nSELECT c.cname, r.pname, r.price\nFROM ranked r\nJOIN category c ON c.cid = r.cid\nWHERE r.rn = 1;',
    reference_sql: 'WITH ranked AS (SELECT p.pid, p.pname, p.price, p.cid, ROW_NUMBER() OVER (PARTITION BY p.cid ORDER BY p.price DESC) AS rn FROM product p) SELECT c.cname, r.pname, r.price FROM ranked r JOIN category c ON c.cid = r.cid WHERE r.rn = 1;',
    difficulty: 5,
  },
  {
    id: 'L41', dataset_id: 'company', chapter_id: 'ch-sql-agg', kid: 'k-window', seq: 41,
    title: '部门内薪资排名',
    brief: `查询每个员工的姓名、部门名、月薪，以及**他在本部门内的薪资排名**（从 1 开始，并列同名次）。

用 \`RANK() OVER (PARTITION BY deptno ORDER BY sal DESC)\`。

> \`RANK()\` 遇并列会跳号（1,2,2,4），\`DENSE_RANK()\` 不跳（1,2,2,3），
> \`ROW_NUMBER()\` 直接强行不并列（1,2,3,4）。三者语义不同，选哪个取决于
> 「并列第二之后的下一个是第三还是第四」这个业务问题。`,
    hint: 'RANK() OVER (PARTITION BY e.deptno ORDER BY e.sal DESC)',
    starter_sql: 'SELECT e.ename, d.dname, e.sal,\n       RANK() OVER (PARTITION BY e.deptno ORDER BY e.sal DESC) AS 排名\nFROM emp e\nJOIN dept d ON d.deptno = e.deptno;',
    reference_sql: 'SELECT e.ename, d.dname, e.sal, RANK() OVER (PARTITION BY e.deptno ORDER BY e.sal DESC) FROM emp e JOIN dept d ON d.deptno = e.deptno;',
    difficulty: 5,
  },
  {
    id: 'L42', dataset_id: 'shop', chapter_id: 'ch-sql-sub', kid: 'k-subquery', seq: 42,
    title: '买了超过 2 种商品的订单',
    brief: `找出**包含 3 种及以上不同商品**的订单号，以及商品种类数。

> 想想为什么用 \`COUNT(DISTINCT pid)\` 而不是 \`COUNT(*)\`：
> 这里 \`order_item\` 的主键是 \`(oid, pid)\`，同一个订单里一种商品只会有一行，
> 所以两者结果一样。但如果明细表允许同一商品分多行记录（比如分批发货），
> \`COUNT(*)\` 就会数错。**先想清楚业务约束，再决定用哪个**。`,
    hint: 'GROUP BY oid HAVING COUNT(DISTINCT pid) >= 3',
    starter_sql: 'SELECT oid, COUNT(DISTINCT pid) AS 种类数\nFROM order_item\nGROUP BY oid\nHAVING COUNT(DISTINCT pid) >= 3;',
    reference_sql: 'SELECT oid, COUNT(DISTINCT pid) FROM order_item GROUP BY oid HAVING COUNT(DISTINCT pid) >= 3;',
    difficulty: 3,
  },
  {
    id: 'L43', dataset_id: 'library', chapter_id: 'ch-sql-join', kid: 'k-join', seq: 43,
    title: '每个读者的借阅明细（含未借过的读者）',
    brief: `列出**所有读者**的姓名和他借过的书名。**从没借过书的读者也要出现**，书名显示 NULL。

需要 \`reader LEFT JOIN borrow LEFT JOIN book\` 两级左连接。`,
    hint: 'FROM reader r LEFT JOIN borrow b ON b.rno = r.rno LEFT JOIN book bk ON bk.isbn = b.isbn',
    starter_sql: 'SELECT r.rname, bk.title\nFROM reader r\nLEFT JOIN borrow b ON b.rno = r.rno\nLEFT JOIN book bk ON bk.isbn = b.isbn;',
    reference_sql: 'SELECT r.rname, bk.title FROM reader r LEFT JOIN borrow b ON b.rno = r.rno LEFT JOIN book bk ON bk.isbn = b.isbn;',
    difficulty: 4,
  },
  {
    id: 'L44', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-select', seq: 44,
    title: '综合：成绩单',
    brief: `生成一份成绩单：**学生姓名、课程名、成绩、等级**。

等级规则：
- \`grade >= 90\` → \`优秀\`
- \`grade >= 80\` → \`良好\`
- \`grade >= 70\` → \`中等\`
- \`grade >= 60\` → \`及格\`
- 其余 → \`不及格\`

用 \`CASE WHEN ... THEN ... END\`。只包含有成绩的记录（grade 不为 NULL）。`,
    hint: "CASE WHEN sc.grade >= 90 THEN '优秀' WHEN ... END",
    starter_sql: "SELECT s.sname, c.cname, sc.grade,\n  CASE\n    WHEN sc.grade >= 90 THEN '优秀'\n    WHEN sc.grade >= 80 THEN '良好'\n    WHEN sc.grade >= 70 THEN '中等'\n    WHEN sc.grade >= 60 THEN '及格'\n    ELSE '不及格'\n  END AS 等级\nFROM sc\nJOIN student s ON s.sno = sc.sno\nJOIN course c ON c.cno = sc.cno\nWHERE sc.grade IS NOT NULL;",
    reference_sql: "SELECT s.sname, c.cname, sc.grade, CASE WHEN sc.grade >= 90 THEN '优秀' WHEN sc.grade >= 80 THEN '良好' WHEN sc.grade >= 70 THEN '中等' WHEN sc.grade >= 60 THEN '及格' ELSE '不及格' END FROM sc JOIN student s ON s.sno = sc.sno JOIN course c ON c.cno = sc.cno WHERE sc.grade IS NOT NULL;",
    difficulty: 4,
  },
  {
    id: 'L45', dataset_id: 'school', chapter_id: 'ch-sql-basic', kid: 'k-select', seq: 45,
    title: '综合：系别学情汇总',
    brief: `输出**每个系**的：系名、人数、平均年龄、**选课总人次**。

要求：
- 四个系都要出现，即使某个系还没人选课（选课人次记 0）
- 按人数从多到少排序

> ⚠️ 要求行序。这道题综合了 LEFT JOIN、GROUP BY、COUNT 的 NULL 语义、
> 多级聚合。做出来说明前面几关是真的过了。`,
    hint: 'student LEFT JOIN sc，注意 COUNT(sc.sno) 而不是 COUNT(*)',
    starter_sql: 'SELECT s.sdept,\n       COUNT(DISTINCT s.sno) AS 人数,\n       AVG(s.sage) AS 平均年龄,\n       COUNT(sc.sno) AS 选课人次\nFROM student s\nLEFT JOIN sc ON sc.sno = s.sno\nGROUP BY s.sdept\nORDER BY 人数 DESC;',
    reference_sql: 'SELECT s.sdept, COUNT(DISTINCT s.sno), AVG(s.sage), COUNT(sc.sno) FROM student s LEFT JOIN sc ON sc.sno = s.sno GROUP BY s.sdept ORDER BY COUNT(DISTINCT s.sno) DESC;',
    order_matters: 1,
    difficulty: 5,
  },
];

export default LEVELS;
