/* 班级接口 /api/classes/*
 *
 * 班级是「教师 → 学生」这条权限链的载体。
 * 教师的管辖范围 = 他名下班级的成员 ∪ 他亲手创建的账号（见 lib/perms.js）。
 *
 * 学生端：用邀请码入班、看自己所在的班、看班级公告/排行榜。
 * 教师端：建班、改班、看成员学情、移出成员。
 *
 * ── 为什么学生能看到班级排行榜，但看不到别人的错题 ──────────────
 * 排行榜是激励，错题是隐私。同一个班级里的人能看到"张三这次练习
 * 正确率 92%"，但不该看到"张三在哪道题上错了"。
 * 这条线在 canViewDetail 里划：同班同学的**聚合数字**可以看，
 * **明细**只有教师能看。
 */
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { isStaff, isAdmin, canManage } from '../lib/perms.js';
import { diagnoseClass } from '../lib/diagnose.js';
import { levelInfo } from '../lib/game.js';
import { todayLocal, lastDays } from '../lib/dates.js';
import { rl } from '../lib/rateLimit.js';

const newId = () => crypto.randomBytes(4).toString('hex').toUpperCase();

/** 班级邀请码：6 位大写字母数字，去掉容易看错的 O/0/I/1。 */
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function shapeClass(c, extra = {}) {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    term: c.term,
    description: c.description,
    status: c.status,
    teacherId: c.teacher_id,
    teacherName: c.teacher_name || '',
    createdAt: c.created_at,
    memberCount: c.member_count ?? 0,
    ...extra,
  };
}

const CLASS_LIST_SQL = `
  SELECT c.*, u.username AS teacher_name,
         (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS member_count
  FROM classes c JOIN users u ON u.id = c.teacher_id
`;

/** 取班级并校验「我能不能管它」。返回 { klass } 或 { code, error }。 */
function loadManageable(req, classId) {
  const klass = db.prepare(`${CLASS_LIST_SQL} WHERE c.id = ?`).get(classId);
  if (!klass) return { code: 404, error: '班级不存在' };
  if (isAdmin(req.user)) return { klass };
  if (klass.teacher_id !== req.user.id) {
    // 403 而不是 404 —— 详见 lib/perms.js 顶部关于存在性探测的说明
    return { code: 403, error: '这不是你的班级' };
  }
  return { klass };
}

export default async function classRoutes(fastify) {
  /* ============ 我看到的班级列表 ============ */
  fastify.get('/api/classes', { preHandler: fastify.requireAuth }, async (req) => {
    if (isStaff(req.user)) {
      const mine = isAdmin(req.user)
        ? db.prepare(`${CLASS_LIST_SQL} ORDER BY c.created_at DESC`).all()
        : db.prepare(`${CLASS_LIST_SQL} WHERE c.teacher_id = ? ORDER BY c.created_at DESC`).all(req.user.id);

      const joined = db.prepare(`
        ${CLASS_LIST_SQL}
        JOIN class_members m ON m.class_id = c.id AND m.user_id = ?
        ORDER BY c.created_at DESC`).all(req.user.id);

      return { teaching: mine.map((c) => shapeClass(c)), joined: joined.map((c) => shapeClass(c)) };
    }

    const joined = db.prepare(`
      ${CLASS_LIST_SQL}
      JOIN class_members m ON m.class_id = c.id AND m.user_id = ?
      ORDER BY c.created_at DESC`).all(req.user.id);
    return { teaching: [], joined: joined.map((c) => shapeClass(c)) };
  });

  /* ============ 建班（教师）============ */
  fastify.post('/api/classes', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 60 },
          term: { type: 'string', maxLength: 40 },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => {
    const name = String(req.body.name).trim();
    if (!name) return reply.code(400).send({ error: '班级名不能为空' });

    /* 邀请码唯一。碰撞概率极低（32^6 ≈ 10 亿），但真撞上时报错信息
     * 会是一句「UNIQUE constraint failed」，所以重试几次而不是直接失败。 */
    let code = '';
    for (let i = 0; i < 10; i++) {
      const c = genCode();
      if (!db.prepare('SELECT 1 FROM classes WHERE code = ?').get(c)) { code = c; break; }
    }
    if (!code) return reply.code(500).send({ error: '生成邀请码失败，请重试' });

    const info = db.prepare(`INSERT INTO classes (name, code, teacher_id, term, description)
      VALUES (?,?,?,?,?)`).run(
      name, code, req.user.id,
      String(req.body.term || '').slice(0, 40),
      String(req.body.description || '').slice(0, 500),
    );

    audit(req, 'class_create', { detail: { name, code } });
    const klass = db.prepare(`${CLASS_LIST_SQL} WHERE c.id = ?`).get(info.lastInsertRowid);
    return { ok: true, class: shapeClass(klass) };
  });

  /* ============ 班级详情 ============ */
  fastify.get('/api/classes/:id', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const klass = db.prepare(`${CLASS_LIST_SQL} WHERE c.id = ?`).get(req.params.id);
    if (!klass) return reply.code(404).send({ error: '班级不存在' });

    const canManageIt = isAdmin(req.user) || klass.teacher_id === req.user.id;
    const isMember = !!db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?')
      .get(klass.id, req.user.id);

    if (!canManageIt && !isMember) {
      return reply.code(403).send({ error: '你不在这个班级里' });
    }

    const members = db.prepare(`
      SELECT u.id, u.username, u.email, u.real_name, u.student_no, u.status, u.avatar_hue,
             m.joined_at,
             COALESCE(g.xp, 0) xp,
             COALESCE(a.n, 0) attempts, COALESCE(a.c, 0) correct, COALESCE(a.days, 0) days
      FROM class_members m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN game_state g ON g.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) n, SUM(correct) c, COUNT(DISTINCT date) days
                 FROM attempts GROUP BY user_id) a ON a.user_id = u.id
      WHERE m.class_id = ?
      ORDER BY u.username`).all(klass.id);

    const shaped = members.map((m) => {
      const lv = levelInfo(m.xp || 0);
      return {
        id: m.id,
        username: m.username,
        realName: m.real_name,
        studentNo: m.student_no,
        status: m.status,
        avatarHue: m.avatar_hue,
        joinedAt: m.joined_at,
        isMe: m.id === req.user.id,
        stats: {
          xp: m.xp || 0,
          level: lv.level,
          levelTitle: lv.title,
          attempts: m.attempts || 0,
          correct: m.correct || 0,
          accuracy: m.attempts ? Math.round((m.correct / m.attempts) * 100) : 0,
          activeDays: m.days || 0,
        },
      };
    });

    const assignments = db.prepare(`
      SELECT a.*, (SELECT COUNT(*) FROM assignment_items i WHERE i.assignment_id = a.id) AS item_count,
             (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'graded') AS graded_count,
             (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submitted_count
      FROM assignments a WHERE a.class_id = ? ORDER BY a.created_at DESC`).all(klass.id);

    const body = {
      class: shapeClass(klass, { canManage: canManageIt }),
      members: shaped,
      assignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        brief: a.brief,
        dueAt: a.due_at,
        status: a.status,
        totalPoints: a.total_points,
        itemCount: a.item_count,
        submittedCount: a.submitted_count,
        gradedCount: a.graded_count,
        createdAt: a.created_at,
      })),
    };

    /* ★ 教师看到的成员**含邮箱**，学生看到的**不含**。
     * 同班同学之间没有互相看邮箱的理由，而邮箱是最常被爬的字段。
     * 这个分支是隐私边界的一个具体落点。 */
    if (!canManageIt) {
      body.members = shaped.map(({ email, studentNo, ...rest }) => ({ ...rest }));
    } else {
      body.members = shaped.map((m, i) => ({ ...m, email: members[i].email }));
    }

    return body;
  });

  /* ============ 改班级（教师）============ */
  fastify.patch('/api/classes/:id', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 60 },
          term: { type: 'string', maxLength: 40 },
          description: { type: 'string', maxLength: 500 },
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
    if (b.name !== undefined) { sets.push('name = ?'); params.push(String(b.name).trim()); }
    if (b.term !== undefined) { sets.push('term = ?'); params.push(String(b.term).slice(0, 40)); }
    if (b.description !== undefined) { sets.push('description = ?'); params.push(String(b.description).slice(0, 500)); }
    if (b.status !== undefined && ['active', 'archived'].includes(b.status)) {
      sets.push('status = ?'); params.push(b.status);
    }
    if (!sets.length) return { ok: true, changed: {} };

    db.prepare(`UPDATE classes SET ${sets.join(', ')} WHERE id = ?`).run(...params, r.klass.id);
    audit(req, 'class_update', { detail: { classId: r.klass.id, changed: b } });
    const fresh = db.prepare(`${CLASS_LIST_SQL} WHERE c.id = ?`).get(r.klass.id);
    return { ok: true, class: shapeClass(fresh) };
  });

  /* ============ 重置邀请码 ============ */
  fastify.post('/api/classes/:id/rotate-code', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    let code = '';
    for (let i = 0; i < 10; i++) {
      const c = genCode();
      if (!db.prepare('SELECT 1 FROM classes WHERE code = ?').get(c)) { code = c; break; }
    }
    db.prepare('UPDATE classes SET code = ? WHERE id = ?').run(code, r.klass.id);
    audit(req, 'class_rotate_code', { detail: { classId: r.klass.id, newCode: code } });
    return { ok: true, code };
  });

  /* ============ 删班（教师）============
   * 删班不删学生 —— 只解除关联。学生和他的学习数据都还在，
   * 只是不再属于这个班。这是有意的：删班的意图是"这学期的课结束了"，
   * 不是"把这些学生的记录抹掉"。 */
  fastify.delete('/api/classes/:id', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const n = db.prepare('SELECT COUNT(*) n FROM class_members WHERE class_id = ?').get(r.klass.id).n;
    db.prepare('DELETE FROM classes WHERE id = ?').run(r.klass.id);
    audit(req, 'class_delete', { detail: { name: r.klass.name, code: r.klass.code, memberCount: n } });
    return { ok: true, releasedStudents: n };
  });

  /* ============ 学生自己入班 ============ */
  fastify.post('/api/classes/join', {
    preHandler: fastify.requireAuth,
    config: { rateLimit: rl(10, '10 minutes') },
    schema: {
      body: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const klass = db.prepare(`${CLASS_LIST_SQL} WHERE c.code = ?`).get(code);
    if (!klass) return reply.code(404).send({ error: '邀请码无效' });
    if (klass.status !== 'active') return reply.code(400).send({ error: '这个班级已归档，不能加入' });
    if (klass.teacher_id === req.user.id) return reply.code(400).send({ error: '你是这个班级的老师，不需要加入' });

    const exists = db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?')
      .get(klass.id, req.user.id);
    if (exists) return { ok: true, already: true, class: shapeClass(klass) };

    db.prepare('INSERT INTO class_members (class_id, user_id) VALUES (?,?)').run(klass.id, req.user.id);
    return { ok: true, class: shapeClass(klass) };
  });

  /* ============ 退出班级 ============ */
  fastify.post('/api/classes/:id/leave', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const klass = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
    if (!klass) return reply.code(404).send({ error: '班级不存在' });
    if (klass.teacher_id === req.user.id) {
      return reply.code(400).send({ error: '你是这个班级的老师，不能退出（可以删班）' });
    }
    const r = db.prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(klass.id, req.user.id);
    if (!r.changes) return reply.code(404).send({ error: '你不在这个班级里' });
    return { ok: true };
  });

  /* ============ 教师把学生移出班级 ============ */
  fastify.delete('/api/classes/:id/members/:userId', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const target = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(req.params.userId);
    if (!target) return reply.code(404).send({ error: '学生不存在' });

    const del = db.prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?')
      .run(r.klass.id, target.id);
    if (!del.changes) return reply.code(404).send({ error: '这个学生不在班级里' });

    audit(req, 'class_remove_member', {
      target, detail: { classId: r.klass.id, className: r.klass.name },
    });
    return { ok: true };
  });

  /* ============ 班级学情分析（教师）============ */
  fastify.get('/api/classes/:id/analytics', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const r = loadManageable(req, req.params.id);
    if (r.error) return reply.code(r.code).send({ error: r.error });

    const members = db.prepare(`
      SELECT u.id, u.username FROM class_members m
      JOIN users u ON u.id = m.user_id WHERE m.class_id = ?`).all(r.klass.id);

    const students = members.map((m) => {
      const stats = {};
      for (const s of db.prepare('SELECT kid, n, c FROM stats_node WHERE user_id = ?').all(m.id)) {
        stats[s.kid] = { n: s.n, c: s.c };
      }
      return { userId: m.id, username: m.username, stats };
    });

    const meta = {};
    for (const k of db.prepare('SELECT id, title, chapter_id FROM knowledge').all()) {
      meta[k.id] = { title: k.title, chapterId: k.chapter_id };
    }
    const edges = db.prepare('SELECT from_kid, to_kid, type, strength FROM knowledge_edges').all();

    const analysis = diagnoseClass(students, edges, meta);

    /* 最近 14 天的班级活跃度。教师最关心的一个数字是
     * 「有多少人这几天根本没来」—— 那比平均分更能说明问题。 */
    const days = lastDays(14);
    const activity = days.map((d) => {
      const row = db.prepare(`
        SELECT COUNT(DISTINCT a.user_id) users, COUNT(*) n, SUM(a.correct) c
        FROM attempts a JOIN class_members m ON m.user_id = a.user_id
        WHERE m.class_id = ? AND a.date = ?`).get(r.klass.id, d);
      return { date: d, activeUsers: row.users || 0, attempts: row.n || 0, correct: row.c || 0 };
    });

    const inactive = db.prepare(`
      SELECT u.id, u.username,
             (SELECT MAX(a.date) FROM attempts a WHERE a.user_id = u.id) AS last_active
      FROM class_members m JOIN users u ON u.id = m.user_id
      WHERE m.class_id = ?
      ORDER BY last_active IS NULL DESC, last_active ASC`).all(r.klass.id)
      .filter((u) => !u.last_active || u.last_active < days[days.length - 2]);

    const today = todayLocal();
    return {
      class: shapeClass(r.klass),
      total: members.length,
      analysis: {
        summary: analysis.summary,
        common: analysis.common.slice(0, 12),
        perStudent: analysis.perStudent.map((s) => ({
          userId: s.userId,
          username: s.username,
          summary: s.summary,
          rootCount: s.roots.length,
          topRoot: s.roots[0] || null,
          weakCount: s.weak.length,
        })),
      },
      activity,
      inactive: inactive.map((u) => ({ id: u.id, username: u.username, lastActive: u.last_active || null })),
      today,
    };
  });
}

/** 写一条管理审计。审计是旁路，失败不能连累主流程。 */
function audit(req, action, { target = null, detail = {} } = {}) {
  try {
    db.prepare(`INSERT INTO admin_log (actor_id, actor_email, target_id, target_email, action, detail, ip)
      VALUES (?,?,?,?,?,?,?)`).run(
      req.user.id, req.user.email,
      target?.id ?? null, target?.email ?? null,
      action, JSON.stringify(detail), String(req.ip || '').slice(0, 60),
    );
  } catch (e) {
    req.log.error({ err: e }, '写审计失败');
  }
}
