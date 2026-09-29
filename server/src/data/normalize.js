/* 范式实验室题目
 *
 * 四种问法（ask）：
 *   closure    求指定属性的闭包      answer 由算法推导，不用手写
 *   keys       求全部候选键          answer 由算法推导
 *   nf         判断最高范式等级      answer 由算法推导
 *   decompose  给出无损分解          answer.schemes 是**一个示例解**，不是唯一解
 *
 * ── 关于 decompose 的判分（这一点和别的题型完全不同）─────────────
 * 分解题的正确答案**通常不唯一** —— 因为最小覆盖不唯一，
 * 由它合成出的 3NF 分解也就不唯一。拿一个参考答案做字符串比对，
 * 会把完全正确的分解判错，而学生根本无从察觉（他会以为自己错了）。
 *
 * 所以判分走 lib/normalize.js 的 judgeNormalize：验**性质**而不是验答案 ——
 *   ① 覆盖全部属性 ② 无损连接 ③（3NF 时）保持函数依赖 ④ 每个关系达到目标范式
 * answer.schemes 在这里的作用退化成"给前端展示一个可行解"，
 * 判分逻辑根本不读它。tests/content.mjs 会用它验证"至少存在一个通过的解"。
 */

export const NORMALIZE_TASKS = [
  /* ==================== 属性闭包 ==================== */
  {
    id: 'N01', kid: 'k-fd', ask: 'closure', target: 'A', difficulty: 2,
    title: '求属性闭包（小心只扫一遍的错）',
    brief: `设关系模式 $R(A, B, C, D)$，函数依赖集

$$F = \\{A \\to B,\\; B \\to C\\}$$

求 $A^+$（属性 A 的闭包）。

> ⚠️ 这一题是专门用来暴露"只扫一遍"这个错误的。
> 请想清楚：第一轮能推出什么？第二轮呢？`,
    attrs: ['A', 'B', 'C', 'D'],
    fds: [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['B'], rhs: ['C'] }],
    hint: '第一轮 A→B 得到 {A,B}。此时 B→C 的条件刚被满足 —— 还需要第二轮。',
  },
  {
    id: 'N02', kid: 'k-fd', ask: 'closure', target: ['A', 'B'], difficulty: 3,
    title: '多属性起点的闭包',
    brief: `设 $R(A, B, C, D, E)$，函数依赖集

$$F = \\{AB \\to C,\\; C \\to D,\\; D \\to E\\}$$

求 $(AB)^+$。`,
    attrs: ['A', 'B', 'C', 'D', 'E'],
    fds: [
      { lhs: ['A', 'B'], rhs: ['C'] },
      { lhs: ['C'], rhs: ['D'] },
      { lhs: ['D'], rhs: ['E'] },
    ],
    hint: 'AB → C，然后 C → D，然后 D → E。一路推下去。',
  },
  {
    id: 'N03', kid: 'k-fd', ask: 'closure', target: 'A', difficulty: 4,
    title: '需要绕一圈才能推全的闭包',
    brief: `设 $R(A, B, C, D, E, F)$，函数依赖集

$$F = \\{A \\to BC,\\; CD \\to E,\\; B \\to D,\\; E \\to A\\}$$

求 $A^+$。

> 注意 $E \\to A$ 这条依赖 —— 它看起来"没用"，因为 A 本来就在结果里。
> 但它会让你的推导多绕一圈。`,
    attrs: ['A', 'B', 'C', 'D', 'E', 'F'],
    fds: [
      { lhs: ['A'], rhs: ['B', 'C'] },
      { lhs: ['C', 'D'], rhs: ['E'] },
      { lhs: ['B'], rhs: ['D'] },
      { lhs: ['E'], rhs: ['A'] },
    ],
    hint: 'A→BC 得到 B、C；B→D 得到 D；此时 C 和 D 都在，CD→E 得到 E。F 推不出来。',
  },

  /* ==================== 候选键 ==================== */
  {
    id: 'N04', kid: 'k-key', ask: 'keys', difficulty: 3,
    title: '只有一个候选键的情况',
    brief: `设 $R(A, B, C, D)$，函数依赖集

$$F = \\{A \\to B,\\; B \\to C,\\; A \\to D\\}$$

求 $R$ 的**全部候选键**。

> 先想：哪些属性从不出现在依赖的右部？它们必然在每个候选键里。`,
    attrs: ['A', 'B', 'C', 'D'],
    fds: [
      { lhs: ['A'], rhs: ['B'] },
      { lhs: ['B'], rhs: ['C'] },
      { lhs: ['A'], rhs: ['D'] },
    ],
    hint: 'A 从不出现在右部，所以必在键中。算一下 A⁺ 看是不是全集。',
  },
  {
    id: 'N05', kid: 'k-key', ask: 'keys', difficulty: 4,
    title: '三个候选键',
    brief: `设 $R(A, B, C, D)$，函数依赖集

$$F = \\{AB \\to C,\\; C \\to D,\\; D \\to A\\}$$

求 $R$ 的**全部候选键**。

> 这一题有三个候选键。注意不要漏，也不要多 ——
> 「极小性」是关键：一个包含候选键的属性组是超键，**不是**候选键。`,
    attrs: ['A', 'B', 'C', 'D'],
    fds: [
      { lhs: ['A', 'B'], rhs: ['C'] },
      { lhs: ['C'], rhs: ['D'] },
      { lhs: ['D'], rhs: ['A'] },
    ],
    hint: 'B 从不出现在右部，必在键中。然后试 AB、BC、BD 的闭包。',
  },
  {
    id: 'N06', kid: 'k-key', ask: 'keys', difficulty: 3,
    title: '两个属性组成的唯一键',
    brief: `设 $R(A, B, C, D, E)$，函数依赖集

$$F = \\{AB \\to C,\\; C \\to D,\\; D \\to E\\}$$

求 $R$ 的全部候选键。`,
    attrs: ['A', 'B', 'C', 'D', 'E'],
    fds: [
      { lhs: ['A', 'B'], rhs: ['C'] },
      { lhs: ['C'], rhs: ['D'] },
      { lhs: ['D'], rhs: ['E'] },
    ],
    hint: 'A 和 B 都不在右部，所以它们必在键中。',
  },

  /* ==================== 范式判定 ==================== */
  {
    id: 'N07', kid: 'k-nf', ask: 'nf', difficulty: 4,
    title: '部分依赖：只到 1NF',
    brief: `设 $R(\\underline{Sno}, Sname, \\underline{Cno}, Grade)$，
候选键是 $(Sno, Cno)$，函数依赖集

$$F = \\{Sno \\to Sname,\\; SnoCno \\to Grade\\}$$

$R$ 最高达到第几范式？

> 提示：$Sname$ 是主属性还是非主属性？它依赖于候选键的**全部**还是**一部分**？`,
    attrs: ['Sno', 'Sname', 'Cno', 'Grade'],
    fds: [
      { lhs: ['Sno'], rhs: ['Sname'] },
      { lhs: ['Sno', 'Cno'], rhs: ['Grade'] },
    ],
    hint: 'Sno → Sname，而 Sno 只是候选键 (Sno,Cno) 的一部分。',
  },
  {
    id: 'N08', kid: 'k-nf', ask: 'nf', difficulty: 4,
    title: '传递依赖：到 2NF 为止',
    brief: `设 $R(\\underline{Sno}, Sname, Sdept, Dhead)$，函数依赖集

$$F = \\{Sno \\to Sname,\\; Sno \\to Sdept,\\; Sdept \\to Dhead\\}$$

$R$ 最高达到第几范式？

> 这里没有部分依赖（候选键是单属性），但有传递依赖：
> $Sno \\to Sdept$，$Sdept \\to Dhead$，所以 $Sno \\to Dhead$ 是传递的。`,
    attrs: ['Sno', 'Sname', 'Sdept', 'Dhead'],
    fds: [
      { lhs: ['Sno'], rhs: ['Sname'] },
      { lhs: ['Sno'], rhs: ['Sdept'] },
      { lhs: ['Sdept'], rhs: ['Dhead'] },
    ],
    hint: 'Dhead 通过 Sdept 传递依赖于 Sno。',
  },
  {
    id: 'N09', kid: 'k-nf', ask: 'nf', difficulty: 5,
    title: '★ 3NF 但不是 BCNF（经典例子）',
    brief: `设 $R(S, T, J)$，函数依赖集

$$F = \\{ST \\to J,\\; J \\to T\\}$$

$R$ 最高达到第几范式？

> 这是教材里最经典的"3NF 但不是 BCNF"的例子，请务必想清楚：
> 1. 候选键有几个？（不止一个）
> 2. 哪些属性是主属性？
> 3. 对 $J \\to T$ 这条依赖，$J$ 是超键吗？$T$ 是主属性吗？`,
    attrs: ['S', 'T', 'J'],
    fds: [
      { lhs: ['S', 'T'], rhs: ['J'] },
      { lhs: ['J'], rhs: ['T'] },
    ],
    hint: '候选键是 ST 和 SJ —— 三个属性全是主属性。所以 J→T 的右部 T 是主属性，3NF 条件满足；但 J 不是超键，BCNF 条件不满足。',
  },
  {
    id: 'N10', kid: 'k-nf', ask: 'nf', difficulty: 3,
    title: '标准 BCNF',
    brief: `设 $R(\\underline{Sno}, Sname, Sage, Sdept)$，函数依赖集

$$F = \\{Sno \\to Sname,\\; Sno \\to Sage,\\; Sno \\to Sdept\\}$$

$R$ 最高达到第几范式？`,
    attrs: ['Sno', 'Sname', 'Sage', 'Sdept'],
    fds: [
      { lhs: ['Sno'], rhs: ['Sname'] },
      { lhs: ['Sno'], rhs: ['Sage'] },
      { lhs: ['Sno'], rhs: ['Sdept'] },
    ],
    hint: '每条依赖的左部都是 Sno，而 Sno 是超键。',
  },
  {
    id: 'N11', kid: 'k-nf', ask: 'nf', difficulty: 4,
    title: '多候选键的 BCNF',
    brief: `设 $R(A, B, C)$，函数依赖集

$$F = \\{AB \\to C,\\; C \\to A\\}$$

$R$ 最高达到第几范式？

> 注意候选键有两个：$AB$ 和 $BC$。逐个检查每条依赖的左部是不是超键。`,
    attrs: ['A', 'B', 'C'],
    fds: [
      { lhs: ['A', 'B'], rhs: ['C'] },
      { lhs: ['C'], rhs: ['A'] },
    ],
    hint: 'AB⁺ = ABC ✓ 是超键。C⁺ = CA，不是全集 —— 等等，那 C 不是超键，是不是违反 BCNF？再算一遍 BC⁺。',
  },

  /* ==================== 分解 ==================== */
  {
    id: 'N12', kid: 'k-decomp', ask: 'decompose', target: '3NF', difficulty: 5,
    title: '3NF 分解：无损 + 保持依赖',
    brief: `设 $R(Sno, Sname, Sdept, Dhead, Cno, Grade)$，函数依赖集

$$F = \\{Sno \\to Sname,\\; Sno \\to Sdept,\\; Sdept \\to Dhead,\\; SnoCno \\to Grade\\}$$

把它分解到 **3NF**，要求**既无损连接又保持函数依赖**。

用「合成法」：
1. 求最小覆盖 $F_c$
2. 按左部分组，每组构成一个关系
3. 若没有任何关系包含候选键，补一个候选键关系

> 提交格式：每个关系一组属性，例如 \`[Sno, Sname, Sdept]\`。
>
> ⚠️ 本题**不比对标准答案** —— 正确的分解通常不唯一。
> 系统会验算你的分解是否满足：覆盖全部属性、无损连接、保持函数依赖、
> 每个关系都达到 3NF。只要都满足就算对。`,
    attrs: ['Sno', 'Sname', 'Sdept', 'Dhead', 'Cno', 'Grade'],
    fds: [
      { lhs: ['Sno'], rhs: ['Sname'] },
      { lhs: ['Sno'], rhs: ['Sdept'] },
      { lhs: ['Sdept'], rhs: ['Dhead'] },
      { lhs: ['Sno', 'Cno'], rhs: ['Grade'] },
    ],
    answer: { schemes: [['Sno', 'Sname', 'Sdept'], ['Sdept', 'Dhead'], ['Sno', 'Cno', 'Grade']] },
    hint: '最小覆盖里左部有三种：Sno、Sdept、(Sno,Cno)。Sno 那组把 Sname 和 Sdept 都带上。',
  },
  {
    id: 'N13', kid: 'k-decomp', ask: 'decompose', target: '3NF', difficulty: 4,
    title: '3NF 分解：另一个例子',
    brief: `设 $R(A, B, C, D, E)$，函数依赖集

$$F = \\{A \\to B,\\; AC \\to D,\\; D \\to E\\}$$

把它分解到 **3NF**（要求无损且保持依赖）。

> 候选键是 $AC$。分组之后检查一下有没有关系包含了它。`,
    attrs: ['A', 'B', 'C', 'D', 'E'],
    fds: [
      { lhs: ['A'], rhs: ['B'] },
      { lhs: ['A', 'C'], rhs: ['D'] },
      { lhs: ['D'], rhs: ['E'] },
    ],
    answer: { schemes: [['A', 'B'], ['A', 'C', 'D'], ['D', 'E']] },
    hint: '三个左部：A、AC、D。A 那组是 [A,B]，AC 那组是 [A,C,D]，D 那组是 [D,E]。',
  },
  {
    id: 'N14', kid: 'k-decomp', ask: 'decompose', target: 'BCNF', difficulty: 5,
    title: '★ BCNF 分解（会丢掉依赖）',
    brief: `设 $R(S, T, J)$，函数依赖集

$$F = \\{ST \\to J,\\; J \\to T\\}$$

把它分解到 **BCNF**。

> ⚠️ 这一题会让你亲眼看到那个经典结论：
> **BCNF 分解保证无损，但可能不保持函数依赖。**
>
> 分解完成后，请想一想：$ST \\to J$ 这条依赖还在吗？
> 它跨在两个关系上，数据库已经**没法自动检查**它了 ——
> 这正是"BCNF 不保持依赖"的具体含义。`,
    attrs: ['S', 'T', 'J'],
    fds: [
      { lhs: ['S', 'T'], rhs: ['J'] },
      { lhs: ['J'], rhs: ['T'] },
    ],
    answer: { schemes: [['J', 'T'], ['S', 'J']] },
    hint: 'J → T 违反 BCNF（J 不是超键）。按 X∪Y 和 R−Y 切开：得到 [J,T] 和 [S,J]。',
  },
  {
    id: 'N15', kid: 'k-decomp', ask: 'decompose', target: 'BCNF', difficulty: 4,
    title: 'BCNF 分解：多步切分',
    brief: `设 $R(A, B, C, D)$，函数依赖集

$$F = \\{AB \\to C,\\; C \\to D,\\; D \\to A\\}$$

把它分解到 **BCNF**。

> 这一题可能需要切两次。每次切分后，
> 对每个新关系重新检查它内部的依赖是否都满足 BCNF。`,
    attrs: ['A', 'B', 'C', 'D'],
    fds: [
      { lhs: ['A', 'B'], rhs: ['C'] },
      { lhs: ['C'], rhs: ['D'] },
      { lhs: ['D'], rhs: ['A'] },
    ],
    answer: { schemes: [['C', 'D'], ['A', 'B', 'C']] },
    hint: '在 R(ABCD) 里 C→D 违反 BCNF（C⁺ = CDA，不是全集）。切成 [C,D] 和 [A,B,C]。检查 [A,B,C]：AB→C 的左部 AB 在它里面是超键吗？',
  },
];

export default NORMALIZE_TASKS;
