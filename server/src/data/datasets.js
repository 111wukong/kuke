/* SQL 实训数据集
 *
 * 四个经典教学库。选它们的理由是「学生一眼能看懂业务含义」——
 * 抽象的表名（T1/A/B）会让学生把认知预算花在「这列是什么」上，
 * 而不是花在 SQL 本身。
 *
 *   school   学生选课    —— 最经典的教材库，三张表讲清多对多
 *   shop     电商订单    —— 贴近生活，适合讲 JOIN + 聚合 + 时间函数
 *   library  图书借阅    —— 适合讲日期计算、NULL、外连接
 *   company  员工部门    —— 自带层次（员工→经理）和工资等级，适合讲自连接
 *
 * tables_meta 是给前端 schema 浏览器用的结构化元信息。
 * 为什么不从 ddl 解析出来：那要引入一个 SQL 解析器（大依赖），
 * 而这份元信息在写数据集时本来就是结构化的，直接存即可。
 * 它和 ddl 的一致性由 tests/unit.mjs 里的一条断言守着
 * （逐个比对 meta 里的列名是否真的在 ddl 里出现）。
 */

export const DATASETS = [
  /* ============ 1. 学生选课 ============ */
  {
    id: 'school',
    name: 'student_course',
    title: '学生选课库',
    description: '最经典的教材库：学生、课程、选课三张表，讲清多对多关系。',
    scenario: '某学院的教学管理系统。一个学生可以选多门课，一门课可以被多个学生选，'
      + '选课关系上还带一个成绩。这是「多对多必须拆成三张表」的最直观例子。',
    ddl: `CREATE TABLE student (
  sno       TEXT PRIMARY KEY,      -- 学号
  sname     TEXT NOT NULL,         -- 姓名
  ssex      TEXT,                  -- 性别
  sage      INTEGER,               -- 年龄
  sdept     TEXT                   -- 所在系
);

CREATE TABLE course (
  cno       TEXT PRIMARY KEY,      -- 课程号
  cname     TEXT NOT NULL,         -- 课程名
  cpno      TEXT,                  -- 先修课号（自引用外键）
  ccredit   INTEGER,               -- 学分
  FOREIGN KEY (cpno) REFERENCES course(cno)
);

CREATE TABLE sc (
  sno       TEXT NOT NULL,         -- 学号
  cno       TEXT NOT NULL,         -- 课程号
  grade     INTEGER,               -- 成绩，NULL 表示还没出分
  PRIMARY KEY (sno, cno),
  FOREIGN KEY (sno) REFERENCES student(sno),
  FOREIGN KEY (cno) REFERENCES course(cno)
);`,
    seed: `INSERT INTO student (sno, sname, ssex, sage, sdept) VALUES
('2021001','张伟','男',20,'计算机系'),
('2021002','李娜','女',19,'计算机系'),
('2021003','王强','男',21,'软件工程系'),
('2021004','刘敏','女',20,'软件工程系'),
('2021005','陈杰','男',22,'信息安全系'),
('2021006','杨柳','女',19,'计算机系'),
('2021007','赵鹏','男',20,'软件工程系'),
('2021008','周雪','女',21,'信息安全系'),
('2021009','吴涛','男',20,'计算机系'),
('2021010','郑爽','女',19,'信息安全系'),
-- 这一位没有选任何课。不是凑数：没有它，「找出没选课的学生」这道题
-- 的正确答案就是空集，而空集的题**判不出来也讲不清**（学生看到"正确"却什么都没有）。
-- 反例数据是"找出不存在 X 的记录"这类题目的必需品。
('2021012','孙浩','男',20,'软件工程系');

INSERT INTO course (cno, cname, cpno, ccredit) VALUES
('C01','数据库系统原理',NULL,4),
('C02','数据结构','C01',4),
('C03','操作系统','C02',3),
('C04','计算机网络',NULL,3),
('C05','软件工程','C01',3),
('C06','编译原理','C02',4),
('C07','离散数学',NULL,4),
('C08','数据库应用开发','C01',2);

INSERT INTO sc (sno, cno, grade) VALUES
('2021001','C01',92),('2021001','C02',85),('2021001','C04',78),
('2021002','C01',88),('2021002','C02',91),('2021002','C07',95),
('2021003','C01',76),('2021003','C05',82),('2021003','C04',69),
('2021004','C01',94),('2021004','C05',89),('2021004','C07',88),
('2021005','C04',73),('2021005','C03',66),
('2021006','C01',81),('2021006','C07',90),
('2021007','C02',58),('2021007','C05',75),('2021007','C01',62),
('2021008','C04',87),('2021008','C03',80),
('2021009','C01',69),('2021009','C02',74),('2021009','C08',91),
('2021010','C07',83),('2021010','C01',77);`,
    tables_meta: [
      {
        name: 'student', comment: '学生', rows: 11,
        columns: [
          { name: 'sno', type: 'TEXT', pk: true, comment: '学号' },
          { name: 'sname', type: 'TEXT', comment: '姓名' },
          { name: 'ssex', type: 'TEXT', comment: '性别' },
          { name: 'sage', type: 'INTEGER', comment: '年龄' },
          { name: 'sdept', type: 'TEXT', comment: '所在系' },
        ],
      },
      {
        name: 'course', comment: '课程', rows: 8,
        columns: [
          { name: 'cno', type: 'TEXT', pk: true, comment: '课程号' },
          { name: 'cname', type: 'TEXT', comment: '课程名' },
          { name: 'cpno', type: 'TEXT', fk: 'course(cno)', comment: '先修课程号' },
          { name: 'ccredit', type: 'INTEGER', comment: '学分' },
        ],
      },
      {
        name: 'sc', comment: '选课成绩（学生与课程的多对多关系）', rows: 26,
        columns: [
          { name: 'sno', type: 'TEXT', pk: true, fk: 'student(sno)', comment: '学号' },
          { name: 'cno', type: 'TEXT', pk: true, fk: 'course(cno)', comment: '课程号' },
          { name: 'grade', type: 'INTEGER', comment: '成绩，NULL 表示未出分' },
        ],
      },
    ],
  },

  /* ============ 2. 电商订单 ============ */
  {
    id: 'shop',
    name: 'ecommerce',
    title: '电商订单库',
    description: '贴近生活的电商场景，适合练 JOIN、聚合、日期计算。',
    scenario: '一个线上商城的核心表。顾客下订单，订单里有多个商品明细。'
      + '注意订单总额不在 orders 表里 —— 它是明细算出来的，这正是「不要存冗余派生值」的例子。',
    ddl: `CREATE TABLE category (
  cid        INTEGER PRIMARY KEY,   -- 分类号
  cname      TEXT NOT NULL          -- 分类名
);

CREATE TABLE product (
  pid        INTEGER PRIMARY KEY,   -- 商品号
  pname      TEXT NOT NULL,         -- 商品名
  cid        INTEGER,               -- 分类号
  price      REAL NOT NULL,         -- 单价
  stock      INTEGER DEFAULT 0,     -- 库存
  FOREIGN KEY (cid) REFERENCES category(cid)
);

CREATE TABLE customer (
  uid        INTEGER PRIMARY KEY,   -- 顾客号
  uname      TEXT NOT NULL,         -- 姓名
  city       TEXT,                  -- 城市
  reg_date   TEXT                   -- 注册日期
);

CREATE TABLE orders (
  oid        INTEGER PRIMARY KEY,   -- 订单号
  uid        INTEGER NOT NULL,      -- 下单顾客
  odate      TEXT NOT NULL,         -- 下单日期
  status     TEXT NOT NULL,         -- pending/paid/shipped/done/cancelled
  FOREIGN KEY (uid) REFERENCES customer(uid)
);

CREATE TABLE order_item (
  oid        INTEGER NOT NULL,      -- 订单号
  pid        INTEGER NOT NULL,      -- 商品号
  qty        INTEGER NOT NULL,      -- 数量
  unit_price REAL NOT NULL,         -- 成交单价（下单时快照，不跟商品现价联动）
  PRIMARY KEY (oid, pid),
  FOREIGN KEY (oid) REFERENCES orders(oid),
  FOREIGN KEY (pid) REFERENCES product(pid)
);`,
    seed: `INSERT INTO category (cid, cname) VALUES
(1,'数码'),(2,'图书'),(3,'家居'),(4,'食品');

INSERT INTO product (pid, pname, cid, price, stock) VALUES
(101,'机械键盘',1,399.0,120),
(102,'无线鼠标',1,129.0,340),
(103,'显示器',1,1299.0,45),
(104,'数据库系统概论',2,49.5,600),
(105,'算法导论',2,128.0,210),
(106,'SQL 必知必会',2,39.0,480),
(107,'台灯',3,159.0,90),
(108,'人体工学椅',3,899.0,25),
(109,'咖啡豆',4,88.0,300),
(110,'坚果礼盒',4,139.0,150),
(111,'U 盘 64G',1,59.0,700),
(112,'笔记本支架',3,99.0,180),
-- 这个商品从没被下单过。理由同 school 里的孙浩：
-- 「找出从没被买过的商品」需要一条真的没被买过的记录，否则答案恒为空集。
(113,'显示器支架',3,149.0,60);

INSERT INTO customer (uid, uname, city, reg_date) VALUES
(1,'张伟','成都','2025-03-12'),
(2,'李娜','北京','2025-05-20'),
(3,'王强','上海','2024-11-08'),
(4,'刘敏','成都','2025-08-01'),
(5,'陈杰','深圳','2024-06-15'),
(6,'杨柳','杭州','2025-09-10'),
(7,'赵鹏','成都','2025-01-25'),
(8,'周雪','武汉','2025-07-03'),
(9,'吴涛','北京','2024-12-19'),
(10,'郑爽','上海','2025-10-02');

INSERT INTO orders (oid, uid, odate, status) VALUES
(1001,1,'2025-10-01','done'),
(1002,1,'2025-10-15','done'),
(1003,2,'2025-10-03','done'),
(1004,3,'2025-10-05','shipped'),
(1005,3,'2025-10-20','paid'),
(1006,4,'2025-10-06','done'),
(1007,5,'2025-10-08','cancelled'),
(1008,5,'2025-10-22','paid'),
(1009,6,'2025-10-11','done'),
(1010,7,'2025-10-12','done'),
(1011,8,'2025-10-14','pending'),
(1012,9,'2025-10-18','done'),
(1013,10,'2025-10-25','pending'),
(1014,2,'2025-11-01','done');

INSERT INTO order_item (oid, pid, qty, unit_price) VALUES
(1001,101,1,399.0),(1001,102,2,129.0),
(1002,104,3,49.5),
(1003,103,1,1299.0),(1003,111,2,59.0),
(1004,108,1,899.0),
(1005,109,4,88.0),
(1006,105,1,128.0),(1006,106,2,39.0),
(1007,107,1,159.0),
(1008,101,1,379.0),
(1009,110,2,139.0),(1009,109,1,88.0),
(1010,104,1,49.5),(1010,105,1,128.0),(1010,112,1,99.0),
(1011,102,1,129.0),
(1012,103,1,1199.0),
(1013,111,3,59.0),
(1014,106,1,39.0),(1014,109,2,88.0);`,
    tables_meta: [
      {
        name: 'category', comment: '商品分类', rows: 4,
        columns: [
          { name: 'cid', type: 'INTEGER', pk: true, comment: '分类号' },
          { name: 'cname', type: 'TEXT', comment: '分类名' },
        ],
      },
      {
        name: 'product', comment: '商品', rows: 13,
        columns: [
          { name: 'pid', type: 'INTEGER', pk: true, comment: '商品号' },
          { name: 'pname', type: 'TEXT', comment: '商品名' },
          { name: 'cid', type: 'INTEGER', fk: 'category(cid)', comment: '分类号' },
          { name: 'price', type: 'REAL', comment: '现价' },
          { name: 'stock', type: 'INTEGER', comment: '库存' },
        ],
      },
      {
        name: 'customer', comment: '顾客', rows: 10,
        columns: [
          { name: 'uid', type: 'INTEGER', pk: true, comment: '顾客号' },
          { name: 'uname', type: 'TEXT', comment: '姓名' },
          { name: 'city', type: 'TEXT', comment: '城市' },
          { name: 'reg_date', type: 'TEXT', comment: '注册日期' },
        ],
      },
      {
        name: 'orders', comment: '订单主表', rows: 14,
        columns: [
          { name: 'oid', type: 'INTEGER', pk: true, comment: '订单号' },
          { name: 'uid', type: 'INTEGER', fk: 'customer(uid)', comment: '下单顾客' },
          { name: 'odate', type: 'TEXT', comment: '下单日期' },
          { name: 'status', type: 'TEXT', comment: '订单状态' },
        ],
      },
      {
        name: 'order_item', comment: '订单明细（订单与商品的多对多）', rows: 21,
        columns: [
          { name: 'oid', type: 'INTEGER', pk: true, fk: 'orders(oid)', comment: '订单号' },
          { name: 'pid', type: 'INTEGER', pk: true, fk: 'product(pid)', comment: '商品号' },
          { name: 'qty', type: 'INTEGER', comment: '数量' },
          { name: 'unit_price', type: 'REAL', comment: '成交单价' },
        ],
      },
    ],
  },

  /* ============ 3. 图书借阅 ============ */
  {
    id: 'library',
    name: 'library',
    title: '图书借阅库',
    description: '适合练日期计算、NULL 处理、外连接（找出从没被借过的书）。',
    scenario: '学校图书馆的借阅系统。注意 borrow.return_date 为 NULL 表示「还没还」——'
      + '这是 NULL 语义的最佳教学场景：NULL 不等于任何值，也不能用 = 去比较。',
    ddl: `CREATE TABLE publisher (
  pub_id     INTEGER PRIMARY KEY,   -- 出版社号
  pub_name   TEXT NOT NULL,         -- 出版社名
  city       TEXT                   -- 所在城市
);

CREATE TABLE book (
  isbn       TEXT PRIMARY KEY,      -- ISBN
  title      TEXT NOT NULL,         -- 书名
  author     TEXT,                  -- 作者
  pub_id     INTEGER,               -- 出版社
  category   TEXT,                  -- 分类
  price      REAL,                  -- 定价
  FOREIGN KEY (pub_id) REFERENCES publisher(pub_id)
);

CREATE TABLE reader (
  rno        TEXT PRIMARY KEY,      -- 借书证号
  rname      TEXT NOT NULL,         -- 姓名
  rtype      TEXT NOT NULL,         -- student/teacher
  dept       TEXT,                  -- 院系
  reg_date   TEXT                   -- 办证日期
);

CREATE TABLE borrow (
  id          INTEGER PRIMARY KEY,  -- 借阅流水号
  rno         TEXT NOT NULL,        -- 借书证号
  isbn        TEXT NOT NULL,        -- ISBN
  borrow_date TEXT NOT NULL,        -- 借出日期
  due_date    TEXT NOT NULL,        -- 应还日期
  return_date TEXT,                 -- 实际归还日期，NULL = 尚未归还
  FOREIGN KEY (rno) REFERENCES reader(rno),
  FOREIGN KEY (isbn) REFERENCES book(isbn)
);`,
    seed: `INSERT INTO publisher (pub_id, pub_name, city) VALUES
(1,'高等教育出版社','北京'),
(2,'机械工业出版社','北京'),
(3,'人民邮电出版社','北京'),
(4,'电子工业出版社','北京'),
(5,'四川大学出版社','成都');

INSERT INTO book (isbn, title, author, pub_id, category, price) VALUES
('9787040123456','数据库系统概论','王珊',1,'教材',45.0),
('9787111234567','数据库系统概念','Silberschatz',2,'教材',99.0),
('9787115678901','高性能 MySQL','Baron',3,'技术',128.0),
('9787121345678','SQL 学习指南','Alan Beaulieu',4,'技术',69.0),
('9787040567890','离散数学','屈婉玲',1,'教材',38.0),
('9787111789012','Redis 设计与实现','黄健宏',2,'技术',89.0),
('9787568901234','数据库原理与设计','张三',5,'教材',42.0),
('9787112345678','深入理解计算机系统','Bryant',2,'教材',139.0),
('9787121456789','数据仓库工具箱','Kimball',4,'技术',158.0),
('9787568912345','大数据技术原理','林子雨',5,'教材',56.0);

INSERT INTO reader (rno, rname, rtype, dept, reg_date) VALUES
('R001','张伟','student','计算机系','2024-09-01'),
('R002','李娜','student','计算机系','2024-09-01'),
('R003','王强','student','软件工程系','2024-09-03'),
('R004','刘敏','student','软件工程系','2024-09-03'),
('R005','陈杰','student','信息安全系','2024-09-05'),
('R006','杨柳','student','计算机系','2025-02-20'),
('R007','赵鹏','student','软件工程系','2025-02-20'),
('R008','周雪','student','信息安全系','2025-03-01'),
('T001','孙教授','teacher','计算机系','2020-06-15'),
('T002','钱老师','teacher','软件工程系','2021-09-01');

INSERT INTO borrow (id, rno, isbn, borrow_date, due_date, return_date) VALUES
(1,'R001','9787040123456','2025-09-10','2025-10-10','2025-10-02'),
(2,'R001','9787111234567','2025-10-15','2025-11-14',NULL),
(3,'R002','9787040123456','2025-09-12','2025-10-12','2025-10-11'),
(4,'R003','9787115678901','2025-09-20','2025-10-20','2025-11-05'),
(5,'R003','9787121345678','2025-10-01','2025-10-31',NULL),
(6,'R004','9787040567890','2025-10-05','2025-11-04','2025-10-28'),
(7,'R005','9787111234567','2025-10-08','2025-11-07',NULL),
(8,'R006','9787040123456','2025-10-10','2025-11-09','2025-11-01'),
(9,'R007','9787112345678','2025-10-12','2025-11-11',NULL),
(10,'R007','9787121345678','2025-10-20','2025-11-19',NULL),
(11,'R008','9787121456789','2025-10-22','2025-11-21',NULL),
(12,'T001','9787115678901','2025-09-01','2025-12-01','2025-10-20'),
(13,'T001','9787568901234','2025-10-25','2026-01-25',NULL),
(14,'T002','9787568912345','2025-09-15','2025-12-15','2025-11-02'),
(15,'R002','9787040567890','2025-10-30','2025-11-29',NULL),
(16,'R001','9787568912345','2025-11-02','2025-12-02',NULL);`,
    tables_meta: [
      {
        name: 'publisher', comment: '出版社', rows: 5,
        columns: [
          { name: 'pub_id', type: 'INTEGER', pk: true, comment: '出版社号' },
          { name: 'pub_name', type: 'TEXT', comment: '出版社名' },
          { name: 'city', type: 'TEXT', comment: '所在城市' },
        ],
      },
      {
        name: 'book', comment: '图书', rows: 10,
        columns: [
          { name: 'isbn', type: 'TEXT', pk: true, comment: 'ISBN' },
          { name: 'title', type: 'TEXT', comment: '书名' },
          { name: 'author', type: 'TEXT', comment: '作者' },
          { name: 'pub_id', type: 'INTEGER', fk: 'publisher(pub_id)', comment: '出版社号' },
          { name: 'category', type: 'TEXT', comment: '分类' },
          { name: 'price', type: 'REAL', comment: '定价' },
        ],
      },
      {
        name: 'reader', comment: '读者', rows: 10,
        columns: [
          { name: 'rno', type: 'TEXT', pk: true, comment: '借书证号' },
          { name: 'rname', type: 'TEXT', comment: '姓名' },
          { name: 'rtype', type: 'TEXT', comment: '读者类型' },
          { name: 'dept', type: 'TEXT', comment: '院系' },
          { name: 'reg_date', type: 'TEXT', comment: '办证日期' },
        ],
      },
      {
        name: 'borrow', comment: '借阅流水（return_date 为 NULL 表示未归还）', rows: 16,
        columns: [
          { name: 'id', type: 'INTEGER', pk: true, comment: '流水号' },
          { name: 'rno', type: 'TEXT', fk: 'reader(rno)', comment: '借书证号' },
          { name: 'isbn', type: 'TEXT', fk: 'book(isbn)', comment: 'ISBN' },
          { name: 'borrow_date', type: 'TEXT', comment: '借出日期' },
          { name: 'due_date', type: 'TEXT', comment: '应还日期' },
          { name: 'return_date', type: 'TEXT', comment: '实际归还日期，NULL=未还' },
        ],
      },
    ],
  },

  /* ============ 4. 员工部门 ============ */
  {
    id: 'company',
    name: 'company',
    title: '员工部门库',
    description: '自带层次结构（员工→经理）和工资等级，适合练自连接、区间连接。',
    scenario: '公司人事系统。emp 表里 mgr 指向同一张表的 empno —— 这是自连接的经典场景'
      + '（「找出每个员工的经理姓名」）。salgrade 是区间表，连接条件不是等值而是 BETWEEN，'
      + '用来讲「连接不一定是 =」。',
    ddl: `CREATE TABLE dept (
  deptno     INTEGER PRIMARY KEY,   -- 部门号
  dname      TEXT NOT NULL,         -- 部门名
  loc        TEXT                   -- 所在地
);

CREATE TABLE emp (
  empno      INTEGER PRIMARY KEY,   -- 员工号
  ename      TEXT NOT NULL,         -- 姓名
  job        TEXT NOT NULL,         -- 职位
  mgr        INTEGER,               -- 上级员工号（自引用，NULL = 没有上级）
  hiredate   TEXT NOT NULL,         -- 入职日期
  sal        REAL NOT NULL,         -- 月薪
  comm       REAL,                  -- 奖金（NULL = 没有奖金，不是 0）
  deptno     INTEGER,               -- 部门号
  FOREIGN KEY (mgr) REFERENCES emp(empno),
  FOREIGN KEY (deptno) REFERENCES dept(deptno)
);

CREATE TABLE salgrade (
  grade      INTEGER PRIMARY KEY,   -- 工资等级
  losal      REAL NOT NULL,         -- 该等级下限
  hisal      REAL NOT NULL          -- 该等级上限
);`,
    seed: `INSERT INTO dept (deptno, dname, loc) VALUES
(10,'研发部','成都'),
(20,'市场部','北京'),
(30,'财务部','成都'),
(40,'运维部','深圳'),
(50,'人事部','北京');

INSERT INTO emp (empno, ename, job, mgr, hiredate, sal, comm, deptno) VALUES
(1001,'孙建国','总经理',NULL,'2018-03-01',32000,NULL,10),
(1002,'李伟','研发经理',1001,'2019-06-15',21000,3000,10),
(1003,'王芳','研发工程师',1002,'2021-07-01',15000,NULL,10),
(1004,'张敏','研发工程师',1002,'2022-09-10',13800,NULL,10),
(1005,'刘洋','测试工程师',1002,'2023-02-20',11500,1200,10),
(1006,'陈静','市场经理',1001,'2020-01-08',19500,5000,20),
(1007,'赵磊','市场专员',1006,'2022-05-16',9800,2500,20),
(1008,'周涛','市场专员',1006,'2023-08-01',9200,1800,20),
(1009,'吴丽','财务经理',1001,'2019-11-25',20000,NULL,30),
(1010,'郑强','会计',1009,'2021-04-12',10800,NULL,30),
(1011,'冯雪','出纳',1009,'2023-06-05',8600,NULL,30),
(1012,'蒋鹏','运维经理',1001,'2020-08-18',18800,2200,40),
(1013,'沈磊','运维工程师',1012,'2022-11-07',12600,NULL,40),
(1014,'韩梅','人事专员',1001,'2023-03-15',9400,NULL,50);

INSERT INTO salgrade (grade, losal, hisal) VALUES
(1,0,9999),
(2,10000,14999),
(3,15000,19999),
(4,20000,29999),
(5,30000,99999);`,
    tables_meta: [
      {
        name: 'dept', comment: '部门', rows: 5,
        columns: [
          { name: 'deptno', type: 'INTEGER', pk: true, comment: '部门号' },
          { name: 'dname', type: 'TEXT', comment: '部门名' },
          { name: 'loc', type: 'TEXT', comment: '所在地' },
        ],
      },
      {
        name: 'emp', comment: '员工（mgr 自引用本表，NULL=最高层）', rows: 14,
        columns: [
          { name: 'empno', type: 'INTEGER', pk: true, comment: '员工号' },
          { name: 'ename', type: 'TEXT', comment: '姓名' },
          { name: 'job', type: 'TEXT', comment: '职位' },
          { name: 'mgr', type: 'INTEGER', fk: 'emp(empno)', comment: '上级员工号' },
          { name: 'hiredate', type: 'TEXT', comment: '入职日期' },
          { name: 'sal', type: 'REAL', comment: '月薪' },
          { name: 'comm', type: 'REAL', comment: '奖金，NULL=无奖金' },
          { name: 'deptno', type: 'INTEGER', fk: 'dept(deptno)', comment: '部门号' },
        ],
      },
      {
        name: 'salgrade', comment: '工资等级区间表', rows: 5,
        columns: [
          { name: 'grade', type: 'INTEGER', pk: true, comment: '等级' },
          { name: 'losal', type: 'REAL', comment: '下限' },
          { name: 'hisal', type: 'REAL', comment: '上限' },
        ],
      },
    ],
  },
];

export default DATASETS;
