/* AI · 学习者档案 → 自然语言摘要
 *
 * ── 这一段比模型本身重要 ────────────────────────────────────────
 * 「AI 融入不够」的真正解药不是换个更强的模型，而是让提示词里带上
 * **这个人此刻的真实状态**。只写「你是数据库课老师」的提示词，
 * 任何模型都只能讲通用内容；写「他 GROUP BY 掌握度 31%、累计错 4 次、
 * 最近三次是错对错，而且上游的 WHERE 有 88%」，它才会针对性地讲。
 *
 * ── 库课的优势：这些数字是真的 ──────────────────────────────────
 * 那个独立的问学项目里，这些数字来自 localStorage 里的手写记录。
 * 这里来自 attempts / stats_node / cards —— 真的作答，真的判分，
 * 而且**根因是沿依赖图回溯出来的**（diagnose.js），不是按错误次数排的。
 *
 * 于是「薄弱点」不只是「哪里错得多」，而是「先去补哪个，能连带解决几道错题」。
 */

import { db } from '../db/index.js';
import { diagnose, WEAK_THRESHOLD, MIN_SAMPLES } from '../lib/diagnose.js';

/** 全部依赖边（诊断要用）。量级是几百条，每次读一遍没问题。 */
function allEdges() {
  return db.prepare('SELECT from_kid, to_kid, type FROM knowledge_edges').all()
    .map((r) => ({ from: r.from_kid, to: r.to_kid, type: r.type }));
}

/** 考点 id → { title, chapterId }，给诊断当 meta。 */
function knowledgeMeta() {
  const rows = db.prepare('SELECT id, title, chapter_id FROM knowledge').all();
  const out = {};
  for (const r of rows) out[r.id] = { title: r.title, chapterId: r.chapter_id };
  return out;
}

/** 某个学生的作答统计 { kid: { n, c } }。 */
function statsOf(userId) {
  const rows = db.prepare('SELECT kid, n, c FROM stats_node WHERE user_id = ?').all(userId);
  const out = {};
  for (const r of rows) out[r.kid] = { n: r.n, c: r.c };
  return out;
}

/** 最近的错题（含他当时写的答案和错因归类）。 */
export function recentMistakes(userId, limit = 5) {
  return db.prepare(`
    SELECT a.kid, a.ref_id, a.answer, a.error_type, a.ts, q.stem, q.type, q.answer AS std
      FROM attempts a
      LEFT JOIN questions q ON q.id = a.ref_id
     WHERE a.user_id = ? AND a.correct = 0 AND a.kind = 'question'
     ORDER BY a.ts DESC
     LIMIT ?
  `).all(userId, limit);
}

/** 错因分布。答错和答错不是一回事：概念混淆要回去补前置，语法记错只要多写几遍。 */
export function errorTypeBreakdown(userId, limit = 4) {
  return db.prepare(`
    SELECT error_type, COUNT(*) AS n
      FROM attempts
     WHERE user_id = ? AND correct = 0 AND error_type != ''
     GROUP BY error_type
     ORDER BY n DESC
     LIMIT ?
  `).all(userId, limit);
}

/** 总体作答概况。 */
export function overview(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n, SUM(correct) AS c
      FROM attempts
     WHERE user_id = ? AND kind = 'question'
  `).get(userId);
  const n = row?.n || 0;
  const c = row?.c || 0;
  const due = db.prepare(`
    SELECT COUNT(*) AS n FROM cards
     WHERE user_id = ? AND due <= date('now','localtime')
  `).get(userId)?.n || 0;
  return { n, c, accuracy: n ? c / n : null, due };
}

/**
 * 跑一次根因诊断。
 * @returns diagnose() 的结果（weak / roots / summary …）
 */
export function runDiagnose(userId) {
  return diagnose(statsOf(userId), allEdges(), knowledgeMeta());
}

/* ============================================================
   ★ 拼成给模型看的一段话
   ============================================================
   要求：**短**（几百字以内）且**具体**（带数字、带考点名、带原话）。
   写「该生基础薄弱」是没用的。
   ============================================================ */
export function learningProfile(userId, focusKid = null) {
  if (!userId) return '';

  const ov = overview(userId);
  const diag = runDiagnose(userId);
  const lines = ['【学习者档案】（以下来自他在本平台上的真实作答记录，请据此调整难度，不要泛泛而谈）'];

  if (!ov.n) {
    lines.push('- 他还没有提交过任何客观题。不要假定他学过什么，也不要假定他没学过——用第一个问题去探。');
    return lines.join('\n');
  }

  lines.push(`- 累计作答 ${ov.n} 题，答对 ${ov.c} 题，总正确率 ${Math.round(ov.accuracy * 100)}%`);
  if (ov.due) lines.push(`- 今天有 ${ov.due} 张复习卡到期`);

  /* 根因，不是「错得最多的地方」 */
  const roots = (diag.roots || []).slice(0, 3);
  if (roots.length) {
    lines.push('- 最该先补的根因（沿依赖图回溯出来的，不是按错误次数排的）：');
    for (const r of roots) {
      lines.push(`    · ${r.title}（掌握度 ${Math.round(r.mastery * 100)}%，做过 ${r.attempts} 题）—— ${r.reason}`);
      if (r.symptoms && r.symptoms.length) {
        lines.push(`      它拖累的下游：${r.symptoms.slice(0, 3).map((s) => `${s.title}(${Math.round(s.mastery * 100)}%)`).join('、')}`);
      }
    }
  } else if ((diag.weak || []).length) {
    lines.push(`- 有 ${diag.weak.length} 个薄弱考点，但它们的上游也都薄弱 —— 建议从最基础的开始补。`);
  } else {
    const thin = (diag.observing || []).length;
    lines.push(thin
      ? `- 暂时没有明确薄弱点，但有 ${thin} 个考点样本还太少（少于 ${MIN_SAMPLES} 题），结论仅供参考。`
      : `- 练过的考点掌握度都在 ${Math.round(WEAK_THRESHOLD * 100)}% 以上。`);
  }

  /* 错因分布：概念混淆 vs 语法记错，策略是相反的 */
  const errs = errorTypeBreakdown(userId, 3);
  if (errs.length) {
    lines.push(`- 他的错因分布：${errs.map((e) => `${e.error_type} ${e.n} 次`).join('、')}`);
  }

  /* 最近的错题原话 —— 这是最能让他「觉得老师知道我」的一句 */
  const mis = recentMistakes(userId, 3);
  if (mis.length) {
    lines.push('- 他最近答错的题（含他当时写的答案）：');
    for (const m of mis) {
      const title = knowledgeMeta()[m.kid]?.title || m.kid;
      lines.push(`    · ${title}：他答「${String(m.answer || '').slice(0, 24)}」${m.error_type ? `（判为${m.error_type}）` : ''}`);
    }
  }

  /* 本考点历史 —— 老师这一节要讲的就是它 */
  if (focusKid) {
    const s = statsOf(userId)[focusKid];
    const title = knowledgeMeta()[focusKid]?.title || focusKid;
    if (s && s.n) {
      lines.push(`- 本考点（${title}）历史：做过 ${s.n} 题，对 ${s.c} 题，掌握度约 ${Math.round(((s.c + 1) / (s.n + 2)) * 100)}%`);
    } else {
      lines.push(`- 本考点（${title}）他还没有做过题`);
    }
  }

  return lines.join('\n');
}

/** 给 UI 用的一份结构化摘要（侧栏显示）。 */
export function profileCard(userId) {
  const ov = overview(userId);
  const diag = runDiagnose(userId);
  return {
    overview: ov,
    weak: (diag.weak || []).slice(0, 5),
    roots: (diag.roots || []).slice(0, 3),
    summary: diag.summary,
    errorTypes: errorTypeBreakdown(userId, 5),
  };
}
