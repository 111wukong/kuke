/* 根因诊断
 *
 * ── 这个模块解决什么问题 ────────────────────────────────────────
 * 错题本只能告诉你「哪里错得多」。但「聚合查询错了 12 次」这句话本身
 * 不构成行动 —— 学生打开错题本，看到一片红，然后呢？
 *
 * 真正有用的是：「你的聚合错得多，但你 GROUP BY 的掌握度只有 31%，
 * 而 WHERE 有 88% —— 先去把 GROUP BY 补上，你现在的 12 道错题里有 7 道
 * 会跟着好。」
 *
 * 这就是沿依赖图回溯的价值：把「症状」翻译成「病灶」。
 * 没有依赖图，只能按错误次数排序 —— 而那会让学生一直去练
 * 自己本来就不会的东西，越练越挫败。
 *
 * ── 排序公式的三项，各自防的是什么 ──────────────────────────────
 *   gap       缺口大小（1 − 掌握度）      → 越差越该补
 *   coverage  它撑着多少个薄弱后代        → 补它能救的题越多，优先级越高
 *   decay     距离衰减 1/(1+distance)     → 太远的祖先别推荐，链长了学生也学不动
 * 少了 coverage，会把「一个孤立的薄弱点」排在「一个撑着 7 个错题的根因」前面；
 * 少了 decay，会一路回溯到最顶上的「数据库基本概念」—— 那没有可操作性。
 */

import { buildGraph, ancestors, descendants, topoSort } from './graph.js';

/** 掌握度估计。
 *
 * 用拉普拉斯平滑 (c+1)/(n+2) 而不是裸正确率 c/n：
 *   1 题做对 → 裸正确率 100%，平滑后 66%。前者会让「蒙对一次」
 *   的节点看起来已经掌握，从而不再出现在复习队列里。
 * 这是有意的保守 —— 漏推一个已掌握的节点代价很小（浪费一次复习），
 * 漏掉一个没掌握的节点代价很大（学生以为自己会了）。
 */
export function masteryOf(n, c) {
  return (c + 1) / (n + 2);
}

/** 这个估计有多可信。样本少于 3 时可信度低，不足以据此判定薄弱。 */
export function confidenceOf(n) {
  return 1 - Math.exp(-n / 5);
}

export const WEAK_THRESHOLD = 0.7;
export const MIN_SAMPLES = 3;

/**
 * 诊断一个用户的薄弱点与根因。
 *
 * @param {object} stats      Map/对象：kid -> { n, c }
 * @param {Array}  edges      依赖边
 * @param {object} meta       kid -> { title, chapterId, categoryId }
 */
export function diagnose(stats, edges, meta = {}) {
  const graph = buildGraph(edges);
  const rows = Object.entries(stats || {}).map(([kid, v]) => {
    const n = v.n || 0;
    const c = v.c || 0;
    return { kid, n, c, mastery: masteryOf(n, c), confidence: confidenceOf(n) };
  });

  const byKid = new Map(rows.map((r) => [r.kid, r]));
  const get = (kid) => byKid.get(kid) || { kid, n: 0, c: 0, mastery: 0.5, confidence: 0 };

  /* 薄弱点：掌握度低于阈值，且样本足够。
   * 样本不足的节点单独归为「待观察」—— 刚学过一次就判它薄弱是不公平的。 */
  const weak = rows.filter((r) => r.mastery < WEAK_THRESHOLD && r.n >= MIN_SAMPLES);
  const observing = rows.filter((r) => r.mastery < WEAK_THRESHOLD && r.n > 0 && r.n < MIN_SAMPLES);
  const strong = rows.filter((r) => r.mastery >= WEAK_THRESHOLD && r.n >= MIN_SAMPLES);

  const weakSet = new Set(weak.map((r) => r.kid));

  /* 根因 = 薄弱、且它自己没有任何「也薄弱」的祖先。
   * 换句话说：再往上找，上面都是会了的 —— 那这里就是断链的起点。 */
  const roots = [];
  for (const w of weak) {
    const anc = ancestors(graph, w.kid);
    const weakAncestors = [...anc.keys()].filter((k) => weakSet.has(k));
    if (weakAncestors.length === 0) roots.push({ ...w, depthFromRoot: 0, weakAncestors: [] });
  }

  /* 每个薄弱点找到「最近的薄弱祖先」，挂到它下面 —— 这样前端能画出一棵
   * 「症状树」：根因在上，被它拖累的症状在下。 */
  const symptomsOf = new Map(roots.map((r) => [r.kid, []]));
  for (const w of weak) {
    if (symptomsOf.has(w.kid)) continue;
    const anc = ancestors(graph, w.kid);
    let best = null;
    let bestD = Infinity;
    for (const [k, d] of anc) {
      if (weakSet.has(k) && d < bestD) { best = k; bestD = d; }
    }
    if (best) symptomsOf.get(best)?.push({ ...w, distance: bestD });
  }

  /* 排序打分 */
  const scored = roots.map((r) => {
    const desc = descendants(graph, r.kid);
    // 它撑着多少个薄弱后代（含自身）
    let covered = 1;
    for (const k of desc.keys()) if (weakSet.has(k)) covered++;
    const gap = 1 - r.mastery;
    // 后代越多、缺口越大、越靠上游，分越高
    const upstreamBonus = 1 + Math.min(desc.size, 10) / 20;
    const score = gap * Math.log2(1 + covered) * upstreamBonus * r.confidence;

    return {
      kid: r.kid,
      title: meta[r.kid]?.title || r.kid,
      chapterId: meta[r.kid]?.chapterId || '',
      mastery: Number(r.mastery.toFixed(3)),
      attempts: r.n,
      correct: r.c,
      coveredSymptoms: covered,
      totalDescendants: desc.size,
      score: Number(score.toFixed(4)),
      symptoms: (symptomsOf.get(r.kid) || [])
        .sort((a, b) => a.mastery - b.mastery)
        .map((s) => ({ kid: s.kid, title: meta[s.kid]?.title || s.kid, mastery: Number(s.mastery.toFixed(3)), distance: s.distance })),
      reason: covered > 1
        ? `补上它，连带能解决 ${covered - 1} 个后续薄弱点`
        : '这是一个孤立的知识缺口',
    };
  }).sort((a, b) => b.score - a.score);

  /* 学习路径：把推荐的根因 + 它们的祖先一起做拓扑排序，
   * 保证「先补的排在前面」。
   * 祖先里已经掌握的不排除 —— 它们会出现在路径里作为「复习」节点，
   * 但排在薄弱点之前，符合先易后难。 */
  const pathSet = new Set();
  for (const s of scored.slice(0, 5)) {
    pathSet.add(s.kid);
    for (const k of ancestors(graph, s.kid).keys()) pathSet.add(k);
  }
  const { order, cycles } = topoSort(edges, [...pathSet]);

  return {
    weak: weak.sort((a, b) => a.mastery - b.mastery).map((r) => ({
      kid: r.kid,
      title: meta[r.kid]?.title || r.kid,
      mastery: Number(r.mastery.toFixed(3)),
      attempts: r.n,
      correct: r.c,
    })),
    observing: observing.map((r) => ({ kid: r.kid, title: meta[r.kid]?.title || r.kid, attempts: r.n })),
    strong: strong.map((r) => ({
      kid: r.kid,
      title: meta[r.kid]?.title || r.kid,
      mastery: Number(r.mastery.toFixed(3)),
      attempts: r.n,
    })).sort((a, b) => b.mastery - a.mastery),
    roots: scored,
    path: order.map((kid) => ({
      kid,
      title: meta[kid]?.title || kid,
      mastery: Number(get(kid).mastery.toFixed(3)),
      isGap: weakSet.has(kid),
    })),
    cycles,
    summary: buildSummary(scored, weak, rows),
  };
}

function buildSummary(roots, weak, rows) {
  if (!rows.length) return '还没有作答记录，先去做几道题，这里就会出现诊断。';
  if (!weak.length) {
    const thin = rows.filter((r) => r.n < MIN_SAMPLES).length;
    return thin
      ? `暂时没发现薄弱点，但有 ${thin} 个知识点样本还太少（少于 ${MIN_SAMPLES} 题），结论仅供参考。`
      : '所有练过的知识点掌握度都在 70% 以上。';
  }
  const top = roots[0];
  if (!top) return `有 ${weak.length} 个薄弱知识点，但它们的上游也都薄弱，建议从最基础的开始补。`;
  return `最该先补的是「${top.title}」（掌握度 ${Math.round(top.mastery * 100)}%）。${top.reason}。`;
}

/**
 * 班级级诊断：把每个学生的薄弱点汇总，找出**全班共同的**根因。
 * 教师端「学情分析」用 —— 一个知识点如果 60% 的学生都薄弱，
 * 那是讲法的问题，不是学生的问题。
 */
export function diagnoseClass(students, edges, meta = {}) {
  const total = students.length;
  if (!total) return { common: [], perStudent: [], summary: '班级里还没有学生。' };

  const perStudent = students.map((s) => ({
    userId: s.userId,
    username: s.username,
    ...diagnose(s.stats, edges, meta),
  }));

  // 每个知识点：多少学生薄弱
  const hitCount = new Map();
  for (const st of perStudent) {
    for (const w of st.weak) hitCount.set(w.kid, (hitCount.get(w.kid) || 0) + 1);
  }

  const common = [...hitCount.entries()]
    .map(([kid, hits]) => ({
      kid,
      title: meta[kid]?.title || kid,
      chapterId: meta[kid]?.chapterId || '',
      students: hits,
      ratio: Number((hits / total).toFixed(3)),
      avgMastery: Number((
        students.reduce((acc, s) => {
          const v = s.stats?.[kid];
          return acc + (v ? masteryOf(v.n, v.c) : 0.5);
        }, 0) / total
      ).toFixed(3)),
    }))
    .sort((a, b) => b.ratio - a.ratio || a.avgMastery - b.avgMastery);

  const worst = common[0];
  const summary = !common.length
    ? '班级整体掌握情况良好，没有出现普遍性薄弱点。'
    : worst.ratio >= 0.5
      ? `「${worst.title}」有 ${Math.round(worst.ratio * 100)}% 的学生掌握不牢 —— 这个比例更像是讲法需要调整，而不是个别学生的问题。`
      : `最集中的问题是「${worst.title}」，${worst.students}/${total} 的学生需要补。`;

  return { common, perStudent, summary, total };
}
