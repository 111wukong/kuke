/* 知识依赖图
 *
 * 邻接表 + 遍历 + 拓扑排序 + 环检测。
 *
 * ── 为什么环检测是硬门禁 ────────────────────────────────────────
 * 前置依赖图一旦有环（A 要先学 B，B 又要先学 A），下面两件事会同时坏掉：
 *   · 拓扑排序没有输出（或者输出一个看起来正常的顺序，但它是错的）
 *   · 根因回溯会无限递归
 * 而环往往是**录数据时手滑**造成的（把 A→B 录成了 B→A 形成互指），
 * 不是设计意图。所以种子导入时直接拒绝带环的数据集，
 * 而不是等到线上回溯卡死才发现。
 *
 * ── 方向约定（和 schema.sql 里写的一致，这里再写一遍）────────────
 *   from = 前置（先学） → to = 后继（后学）
 *   out 边（from→to）：沿它能找到「学了这个之后能解锁什么」
 *   in  边（to←from）：沿它能找到「要学这个得先补什么」
 * 找祖先走 in，找后代走 out。搞反了会让诊断给出完全相反的建议。
 */

export function buildGraph(edges = []) {
  const out = new Map();
  const inn = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const e of edges) {
    if (e.type === 'confusable') continue;   // 易混淆是辨析题用的，不参与路径规划
    add(out, e.from_kid, { kid: e.to_kid, type: e.type, strength: e.strength || 'hard' });
    add(inn, e.to_kid, { kid: e.from_kid, type: e.type, strength: e.strength || 'hard' });
    if (e.type === 'related') {
      // 相关边是双向的：A 与 B 相关，则 B 与 A 也相关
      add(out, e.to_kid, { kid: e.from_kid, type: 'related', strength: 'soft' });
      add(inn, e.from_kid, { kid: e.to_kid, type: 'related', strength: 'soft' });
    }
  }
  return { out, inn };
}

/** 沿 in 边回溯全部祖先（含传递闭包），返回 kid -> 最短距离。 */
export function ancestors(graph, kid, maxDepth = 8) {
  const dist = new Map();
  const queue = [[kid, 0]];
  const seen = new Set([kid]);

  while (queue.length) {
    const [cur, d] = queue.shift();
    if (d >= maxDepth) continue;
    for (const e of graph.inn.get(cur) || []) {
      if (seen.has(e.kid)) continue;
      seen.add(e.kid);
      dist.set(e.kid, d + 1);
      queue.push([e.kid, d + 1]);
    }
  }
  return dist;
}

/** 沿 out 边找全部后代，返回 kid -> 最短距离。 */
export function descendants(graph, kid, maxDepth = 8) {
  const dist = new Map();
  const queue = [[kid, 0]];
  const seen = new Set([kid]);

  while (queue.length) {
    const [cur, d] = queue.shift();
    if (d >= maxDepth) continue;
    for (const e of graph.out.get(cur) || []) {
      if (seen.has(e.kid)) continue;
      seen.add(e.kid);
      dist.set(e.kid, d + 1);
      queue.push([e.kid, d + 1]);
    }
  }
  return dist;
}

/** 环检测（DFS 三色标记）。返回找到的环（可能多个，最多返回 limit 个）。 */
export function detectCycles(edges, limit = 5) {
  const { out } = buildGraph(edges.filter((e) => e.type === 'prereq'));
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = [];

  const visit = (node) => {
    if (cycles.length >= limit) return;
    color.set(node, GRAY);
    stack.push(node);
    for (const e of out.get(node) || []) {
      const c = color.get(e.kid) || WHITE;
      if (c === GRAY) {
        const at = stack.indexOf(e.kid);
        cycles.push([...stack.slice(at), e.kid]);
      } else if (c === WHITE) visit(e.kid);
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const node of out.keys()) {
    if ((color.get(node) || WHITE) === WHITE) visit(node);
  }
  return cycles;
}

/**
 * 拓扑排序（Kahn 算法）。只对 prereq 边生效 —— related 是双向的，
 * 放进拓扑排序必然成环，而它本来就不表达先后。
 *
 * @param {string[]} nodes 要排序的节点集合（不传则取图里全部节点）
 * @returns {{order:string[], cycles:string[][]}}
 */
export function topoSort(edges, nodes = null) {
  const pre = edges.filter((e) => e.type === 'prereq');
  const all = new Set(nodes || []);
  if (!nodes) {
    for (const e of pre) { all.add(e.from_kid); all.add(e.to_kid); }
  } else {
    // 只保留两端都在集合内的边，否则会引入集合外的节点
    for (const e of pre) if (all.has(e.from_kid) && all.has(e.to_kid)) { /* 保留 */ }
  }

  const inDeg = new Map([...all].map((k) => [k, 0]));
  const out = new Map([...all].map((k) => [k, []]));
  for (const e of pre) {
    if (!all.has(e.from_kid) || !all.has(e.to_kid)) continue;
    out.get(e.from_kid).push(e.to_kid);
    inDeg.set(e.to_kid, (inDeg.get(e.to_kid) || 0) + 1);
  }

  const queue = [...all].filter((k) => (inDeg.get(k) || 0) === 0).sort();
  const order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    for (const nxt of out.get(cur) || []) {
      inDeg.set(nxt, inDeg.get(nxt) - 1);
      if (inDeg.get(nxt) === 0) {
        // 插到合适位置保持字典序稳定 —— 顺序确定，测试才能写死断言
        let i = 0;
        while (i < queue.length && queue[i] < nxt) i++;
        queue.splice(i, 0, nxt);
      }
    }
  }

  const sorted = order.length === all.size;
  return { order, cycles: sorted ? [] : detectCycles(pre) };
}

/** 图的体检报告。种子导入时打印，也供教师端「图谱体检」页用。 */
export function auditGraph(edges, knowledgeIds = []) {
  const pre = edges.filter((e) => e.type === 'prereq');
  const related = edges.filter((e) => e.type === 'related');
  const confusable = edges.filter((e) => e.type === 'confusable');
  const cycles = detectCycles(pre);

  const known = new Set(knowledgeIds);
  const dangling = edges.filter((e) => !known.has(e.from_kid) || !known.has(e.to_kid));

  const hasIn = new Set(pre.map((e) => e.to_kid));
  const hasOut = new Set(pre.map((e) => e.from_kid));

  // 最长前置链：对每个节点求祖先深度，取最大
  const graph = buildGraph(pre);
  let longest = 0;
  let longestAt = '';
  for (const k of new Set([...hasIn, ...hasOut])) {
    const d = ancestors(graph, k).size;
    if (d > longest) { longest = d; longestAt = k; }
  }

  return {
    total: edges.length,
    byType: { prereq: pre.length, related: related.length, confusable: confusable.length },
    cycles,
    dangling: dangling.map((e) => `${e.from_kid}→${e.to_kid}`),
    roots: knowledgeIds.filter((k) => !hasIn.has(k)).length,
    leaves: knowledgeIds.filter((k) => !hasOut.has(k)).length,
    longestChain: longest,
    longestChainAt: longestAt,
    ok: cycles.length === 0 && dangling.length === 0,
  };
}
