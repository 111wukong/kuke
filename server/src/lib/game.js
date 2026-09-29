/* 游戏化：XP / 等级 / 成就 / 连续打卡
 *
 * ── 设计立场：奖励「练对了」，不奖励「练得多」 ────────────────────
 * 按题量给 XP 会催生「乱点选项刷分」。所以：
 *   · 答对才给分，答错给 0（不是负分 —— 负分让人不敢做题）
 *   · 错题复习答对给**双倍**（补短板比刷熟题价值高）
 *   · SQL 关卡一次通过给满额，多次尝试递减（防暴力试错）
 *   · 连击只统计连续答对，不统计连续作答
 *
 * ── 等级曲线 ────────────────────────────────────────────────────
 * 第 n 级需要的总 XP = 100·n^1.6（取整到十位）。不是线性：
 * 线性曲线下等级会涨得越来越快，前 10 级毫无成就感。
 * 1.6 次幂让前几级很密（每 100–300 XP 一级），后面逐渐拉开。
 */

export const LEVEL_TITLES = [
  '初识数据', '建表新手', '查询入门', '连接熟练工', '聚合好手',
  '范式学徒', '索引行家', '事务守门人', '查询优化师', '数据库工程师',
];

export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round((100 * Math.pow(level - 1, 1.6)) / 10) * 10;
}

export function levelInfo(xp) {
  let level = 1;
  while (level < 99 && xp >= xpForLevel(level + 1)) level++;
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    into: xp - base,
    need: Math.max(1, next - base),
    total: xp,
    nextAt: next,
    progress: Math.min(1, (xp - base) / Math.max(1, next - base)),
  };
}

/**
 * 一次作答给多少 XP。
 * @param {object} o
 *   correct      是否答对
 *   kind         question | level | normalize | lab
 *   context      practice | review | assignment | level
 *   difficulty   1..5
 *   firstTry     关卡是否第一次就过
 *   attemptNo    这是第几次尝试（关卡用）
 */
export function xpFor({ correct, kind = 'question', context = 'practice', difficulty = 2, firstTry = true, attemptNo = 1 }) {
  if (!correct) return 0;

  const base = { question: 10, level: 25, normalize: 20, lab: 15 }[kind] ?? 10;
  const diffMul = 1 + (Math.min(Math.max(difficulty, 1), 5) - 2) * 0.15;   // 1 → 0.85，5 → 1.45
  let mul = diffMul;

  // 错题复习答对双倍：补短板的价值高于刷熟题
  if (context === 'review') mul *= 2;

  // 关卡多次尝试递减：第 1 次 ×1，第 2 次 ×0.7，第 3 次 ×0.5，之后 ×0.3
  if (kind === 'level' && !firstTry) {
    mul *= [1, 0.7, 0.5][Math.min(attemptNo - 1, 2)] ?? 0.3;
  }

  return Math.round(base * mul);
}

/** 连击加成：连续答对 5 题以上，每 5 题多给 20%，封顶 +60%。 */
export function comboBonus(combo) {
  if (combo < 5) return 1;
  return Math.min(1.6, 1 + Math.floor(combo / 5) * 0.2);
}

/* ---------- 成就 ---------- */
/* 定义在这里，判定在 checkAchievements。id 一旦发布就不能改 ——
 * achievements 表里存的是 id，改了 id 等于把所有人的成就记录作废。 */
export const ACHIEVEMENTS = [
  { id: 'first_step', name: '第一次查询', desc: '完成第一道题', tier: 'bronze' },
  { id: 'sql_runner', name: '跑起来了', desc: '在实训场成功执行 10 次 SQL', tier: 'bronze' },
  { id: 'level_10', name: '连过十关', desc: '通过 10 个 SQL 关卡', tier: 'bronze' },
  { id: 'join_master', name: '连接熟练工', desc: '通过全部 JOIN 相关关卡', tier: 'silver' },
  { id: 'group_master', name: '聚合好手', desc: '通过全部 GROUP BY 相关关卡', tier: 'silver' },
  { id: 'key_hunter', name: '找键猎人', desc: '连续答对 5 道候选键题', tier: 'silver' },
  { id: 'bcnf_slayer', name: '范式屠夫', desc: '答对 10 道范式判定题', tier: 'gold' },
  { id: 'no_hint', name: '不看提示', desc: '一次通过 5 个关卡且没用提示', tier: 'silver' },
  { id: 'streak_7', name: '一周不断', desc: '连续打卡 7 天', tier: 'silver' },
  { id: 'streak_30', name: '一月不断', desc: '连续打卡 30 天', tier: 'gold' },
  { id: 'mistake_clear', name: '错题清零', desc: '把错题本清空一次（至少 20 题）', tier: 'gold' },
  { id: 'perfect_run', name: '全对', desc: '一次练习中 20 题全对', tier: 'gold' },
  { id: 'night_owl', name: '夜猫子', desc: '在 0:00–5:00 之间完成一次练习', tier: 'bronze' },
  { id: 'comeback', name: '翻身', desc: '把 5 个曾经掌握度低于 40% 的知识点练到 80% 以上', tier: 'gold' },
  { id: 'normalize_master', name: '规范化大师', desc: '完成全部范式实验室题目', tier: 'gold' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const achievementDef = (id) => BY_ID.get(id) || null;

/**
 * 根据当前统计判定新解锁的成就。
 * 传入的是「已经算好的数字」，这个函数不查库 —— 纯函数好测。
 *
 * @returns {string[]} 新解锁的成就 id
 */
export function checkAchievements(stats, owned = []) {
  const has = new Set(owned);
  const out = [];
  const unlock = (id, cond) => { if (cond && !has.has(id)) out.push(id); };

  unlock('first_step', (stats.attempts || 0) >= 1);
  unlock('sql_runner', (stats.sqlRuns || 0) >= 10);
  unlock('level_10', (stats.levelsPassed || 0) >= 10);
  unlock('join_master', stats.joinLevelsTotal > 0 && (stats.joinLevelsPassed || 0) >= stats.joinLevelsTotal);
  unlock('group_master', stats.groupLevelsTotal > 0 && (stats.groupLevelsPassed || 0) >= stats.groupLevelsTotal);
  unlock('key_hunter', (stats.keyStreak || 0) >= 5);
  unlock('bcnf_slayer', (stats.nfCorrect || 0) >= 10);
  unlock('no_hint', (stats.noHintLevels || 0) >= 5);
  unlock('streak_7', (stats.streak || 0) >= 7);
  unlock('streak_30', (stats.streak || 0) >= 30);
  unlock('mistake_clear', !!stats.clearedMistakes);
  unlock('perfect_run', !!stats.perfectRun);
  unlock('night_owl', !!stats.nightOwl);
  unlock('comeback', (stats.comebacks || 0) >= 5);
  unlock('normalize_master', stats.normalizeTotal > 0 && (stats.normalizeDone || 0) >= stats.normalizeTotal);

  return out;
}

/**
 * 连续打卡天数。
 * ★ 从今天往回数，但**今天没打卡不算断**——否则早上打开页面会看到
 *   「连续 0 天」，而昨天明明打了。所以从今天或昨天起算。
 */
export function streakFrom(dates, today) {
  const set = new Set(dates);
  const dayBefore = (s) => {
    const d = new Date(`${s}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  let cursor = set.has(today) ? today : dayBefore(today);
  if (!set.has(cursor)) return 0;

  let n = 0;
  while (set.has(cursor)) { n++; cursor = dayBefore(cursor); }
  return n;
}
