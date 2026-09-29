/* FSRS-6 间隔重复调度器
 *
 * ── 为什么用 FSRS 而不是 SM-2 ────────────────────────────────────
 * SM-2 是 1987 年的算法：只有一个 EF 因子，复习间隔按固定倍率滚。
 * FSRS 把「记忆」拆成两个可学习的量：
 *   stability（S）  记忆稳定度 —— 保留率降到 90% 所需的天数
 *   difficulty（D） 这张卡对这个人的难度（1–10）
 * 每次作答都用遗忘曲线反推「你现在还记得的概率是多少」，再据此调整 S。
 * 同样多的复习次数，时间会更多地花在快忘掉的卡上。
 *
 * ── 参数与公式来源 ──────────────────────────────────────────────
 * 全部取自 open-spaced-repetition/ts-fsrs：
 *   packages/fsrs/src/constant.ts   → default_w（21 个权重）
 *   packages/fsrs/src/algorithm.ts  → forgetting_curve / init_* / next_*
 * 权重是从参考实现里逐个数抄下来的，没有凭记忆编数字。
 *
 * ── 与原版的三处差异（有意为之，写清楚免得后人以为漏了）──────────
 *   1. **不做 fuzz**。原版给间隔加随机抖动避免卡片扎堆。这里卡片量级是几十张，
 *      抖动带来的不可复现性反而碍事（测试没法写确定的断言）。
 *   2. **不做分钟级学习步骤**。本应用按「天」调度，due 是日期字符串，
 *      分钟级步骤没有落点。只保留 t=0（同一天内二次复习）那一支。
 *   3. 间隔上限 365 天。原版 36500 —— 对一学期课程没有意义。
 */
import { addDays, todayLocal } from './dates.js';

export const W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
  1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

const S_MIN = 0.01;
const S_MAX = 36500;
const MAX_INTERVAL = 365;
const REQUEST_RETENTION = 0.9;

const DECAY = -W[20];
const FACTOR = Math.exp(Math.pow(DECAY, -1) * Math.log(0.9)) - 1;
const INTERVAL_MODIFIER = (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1) / FACTOR;

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const round8 = (x) => Math.round(x * 1e8) / 1e8;

/** R(t,S) = (1 + FACTOR·t/S)^DECAY。代入 t=S 得 0.9 —— 即稳定度的定义。 */
export function retrievability(elapsedDays, stability) {
  if (!(stability > 0)) return 0;
  const t = Math.max(0, elapsedDays);
  return round8(Math.pow(1 + (FACTOR * t) / stability, DECAY));
}

export function initStability(g) {
  return Math.max(W[g - 1], 0.1);
}

export function initDifficulty(g) {
  return clamp(round8(W[4] - Math.exp((g - 1) * W[5]) + 1), 1, 10);
}

function linearDamping(deltaD, oldD) {
  return round8((deltaD * (10 - oldD)) / 9);
}

function meanReversion(init, current) {
  return round8(W[7] * init + (1 - W[7]) * current);
}

export function nextDifficulty(d, g) {
  const deltaD = -W[6] * (g - 3);
  return clamp(meanReversion(initDifficulty(4), d + linearDamping(deltaD, d)), 1, 10);
}

export function nextRecallStability(d, s, r, g) {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBound = g === 4 ? W[16] : 1;
  const next = s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9])
    * (Math.exp((1 - r) * W[10]) - 1) * hardPenalty * easyBound);
  return round8(clamp(next, S_MIN, S_MAX));
}

export function nextForgetStability(d, s, r) {
  const next = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
  const ceiling = s / Math.exp(W[17] * W[18]);
  return round8(clamp(clamp(next, S_MIN, S_MAX), S_MIN, Math.max(ceiling, S_MIN)));
}

export function nextShortTermStability(s, g) {
  return round8(clamp(s * Math.exp(W[17] * (g - 3 + W[18]) * Math.pow(s, -W[19])), S_MIN, S_MAX));
}

export function nextInterval(stability) {
  return clamp(Math.round(stability * INTERVAL_MODIFIER), 1, MAX_INTERVAL);
}

export function daysBetween(fromStr, toStr) {
  const a = new Date(`${fromStr}T00:00:00`);
  const b = new Date(`${toStr}T00:00:00`);
  return Math.max(0, Math.round((b - a) / 864e5));
}

/** 新建一张卡。state='new'，S/D 留空 —— 由第一次作答的评分决定。 */
export function newCard(knowledgeId, questionId, cardType) {
  const id = 'card_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  return {
    id,
    type: cardType || 'knowledge',
    knowledgeId: knowledgeId || null,
    questionId: questionId || null,
    state: 'new',
    stability: null,
    difficulty: null,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: addDays(todayLocal(), 1),
    lastReview: null,
    createdAt: todayLocal(),
  };
}

/**
 * 复习一次后的新状态。**纯函数** —— 同样输入永远同样输出，测试好写。
 * @param {1|2|3|4} rating 1=忘了 2=吃力 3=记得 4=很熟
 */
export function grade(card, rating) {
  const g = clamp(Math.round(Number(rating) || 1), 1, 4);
  const todayStr = todayLocal();

  const state = card.state || (card.reps > 0 ? 'review' : 'new');
  const reps = card.reps || 0;
  const lapses = card.lapses || 0;

  /* 老库迁移过来的卡可能没有 FSRS 状态，用 interval 反推：
   * interval 本来就约等于稳定度（保留率 90% 时两者相等），
   * 难度取中性值 5，之后几次复习会自己收敛。 */
  let s = card.stability != null ? Number(card.stability) : null;
  let d = card.difficulty != null ? Number(card.difficulty) : null;
  if (s == null && (card.interval || 0) > 0) s = Math.max(Number(card.interval), 0.1);
  if (d == null && (card.interval || 0) > 0) d = 5;

  const elapsed = card.lastReview ? daysBetween(card.lastReview, todayStr) : 0;

  let nextS;
  let nextD;
  let nextState;

  if (s == null || d == null) {
    nextS = initStability(g);
    nextD = initDifficulty(g);
    nextState = g === 1 ? 'learning' : 'review';
  } else {
    const r = retrievability(elapsed, s);
    if (elapsed === 0) nextS = nextShortTermStability(s, g);
    else if (g === 1) nextS = nextForgetStability(d, s, r);
    else nextS = nextRecallStability(d, s, r, g);
    nextD = nextDifficulty(d, g);
    nextState = g === 1 ? (state === 'review' ? 'relearning' : 'learning') : 'review';
  }

  return {
    state: nextState,
    stability: nextS,
    difficulty: nextD,
    interval: nextInterval(nextS),
    reps: reps + 1,
    lapses: g === 1 ? lapses + 1 : lapses,
    due: addDays(todayStr, nextInterval(nextS)),
    lastReview: todayStr,
  };
}

/** 这张卡现在的可回忆概率。复习队列拿它排序 —— 快忘掉的排前面。 */
export function currentRetrievability(card, todayStr = todayLocal()) {
  const s = card.stability != null ? Number(card.stability) : (card.interval > 0 ? Number(card.interval) : null);
  if (!s || !card.lastReview) return null;
  return retrievability(daysBetween(card.lastReview, todayStr), s);
}

/** 把「答对/答错 + 用时」映射成 FSRS 评分。 */
export function ratingFromOutcome(correct, durationMs = 0) {
  if (!correct) return 1;                       // 错了 → Again
  if (durationMs > 60000) return 2;             // 对了但磨了很久 → Hard
  if (durationMs > 0 && durationMs < 8000) return 4; // 秒答 → Easy
  return 3;                                     // 正常答对 → Good
}
