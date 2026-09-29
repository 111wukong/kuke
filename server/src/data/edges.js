/* 知识依赖边
 *
 * 方向约定（写死一遍，最容易搞反）：
 *   from_kid = 前置（先学的）  →  to_kid = 后继（后学的）
 *
 * type 语义：
 *   prereq      硬前置，缺了学不动（参与拓扑排序和根因回溯）
 *   related     相关但无先后，遍历时视为双向（不参与路径规划）
 *   confusable  易混淆，用来出对比辨析题（不参与路径规划）
 *
 * strength 只在 prereq 上有意义：
 *   hard  缺了直接学不懂 —— 根因回溯必须停下来补
 *   soft  缺了能学但吃力 —— 可以边学边补
 *
 * ── 这张图的质量直接决定诊断的质量 ──────────────────────────────
 * 边连得太粗（什么都连），根因会一路回溯到最顶上，给出的建议没有可操作性；
 * 连得太细（只连最直接的），症状和病灶会脱节，回溯不到真正的断点。
 * 判断标准：**"学 A 之前不学 B 会不会真的学不懂"** ——
 * 会，才是 hard prereq；只是"有点吃力"，是 soft；只是"常一起出现"，是 related。
 *
 * 全图由 tests/content.mjs 做环检测和悬空边检查，有环直接失败。
 */

export const EDGES = [
  /* ---------- 基础理论内部 ---------- */
  { from_kid: 'k-3level', to_kid: 'k-dbms', type: 'prereq', strength: 'soft', reason: '三级模式是 DBMS 体系结构的展开，先知道 DBMS 是什么再看它的结构' },
  { from_kid: 'k-dbms', to_kid: 'k-datamodel', type: 'prereq', strength: 'soft', reason: '数据模型是 DBMS 内部组织数据的方式' },
  { from_kid: 'k-datamodel', to_kid: 'k-rel-concept', type: 'prereq', strength: 'hard', reason: '关系模型是逻辑模型的一种，不先理解"模型分层"就无法理解为什么要有术语体系' },
  { from_kid: 'k-rel-concept', to_kid: 'k-integrity', type: 'prereq', strength: 'hard', reason: '完整性约束是建立在主码/外码之上的，先知道码是什么才谈得上约束' },
  { from_kid: 'k-rel-concept', to_kid: 'k-algebra-basic', type: 'prereq', strength: 'hard', reason: '关系代数以关系、元组、属性为操作对象' },
  { from_kid: 'k-algebra-basic', to_kid: 'k-algebra-join', type: 'prereq', strength: 'hard', reason: '连接是由笛卡尔积 + 选择导出的，不先掌握这两个基本运算就理解不了连接的定义' },
  { from_kid: 'k-rel-concept', to_kid: 'k-er', type: 'prereq', strength: 'soft', reason: 'E-R 模型转关系表时要落到码和属性上' },

  /* ---------- 基础 → SQL ---------- */
  { from_kid: 'k-rel-concept', to_kid: 'k-select', type: 'prereq', strength: 'hard', reason: 'SQL 是关系模型的操作语言，表/行/列的概念是它的全部基础' },
  { from_kid: 'k-algebra-basic', to_kid: 'k-select', type: 'prereq', strength: 'soft', reason: 'SELECT 对应投影，WHERE 对应选择 —— 知道这个对应关系能少背很多规则' },
  { from_kid: 'k-algebra-join', to_kid: 'k-join', type: 'prereq', strength: 'soft', reason: 'SQL 的 JOIN 是关系代数连接运算的直接实现' },
  { from_kid: 'k-integrity', to_kid: 'k-ddl', type: 'prereq', strength: 'hard', reason: '建表语句的主体就是声明约束，不知道三类完整性就写不出正确的 DDL' },

  /* ---------- SQL 单表查询链 ---------- */
  { from_kid: 'k-select', to_kid: 'k-where', type: 'prereq', strength: 'hard', reason: '条件筛选是在会写 SELECT 之后的第一步' },
  { from_kid: 'k-where', to_kid: 'k-orderby', type: 'prereq', strength: 'soft', reason: '排序通常是配合筛选使用的' },
  { from_kid: 'k-where', to_kid: 'k-null', type: 'prereq', strength: 'hard', reason: 'NULL 的坑全在 WHERE 条件里，不先会写条件就理解不了三值逻辑的危害' },
  { from_kid: 'k-select', to_kid: 'k-ddl', type: 'prereq', strength: 'soft', reason: '要先能查才知道自己建的表对不对' },
  { from_kid: 'k-ddl', to_kid: 'k-dml', type: 'prereq', strength: 'hard', reason: '先有表才能插数据' },
  { from_kid: 'k-dml', to_kid: 'k-view', type: 'prereq', strength: 'soft', reason: '可更新视图涉及对基表的写操作' },

  /* ---------- SQL 聚合链 ---------- */
  { from_kid: 'k-select', to_kid: 'k-aggregate', type: 'prereq', strength: 'hard', reason: '聚合函数是 SELECT 列表里的表达式' },
  { from_kid: 'k-aggregate', to_kid: 'k-groupby', type: 'prereq', strength: 'hard', reason: '分组的意义就是"分组之后对每组做聚合"，不先理解聚合函数就不知道分组为了什么' },
  { from_kid: 'k-groupby', to_kid: 'k-having', type: 'prereq', strength: 'hard', reason: 'HAVING 筛的是"组"，没有分组就没有组可筛' },
  { from_kid: 'k-groupby', to_kid: 'k-window', type: 'prereq', strength: 'soft', reason: '窗口函数的 PARTITION BY 和 GROUP BY 语义相近，先懂分组更容易理解分区' },
  { from_kid: 'k-aggregate', to_kid: 'k-window', type: 'prereq', strength: 'soft', reason: '窗口函数里最常用的就是聚合函数加 OVER' },

  /* ---------- SQL 多表链 ---------- */
  { from_kid: 'k-join', to_kid: 'k-outer-join', type: 'prereq', strength: 'hard', reason: '外连接是内连接的扩展，不先掌握内连接就分不清 ON 和 WHERE 的差别' },
  { from_kid: 'k-join', to_kid: 'k-selfjoin', type: 'prereq', strength: 'hard', reason: '自连接只是"连接同一张表"，本质还是连接' },
  { from_kid: 'k-null', to_kid: 'k-outer-join', type: 'prereq', strength: 'hard', reason: '外连接补出来的就是 NULL，不理解 NULL 语义会把外连接写成内连接还不自知' },
  { from_kid: 'k-join', to_kid: 'k-subquery', type: 'prereq', strength: 'soft', reason: '很多子查询可以改写成连接，反之亦然 —— 但子查询的相关性概念需要先理解连接' },
  { from_kid: 'k-select', to_kid: 'k-subquery', type: 'prereq', strength: 'hard', reason: '子查询本身就是一个 SELECT' },
  { from_kid: 'k-subquery', to_kid: 'k-exists', type: 'prereq', strength: 'hard', reason: 'EXISTS 是子查询的一种谓词形式，先会写子查询才谈得上选哪种谓词' },
  { from_kid: 'k-null', to_kid: 'k-exists', type: 'prereq', strength: 'hard', reason: 'NOT IN 的 NULL 陷阱是"为什么该用 EXISTS"的全部理由' },

  /* ---------- SQL → 设计 ---------- */
  { from_kid: 'k-dml', to_kid: 'k-fd', type: 'prereq', strength: 'soft', reason: '函数依赖是从"这列改了那列要不要跟着改"的实际问题里抽象出来的' },

  /* ---------- 数据库设计链 ---------- */
  { from_kid: 'k-er', to_kid: 'k-fd', type: 'prereq', strength: 'soft', reason: 'E-R 图转表时哪些属性该放一起，正是函数依赖要回答的问题' },
  { from_kid: 'k-fd', to_kid: 'k-key', type: 'prereq', strength: 'hard', reason: '候选键就是"极小超键"，是属性闭包的直接应用' },
  { from_kid: 'k-key', to_kid: 'k-nf', type: 'prereq', strength: 'hard', reason: '范式判定的全部条件都建立在"候选键"和"主属性"之上，不知道候选键就无从判定' },
  { from_kid: 'k-fd', to_kid: 'k-nf', type: 'prereq', strength: 'hard', reason: '部分依赖和传递依赖都是函数依赖的特殊形态' },
  { from_kid: 'k-nf', to_kid: 'k-decomp', type: 'prereq', strength: 'hard', reason: '分解的目的是消除范式违规，先知道违规在哪才知道往哪拆' },

  /* ---------- 存储与索引链 ---------- */
  { from_kid: 'k-storage', to_kid: 'k-bplus', type: 'prereq', strength: 'hard', reason: 'B+ 树的一切设计都是为了减少"页"的磁盘 I/O，不知道页是什么就看不懂它为什么长这样' },
  { from_kid: 'k-bplus', to_kid: 'k-index-use', type: 'prereq', strength: 'hard', reason: '"索引为什么会失效"要回到 B+ 树的有序性上解释' },
  { from_kid: 'k-bplus', to_kid: 'k-hash', type: 'prereq', strength: 'soft', reason: '两种索引结构的对比才是理解各自的钥匙' },
  { from_kid: 'k-storage', to_kid: 'k-query-process', type: 'prereq', strength: 'soft', reason: '物理优化的代价模型建立在存储层之上' },
  { from_kid: 'k-index-use', to_kid: 'k-plan', type: 'prereq', strength: 'hard', reason: '读执行计划的主要目的就是看"索引有没有用上"' },
  { from_kid: 'k-bplus', to_kid: 'k-acid', type: 'prereq', strength: 'soft', reason: 'D（持久性）的实现要理解数据在磁盘上的组织方式' },

  /* ---------- 查询优化链 ---------- */
  { from_kid: 'k-query-process', to_kid: 'k-algebra-opt', type: 'prereq', strength: 'hard', reason: '代数优化是查询处理流程里的第三步，不知道流程就不知道它在哪一环' },
  { from_kid: 'k-algebra-opt', to_kid: 'k-plan', type: 'prereq', strength: 'hard', reason: '执行计划是代数优化 + 物理优化的产物' },
  { from_kid: 'k-join', to_kid: 'k-algebra-opt', type: 'prereq', strength: 'soft', reason: '代数优化的核心就是连接顺序的重排' },
  { from_kid: 'k-algebra-basic', to_kid: 'k-algebra-opt', type: 'prereq', strength: 'hard', reason: '代数优化是在关系代数表达式上做等价变换，先得能读懂那个表达式' },

  /* ---------- 事务与并发链 ---------- */
  { from_kid: 'k-acid', to_kid: 'k-isolation', type: 'prereq', strength: 'hard', reason: '隔离级别是 I（隔离性）这一条的具体实现档位' },
  { from_kid: 'k-isolation', to_kid: 'k-lock', type: 'prereq', strength: 'hard', reason: '封锁是达到各级隔离级别的手段，先知道要防什么才知道为什么要加锁' },
  { from_kid: 'k-lock', to_kid: 'k-serializable', type: 'prereq', strength: 'hard', reason: '可串行化调度的判定要基于"冲突操作"，而冲突的定义离不开读写锁的语义' },
  { from_kid: 'k-lock', to_kid: 'k-deadlock', type: 'prereq', strength: 'hard', reason: '死锁是加锁的直接副作用，没有锁就没有死锁' },
  { from_kid: 'k-acid', to_kid: 'k-wal', type: 'prereq', strength: 'hard', reason: 'WAL 就是 A（原子性）和 D（持久性）的实现机制' },

  /* ---------- 恢复链 ---------- */
  { from_kid: 'k-wal', to_kid: 'k-failure', type: 'prereq', strength: 'hard', reason: '故障恢复的手段（Undo/Redo）全部建立在日志之上' },
  { from_kid: 'k-ddl', to_kid: 'k-security', type: 'prereq', strength: 'soft', reason: 'GRANT/REVOKE 属于 DDL 家族' },
  { from_kid: 'k-view', to_kid: 'k-security', type: 'prereq', strength: 'soft', reason: '视图是行级权限隔离的实现手段' },

  /* ==================== 相关（无先后，双向） ==================== */
  { from_kid: 'k-nf', to_kid: 'k-decomp', type: 'related', strength: 'soft', reason: '范式与分解是同一件事的两面：判定问题和解决手段' },
  { from_kid: 'k-subquery', to_kid: 'k-window', type: 'related', strength: 'soft', reason: '"分组取 Top-N"两者都能做，性能差别很大，放在一起对比才讲得清' },
  { from_kid: 'k-join', to_kid: 'k-index-use', type: 'related', strength: 'soft', reason: '连接列是最该建索引的地方' },
  { from_kid: 'k-isolation', to_kid: 'k-serializable', type: 'related', strength: 'soft', reason: '隔离级别是"工程上的近似"，可串行化是"理论上的标准"，两者要对照理解' },
  { from_kid: 'k-algebra-opt', to_kid: 'k-index-use', type: 'related', strength: 'soft', reason: '优化的两个层面：改写成更优的表达式，和让它用上索引' },

  /* ==================== 易混淆（出对比辨析题用） ==================== */
  { from_kid: 'k-where', to_kid: 'k-having', type: 'confusable', strength: 'soft', reason: 'WHERE 筛行、HAVING 筛组，执行时机不同 —— 最高频的混淆点' },
  { from_kid: 'k-join', to_kid: 'k-outer-join', type: 'confusable', strength: 'soft', reason: 'ON 和 WHERE 在外连接里不等价，写错一个就静默退化成内连接' },
  { from_kid: 'k-groupby', to_kid: 'k-window', type: 'confusable', strength: 'soft', reason: '分组合并行，窗口保留行 —— 语义差别很大但语法长得像' },
  { from_kid: 'k-subquery', to_kid: 'k-exists', type: 'confusable', strength: 'soft', reason: 'IN 和 EXISTS 在 NOT 下的语义差异（NULL 陷阱）' },
  { from_kid: 'k-bplus', to_kid: 'k-hash', type: 'confusable', strength: 'soft', reason: '哈希索引等值快但不支持范围，B+ 树两者都能做但常数更大' },
  { from_kid: 'k-isolation', to_kid: 'k-lock', type: 'confusable', strength: 'soft', reason: '隔离级别是"目标"，封锁协议是"手段"，考试常问某级别用几级封锁协议实现' },
  { from_kid: 'k-nf', to_kid: 'k-decomp', type: 'confusable', strength: 'soft', reason: '3NF 和 BCNF 的取舍：BCNF 无损但可能不保持依赖' },
  { from_kid: 'k-rel-concept', to_kid: 'k-algebra-basic', type: 'confusable', strength: 'soft', reason: '选择（σ）挑行、投影（π）挑列，符号和名字都容易记反' },
  { from_kid: 'k-integrity', to_kid: 'k-ddl', type: 'confusable', strength: 'soft', reason: '实体完整性 vs 参照完整性，以及三个级联选项的选择' },
  { from_kid: 'k-select', to_kid: 'k-ddl', type: 'confusable', strength: 'soft', reason: 'DELETE 与 TRUNCATE、DROP 的区别：能不能回滚' },
];

export default EDGES;
