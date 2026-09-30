/* 作业接口 /api/assignments/*
 *
 * ── 提交时存快照，而不是每次回查 attempts ────────────────────────
 * 学生交卷后还会继续刷题，attempts 会一直长。
 * 如果作业详情每次实时回查 attempts，一份已批改的作业会随着学生
 * 继续练习而"变分"—— 教师看到 82 分，过两天变成 78 分，而且没人知道为什么。
 *
 * 所以 submissions.detail 存的是**交卷那一刻的作答快照**。
 * 快照是契约，attempts 是流水。这条界限不划清楚，
 * 作业成绩就不是一个可信的数字。
 */
import { db } from '../db/index.js';
import { isStaff, isAdmin, canManage } from '../lib/perms.js';
import { judgeQuestion } from '../lib/judge.js';
import { judgeSql } from '../lib/sqlCompare.js';
import { judgeNormalize, parseAttrGroup, parseSchemeList } from '../lib/normalize.js';
import { sqlPool } from '../lib/sqlRunner.js';
import { rl } from '../lib/rateLimit.js';

const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

function audit(req, action, { target = null, detail = {} } = {}) {
  try {
    db.prepare(`INSERT INTO admin_log (actor_id, actor_email, target_id, target_email, action, detail, ip)
      VALUES (?,?,?,?,?,?,?)`).run(
      req.user.id, req.user.email, target?.id ?? null, target?.email ?? null,
      action, JSON.stringify(detail), String(req.ip || '').slice(0, 60),
    );
  } catch { /* 审计是旁路 */ }
}

/** 这个作业我能不能管。 */
function loadManageable(req, id) {
  const a = db.prepare(`
    SELECT a.*, c.name AS class_name, c.teacher_id, u.username AS teacher_name
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    JOIN users u ON u.id = a.teacher_id
    WHERE a.id = ?`).get(id);
  if (!a) return { code: 404, error: '作业不存在' };
  if (!(isAdmin(req.user) || a.teacher_id === req.user.id)) {
    return { code: 403, error: '这不是你布置的作业' };
  }
  return { assignment: a };
}

/** 学生是否在这个作业的班里。 */
function isEnrolled(userId, classId) {
  return !!db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, userId);
}

export default async function assignmentRoutes(fastify) {
  /* ============ 布置作业（教师）============ */
  fastify.post('/api/assignments', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        required: ['classId', 'title', 'items'],
        properties: {
          classId: { type: 'integer' },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          brief: { type: 'string', maxLength: 2000 },
          dueAt: { type: 'string' },
          items: {
            type: 'array', minItems: 1, maxItems: 100,
            items: {
              type: 'object',
              required: ['kind', 'refId'],
              properties: {
                kind: { type: 'string' },
                refId: { type: 'string' },
                points: { type: 'integer', minimum: 1, maximum: 100 },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body;
    const klass = db.prepare('SELECT * FROM classes WHERE id = ?').get(b.classId);
    if (!klass) return reply.code(404).send({ error: '班级不存在' });
    if (!(isAdmin(req.user) || klass.teacher_id === req.user.id)) {
      return reply.code(403).send({ error: '这不是你的班级', code: 'FORBIDDEN' });
    }

    /* 校验每道题都真实存在。不校验的话，教师手抖写错一个 id，
     * 学生那边就会看到一道空白题，而作业本身"布置成功"了。 */
    const bad = [];
    for (const it of b.items) {
      const table = { question: 'questions', level: 'sql_levels', normalize: 'normalize_tasks', lab: 'labs' }[it.kind];
      if (!table) { bad.push(`${it.refId}（未知类型 ${it.kind}）`); continue; }
      if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(it.refId)) bad.push(it.refId);
    }
    if (bad.length) return reply.code(400).send({ error: `这些题目不存在：${bad.join('、')}` });

    const total = b.items.reduce((s, it) => s + (it.points || 10), 0);

    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO assignments
        (class_id, teacher_id, title, brief, due_at, total_points, status)
        VALUES (?,?,?,?,?,?, 'published')`).run(
        b.classId, req.user.id, String(b.title).trim().slice(0, 120),
        String(b.brief || '').slice(0, 2000),
        b.dueAt || null, total,
      );
      const aid = Number(info.lastInsertRowid);
      const ins = db.prepare(`INSERT INTO assignment_items
        (id, assignment_id, kind, ref_id, points, sort_order) VALUES (?,?,?,?,?,?)`);
      b.items.forEach((it, i) => {
        ins.run(`ai_${aid}_${i}`, aid, it.kind, it.refId, it.points || 10, i + 1);
      });
      return aid;
    })();

    audit(req, 'assignment_create', {
      detail: { assignmentId: id, classId: b.classId, itemCount: b.items.length, totalPoints: total },
    });
    return { ok: true, id, totalPoints: total };
  });

  /* ============ 作业列表 ============ */
  fastify.get('/api/assignments', { preHandler: fastify.requireAuth }, async (req) => {
    if (isStaff(req.user)) {
      const clause = isAdmin(req.user) ? '' : 'WHERE a.teacher_id = ?';
      const params = isAdmin(req.user) ? [] : [req.user.id];
      const rows = db.prepare(`
        SELECT a.*, c.name AS class_name,
          (SELECT COUNT(*) FROM assignment_items i WHERE i.assignment_id = a.id) AS item_count,
          (SELECT COUNT(*) FROM class_members m WHERE m.class_id = a.class_id) AS member_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submitted_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'graded') AS graded_count
        FROM assignments a JOIN classes c ON c.id = a.class_id
        ${clause} ORDER BY a.created_at DESC`).all(...params);

      return {
        role: 'teacher',
        assignments: rows.map((a) => ({
          id: a.id, classId: a.class_id, className: a.class_name, title: a.title,
          brief: a.brief, dueAt: a.due_at, status: a.status, totalPoints: a.total_points,
          itemCount: a.item_count, memberCount: a.member_count,
          submittedCount: a.submitted_count, gradedCount: a.graded_count,
          createdAt: a.created_at,
        })),
      };
    }

    /* 学生视角：我所在班级的、已发布的作业 + 我的提交状态。
     * 截止时间过了仍然能看到（可能还能补交，由教师决定）。 */
    const rows = db.prepare(`
      SELECT a.*, c.name AS class_name, u.username AS teacher_name,
        (SELECT COUNT(*) FROM assignment_items i WHERE i.assignment_id = a.id) AS item_count,
        s.status AS my_status, s.score AS my_score, s.submitted_at AS my_submitted_at, s.graded_at AS my_graded_at
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      JOIN users u ON u.id = a.teacher_id
      JOIN class_members m ON m.class_id = a.class_id AND m.user_id = ?
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = ?
      WHERE a.status = 'published'
      ORDER BY (a.due_at IS NULL), a.due_at ASC, a.created_at DESC
    `).all(req.user.id, req.user.id);

    const now = Date.now();
    return {
      role: 'student',
      assignments: rows.map((a) => ({
        id: a.id, classId: a.class_id, className: a.class_name, teacherName: a.teacher_name,
        title: a.title, brief: a.brief, dueAt: a.due_at, status: a.status,
        totalPoints: a.total_points, itemCount: a.item_count,
        myStatus: a.my_status || 'pending',
        myScore: a.my_score ?? null,
        submittedAt: a.my_submitted_at,
        gradedAt: a.my_graded_at,
        overdue: a.due_at ? Date.parse(a.due_at) < now : false,
      })),
    };
  });

  /* ============ 作业详情 ============ */
  fastify.get('/api/assignments/:id', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const a = db.prepare(`
      SELECT a.*, c.name AS class_name, u.username AS teacher_name
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      JOIN users u ON u.id = a.teacher_id
      WHERE a.id = ?`).get(req.params.id);
    if (!a) return reply.code(404).send({ error: '作业不存在' });

    const mine = isAdmin(req.user) || a.teacher_id === req.user.id;
    const enrolled = isEnrolled(req.user.id, a.class_id);
    if (!mine && !enrolled) return reply.code(403).send({ error: '你不在这个作业的班级里' });

    const items = db.prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order').all(a.id);

    /* 题目内容按类型取。★ 对**学生**，客观题不下发 answer，
     * SQL 关卡不下发 reference_sql —— 和 catalog 的口径一致。 */
    const shapedItems = items.map((it) => {
      const base = { id: it.id, kind: it.kind, refId: it.ref_id, points: it.points, order: it.sort_order };
      if (it.kind === 'question') {
        const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(it.ref_id);
        return {
          ...base,
          question: q ? {
            id: q.id, type: q.type, difficulty: q.difficulty, stem: q.stem,
            options: parseJson(q.options, null),
            ...(mine ? { answer: q.answer, analysis: q.analysis, steps: parseJson(q.steps, []) } : {}),
          } : null,
        };
      }
      if (it.kind === 'level') {
        const l = db.prepare('SELECT * FROM sql_levels WHERE id = ?').get(it.ref_id);
        const ds = l ? db.prepare('SELECT id, title FROM datasets WHERE id = ?').get(l.dataset_id) : null;
        return {
          ...base,
          level: l ? {
            id: l.id, title: l.title, brief: l.brief, hint: l.hint,
            starterSql: l.starter_sql, datasetId: l.dataset_id,
            datasetTitle: ds?.title || '', difficulty: l.difficulty,
            orderMatters: l.order_matters === 1,
            ...(mine ? { reference: l.reference_sql } : {}),
          } : null,
        };
      }
      if (it.kind === 'normalize') {
        const t = db.prepare('SELECT * FROM normalize_tasks WHERE id = ?').get(it.ref_id);
        return {
          ...base,
          task: t ? {
            id: t.id, title: t.title, brief: t.brief,
            attrs: parseJson(t.attrs, []), fds: parseJson(t.fds, []),
            ask: t.ask, target: t.target, hint: t.hint, difficulty: t.difficulty,
          } : null,
        };
      }
      if (it.kind === 'lab') {
        const lb = db.prepare('SELECT * FROM labs WHERE id = ?').get(it.ref_id);
        return {
          ...base,
          lab: lb ? {
            id: lb.id, kind: lb.kind, title: lb.title, brief: lb.brief,
            payload: parseJson(lb.payload, {}), difficulty: lb.difficulty,
          } : null,
        };
      }
      return base;
    });

    const body = {
      assignment: {
        id: a.id, classId: a.class_id, className: a.class_name,
        teacherName: a.teacher_name, title: a.title, brief: a.brief,
        dueAt: a.due_at, status: a.status, totalPoints: a.total_points,
        createdAt: a.created_at,
      },
      items: shapedItems,
      canManage: mine,
    };

    if (mine) {
      /* 教师视角：全班提交情况 + 每个人的分数。
       * 这里**不返回**学生的逐题作答明细 —— 那在单份批改页里给，
       * 列表页只需要"谁交了、多少分、要不要批"。 */
      const subs = db.prepare(`
        SELECT s.*, u.username, u.email, u.real_name, u.student_no
        FROM submissions s JOIN users u ON u.id = s.user_id
        WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC`).all(a.id);

      const members = db.prepare(`
        SELECT u.id, u.username, u.real_name, u.student_no
        FROM class_members m JOIN users u ON u.id = m.user_id
        WHERE m.class_id = ? ORDER BY u.username`).all(a.class_id);
      const subMap = new Map(subs.map((s) => [s.user_id, s]));

      body.submissions = members.map((m) => {
        const s = subMap.get(m.id);
        return {
          userId: m.id, username: m.username, realName: m.real_name, studentNo: m.student_no,
          status: s?.status || 'not_submitted',
          score: s?.score ?? null,
          submittedAt: s?.submitted_at || null,
          gradedAt: s?.graded_at || null,
          feedback: s?.feedback || '',
        };
      });
      body.stats = {
        members: members.length,
        submitted: subs.length,
        graded: subs.filter((s) => s.status === 'graded').length,
        avgScore: subs.filter((s) => s.status === 'graded').length
          ? Math.round(subs.filter((s) => s.status === 'graded').reduce((x, s) => x + s.score, 0)
            / subs.filter((s) => s.status === 'graded').length)
          : null,
      };
    } else {
      const s = db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?')
        .get(a.id, req.user.id);
      body.mySubmission = s ? {
        status: s.status,
        score: s.score,
        detail: parseJson(s.detail, []),
        feedback: s.feedback,
        submittedAt: s.submitted_at,
        gradedAt: s.graded_at,
      } : null;
    }

    return body;
  });

  /* ============ 学生提交作业 ============ */
  fastify.post('/api/assignments/:id/submit', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(10, '10 minutes') },
    schema: {
      body: {
        type: 'object',
        required: ['answers'],
        properties: {
          answers: {
            type: 'array', maxItems: 100,
            items: {
              type: 'object',
              properties: { itemId: { type: 'string' }, answer: { type: 'string' } },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!a) return reply.code(404).send({ error: '作业不存在' });
    if (a.status !== 'published') return reply.code(400).send({ error: '这份作业已经关闭了' });
    if (!isEnrolled(req.user.id, a.class_id)) {
      return reply.code(403).send({ error: '你不在这个作业的班级里', code: 'FORBIDDEN' });
    }
    if (isStaff(req.user)) return reply.code(400).send({ error: '教师不需要提交作业' });

    const existing = db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?')
      .get(a.id, req.user.id);
    if (existing && existing.status === 'graded') {
      return reply.code(400).send({ error: '这份作业已经批改过了，不能再提交' });
    }

    const items = db.prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order').all(a.id);
    const ansMap = new Map((req.body.answers || []).map((x) => [x.itemId, String(x.answer ?? '')]));

    /* 逐题自动判分。SQL 题要跑沙箱，所以这里可能有几次异步等待 ——
     * 这是整个提交接口里唯一慢的地方，但一道 SQL 题的判定是几十毫秒级，
     * 一份 10 题的作业也就一两百毫秒。 */
    const detail = [];
    let score = 0;
    let autoTotal = 0;
    let manualCount = 0;

    for (const it of items) {
      const answer = ansMap.get(it.id) ?? '';
      const rec = { itemId: it.id, kind: it.kind, refId: it.ref_id, points: it.points, answer, needsManual: false };

      if (it.kind === 'question') {
        const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(it.ref_id);
        if (q) {
          const v = judgeQuestion(q, answer);
          rec.correct = v.pass;
          rec.needsManual = !!v.needsManual;
          if (v.needsManual) { manualCount++; rec.score = null; }
          else { rec.score = Math.round((v.score / 100) * it.points); score += rec.score; autoTotal += it.points; }
        }
      } else if (it.kind === 'level') {
        const l = db.prepare('SELECT * FROM sql_levels WHERE id = ?').get(it.ref_id);
        const ds = l ? db.prepare('SELECT * FROM datasets WHERE id = ?').get(l.dataset_id) : null;
        if (l && ds) {
          const allowWrite = !!l.check_sql;
          const [userRes, refRes] = await Promise.all([
            sqlPool.run({ ddl: ds.ddl, seed: ds.seed, sql: answer, allowWrite }, { timeout: 4000 }),
            sqlPool.run({ ddl: ds.ddl, seed: ds.seed, sql: l.reference_sql, allowWrite }, { timeout: 4000 }),
          ]);
          const v = judgeSql(userRes, refRes, {
            orderMatters: l.order_matters === 1,
            requireColumns: l.require_columns === 1,
          });
          rec.correct = v.pass;
          rec.message = v.message;
          rec.score = v.pass ? it.points : 0;
          score += rec.score;
          autoTotal += it.points;
        }
      } else if (it.kind === 'normalize') {
        const t = db.prepare('SELECT * FROM normalize_tasks WHERE id = ?').get(it.ref_id);
        if (t) {
          const task = {
            attrs: parseJson(t.attrs, []), fds: parseJson(t.fds, []), ask: t.ask,
            target: t.target.includes(',') ? t.target.split(',') : t.target,
            answer: parseJson(t.answer, {}),
          };
          let parsed = answer;
          try { parsed = JSON.parse(answer); } catch { /* 学生可能直接写了 'A,B' 这种纯文本 */ }
          if (task.ask === 'closure') parsed = parseAttrGroup(parsed, task.attrs);
          else if (task.ask === 'keys' || task.ask === 'decompose') parsed = parseSchemeList(parsed, task.attrs);
          const v = judgeNormalize(task, parsed);
          rec.correct = v.pass;
          rec.message = v.message;
          rec.score = Math.round(((v.score || 0) / 100) * it.points);
          score += rec.score;
          autoTotal += it.points;
        }
      } else if (it.kind === 'lab') {
        const lb = db.prepare('SELECT * FROM labs WHERE id = ?').get(it.ref_id);
        if (lb) {
          const ans = parseJson(lb.answer, {});
          const pass = String(answer).trim().toUpperCase() === String(ans.pick || '').toUpperCase();
          rec.correct = pass;
          rec.score = pass ? it.points : 0;
          score += rec.score;
          autoTotal += it.points;
        }
      }
      detail.push(rec);
    }

    const totalPoints = items.reduce((s, it) => s + it.points, 0);
    /* 有需要人工批改的题 → 状态留在 submitted，等教师批。
     * 全自动判完 → 也留在 submitted，但分数已经算好了；
     * 教师可以选择直接"确认"（不改分）或改分。
     * 不自动置 graded 是因为"批改"这个动作意味着有人看过了，
     * 而系统判分不等于有人看过。 */
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO submissions
      (assignment_id, user_id, status, score, detail, submitted_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(assignment_id, user_id) DO UPDATE SET
        status = 'submitted', score = excluded.score, detail = excluded.detail,
        submitted_at = excluded.submitted_at, feedback = '', graded_at = NULL, graded_by = NULL`)
      .run(a.id, req.user.id, 'submitted', score, JSON.stringify(detail), now);

    return {
      ok: true,
      score,
      totalPoints,
      autoGradedPoints: autoTotal,
      manualCount,
      detail: detail.map((d) => ({
        itemId: d.itemId, kind: d.kind, refId: d.refId,
        points: d.points, score: d.score, correct: d.correct, needsManual: d.needsManual, message: d.message,
      })),
    };
  });

  /* ============ 教师批改 ============ */
  fastify.post('/api/assignments/:id/grade', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'integer' },
          score: { type: 'integer', minimum: 0, maximum: 1000 },
          feedback: { type: 'string', maxLength: 2000 },
          itemScores: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const sub = db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?')
      .get(r.assignment.id, req.body.userId);
    if (!sub) return reply.code(404).send({ error: '这个学生还没提交' });

    /* ★ 必须把 role 查出来 —— canManage 靠它判断"目标是学生还是教师"。
     * 只 SELECT 三个字段的话，target.role 是 undefined，
     * canManage 会一律判成"这不是学生"，于是教师连自己的学生都批改不了。 */
    const target = db.prepare('SELECT id, email, username, role, status FROM users WHERE id = ?').get(req.body.userId);
    const deny = canManage(req.user, target);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    const detail = parseJson(sub.detail, []);

    /* 逐题改分：只覆盖传了 itemScores 的那几题，其余保持自动判分。
     * 这样教师改一道简答题时，不用把 10 道客观题的分数都重填一遍。 */
    if (Array.isArray(req.body.itemScores)) {
      for (const is of req.body.itemScores) {
        const item = detail.find((d) => d.itemId === is.itemId);
        if (item && typeof is.score === 'number') {
          item.score = Math.max(0, Math.min(item.points, Math.round(is.score)));
          item.manual = true;
        }
      }
    }

    const autoScore = detail.reduce((s, d) => s + (typeof d.score === 'number' ? d.score : 0), 0);
    const finalScore = req.body.score !== undefined ? req.body.score : autoScore;

    db.prepare(`UPDATE submissions SET status='graded', score=?, detail=?, feedback=?,
      graded_at=datetime('now'), graded_by=? WHERE assignment_id=? AND user_id=?`).run(
      finalScore, JSON.stringify(detail), String(req.body.feedback || '').slice(0, 2000),
      req.user.id, r.assignment.id, req.body.userId,
    );

    audit(req, 'grade_submission', {
      target,
      detail: { assignmentId: r.assignment.id, autoScore, finalScore, feedback: !!req.body.feedback },
    });

    return { ok: true, score: finalScore, autoScore };
  });

  /* ============ 关闭 / 重开 / 改截止时间（教师）============ */
  fastify.patch('/api/assignments/:id', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 120 },
          brief: { type: 'string', maxLength: 2000 },
          dueAt: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const sets = [];
    const params = [];
    const b = req.body || {};
    if (b.title !== undefined) { sets.push('title = ?'); params.push(String(b.title).slice(0, 120)); }
    if (b.brief !== undefined) { sets.push('brief = ?'); params.push(String(b.brief).slice(0, 2000)); }
    if (b.dueAt !== undefined) { sets.push('due_at = ?'); params.push(b.dueAt || null); }
    if (b.status !== undefined && ['draft', 'published', 'closed'].includes(b.status)) {
      sets.push('status = ?'); params.push(b.status);
    }
    if (!sets.length) return { ok: true };

    db.prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`).run(...params, r.assignment.id);
    audit(req, 'assignment_update', { detail: { assignmentId: r.assignment.id, changed: b } });
    return { ok: true };
  });

  /* ============ 删作业（教师）============ */
  fastify.delete('/api/assignments/:id', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const n = db.prepare('SELECT COUNT(*) n FROM submissions WHERE assignment_id = ?').get(r.assignment.id).n;
    db.prepare('DELETE FROM assignments WHERE id = ?').run(r.assignment.id);
    audit(req, 'assignment_delete', { detail: { title: r.assignment.title, submissions: n } });
    return { ok: true, deletedSubmissions: n };
  });

  /* ============ 单份提交详情（教师批改用）============ */
  fastify.get('/api/assignments/:id/submission/:userId', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const target = db.prepare('SELECT id, email, username, role, status, real_name, student_no FROM users WHERE id = ?')
      .get(req.params.userId);
    if (!target) return reply.code(404).send({ error: '学生不存在' });
    const deny = canManage(req.user, target);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    const sub = db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?')
      .get(r.assignment.id, req.params.userId);
    if (!sub) return reply.code(404).send({ error: '这个学生还没提交' });

    const items = db.prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order').all(r.assignment.id);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const detail = parseJson(sub.detail, []);

    /* 逐题拼上题干与标准答案 —— 教师批改时需要对照。
     * 这里是教师视角，所以可以给答案。 */
    const graded = detail.map((d) => {
      const it = itemMap.get(d.itemId);
      const out = { ...d, points: it?.points ?? d.points };
      if (it?.kind === 'question') {
        const q = db.prepare('SELECT stem, type, options, answer, analysis, steps FROM questions WHERE id = ?').get(it.ref_id);
        out.stem = q?.stem || '';
        out.type = q?.type || '';
        out.options = parseJson(q?.options, null);
        out.correctAnswer = q?.answer || '';
        out.analysis = q?.analysis || '';
        out.steps = parseJson(q?.steps, []);
      } else if (it?.kind === 'level') {
        const l = db.prepare('SELECT title, brief, reference_sql FROM sql_levels WHERE id = ?').get(it.ref_id);
        out.stem = l?.title || '';
        out.brief = l?.brief || '';
        out.correctAnswer = l?.reference_sql || '';
        out.type = 'sql';
      } else if (it?.kind === 'normalize') {
        const t = db.prepare('SELECT title, brief FROM normalize_tasks WHERE id = ?').get(it.ref_id);
        out.stem = t?.title || '';
        out.brief = t?.brief || '';
        out.type = 'normalize';
      } else if (it?.kind === 'lab') {
        const lb = db.prepare('SELECT title, brief, explanation FROM labs WHERE id = ?').get(it.ref_id);
        out.stem = lb?.title || '';
        out.brief = lb?.brief || '';
        out.analysis = lb?.explanation || '';
        out.type = 'lab';
      }
      return out;
    });

    return {
      student: {
        id: target.id, username: target.username, email: target.email,
        realName: target.real_name, studentNo: target.student_no,
      },
      assignment: { id: r.assignment.id, title: r.assignment.title, totalPoints: r.assignment.total_points },
      submission: {
        status: sub.status, score: sub.score, feedback: sub.feedback,
        submittedAt: sub.submitted_at, gradedAt: sub.graded_at,
      },
      items: graded,
    };
  });
}
