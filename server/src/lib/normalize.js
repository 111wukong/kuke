/* 关系规范化算法
 *
 * 这是本课程里唯一一块**能完全自动判分、而且答案唯一**的推理题。
 * SQL 题靠跑结果集，范式题靠算法 —— 两者都不需要人工批改，
 * 而「判断范式等级」恰恰是学生最容易自欺欺人的地方
 * （觉得自己懂了，一给反例就错）。所以这里把算法全部实现出来。
 *
 * ── 数据表示 ────────────────────────────────────────────────────
 *   attrs  = ['A','B','C','D']                 属性全集
 *   fds    = [{ lhs:['A','B'], rhs:['C'] }]    函数依赖集 F
 * 所有函数返回**新对象**，不改入参 —— 判题器会对同一份 F 反复求闭包，
 * 中间态被改掉的话，第二次判分结果就和第一次不一样了。
 *
 * ── 一个反复踩的坑：为什么所有集合比较都要先排序 ─────────────────
 * JS 的 Set 没有顺序语义，但把 Set 转成数组之后 Array.prototype.sort 是
 * **字典序**：['A','B','C'] 排完还是 ['A','B','C']，而 ['A','K','Z'] 排完是
 * ['A','K','Z']，可 ['A','B','K'] 排完是 ['A','B','K']。看起来没问题，
 * 但属性名一旦有两位数（A1、A2、A10）就会出问题 —— 'A10' < 'A2'。
 * 本课程的属性都是单字母，但 key() 里做了数字感知排序，
 * 免得以后有人加了 A10 属性就出现「同样的闭包被判成不同」的灵异现象。
 */

const isNum = (s) => /^\d+$/.test(String(s).slice(1));

/** 属性排序：先按前缀字母，再按数字大小（A2 < A10）。 */
function attrCompare(a, b) {
  const pa = String(a).match(/^([^\d]*)(\d*)$/) || ['', String(a), ''];
  const pb = String(b).match(/^([^\d]*)(\d*)$/) || ['', String(b), ''];
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  if (pa[2] && pb[2]) return Number(pa[2]) - Number(pb[2]);
  return String(a) < String(b) ? -1 : 1;
}

/** 属性集合的规范化：去重 + 排序。
 *
 * ★ 必须容忍非数组输入。调用方很自然地会传单个属性名（字符串）——
 * 比如 judgeNormalize 里把题目的 target 直接交给 closure()。
 * 如果这里假设 list 一定是数组，症状是 `list.map is not a function`，
 * 而这个报错离真正的调用点隔了三层，很难定位。
 */
export function sortAttrs(list) {
  const arr = list == null ? [] : (Array.isArray(list) ? list : [list]);
  return [...new Set(arr.map(String))].sort(attrCompare);
}

/** 集合的规范字符串形式，用于比较与去重。 */
export function key(list) {
  return sortAttrs(list).join(',');
}

/**
 * 把学生提交的「属性组」解析成属性数组。
 *
 * ── 为什么要按题目的属性集来切，而不是按分隔符切 ──────────────────
 * 学生写候选键的方式五花八门：`AB`、`A,B`、`A B`、`['A','B']`。
 * 而题目的属性集是已知的：如果属性都是单字符（A、B、C），
 * 那 `AB` 只可能是 {A,B}，不可能是"一个叫 AB 的属性"。
 * 按分隔符切的话，`AB` 会变成一个叫 "AB" 的属性，
 * 然后判分说"少了 {A,B}" —— 学生看着自己写的 AB 会以为系统坏了。
 *
 * 属性名是多字符时（Sno、Sname）不做这种拆分，
 * 因为那时 "Sno" 真的可能是一个属性。
 *
 * 认不出来的原样保留，交给判分报错 —— **不猜**。
 * 猜错的代价是"学生写对了却被判错"，比"报错说他格式不对"严重得多。
 */
export function parseAttrGroup(value, attrs) {
  if (Array.isArray(value)) return [...new Set(value.flatMap((v) => parseAttrGroup(v, attrs)))];
  const s = String(value ?? '').trim();
  if (!s) return [];

  const singleChar = attrs.length > 0 && attrs.every((a) => String(a).length === 1);
  const out = [];
  for (const part of s.split(/[\s,，、|]+/).filter(Boolean)) {
    if (attrs.includes(part)) { out.push(part); continue; }
    if (singleChar && /^[A-Za-z]+$/.test(part) && [...part].every((ch) => attrs.includes(ch))) {
      out.push(...part);
      continue;
    }
    out.push(part);
  }
  return [...new Set(out)];
}

/** 把候选键 / 分解这类「二维」答案解析成属性组数组。 */
export function parseSchemeList(value, attrs) {
  const arr = Array.isArray(value) ? value : String(value ?? '').split(/[;；\n]+/);
  return arr.map((g) => parseAttrGroup(g, attrs)).filter((g) => g.length);
}

/** 规范化依赖集：合并同 LHS 的 RHS、去掉平凡依赖、排序。 */
export function normalizeFds(fds) {
  const map = new Map();
  for (const fd of fds || []) {
    const lhs = sortAttrs(fd.lhs || []);
    if (!lhs.length) continue;
    for (const r of sortAttrs(fd.rhs || [])) {
      if (lhs.includes(r)) continue;   // 平凡依赖 X→A（A∈X）没有信息量
      const k = lhs.join(',');
      if (!map.has(k)) map.set(k, { lhs, rhs: new Set() });
      map.get(k).rhs.add(r);
    }
  }
  return [...map.values()]
    .map((v) => ({ lhs: v.lhs, rhs: sortAttrs([...v.rhs]) }))
    .sort((a, b) => (key(a.lhs) < key(b.lhs) ? -1 : key(a.lhs) > key(b.lhs) ? 1 : 0));
}

/* ============ 一、属性闭包 X⁺ ============ */
/**
 * 教科书算法：反复扫描 F，凡是 LHS 已被结果包含的依赖，把 RHS 并进来，
 * 直到一轮下来没有再增长。
 *
 * ★ 这里有一个初学者最常犯的错：只扫一遍。反例——
 *   F = {A→B, B→C}，求 A⁺。扫一遍只能得到 AB（因为 B→C 那条在扫描时
 *   B 还没进结果）。必须循环到不动点。测试里专门有一条盯这个。
 */
export function closure(attrs, fds, X) {
  const result = new Set(sortAttrs(X).filter((a) => attrs.includes(a)));
  const F = normalizeFds(fds);
  let changed = true;

  while (changed) {
    changed = false;
    for (const fd of F) {
      if (!fd.lhs.every((a) => result.has(a))) continue;
      for (const r of fd.rhs) {
        if (!result.has(r)) { result.add(r); changed = true; }
      }
    }
  }
  return sortAttrs([...result]);
}

/** 判断 X 是否是超键（X⁺ 覆盖全部属性）。 */
export function isSuperkey(attrs, fds, X) {
  return closure(attrs, fds, X).length === attrs.length;
}

/* ============ 二、候选键 ============ */
/**
 * 求全部候选键。
 *
 * ── 为什么要先算「必含属性」再枚举，而不是直接枚举 2ⁿ 个子集 ──────
 * 直接枚举对 6 个属性是 64 次闭包，没问题；但对 12 个属性就是 4096 次，
 * 每次闭包还要扫一遍 F。而实际上：
 *   · 从不出现在任何 RHS 里的属性（叫 L 类）**必须**在每一个候选键里；
 *   · 只在 RHS 出现、从不出现在 LHS 里的属性（R 类）**一定不**在键里；
 *   · 只在两边都出现的（LR 类）才需要枚举。
 * 教学题里 LR 通常只有 1–3 个，枚举量从 4096 掉到 8。
 *
 * ── 结果顺序 ────────────────────────────────────────────────────
 * 按「先短后长、同长按字典序」返回。这不是美观问题：
 * 判题时学生答案也要按同样规则排序后比对，否则
 * [['A'],['BC']] 和 [['BC'],['A']] 会被判成不同。
 */
export function candidateKeys(attrs, fds) {
  const A = sortAttrs(attrs);
  const F = normalizeFds(fds);
  const inLhs = new Set();
  const inRhs = new Set();
  for (const fd of F) {
    fd.lhs.forEach((a) => inLhs.add(a));
    fd.rhs.forEach((a) => inRhs.add(a));
  }

  const must = A.filter((a) => !inRhs.has(a));              // L ∪ N 类，必含
  const optional = A.filter((a) => inRhs.has(a) && inLhs.has(a)); // LR 类，需枚举
  const never = A.filter((a) => inRhs.has(a) && !inLhs.has(a));   // R 类，永不入键

  const keys = [];
  const combos = (arr, size) => {
    if (size === 0) return [[]];
    const out = [];
    const walk = (start, cur) => {
      if (cur.length === size) { out.push([...cur]); return; }
      for (let i = start; i < arr.length; i++) { cur.push(arr[i]); walk(i + 1, cur); cur.pop(); }
    };
    walk(0, []);
    return out;
  };

  for (let size = 0; size <= optional.length; size++) {
    for (const combo of combos(optional, size)) {
      const cand = sortAttrs([...must, ...combo]);
      if (!isSuperkey(A, F, cand)) continue;
      // 极小性：已有的键不能是它的真子集
      const isMinimal = !keys.some((k) => k.every((a) => cand.includes(a)));
      if (isMinimal) keys.push(cand);
    }
  }

  keys.sort((a, b) => (a.length - b.length) || (key(a) < key(b) ? -1 : 1));
  return { keys, must, optional, never };
}

/** 主属性 = 出现在任一候选键中的属性。 */
export function primeAttrs(attrs, fds) {
  const { keys } = candidateKeys(attrs, fds);
  const set = new Set();
  keys.forEach((k) => k.forEach((a) => set.add(a)));
  return { prime: sortAttrs([...set]), nonPrime: sortAttrs(attrs.filter((a) => !set.has(a))), keys };
}

/* ============ 三、最小依赖集（最小覆盖）============ */
/**
 * 求 F 的最小覆盖 Fc。三步，顺序不能换：
 *   1. 右部单属性化（X→AB 拆成 X→A、X→B）—— 这一步必须在最前，
 *      否则第 2 步「去掉多余右部属性」会和它互相干扰；
 *   2. 去掉多余的依赖：把某条依赖去掉，看它能否被剩下的推出；
 *   3. 去掉左部多余属性：X→A 中若某个 Xi 去掉后仍能推出 A，就删掉它。
 *
 * 注意最小覆盖**不唯一**，取决于第 2、3 步的扫描顺序。
 * 所以判题时不能直接比对最小覆盖本身，只能比对「两者等价」——
 * 见 equivalentFdSets。
 */
export function minimalCover(attrs, fds) {
  const A = sortAttrs(attrs);

  // 1) 右部单属性化
  let F = [];
  for (const fd of normalizeFds(fds)) {
    for (const r of fd.rhs) F.push({ lhs: [...fd.lhs], rhs: [r] });
  }

  // 2) 去掉冗余依赖
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < F.length; i++) {
      const rest = F.filter((_, j) => j !== i);
      const cl = new Set(closure(A, rest, F[i].lhs));
      if (F[i].rhs.every((r) => cl.has(r))) { F = rest; changed = true; break; }
    }
  }

  // 3) 去掉左部冗余属性
  for (let i = 0; i < F.length; i++) {
    let lhs = [...F[i].lhs];
    if (lhs.length <= 1) continue;
    for (const a of [...lhs]) {
      const trial = lhs.filter((x) => x !== a);
      if (!trial.length) continue;
      const cl = new Set(closure(A, F, trial));
      if (F[i].rhs.every((r) => cl.has(r))) lhs = trial;
    }
    F[i] = { lhs: sortAttrs(lhs), rhs: F[i].rhs };
  }

  return normalizeFds(F);
}

/** 两个依赖集是否等价：互相能推出对方的每一条。 */
export function equivalentFdSets(attrs, f1, f2) {
  const covers = (from, to) => to.every((fd) => {
    const cl = new Set(closure(attrs, from, fd.lhs));
    return fd.rhs.every((r) => cl.has(r));
  });
  return covers(f1, f2) && covers(f2, f1);
}

/* ============ 四、范式判定 ============ */
/**
 * 判定 R(attrs, F) 达到的最高范式等级。
 *
 * ── 判定顺序不能换：BCNF → 3NF → 2NF → 1NF ──────────────────────
 * 每个等级的条件都是**蕴含**的（满足 BCNF 必然满足 3NF），
 * 所以从上往下第一个满足的就是答案。
 * 反过来说，如果从 2NF 开始判，一个 3NF 的关系会被判成 2NF。
 *
 * ── 三个条件分别是什么（这是本节最容易被含糊带过的地方）──────────
 *   BCNF：对每条非平凡依赖 X→A，X 都是超键。
 *         注意「X 是超键」而不是「X 包含某个候选键」—— 两者等价，但前者好判。
 *   3NF ：对每条非平凡依赖 X→A，要么 X 是超键，**要么 A 是主属性**。
 *         那个「要么 A 是主属性」就是 3NF 比 BCNF 宽松的全部原因，
 *         也是「有主属性传递依赖但仍算 3NF」的由来。
 *   2NF ：1NF + 不存在**非主属性对候选键的部分依赖**。
 *         即：不存在 X→A，其中 A 非主属性、且 X 是某个候选键的真子集。
 *         单属性候选键的关系天然满足 2NF（没有真子集可言）。
 *
 * 返回值里带 violations，是为了让前端能逐条讲「哪条依赖违反了哪一条」——
 * 只给一个「3NF」结论对学生没有帮助，他需要知道是哪个 FD 卡的。
 */
export function normalForm(attrs, fds) {
  const A = sortAttrs(attrs);
  const F = normalizeFds(fds);
  const { keys } = candidateKeys(A, F);
  const { prime, nonPrime } = primeAttrs(A, F);

  const bcnfViolations = [];
  const nf3Violations = [];
  const nf2Violations = [];

  for (const fd of F) {
    const superkey = isSuperkey(A, F, fd.lhs);
    const allPrime = fd.rhs.every((r) => prime.includes(r));

    if (!superkey) bcnfViolations.push({ fd, why: `左部 {${fd.lhs.join(',')}} 不是超键` });
    if (!superkey && !allPrime) nf3Violations.push({ fd, why: `左部不是超键，且 {${fd.rhs.join(',')}} 不是主属性` });

    /* 2NF 只看「非主属性被候选键的一部分决定」。
     * 注意要遍历所有候选键的真子集，而不是只看单属性 ——
     * 候选键是 ABC 时，AB→D 也是部分依赖。 */
    for (const r of fd.rhs) {
      if (prime.includes(r)) continue;
      const partial = keys.some((k) => fd.lhs.length < k.length && fd.lhs.every((a) => k.includes(a)));
      if (partial) {
        nf2Violations.push({ fd, why: `非主属性 ${r} 部分依赖于候选键 {${keys.find((k) => fd.lhs.every((a) => k.includes(a))).join(',')}}` });
        break;
      }
    }
  }

  let nf = '1NF';
  if (!nf2Violations.length) nf = '2NF';
  if (!nf2Violations.length && !nf3Violations.length) nf = '3NF';
  if (!nf2Violations.length && !nf3Violations.length && !bcnfViolations.length) nf = 'BCNF';

  return {
    nf,
    keys,
    prime,
    nonPrime,
    violations: {
      bcnf: bcnfViolations,
      nf3: nf3Violations,
      nf2: nf2Violations,
    },
    /* 判成 1NF 时说明连 2NF 都不满足；1NF 本身在本模型下恒成立
     * （属性都建模成原子的），所以这里给的是「最高达到的等级」。 */
    note: nf === '1NF'
      ? '存在非主属性对候选键的部分依赖，只达到 1NF。'
      : '',
  };
}

/* ============ 五、无损连接判定（矩阵法 / chase）============ */
/**
 * 判定分解 ρ 是否无损连接。
 *
 * ── 矩阵法怎么做 ────────────────────────────────────────────────
 * 造一个 k 行 n 列的矩阵（k = 分解出的关系个数，n = 属性个数）：
 *   第 i 行第 j 列，若属性 j ∈ Ri 则填 aⱼ，否则填 bᵢⱼ。
 * 然后对每条 FD X→Y：找出所有在 X 各列上取值相同的行，
 * 把这些行在 Y 各列上的值统一（有 aⱼ 就用 aⱼ，否则用下标最小的 bᵢⱼ）。
 * 反复直到不动点。若某一行全变成 a，则无损。
 *
 * ── 为什么不是「R1∩R2 → R1−R2 就无损」那一条定理 ────────────────
 * 那条定理**只对二分解成立**（ρ = {R1, R2}）。
 * 三分解以上必须用矩阵法。教学题里三分解很常见，
 * 用错定理会给出错误的结论，而且是「看起来很专业」的错误结论。
 */
export function isLossless(attrs, fds, decomposition) {
  const A = sortAttrs(attrs);
  const F = normalizeFds(fds);
  const rels = decomposition.map((r) => sortAttrs(r).filter((a) => A.includes(a)));

  // 分解必须覆盖全部属性，否则矩阵法没有意义
  const covered = new Set(rels.flat());
  if (covered.size !== A.length) return { lossless: false, reason: '分解没有覆盖全部属性' };

  const idx = new Map(A.map((a, j) => [a, j]));
  // 矩阵单元：{ a: true, v: 属性名 } 或 { a: false, v: 'b<row><col>' }
  const M = rels.map((rel, i) => A.map((a, j) => (
    rel.includes(a) ? { a: true, v: a } : { a: false, v: `b${i}${j}` }
  )));

  let changed = true;
  let rounds = 0;
  const MAX_ROUNDS = 200; // 防御性上限：属性极多时不动点迭代可能很长

  while (changed && rounds++ < MAX_ROUNDS) {
    changed = false;
    for (const fd of F) {
      const cols = fd.lhs.map((a) => idx.get(a)).filter((j) => j !== undefined);
      if (!cols.length) continue;
      const groups = new Map();
      M.forEach((row, i) => {
        const k = cols.map((j) => row[j].v).join('|');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
      });

      for (const rows of groups.values()) {
        if (rows.length < 2) continue;
        for (const r of fd.rhs) {
          const j = idx.get(r);
          if (j === undefined) continue;
          const hasA = rows.find((i) => M[i][j].a);
          const target = hasA !== undefined ? M[hasA][j] : M[rows[0]][j];
          for (const i of rows) {
            if (M[i][j].v !== target.v) { M[i][j] = { a: target.a, v: target.v }; changed = true; }
          }
        }
      }
    }
  }

  const winRow = M.findIndex((row) => row.every((c) => c.a));
  return {
    lossless: winRow >= 0,
    reason: winRow >= 0 ? '' : '矩阵法跑完没有任何一行全部变成 a，存在信息丢失',
    witnessRow: winRow >= 0 ? rels[winRow] : null,
    matrix: M.map((row) => row.map((c) => c.v)),
  };
}

/* ============ 六、保持依赖判定 ============ */
/**
 * 判定分解是否保持函数依赖。
 *
 * 做法：把 F 投影到每个 Ri 上得到 Gi（Ri 内部能推出的全部依赖），
 * 令 G = ∪Gi，然后检查 F 的每一条能否被 G 推出。
 * 投影时枚举 Ri 的所有子集求闭包，交集即 Ri 内成立的依赖。
 */
export function preservesDependencies(attrs, fds, decomposition) {
  const A = sortAttrs(attrs);
  const F = normalizeFds(fds);
  const G = [];

  for (const rel of decomposition) {
    const R = sortAttrs(rel).filter((a) => A.includes(a));
    if (!R.length) continue;
    // 枚举 R 的全部子集
    for (let mask = 1; mask < (1 << R.length); mask++) {
      const sub = R.filter((_, i) => mask & (1 << i));
      const cl = closure(A, F, sub);
      const inside = cl.filter((a) => R.includes(a) && !sub.includes(a));
      if (inside.length) G.push({ lhs: sub, rhs: inside });
    }
  }

  const lost = [];
  for (const fd of F) {
    const cl = new Set(closure(A, G, fd.lhs));
    if (!fd.rhs.every((r) => cl.has(r))) lost.push(fd);
  }

  return { preserved: lost.length === 0, lost };
}

/* ============ 七、分解合成 ============ */
/**
 * 3NF 合成法（保持依赖 + 无损）。
 *   1. 求最小覆盖 Fc
 *   2. 按 LHS 分组，每组成为一个关系
 *   3. 若没有任何关系包含候选键，补一个「候选键」关系
 *   4. 去掉被其他关系包含的冗余关系
 */
export function synthesize3NF(attrs, fds) {
  const A = sortAttrs(attrs);
  const Fc = minimalCover(A, fds);
  const { keys } = candidateKeys(A, fds);

  const groups = new Map();
  for (const fd of Fc) {
    const k = key(fd.lhs);
    if (!groups.has(k)) groups.set(k, new Set(fd.lhs));
    fd.rhs.forEach((r) => groups.get(k).add(r));
  }
  let rels = [...groups.values()].map((s) => sortAttrs([...s]));

  if (!keys.some((k) => rels.some((r) => k.every((a) => r.includes(a))))) {
    rels.push(sortAttrs(keys[0] || A));
  }

  // 去掉被别的关系统统包含的
  rels = rels.filter((r, i) => !rels.some((o, j) => j !== i && r.every((a) => o.includes(a)) && o.length > r.length));

  return rels;
}

/** BCNF 分解法（无损，但可能不保持依赖）。 */
export function decomposeBCNF(attrs, fds) {
  const A = sortAttrs(attrs);
  let rels = [A];
  let guard = 0;

  while (guard++ < 100) {
    let split = false;
    for (const R of [...rels]) {
      const localFds = normalizeFds(fds).filter((fd) => [...fd.lhs, ...fd.rhs].every((a) => R.includes(a)));
      for (const fd of localFds) {
        if (isSuperkey(R, localFds, fd.lhs)) continue;
        // 违反 BCNF，按 X ∪ Y 与 R − Y 切开
        const r1 = sortAttrs([...fd.lhs, ...fd.rhs]);
        const r2 = sortAttrs(R.filter((a) => !fd.rhs.includes(a)));
        rels = rels.filter((x) => x !== R);
        if (r1.length) rels.push(r1);
        if (r2.length) rels.push(r2);
        split = true;
        break;
      }
      if (split) break;
    }
    if (!split) break;
  }

  return rels.map((r) => sortAttrs(r));
}

/* ============ 八、判分 ============ */
/**
 * 按题目类型判分。
 *
 * ★ 分解题（decompose）**不做精确比对**，而是验性质。
 *   理由：同一个关系模式的无损 3NF 分解**通常不唯一**
 *   （最小覆盖不唯一 → 合成结果不唯一）。
 *   拿参考答案做字符串比对，会把一个完全正确的分解判错，
 *   而这种错误学生根本无从察觉 —— 他会以为自己错了，然后去猜答案。
 *   所以：只要分解满足「覆盖全部属性 + 无损 + （3NF 时）保持依赖 + 每个关系达到目标范式」，
 *   就判对。参考答案退化成「一个示例」而不是「唯一正解」。
 */
export function judgeNormalize(task, studentAnswer) {
  const attrs = sortAttrs(task.attrs || []);
  const fds = normalizeFds(task.fds || []);
  const ask = task.ask || 'keys';

  if (ask === 'closure') {
    const expect = closure(attrs, fds, task.target);
    const got = sortAttrs((studentAnswer || []).map(String));
    const pass = key(got) === key(expect);
    return {
      pass, score: pass ? 100 : 0,
      message: pass ? '闭包正确。' : `闭包不对。你得到 {${got.join(',')}}，正确结果是 {${expect.join(',')}}。`,
      correctAnswer: expect,
    };
  }

  if (ask === 'keys') {
    const { keys } = candidateKeys(attrs, fds);
    const got = (studentAnswer || []).map((k) => sortAttrs(k.map(String)));
    const gotSet = new Set(got.map(key));
    const expSet = new Set(keys.map(key));
    const missing = keys.filter((k) => !gotSet.has(key(k)));
    const extra = got.filter((k) => !expSet.has(key(k)));
    const pass = !missing.length && !extra.length;

    const fmt = (list) => list.map((k) => `{${k.join(',')}}`).join('、');
    return {
      pass, score: pass ? 100 : 0,
      message: pass
        ? '候选键正确。'
        : [
          '候选键不对。',
          missing.length ? `少了 ${fmt(missing)}。` : '',
          extra.length ? `多了 ${fmt(extra)}（不是候选键 —— 要么不是超键，要么含有多余属性）。` : '',
        ].filter(Boolean).join(''),
      correctAnswer: keys,
    };
  }

  if (ask === 'nf') {
    const info = normalForm(attrs, fds);
    const got = String(studentAnswer || '').trim().toUpperCase().replace(/\s/g, '');
    const pass = got === info.nf;
    return {
      pass, score: pass ? 100 : 0,
      message: pass ? `判断正确，最高达到 ${info.nf}。` : `不对。正确答案是 ${info.nf}。`,
      detail: info,
      correctAnswer: info.nf,
    };
  }

  if (ask === 'decompose') {
    const target = (task.target || '3NF').toUpperCase();
    const rels = (studentAnswer || []).map((r) => sortAttrs((r || []).map(String))).filter((r) => r.length);
    if (!rels.length) return { pass: false, score: 0, message: '没有提交分解结果。' };

    const covered = new Set(rels.flat());
    if (covered.size !== attrs.length || attrs.some((a) => !covered.has(a))) {
      const missed = attrs.filter((a) => !covered.has(a));
      return { pass: false, score: 0, message: `分解没有覆盖全部属性，漏了 {${missed.join(',')}}。` };
    }

    const ll = isLossless(attrs, fds, rels);
    if (!ll.lossless) return { pass: false, score: 0, message: `这个分解不是无损连接的：${ll.reason}` };

    if (target === '3NF') {
      const dp = preservesDependencies(attrs, fds, rels);
      if (!dp.preserved) {
        return {
          pass: false, score: 0,
          message: `分解是无损的，但没有保持函数依赖 —— 丢掉了 ${dp.lost.map((f) => `${f.lhs.join('')}→${f.rhs.join('')}`).join('、')}。3NF 分解应当同时做到无损且保持依赖。`,
        };
      }
    }

    for (const r of rels) {
      const localFds = fds.filter((fd) => [...fd.lhs, ...fd.rhs].every((a) => r.includes(a)));
      const info = normalForm(r, localFds);
      const rank = { '1NF': 1, '2NF': 2, '3NF': 3, 'BCNF': 4 };
      if (rank[info.nf] < rank[target]) {
        return {
          pass: false, score: 0,
          message: `分解是无损的，但关系 R(${r.join('')}) 只达到 ${info.nf}，没到 ${target}。`,
        };
      }
    }

    return {
      pass: true, score: 100,
      message: `分解正确：覆盖全部属性、无损连接${target === '3NF' ? '、保持函数依赖' : ''}，且每个关系都达到 ${target}。`,
      correctAnswer: task.answer?.schemes || null,
    };
  }

  return { pass: false, score: 0, message: `未知的题目类型：${ask}` };
}

/** 给前端「查看解析」用的完整推导。 */
export function explain(attrs, fds) {
  const A = sortAttrs(attrs);
  const F = normalizeFds(fds);
  const { keys, must, optional, never } = candidateKeys(A, F);
  return {
    attrs: A,
    fds: F,
    keys,
    mustAttrs: must,
    optionalAttrs: optional,
    neverAttrs: never,
    minimalCover: minimalCover(A, F),
    normalForm: normalForm(A, F),
    synthesize3NF: synthesize3NF(A, F),
    decomposeBCNF: decomposeBCNF(A, F),
    closures: A.map((a) => ({ attr: a, closure: closure(A, F, [a]) })),
  };
}
