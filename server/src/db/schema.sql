-- 库课 · 数据库结构（SQLite）
--
-- ── 设计要点 ──────────────────────────────────────────────────────
-- 1) 内容层（知识树 / 题库 / 数据集 / 关卡）是**全局种子**，owner_id IS NULL 表示内置，
--    指向用户则表示教师自建内容；
-- 2) 学习数据一律按 user_id 隔离，靠外键 ON DELETE CASCADE 级联清理；
-- 3) 聚合表（stats_*）与明细表（attempts）在同一事务内同步写入。
--    明细是权威，聚合表任何时候都能用 rebuildStats(userId) 从明细完整重建；
--    留聚合表的唯一理由是看板页要跑几十次聚合查询，每次全表扫 attempts 是浪费；
-- 4) 时间统一存 ISO8601 文本。'YYYY-MM-DD' 本地日期用于业务口径（打卡 / 连续天数），
--    epoch ms 用于排序与审计，两者并存且互不推导 —— 时区一变，从 ts 反推 date 就会错位。
--
-- ── 为什么题库和关卡分成两张表 ────────────────────────────────────
-- 客观题（选择 / 判断 / 填空）的判分是**字符串比对**，SQL 题的判分是
-- **跑两遍 SQL 比结果集**。后者需要数据集、参考语句、是否计较行序三个额外字段，
-- 而且判分要走 worker 沙箱（异步、有超时、会失败）。
-- 把 SQL 题塞进 questions 表，等于让所有客观题判分路径都背上这三个字段和
-- 一条异步分支 —— 而 90% 的题根本用不上。分开之后，两条判分路径各自独立，
-- 单元测试也能各测各的（tests/unit.mjs 里就是这么分的）。

PRAGMA foreign_keys = ON;

-- ============ 账号 ============
-- role / status / note / student_no / real_name / created_by 都是后加的列，
-- 由 migrate.js 的 ALTER TABLE 补上。schema.sql 全是 CREATE TABLE IF NOT EXISTS ——
-- 老库再跑一遍不会补列，所以「新库建表」和「老库补列」两件事必须都做。
--
-- role 三级：
--   student 学生 —— 只能学自己的
--   teacher 教师 —— 对自己名下学生有完全管理权限（见 lib/perms.js）
--   admin   管理员 —— 系统级，可以管教师
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,          -- scrypt 派生，hex
  password_salt TEXT    NOT NULL,          -- 随机 16 字节，hex
  avatar_hue    INTEGER NOT NULL DEFAULT 0,-- 头像渐变色相，注册时随机分配
  role          TEXT    NOT NULL DEFAULT 'student', -- student | teacher | admin
  status        TEXT    NOT NULL DEFAULT 'active',  -- active | disabled
  note          TEXT    NOT NULL DEFAULT '',        -- 教师/管理员备注
  real_name     TEXT    NOT NULL DEFAULT '',        -- 真实姓名（教师点名用）
  student_no    TEXT    NOT NULL DEFAULT '',        -- 学号 / 工号
  created_by    INTEGER,                            -- 由谁创建（教师建的学生算他的）
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- ⚠️ users(role) / users(created_by) 的索引**故意不写在这里**，它建在 migrate.js 里。
-- 本文件整段 exec 且全是 IF NOT EXISTS：在老库上 users 表已存在 → 上面那条
-- CREATE TABLE 被跳过 → 此刻 role 列还不存在（它靠 migrate() 的 ALTER TABLE 补，
-- 而 migrate() 在本文件之后才跑）。这时候执行 CREATE INDEX ... ON users(role)
-- 会直接抛「no such column: role」，把整个 initSchema 打断，服务根本起不来，
-- 而报错点会指到 index.js 的 initSchema，看着像建表脚本坏了。
-- 所以凡是「依赖新增列」的索引，一律放 migrate()，别放这儿。

-- 会话表：存 token 的 sha256，不存原文 —— 库被拖走也换不出可用的 cookie
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  last_seen_at TEXT    NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============ 用户配置 ============
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme      TEXT    NOT NULL DEFAULT 'deep-space',
  daily_goal INTEGER NOT NULL DEFAULT 20,     -- 每日目标题量
  sql_dialect TEXT   NOT NULL DEFAULT 'sqlite',
  sfx        INTEGER NOT NULL DEFAULT 1,
  editor_font INTEGER NOT NULL DEFAULT 14,    -- SQL 编辑器字号
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============ 班级 ============
-- 班级是「教师 → 学生」这条权限链的载体：教师能管的学生 = 他名下班级的成员
-- ∪ 他亲手创建的账号。没有班级这张表，权限就只能退化成「教师能管所有学生」，
-- 那在多教师部署里是越权。
CREATE TABLE IF NOT EXISTS classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  code        TEXT    NOT NULL UNIQUE,        -- 邀请码，学生凭码入班
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term        TEXT    NOT NULL DEFAULT '',    -- 学期，如 '2026 秋'
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'active', -- active | archived
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);

CREATE TABLE IF NOT EXISTS class_members (
  class_id  INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members(user_id);

-- ============ 知识树（全局种子 / 教师自建）============
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3b82f6',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chapters_cat ON chapters(category_id, sort_order);

-- content 是 Markdown，支持围栏代码块（sql / text）和行内 $...$ 数学
-- （关系代数用得上 σ π ⋈ ρ，而它们没有 Unicode 好写法）。
CREATE TABLE IF NOT EXISTS knowledge (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  chapter_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  sql_demo    TEXT NOT NULL DEFAULT '',      -- 可直接「拿去实训场跑」的示例 SQL
  difficulty  INTEGER NOT NULL DEFAULT 2,    -- 1..5
  importance  INTEGER NOT NULL DEFAULT 2,    -- 1..3，考点重要度
  tags        TEXT NOT NULL DEFAULT '[]',    -- JSON 数组
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = 内置
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chapter ON knowledge(chapter_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_knowledge_cat ON knowledge(category_id);

-- ============ 知识依赖图：有向前置 ============
/* 为什么单独建表，而不是给 knowledge 再加一列：
 *
 *   「A 和 B 相关」是对称的，但「学 A 之前必须先学 B」**有方向**。
 *   方向信息一旦塞进节点的 JSON 数组里（两边互写），就再也分不出谁先谁后，
 *   于是无法回答「这道题做错了，真正没打牢的是哪个前置」——
 *   而那正是错题本从「告诉你哪里弱」升级成「告诉你该回去补哪一环」的全部依据。
 *
 *   方向、类型、强度都是**边**的属性，不是节点的属性。一条边一行，
 *   才能按 from/to 建索引、才能做遍历和环检测。
 *
 * 方向约定（这里最容易搞反，写死一遍）：
 *   from_kid = 前置（先学的）  →  to_kid = 后继（后学的）
 *   找祖先（我该先补什么）走 from_kid；找后代（补这个能救多少）走 to_kid。
 *
 * type 语义：
 *   prereq      硬前置，缺了学不动
 *   related     相关但无先后，遍历时视为**双向**
 *   confusable  易混淆（如 WHERE 与 HAVING），用来出对比辨析题，不参与路径规划
 *
 * strength 只在 prereq 上有意义：hard 缺了直接学不懂，soft 能学但吃力。
 * 这个区分决定回溯时该不该停下来 —— hard 必须补，soft 可以边学边补。
 */
CREATE TABLE IF NOT EXISTS knowledge_edges (
  from_kid TEXT NOT NULL,
  to_kid   TEXT NOT NULL,
  type     TEXT NOT NULL DEFAULT 'prereq',
  strength TEXT NOT NULL DEFAULT 'hard',
  reason   TEXT NOT NULL DEFAULT '',
  source   TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (from_kid, to_kid, type)
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON knowledge_edges(from_kid);
CREATE INDEX IF NOT EXISTS idx_edges_to ON knowledge_edges(to_kid);

-- ============ 题库（客观题）============
-- 六种题型，判分口径见 lib/judge.js：
--   choice 单选 / multi 多选 / judge 判断 / blank 填空 —— 归一化后比对
--   short  简答 —— 不自动判分，教师批改或自评（保留给「简述三级封锁协议」这类）
--   sql    SQL 编写 —— 不在这张表，见 sql_levels
CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  kid         TEXT NOT NULL,                 -- 所属考点
  type        TEXT NOT NULL,                 -- choice | multi | judge | blank | short
  difficulty  INTEGER NOT NULL DEFAULT 2,
  stem        TEXT NOT NULL,
  options     TEXT,                          -- JSON 数组，仅选项型
  answer      TEXT NOT NULL,
  analysis    TEXT NOT NULL DEFAULT '',
  steps       TEXT NOT NULL DEFAULT '[]',    -- JSON 评分点，仅简答题
  source      TEXT NOT NULL DEFAULT '',
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = 内置
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_kid ON questions(kid);
CREATE INDEX IF NOT EXISTS idx_questions_owner ON questions(owner_id);

-- ============ SQL 实训数据集 ============
/* 一个数据集 = 一套 DDL + 一份样本数据。学生在实训场里对着一份数据集写查询。
 *
 * 为什么要 ddl 和 seed 分开存，而不是合成一个 sql 字段：
 *   学生点「查看建表语句」要的是 ddl，「重置数据」要的是 ddl+seed，
 *   而判题 worker 每次起新库也需要两者。合成一个字段就得靠字符串切分去拆，
 *   迟早有人在 seed 里加一行注释把切分点搞坏。
 *
 * tables_meta 是给**前端 schema 浏览器**用的结构化元信息
 * （表名、注释、列名、类型、主键/外键标记、示例值）。
 * 不靠解析 ddl 得到 —— SQL 解析器是个大依赖，而这张表在教师建数据集时
 * 就是结构化录入的，直接存结构化结果即可。
 */
CREATE TABLE IF NOT EXISTS datasets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scenario    TEXT NOT NULL DEFAULT '',      -- 业务背景说明
  ddl         TEXT NOT NULL,
  seed        TEXT NOT NULL DEFAULT '',
  tables_meta TEXT NOT NULL DEFAULT '[]',    -- JSON
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ============ SQL 关卡（闯关式）============
/* 判题方式：把参考 SQL 和用户 SQL 分别在同一份数据集上跑一遍，
 * 比对**结果集**（列名 + 列序 + 数据），而不是比对 SQL 文本。
 * 「select * from student」和「SELECT * FROM student;」是同一个答案，
 * 文本比对会把后者判错 —— 那是在考拼写，不是在考 SQL。
 *
 * order_matters：默认 0（行序不计较）。但题目里出现 ORDER BY / LIMIT 时
 * 行序就是答案的一部分，此时置 1 —— 否则「取工资最高的 3 个人」这道题，
 * 学生不写 ORDER BY 也能过。
 *
 * check_sql：可选的自定义校验（返回 1 行 1 列且为真值即通过）。
 * 给「必须用 GROUP BY 而不是子查询」这类开放性要求留的口子；
 * 为空时走标准的结果集比对。
 *
 * require_columns：列名是否必须与参考答案一致。
 * 默认 0（只警告不判错）—— 因为 `SELECT COUNT(*)` 和 `SELECT COUNT(*) AS 人数`
 * 数据完全一致，把列名当硬条件会大面积误伤。
 * 但题目明确要求「输出列名为 xxx」时必须置 1，否则学生随便起名也能过。
 */
CREATE TABLE IF NOT EXISTS sql_levels (
  id              TEXT PRIMARY KEY,
  dataset_id      TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  chapter_id      TEXT NOT NULL DEFAULT '',
  kid             TEXT NOT NULL DEFAULT '',
  seq             INTEGER NOT NULL DEFAULT 0,   -- 关卡序号，决定解锁顺序
  title           TEXT NOT NULL,
  brief           TEXT NOT NULL DEFAULT '',     -- Markdown 题目说明
  hint            TEXT NOT NULL DEFAULT '',
  starter_sql     TEXT NOT NULL DEFAULT '',     -- 编辑器初始内容
  reference_sql   TEXT NOT NULL,
  check_sql       TEXT NOT NULL DEFAULT '',
  order_matters   INTEGER NOT NULL DEFAULT 0,
  require_columns INTEGER NOT NULL DEFAULT 0,
  difficulty      INTEGER NOT NULL DEFAULT 2,
  owner_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_levels_dataset ON sql_levels(dataset_id, seq);
CREATE INDEX IF NOT EXISTS idx_levels_kid ON sql_levels(kid);

-- ============ 范式实验室题目 ============
/* attrs = 属性全集；fds = 函数依赖集 [{ lhs: ['A'], rhs: ['B'] }]。
 * ask 决定问什么：
 *   closure    求某属性的闭包（target 指定）
 *   keys       求候选键（answer.keys 为候选键数组）
 *   nf         判断范式等级（answer.nf = '1NF'|'2NF'|'3NF'|'BCNF'）
 *   decompose  无损连接分解（answer.schemes 为分解结果）
 * answer 存 JSON，形状随 ask 变化 —— 由 lib/normalize.js 的判分函数统一解释。
 */
CREATE TABLE IF NOT EXISTS normalize_tasks (
  id         TEXT PRIMARY KEY,
  kid        TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  brief      TEXT NOT NULL DEFAULT '',
  attrs      TEXT NOT NULL DEFAULT '[]',
  fds        TEXT NOT NULL DEFAULT '[]',
  ask        TEXT NOT NULL DEFAULT 'keys',
  target     TEXT NOT NULL DEFAULT '',
  answer     TEXT NOT NULL DEFAULT '{}',
  hint       TEXT NOT NULL DEFAULT '',
  difficulty INTEGER NOT NULL DEFAULT 2,
  owner_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_norm_kid ON normalize_tasks(kid);

-- ============ 实验台（索引 / 事务）============
/* kind = 'index' | 'txn'，payload 是 JSON，形状随 kind 变化。
 *
 * 为什么合成一张表而不是 index_scenarios + txn_scenarios 两张：
 *   两者的字段完全不同（索引场景要 dataset_id，事务场景要调度序列），
 *   但它们的**使用方式**完全一样 —— 都是「读一条场景，前端按 kind 分发渲染，
 *   学生提交一个判断，记一次作答」。共用 id 空间让作业布置能统一引用
 *   （assignment_items 只存 kind + ref_id，不用为每种实验台加一列）。
 */
CREATE TABLE IF NOT EXISTS labs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- index | txn
  title       TEXT NOT NULL,
  brief       TEXT NOT NULL DEFAULT '',
  kid         TEXT NOT NULL DEFAULT '',      -- 关联考点，用于统计与错题归类
  payload     TEXT NOT NULL DEFAULT '{}',
  answer      TEXT NOT NULL DEFAULT '{}',
  explanation TEXT NOT NULL DEFAULT '',
  difficulty  INTEGER NOT NULL DEFAULT 2,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_labs_kind ON labs(kind, sort_order);

-- ============ 学习数据（按用户隔离）============

-- 作答明细。权威数据源，永不裁剪。
CREATE TABLE IF NOT EXISTS attempts (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL DEFAULT 'question', -- question | level | normalize | lab
  ref_id      TEXT    NOT NULL,               -- 题 id / 关卡 id / 范式题 id
  kid         TEXT    NOT NULL DEFAULT '',
  answer      TEXT,
  correct     INTEGER NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,     -- 0..100，客观题是 0 或 100
  context     TEXT,                           -- practice | level | review | assignment | lab
  date        TEXT    NOT NULL,               -- 'YYYY-MM-DD' 本地日期
  ts          INTEGER NOT NULL,               -- epoch ms
  duration_ms INTEGER NOT NULL DEFAULT 0,
  /* 错因归类。空串 = 没判过（答对、或还没归类）。
   * 为什么值得单开一列：答错和答错不是一回事 ——
   * 「概念混淆」要回去补前置，「语法记错」只要多写几遍。两者策略相反，
   * 混在一个 correct=0 里就再也分不出来了。 */
  error_type  TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_ts ON attempts(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_user_kid ON attempts(user_id, kid);
CREATE INDEX IF NOT EXISTS idx_attempts_user_ref ON attempts(user_id, kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_date ON attempts(user_id, date);

-- 聚合表：由 attempts 派生，写入时同事务更新，可用 rebuildStats() 完整重建。
CREATE TABLE IF NOT EXISTS stats_node (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kid     TEXT    NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  c       INTEGER NOT NULL DEFAULT 0,
  ts      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kid)
);

CREATE TABLE IF NOT EXISTS stats_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT    NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  c       INTEGER NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- SQL 运行记录。既是「运行历史」功能的数据源，
-- 也是教师看「这个学生到底在写什么」的唯一入口 ——
-- 光看「错了 3 次」看不出他是把 JOIN 写成逗号连接还是漏了 GROUP BY。
CREATE TABLE IF NOT EXISTS sql_runs (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dataset_id TEXT    NOT NULL,
  level_id   TEXT    NOT NULL DEFAULT '',
  sql        TEXT    NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 1,
  ms         INTEGER NOT NULL DEFAULT 0,
  row_count  INTEGER NOT NULL DEFAULT 0,
  error      TEXT    NOT NULL DEFAULT '',
  date       TEXT    NOT NULL,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sqlruns_user ON sql_runs(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sqlruns_level ON sql_runs(user_id, level_id);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kid        TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user_kid ON notes(user_id, kid);

-- 复习卡片（FSRS-6，见 lib/fsrs.js）
CREATE TABLE IF NOT EXISTS cards (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL DEFAULT 'knowledge', -- knowledge | mistake
  knowledge_id TEXT,
  question_id  TEXT,
  due          TEXT    NOT NULL,
  interval     INTEGER NOT NULL DEFAULT 0,
  state        TEXT    NOT NULL DEFAULT 'new',   -- new | learning | review | relearning
  stability    REAL,                             -- 保留率降到 90% 所需天数
  difficulty   REAL,                             -- 这张卡对这个人的难度（1–10）
  reps         INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  last_review  TEXT,
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_user_due ON cards(user_id, due);

CREATE TABLE IF NOT EXISTS checkins (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  minutes    INTEGER NOT NULL DEFAULT 0,
  tasks_done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS game_state (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp         INTEGER NOT NULL DEFAULT 0,
  combo      INTEGER NOT NULL DEFAULT 0,
  best_combo INTEGER NOT NULL DEFAULT 0,
  flags      TEXT    NOT NULL DEFAULT '{}',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT    NOT NULL,
  date           TEXT    NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

-- ============ 作业 ============
/* 作业 = 教师从题库/关卡/范式题里挑一批，设一个截止时间，发给一个班。
 *
 * submissions.detail 存每个小题的作答快照（JSON）。
 * 为什么快照而不是每次实时回查 attempts：
 *   作业批改要的是「交卷那一刻的答案」。学生交卷后继续刷题，attempts 会继续长，
 *   实时回查会让一份已批改的作业在教师端显示成别的分数。
 *   快照是契约，attempts 是流水。 */
CREATE TABLE IF NOT EXISTS assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  brief       TEXT    NOT NULL DEFAULT '',
  due_at      TEXT,                              -- ISO8601，NULL = 不限时
  total_points INTEGER NOT NULL DEFAULT 100,
  status      TEXT    NOT NULL DEFAULT 'published', -- draft | published | closed
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assign_class ON assignments(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assign_teacher ON assignments(teacher_id);

CREATE TABLE IF NOT EXISTS assignment_items (
  id            TEXT    PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL,                -- question | level | normalize | lab
  ref_id        TEXT    NOT NULL,
  points        INTEGER NOT NULL DEFAULT 10,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assign_items ON assignment_items(assignment_id, sort_order);

CREATE TABLE IF NOT EXISTS submissions (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL DEFAULT 'submitted', -- submitted | graded
  score         INTEGER NOT NULL DEFAULT 0,
  detail        TEXT    NOT NULL DEFAULT '[]',   -- JSON：逐题作答快照
  feedback      TEXT    NOT NULL DEFAULT '',     -- 教师评语
  submitted_at  TEXT,
  graded_at     TEXT,
  graded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (assignment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id, submitted_at DESC);

-- ============ 审计 ============
CREATE TABLE IF NOT EXISTS auth_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT,
  user_id    INTEGER,
  event      TEXT NOT NULL,   -- register | login | login_failed | logout | password_change
  ip         TEXT,
  user_agent TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_authlog_at ON auth_log(at DESC);

/* 教师/管理员操作审计。
 *
 * 为什么不复用 auth_log：主体不同。auth_log 记的是「这个人对自己做了什么」
 * （登录、改密），admin_log 记的是「这个人对别人做了什么」（改角色、删号、
 * 重置密码、批改作业）。混在一张表里，「谁被谁改了什么」只能靠 event 名前缀去猜，
 * 审计时最容易看漏 —— 而教师端有删学生的权限，看漏的代价是不可逆的。
 */
CREATE TABLE IF NOT EXISTS admin_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER NOT NULL,
  actor_email  TEXT    NOT NULL,
  target_id    INTEGER,
  target_email TEXT,
  action       TEXT    NOT NULL,   -- student_create | student_update | password_reset |
                                   -- force_logout | student_delete | class_* | assignment_* |
                                   -- content_* | grade_submission
  detail       TEXT    NOT NULL DEFAULT '{}',
  ip           TEXT,
  at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adminlog_at ON admin_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_adminlog_target ON admin_log(target_id);
CREATE INDEX IF NOT EXISTS idx_adminlog_actor ON admin_log(actor_id);

-- ============ 应用级配置（整套服务一份）============
/*
 * 和 user_settings 的区别：那张表是「每个人自己的偏好」（主题、每日目标），
 * 这张是「整套服务一份的配置」—— 目前只有 AI 模型接入。
 *
 * ── 为什么让老师在界面上配，而不是只读 .env ─────────────────────
 * 部署的人（IT / 运维）和使用的人（任课老师）往往不是同一个。
 * 让老师为了换一个模型去改服务器上的环境变量、再重启服务，
 * 是把运维成本转嫁给了教学的人 —— 而这件事本身只是一次表单提交。
 *
 * 尤其是教学场景：这门课可能这个学期用 DeepSeek、下学期换成学校的
 * 私有化部署模型，甚至老师自己有个别家的 key。这些都不该需要重新部署。
 *
 * ── 优先级 ──────────────────────────────────────────────────────
 * 数据库 > 环境变量。原因同上：界面上的设置是「使用者当下想要的」，
 * 环境变量是「部署时的默认值」。前者应该覆盖后者。
 * 界面上清空某项时，自动落回环境变量的值 —— 这样「恢复默认」不用
 * 单独做一个功能。
 *
 * ★ 值里可能有 API Key，所以：
 *   · 读接口一律打码（只回前后各 4 位，中间固定长度）
 *   · 写接口要求教师及以上（学生不该碰这个 —— 那是别人的额度）
 *   · 不写进任何日志
 */
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);

-- ============ 每人的 AI 配置 ============
/*
 * 和 app_settings 的关系是「个人覆盖」：
 *
 *   ┌ 自己配了 key ──────────────→ 用自己配的
 *   ├ 没配，且是老师建的账号 ────→ 用老师配的全局配置
 *   ├ 没配，且是自助注册的 ──────→ 没有可用配置，提示去配
 *   └ 都没有 ───────────────────→ 环境变量兜底
 *
 * ── 为什么要有「自助注册的学生必须自己配」这条 ──────────────────
 * 全局配置用的是老师自己的 API Key，那是老师花钱买的额度。
 * 老师批量建号（created_by 有值）是「我请的学生，额度我出」；
 * 但一个陌生人自己注册进来，不该自动继承老师的额度 ——
 * 那不是功能，是漏算。
 *
 * 区分依据就是 users.created_by：老师建号时写入教师 id，
 * 自助注册时留空。这个字段本来就存在（权限模型在用），不用新增。
 */
CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL DEFAULT '',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
