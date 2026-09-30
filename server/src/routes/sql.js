/* SQL 实训场接口 /api/sql/*
 *
 * ── 两条判题路径，各自独立 ──────────────────────────────────────
 * ① **结果集比对**（默认）：跑一遍参考答案、跑一遍学生的 SQL，
 *    比两份结果表。适合"查询"类题目。
 * ② **自定义校验**（level.check_sql 非空）：学生的 SQL 跑完后，
 *    紧接着在同一条连接里跑 check_sql，看它返回的真值。
 *    适合 INSERT / UPDATE / DELETE / CREATE 类题目 ——
 *    这些题没有"正确答案的结果集"可比，只能验"改完之后状态对不对"。
 *
 * ② 的实现方式是把两段 SQL 拼成一条提交给 worker：
 *    学生语句 + check_sql。因为 worker 每次任务新建内存库，
 *    拼在一起才能让 check 看到学生改过的状态。
 *    代价是学生如果写了 DROP TABLE，check 会报错 —— 那也算没通过，合理。
 *
 * ── 为什么要记录 sql_runs ───────────────────────────────────────
 * 「运行历史」是个功能，但更重要的是它是**教师看学生思路的唯一入口**。
 * 光看"这道题错了 3 次"说明不了任何问题；
 * 看他写的 SQL 才能发现"他一直把 JOIN 写成逗号连接"这种具体毛病。
 */
import { db } from '../db/index.js';
import { sqlPool } from '../lib/sqlRunner.js';
import { judgeSql, finalResultSet } from '../lib/sqlCompare.js';
import { analyze } from '../lib/sqlGuard.js';
import { xpFor, comboBonus, levelInfo, checkAchievements } from '../lib/game.js';
import { todayLocal } from '../lib/dates.js';
import { bumpStats } from '../db/index.js';
import { refreshAchievements, addXp } from '../lib/progress.js';
import { rl } from '../lib/rateLimit.js';
import { refCacheKey, cachedReference } from '../lib/refCache.js';

const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

const WRITE_HEAD = /^\s*(insert|update|delete|replace|create|drop|alter|with\s+.*\b(insert|update|delete)\b)/is;

/** 这个关卡允不允许写操作。 */
function levelAllowsWrite(level) {
  if (level.check_sql) return true;
  return WRITE_HEAD.test(level.reference_sql || '');
}

async function loadDataset(id) {
  const d = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
  if (!d) throw new Error('数据集不存在');
  return d;
}

function recordRun(userId, { datasetId, levelId, sql, res }) {
  try {
    db.prepare(`INSERT INTO sql_runs
      (id, user_id, dataset_id, level_id, sql, ok, ms, row_count, error, date, ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId, datasetId, levelId || '', String(sql).slice(0, 4000),
      res.ok ? 1 : 0, res.ms || 0,
      (finalResultSet(res)?.rows || []).length,
      String(res.error || '').slice(0, 500),
      todayLocal(), Date.now(),
    );
  } catch { /* 记录失败不能连累主流程 */ }
}

export default async function sqlRoutes(fastify) {
  /* ============ 自由运行（SQL 实训场 / 广场）============ */
  fastify.post('/api/sql/run', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(60, '1 minute') },
    schema: {
      body: {
        type: 'object',
        required: ['sql'],
        properties: {
          datasetId: { type: 'string' },
          sql: { type: 'string', maxLength: 20000 },
          explain: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const { datasetId = 'school', sql, explain = false } = req.body;

    const pre = analyze(sql, { allowWrite: true });
    if (pre.errors.length) {
      return { ok: false, phase: 'guard', error: pre.errors[0], warnings: pre.warnings };
    }

    let ds;
    try { ds = await loadDataset(datasetId); }
    catch { return reply.code(404).send({ error: '数据集不存在' }); }

    /* 自由模式允许写操作。理由：worker 每次任务都新建内存库，
     * 写操作只影响这一份用完就扔的副本 —— 而教学上必须允许写，
     * 不让学生写 INSERT/UPDATE/CREATE，SQL 就只教了一半。
     * 真正拦的是 ATTACH / load_extension 那些能逃出内存库的东西，见 sqlGuard。 */
    const res = await sqlPool.run({
      ddl: ds.ddl, seed: ds.seed, sql, allowWrite: true, explain,
    }, { timeout: 4000 });

    recordRun(req.user.id, { datasetId, sql, res });
    return {
      ok: res.ok,
      phase: res.phase,
      error: res.error || '',
      warnings: [...(res.warnings || []), ...pre.warnings],
      ms: res.ms,
      results: res.results || [],
    };
  });

  /* ============ 提交关卡 ============ */
  fastify.post('/api/sql/levels/:id/submit', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(40, '1 minute') },
    schema: {
      body: {
        type: 'object',
        required: ['sql'],
        properties: {
          sql: { type: 'string', maxLength: 20000 },
          usedHint: { type: 'boolean' },
          durationMs: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const level = db.prepare('SELECT * FROM sql_levels WHERE id = ?').get(req.params.id);
    if (!level) return reply.code(404).send({ error: '关卡不存在' });

    const ds = await loadDataset(level.dataset_id);
    const userSql = String(req.body.sql || '');
    const allowWrite = levelAllowsWrite(level);

    const pre = analyze(userSql, { allowWrite });
    if (pre.errors.length) {
      return { pass: false, reason: 'GUARD', message: pre.errors[0], warnings: pre.warnings };
    }

    let verdict;

    if (level.check_sql) {
      /* ---- 路径 ②：自定义校验 ----
       * 把学生 SQL 和 check_sql 拼成一条提交，让 check 看到学生改过的状态。 */
      const combined = `${userSql}\n;\n${level.check_sql}`;
      const res = await sqlPool.run(
        { ddl: ds.ddl, seed: ds.seed, sql: combined, allowWrite: true },
        { timeout: 4000 },
      );
      recordRun(req.user.id, { datasetId: ds.id, levelId: level.id, sql: userSql, res });

      if (!res.ok && res.phase !== 'done') {
        verdict = { pass: false, reason: res.phase === 'timeout' ? 'TIMEOUT' : 'SQL_ERROR', message: res.error };
      } else {
        const check = finalResultSet(res);
        const val = check?.rows?.[0]?.[0];
        const ok = !!val;
        verdict = {
          pass: ok,
          reason: ok ? 'OK' : 'CHECK_FAILED',
          message: ok
            ? '通过。数据已经改成了预期的状态。'
            : '还没有达到题目要求的状态。可以先用 SELECT 看一眼当前数据，再对照题目要求逐条核对。',
        };
        // 学生自己写的 SELECT 结果也回给他，方便自查
        const lastUserResult = [...(res.results || [])].reverse().find((r) => r.columns?.length);
        if (lastUserResult) {
          verdict.actual = {
            columns: lastUserResult.columns,
            rows: (lastUserResult.rows || []).slice(0, 50),
            rowCount: (lastUserResult.rows || []).length,
          };
        }
      }
    } else {
      /* ---- 路径 ①：结果集比对 ----
       * 参考答案走内容哈希缓存（lib/refCache.js）：
       * 300 个学生做同一道题只算一次，判题路径的 worker 占用直接减半。
       * 键里含 ddl / seed / reference_sql / allowWrite ——
       * 老师改了题就自动换键，不需要任何失效逻辑。 */
      const refTask = { ddl: ds.ddl, seed: ds.seed, sql: level.reference_sql, allowWrite };
      const [userRes, refRes] = await Promise.all([
        sqlPool.run({ ddl: ds.ddl, seed: ds.seed, sql: userSql, allowWrite }, { timeout: 4000 }),
        cachedReference(refCacheKey(refTask), () => sqlPool.run(refTask, { timeout: 4000 })),
      ]);
      recordRun(req.user.id, { datasetId: ds.id, levelId: level.id, sql: userSql, res: userRes });

      if (refRes.phase === 'internal' || refRes.phase === 'worker') {
        // 参考答案本身跑不动 —— 这是配置问题，不该让学生背锅
        req.log.error({ levelId: level.id, err: refRes.error }, '参考答案执行失败');
        return { pass: false, reason: 'REFERENCE_BROKEN', message: '这道题的参考答案配置有问题，请联系老师。' };
      }

      const v = judgeSql(userRes, refRes, {
        orderMatters: level.order_matters === 1,
        requireColumns: level.require_columns === 1,
      });
      verdict = v;
    }

    /* ---- 记录作答 ---- */
    const now = Date.now();
    const today = todayLocal();
    const prevTries = db.prepare(`
      SELECT COUNT(*) n, MAX(correct) ok FROM attempts
      WHERE user_id = ? AND kind = 'level' AND ref_id = ?
    `).get(req.user.id, level.id);
    const firstTry = prevTries.n === 0;
    const alreadyPassed = prevTries.ok === 1;

    db.prepare(`INSERT INTO attempts
      (id, user_id, kind, ref_id, kid, answer, correct, score, context, date, ts, duration_ms, error_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `att_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      req.user.id, 'level', level.id, level.kid || '',
      String(userSql).slice(0, 4000),
      verdict.pass ? 1 : 0, verdict.pass ? 100 : 0,
      'level', today, now, req.body.durationMs || 0,
      verdict.pass ? '' : (verdict.reason || 'wrong'),
    );

    if (level.kid) bumpStats(req.user.id, level.kid, today, verdict.pass ? 1 : 0, now);

    /* ---- 加分：只在"首次通过"给分 ----
     * 重复刷同一关不给 XP，否则刷关就是刷分。 */
    let gained = 0;
    if (verdict.pass && !alreadyPassed) {
      const base = xpFor({
        correct: true, kind: 'level', context: 'level',
        difficulty: level.difficulty, firstTry, attemptNo: prevTries.n + 1,
      });
      const combo = firstTry ? comboBonus(1) : 1;
      gained = Math.round(base * combo);
      addXp(req.user.id, gained);
    }

    const unlocked = refreshAchievements(req.user.id);

    return {
      ...verdict,
      levelId: level.id,
      firstTry,
      alreadyPassed,
      xpGained: gained,
      unlocked,
      orderMatters: level.order_matters === 1,
      // 通过之后才把参考答案给出来（过关了再看才有意义）
      reference: verdict.pass ? level.reference_sql : undefined,
    };
  });

  /* ============ 看答案（需要先做过一次）============ */
  fastify.get('/api/sql/levels/:id/solution', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const level = db.prepare('SELECT * FROM sql_levels WHERE id = ?').get(req.params.id);
    if (!level) return reply.code(404).send({ error: '关卡不存在' });

    /* 门槛：至少提交过一次。完全不让看会把人卡死（有些题就是想不到），
     * 但一次都没试过就看答案，等于把练习变成了阅读。 */
    const tries = db.prepare(`
      SELECT COUNT(*) n FROM attempts WHERE user_id = ? AND kind = 'level' AND ref_id = ?
    `).get(req.user.id, level.id).n;
    if (tries === 0) {
      return reply.code(403).send({ error: '先自己试着写一次，再来看答案 —— 直接看会失去练习的意义', code: 'TRY_FIRST' });
    }

    return { reference: level.reference_sql, hint: level.hint, tries };
  });

  /* ============ 运行历史 ============ */
  fastify.get('/api/sql/history', {
    preHandler: fastify.requireAuth,
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  }, async (req) => {
    const rows = db.prepare(`
      SELECT id, dataset_id, level_id, sql, ok, ms, row_count, error, ts
      FROM sql_runs WHERE user_id = ? ORDER BY ts DESC LIMIT ?
    `).all(req.user.id, req.query.limit ?? 30);
    return {
      runs: rows.map((r) => ({
        id: r.id, datasetId: r.dataset_id, levelId: r.level_id, sql: r.sql,
        ok: r.ok === 1, ms: r.ms, rowCount: r.row_count, error: r.error, ts: r.ts,
      })),
    };
  });

  /* ============ 索引实验：真跑 EXPLAIN 验证 ============ */
  fastify.post('/api/sql/labs/:id/submit', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(40, '1 minute') },
    schema: {
      body: { type: 'object', required: ['pick'], properties: { pick: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const lab = db.prepare("SELECT * FROM labs WHERE id = ? AND kind = 'index'").get(req.params.id);
    if (!lab) return reply.code(404).send({ error: '实验不存在' });

    const payload = parseJson(lab.payload, {});
    const answer = parseJson(lab.answer, {});
    const ds = await loadDataset(payload.dataset_id);

    /* ★ 对每个选项**真的跑一遍** EXPLAIN QUERY PLAN。
     * 不查预置的 helps 字段 —— 那样只是把数据文件里的答案信一遍。
     * 真跑的意义是：结论来自引擎，不是来自我写的注释。
     * 代价是这里会起 N 个 worker 任务（N = 选项数，通常 4），
     * 在内存库上是毫秒级，可以接受。 */
    const plans = [];
    for (const opt of payload.options || []) {
      const sql = [
        opt.ddl ? opt.ddl + ';' : '',
        `EXPLAIN QUERY PLAN ${payload.query}`,
      ].filter(Boolean).join('\n');

      const res = await sqlPool.run(
        { ddl: ds.ddl, seed: ds.seed, sql, allowWrite: true },
        { timeout: 4000 },
      );
      const last = [...(res.results || [])].reverse().find((r) => r.columns?.length);
      const detail = last ? last.rows.map((r) => String(r[3] ?? r[1] ?? '')).join(' | ') : '';
      plans.push({
        key: opt.key,
        label: opt.label,
        ddl: opt.ddl,
        detail: detail || (res.error || ''),
        usesIndex: /SEARCH/i.test(detail),
      });
    }

    const winners = plans.filter((p) => p.usesIndex).map((p) => p.key);
    const noneOpt = (payload.options || []).find((o) => o.ddl == null);
    const correct = winners.length ? winners : (noneOpt ? [noneOpt.key] : []);
    const pass = correct.includes(req.body.pick);

    const now = Date.now();
    const today = todayLocal();
    db.prepare(`INSERT INTO attempts
      (id, user_id, kind, ref_id, kid, answer, correct, score, context, date, ts, error_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `att_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      req.user.id, 'lab', lab.id, lab.kid || '', String(req.body.pick),
      pass ? 1 : 0, pass ? 100 : 0, 'lab', today, now, pass ? '' : 'wrong',
    );
    if (lab.kid) bumpStats(req.user.id, lab.kid, today, pass ? 1 : 0, now);

    let xpGained = 0;
    if (pass) {
      const prevOk = db.prepare(`
        SELECT MAX(correct) ok FROM attempts WHERE user_id = ? AND kind = 'lab' AND ref_id = ?
      `).get(req.user.id, lab.id).ok;
      if (prevOk !== 1) {
        xpGained = xpFor({ correct: true, kind: 'lab', difficulty: lab.difficulty });
        addXp(req.user.id, xpGained);
      }
    }
    const unlocked = refreshAchievements(req.user.id);

    return {
      pass,
      correctKeys: correct,
      pick: req.body.pick,
      plans,
      explanation: lab.explanation,
      xpGained,
      unlocked,
    };
  });
}
