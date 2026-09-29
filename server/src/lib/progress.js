/* 学习进度聚合
 *
 * XP、等级、成就、连续打卡、仪表盘快照。
 *
 * ── 为什么单独一个模块而不是塞进 game.js ────────────────────────
 * game.js 是**纯计算**（等级曲线、成就判定、连击加成），不碰数据库，
 * 所以单元测试可以直接调它，不用起库。
 * 这个文件是**有状态的聚合层**：读库、算、写回。
 * 两者分开之后，「等级算得对不对」和「有没有正确落库」可以分开测 ——
 * 这两类 bug 的排查方式完全不同。
 */
import { db } from '../db/index.js';
import {
  levelInfo, xpFor, comboBonus, checkAchievements, achievementDef, streakFrom,
} from './game.js';
import { todayLocal, lastDays } from './dates.js';

export function getGameState(userId) {
  let g = db.prepare('SELECT * FROM game_state WHERE user_id = ?').get(userId);
  if (!g) {
    db.prepare('INSERT OR IGNORE INTO game_state (user_id) VALUES (?)').run(userId);
    g = db.prepare('SELECT * FROM game_state WHERE user_id = ?').get(userId);
  }
  return g;
}

/** 加 XP 并返回新的等级信息。 */
export function addXp(userId, amount) {
  if (!amount) return levelInfo(getGameState(userId).xp || 0);
  db.prepare(`INSERT INTO game_state (user_id, xp) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET xp = xp + excluded.xp, updated_at = datetime('now')`)
    .run(userId, amount);
  return levelInfo(getGameState(userId).xp || 0);
}

/** 更新连击（连续答对）。答错清零。 */
export function updateCombo(userId, correct) {
  const g = getGameState(userId);
  if (correct) {
    const next = (g.combo || 0) + 1;
    db.prepare('UPDATE game_state SET combo = ?, best_combo = MAX(best_combo, ?) WHERE user_id = ?')
      .run(next, next, userId);
    return { combo: next, bonus: comboBonus(next) };
  }
  db.prepare('UPDATE game_state SET combo = 0 WHERE user_id = ?').run(userId);
  return { combo: 0, bonus: 1 };
}

/** 打卡。同一天重复调用只更新分钟数。 */
export function checkin(userId, { minutes = 0, tasksDone = 0 } = {}) {
  const today = todayLocal();
  db.prepare(`INSERT INTO checkins (user_id, date, minutes, tasks_done) VALUES (?,?,?,?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      minutes = MAX(minutes, excluded.minutes),
      tasks_done = tasks_done + excluded.tasks_done`)
    .run(userId, today, minutes, tasksDone);
  db.prepare(`INSERT INTO stats_daily (user_id, date, n, c, minutes) VALUES (?,?,0,0,?)
    ON CONFLICT(user_id, date) DO UPDATE SET minutes = MAX(minutes, excluded.minutes)`)
    .run(userId, today, minutes);
  return streakOf(userId);
}

export function streakOf(userId) {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM (
      SELECT date FROM attempts WHERE user_id = ?
      UNION SELECT date FROM checkins WHERE user_id = ?
    ) ORDER BY date DESC LIMIT 400
  `).all(userId, userId);
  return streakFrom(rows.map((r) => r.date), todayLocal());
}

/** 收集成就判定所需的全部数字。 */
export function achievementStats(userId) {
  const one = (sql, ...p) => db.prepare(sql).get(...p) || {};

  const att = one(`SELECT COUNT(*) n, SUM(correct) c FROM attempts WHERE user_id = ?`, userId);
  const runs = one('SELECT COUNT(*) n FROM sql_runs WHERE user_id = ? AND ok = 1', userId);

  const levels = one(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) passed
    FROM (SELECT ref_id, MAX(correct) ok FROM attempts
          WHERE user_id = ? AND kind = 'level' GROUP BY ref_id)`, userId);

  const joinLevels = db.prepare(`
    SELECT l.id, (SELECT MAX(correct) FROM attempts a
                  WHERE a.user_id = ? AND a.kind = 'level' AND a.ref_id = l.id) AS ok
    FROM sql_levels l WHERE l.kid = 'k-join'`).all(userId);
  const groupLevels = db.prepare(`
    SELECT l.id, (SELECT MAX(correct) FROM attempts a
                  WHERE a.user_id = ? AND a.kind = 'level' AND a.ref_id = l.id) AS ok
    FROM sql_levels l WHERE l.kid IN ('k-groupby','k-having','k-aggregate')`).all(userId);

  const nfCorrect = one(`
    SELECT COUNT(*) n FROM (SELECT ref_id, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind = 'normalize' AND kid IN ('k-nf','k-decomp')
      GROUP BY ref_id) WHERE ok = 1`, userId).n || 0;

  const normTotal = one('SELECT COUNT(*) n FROM normalize_tasks').n || 0;
  const normDone = one(`
    SELECT COUNT(*) n FROM (SELECT ref_id, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind = 'normalize' GROUP BY ref_id) WHERE ok = 1`, userId).n || 0;

  const keyStreak = one(`
    SELECT COUNT(*) n FROM (SELECT ref_id, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind = 'normalize' AND kid = 'k-key' GROUP BY ref_id) WHERE ok = 1`, userId).n || 0;

  const perfectRun = one(`
    SELECT COUNT(*) n FROM (
      SELECT date, COUNT(*) n, SUM(correct) c FROM attempts
      WHERE user_id = ? AND context = 'practice' GROUP BY date HAVING n >= 20 AND c = n
    )`, userId).n || 0;

  const nightOwl = one(`
    SELECT COUNT(*) n FROM attempts
    WHERE user_id = ? AND CAST(strftime('%H', ts / 1000, 'unixepoch', 'localtime') AS INTEGER) < 5`,
  userId).n || 0;

  // 「翻身」：曾经掌握度 <40% 现在 >80% 的知识点
  const comebacks = one(`
    SELECT COUNT(*) n FROM (
      SELECT kid,
             (SELECT (c + 1.0) / (n + 2) FROM stats_node s2
              WHERE s2.user_id = a.user_id AND s2.kid = a.kid) AS m
      FROM attempts a WHERE a.user_id = ? GROUP BY a.kid
    ) WHERE m >= 0.8`, userId).n || 0;

  /* 错题口径与 study/mistakes 保持一致：**曾经答错且至今没答对过**。
   * 用 MAX(correct) = 0 而不是"最后一次错"：
   * 错了三次第四次对了，它不该还算错题。 */
  const mistakeTotal = one(`
    SELECT COUNT(*) n FROM (
      SELECT ref_id, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind = 'question' GROUP BY ref_id
    ) WHERE ok = 0`, userId).n || 0;
  const mistakeLeft = mistakeTotal;

  return {
    attempts: att.n || 0,
    correct: att.c || 0,
    sqlRuns: runs.n || 0,
    levelsTotal: levels.total || 0,
    levelsPassed: levels.passed || 0,
    joinLevelsTotal: joinLevels.length,
    joinLevelsPassed: joinLevels.filter((l) => l.ok === 1).length,
    groupLevelsTotal: groupLevels.length,
    groupLevelsPassed: groupLevels.filter((l) => l.ok === 1).length,
    keyStreak,
    nfCorrect,
    normalizeTotal: normTotal,
    normalizeDone: normDone,
    perfectRun: perfectRun > 0,
    nightOwl: nightOwl > 0,
    comebacks,
    clearedMistakes: mistakeTotal >= 20 && mistakeLeft === 0,
    streak: streakOf(userId),
  };
}

/**
 * 重新判定成就，返回**新解锁**的 id 列表。
 * 每次作答后调用。已解锁的不会重复给。
 */
export function refreshAchievements(userId) {
  const owned = db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ?')
    .all(userId).map((r) => r.achievement_id);
  const stats = achievementStats(userId);
  const fresh = checkAchievements(stats, owned);

  if (fresh.length) {
    const today = todayLocal();
    const ins = db.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement_id, date) VALUES (?,?,?)');
    const tx = db.transaction(() => { for (const id of fresh) ins.run(userId, id, today); });
    tx();
    // 成就也给 XP，让"解锁"有实感
    addXp(userId, fresh.length * 30);
  }
  return fresh;
}

export function myAchievements(userId) {
  const owned = db.prepare('SELECT achievement_id, date FROM achievements WHERE user_id = ?').all(userId);
  const map = new Map(owned.map((o) => [o.achievement_id, o.date]));
  return { owned: map.size, list: owned.map((o) => ({ ...achievementDef(o.achievement_id), date: o.date })).filter(Boolean) };
}

/** 仪表盘快照：一次请求把首屏要的数字全拿到。 */
export function snapshot(userId) {
  const one = (sql, ...p) => db.prepare(sql).get(...p) || {};
  const today = todayLocal();

  const g = getGameState(userId);
  const lv = levelInfo(g.xp || 0);

  const todayStats = one('SELECT n, c FROM stats_daily WHERE user_id = ? AND date = ?', userId, today);

  const totals = one(`
    SELECT COUNT(*) n, SUM(correct) c, COUNT(DISTINCT date) days
    FROM attempts WHERE user_id = ?`, userId);

  /* 错题数：曾经答错过、且之后没答对过的题。
   * 为什么不是「最后一次答错」—— 那样一道题错了三次、第四次对了，
   * 它会一直挂在错题本里，因为 MIN(correct)=0。 */
  const wrong = one(`
    SELECT COUNT(*) n FROM (
      SELECT ref_id, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind IN ('question','level','normalize','lab')
      GROUP BY ref_id
    ) WHERE ok = 0`, userId).n || 0;

  const due = one("SELECT COUNT(*) n FROM cards WHERE user_id = ? AND due <= ?", userId, today).n || 0;

  const daily = db.prepare('SELECT date, n, c, minutes FROM stats_daily WHERE user_id = ?')
    .all(userId);
  const dailyMap = new Map(daily.map((d) => [d.date, d]));
  const heatmap = lastDays(28).map((d) => ({
    date: d,
    n: dailyMap.get(d)?.n || 0,
    c: dailyMap.get(d)?.c || 0,
    minutes: dailyMap.get(d)?.minutes || 0,
  }));

  const levels = one(`
    SELECT COUNT(*) total, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) passed FROM (
      SELECT ref_id, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind = 'level' GROUP BY ref_id)`, userId);

  return {
    user: { id: userId },
    xp: g.xp || 0,
    level: lv.level,
    levelTitle: lv.title,
    levelInfo: { into: lv.into, need: lv.need, progress: lv.progress },
    streak: streakOf(userId),
    combo: g.combo || 0,
    bestCombo: g.best_combo || 0,
    today: { attempts: todayStats.n || 0, correct: todayStats.c || 0 },
    totals: {
      attempts: totals.n || 0,
      correct: totals.c || 0,
      accuracy: totals.n ? Math.round((totals.c / totals.n) * 100) : 0,
      activeDays: totals.days || 0,
    },
    wrong,
    dueCount: due,
    levels: { total: levels.total || 0, passed: levels.passed || 0 },
    heatmap,
  };
}

/** 每日计划：今天该做什么。复习优先，然后错题，然后新内容。 */
export function dailyPlan(userId, goal = 20) {
  const today = todayLocal();

  /* ★ 参数必须传给 .all()，不能传给 .prepare()。
   * better-sqlite3 的 prepare 只接受 SQL 字符串（第二个参数是 options），
   * 多传的参数会被静默忽略 —— 然后 .all() 无参调用时报
   * 「Too few parameter values were provided」，而报错行指向 .all()，
   * 看起来像是"参数没传"，实际上参数传到了隔壁函数的兜里。 */
  const dueCards = db.prepare(`
    SELECT c.id, c.type, c.knowledge_id, c.question_id, k.title
    FROM cards c LEFT JOIN knowledge k ON k.id = c.knowledge_id
    WHERE c.user_id = ? AND c.due <= ?
    ORDER BY c.due LIMIT 50`).all(userId, today);

  const wrongIds = db.prepare(`
    SELECT ref_id, kind, kid FROM (
      SELECT ref_id, kind, kid, MAX(correct) ok, MAX(ts) ts FROM attempts
      WHERE user_id = ? AND kind IN ('question','level') GROUP BY ref_id
    ) WHERE ok = 0 ORDER BY ts DESC LIMIT 20`).all(userId);

  /* 新内容：优先推荐「前置都已掌握」的知识点。
   * 这是把依赖图用在推荐上的地方 —— 不按章节顺序，按**可学性**。 */
  const known = new Set(db.prepare('SELECT kid FROM stats_node WHERE user_id = ? AND c * 1.0 / n >= 0.7').all(userId).map((r) => r.kid));
  const touched = new Set(db.prepare('SELECT DISTINCT kid FROM stats_node WHERE user_id = ?').all(userId).map((r) => r.kid));
  const prereqMap = new Map();
  for (const e of db.prepare("SELECT from_kid, to_kid FROM knowledge_edges WHERE type = 'prereq' AND strength = 'hard'").all()) {
    if (!prereqMap.has(e.to_kid)) prereqMap.set(e.to_kid, []);
    prereqMap.get(e.to_kid).push(e.from_kid);
  }

  const fresh = db.prepare('SELECT id, title FROM knowledge ORDER BY sort_order, id').all()
    .filter((k) => !touched.has(k.id))
    .map((k) => {
      const need = prereqMap.get(k.id) || [];
      const ready = need.every((n) => known.has(n));
      return { ...k, ready, missing: need.filter((n) => !known.has(n)).length };
    })
    .sort((a, b) => (b.ready - a.ready) || (a.missing - b.missing))
    .slice(0, 8);

  return {
    date: today,
    goal,
    done: db.prepare('SELECT n FROM stats_daily WHERE user_id = ? AND date = ?').get(userId, today)?.n || 0,
    review: dueCards.map((c) => ({ id: c.id, type: c.type, knowledgeId: c.knowledge_id, questionId: c.question_id, title: c.title })),
    mistakes: wrongIds,
    fresh,
    summary: dueCards.length
      ? `有 ${dueCards.length} 张卡片到期待复习，先清掉它们。`
      : fresh.length
        ? `复习队列空了。推荐接下来学「${fresh[0].title}」。`
        : '复习队列空了，新内容也都学过了 —— 去做几道综合练习吧。',
  };
}
