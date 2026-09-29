/* 教师 / 管理端接口 /api/admin/*
 *
 * ── 设计原则（逐条都有具体理由，不是套话）────────────────────────
 *
 * 1. **每条路由显式挂 preHandler**，不靠"父级前缀统一挂"。
 *    Fastify 的 prefix 注册和 preHandler 组合有多种写法，
 *    而"以为挂上了其实没挂"是这类代码最典型的失效方式 ——
 *    它的表现是接口照常工作，只是谁都能调。逐条显式挂，多写十行，
 *    换的是"漏一个能被一眼看出来"。
 *
 * 2. **越权不是错误，是攻击**。拒绝一律 403 + code=FORBIDDEN。
 *    但要注意顺序：**先查存在性（404），再查权限（403）**，
 *    两者不共用分支。反过来的话 403 会变成存在性探测器。
 *
 * 3. **隐私边界**：教师对学生有完全管理权限，但有两条线不越 ——
 *    · 密码哈希/盐：连脱敏形式都不给（那是别人的口令凭据）
 *    · 别人的密钥：不是系统资产
 *    能看的是"学情数据"，不是"私人凭据"。
 *
 * 4. **护栏优先于便利**：任何会让系统失去最后一个管理员的操作一律拒绝，
 *    包括管理员对自己下手。
 *
 * 5. **所有写操作进 admin_log**，含改前/改后的值。
 *    教师端有删学生的权限 —— 没有审计日志，出事之后查不出是谁干的。
 */
import { db } from '../db/index.js';
import {
  hashPassword, generatePassword, checkEmail, checkUsername, checkPasswordStrength,
} from '../lib/password.js';
import { destroyUserSessions, logAuth } from '../lib/session.js';
import {
  ROLES, STATUSES, isAdmin, isTeacher, isStaff, canManage, canDelete, canDisable,
  canAssignRole, scopeStudentIds, shapeUser,
} from '../lib/perms.js';
import { levelInfo } from '../lib/game.js';
import { masteryOf, diagnose } from '../lib/diagnose.js';

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
    req.log.error({ err: e }, '写管理审计失败');
  }
}

function shapeStats(r) {
  const attempts = r.n || 0;
  const correct = r.c || 0;
  const lv = levelInfo(r.xp || 0);
  return {
    attempts,
    correct,
    wrong: r.w || 0,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
    xp: r.xp || 0,
    level: lv.level,
    levelTitle: lv.title,
    activeDays: r.days || 0,
    cards: r.cards || 0,
    sqlRuns: r.sql_runs || 0,
    levelsPassed: r.levels_passed || 0,
    lastActive: r.last_active || null,
  };
}

/* 学生列表查询。用 LEFT JOIN 聚合子查询一次取全，不做 N+1。
 * 用户量到几千时这里要改成物化统计表 —— 但那是另一个量级的问题；
 * 现在每次请求跑一次聚合，比为"可能的规模"提前加一层缓存更划算。 */
const LIST_SQL = `
  SELECT u.id, u.email, u.username, u.role, u.status, u.note, u.avatar_hue,
         u.real_name, u.student_no, u.created_at, u.updated_at, u.last_login_at,
         COALESCE(a.n, 0) n, COALESCE(a.c, 0) c, COALESCE(a.w, 0) w,
         COALESCE(a.days, 0) days, COALESCE(a.last_active, '') last_active,
         COALESCE(g.xp, 0) xp, COALESCE(g.best_combo, 0) best_combo,
         COALESCE(cd.cnt, 0) cards,
         COALESCE(sr.cnt, 0) sql_runs,
         COALESCE(lv.passed, 0) levels_passed
  FROM users u
  LEFT JOIN (SELECT user_id, COUNT(*) n, SUM(correct) c, SUM(1 - correct) w,
                    COUNT(DISTINCT date) days, MAX(date) last_active
             FROM attempts GROUP BY user_id) a ON a.user_id = u.id
  LEFT JOIN game_state g ON g.user_id = u.id
  LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM cards GROUP BY user_id) cd ON cd.user_id = u.id
  LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM sql_runs WHERE ok = 1 GROUP BY user_id) sr ON sr.user_id = u.id
  LEFT JOIN (SELECT user_id, COUNT(*) passed FROM (
               SELECT user_id, ref_id, MAX(correct) ok FROM attempts
               WHERE kind = 'level' GROUP BY user_id, ref_id
             ) WHERE ok = 1 GROUP BY user_id) lv ON lv.user_id = u.id
`;

/* 排序白名单。**绝不能**把前端传来的字符串直接拼进 ORDER BY ——
 * 那是教科书级的 SQL 注入，而且参数化占位符在 ORDER BY 上不生效
 * （列名不是值）。只能白名单映射。 */
const SORTS = {
  created: 'u.created_at',
  lastLogin: 'u.last_login_at',
  lastActive: 'a.last_active',
  attempts: 'n',
  accuracy: 'CASE WHEN n > 0 THEN CAST(c AS REAL) / n ELSE -1 END',
  xp: 'xp',
  username: 'u.username',
  email: 'u.email',
  studentNo: 'u.student_no',
};

export default async function adminRoutes(fastify) {
  /* ============ 总览 ============ */
  fastify.get('/api/admin/overview', { preHandler: fastify.requireTeacher }, async (req) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p) || {};
    const ids = scopeStudentIds(req.user);
    const scopeClause = ids === null ? '' : `WHERE u.id IN (${ids.length ? ids.join(',') : 'NULL'})`;

    const totals = one(`SELECT
      COUNT(*) users,
      SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) disabled,
      SUM(CASE WHEN date(last_login_at) >= date('now','localtime') THEN 1 ELSE 0 END) activeToday,
      SUM(CASE WHEN last_login_at IS NULL THEN 1 ELSE 0 END) neverLoggedIn
      FROM users u ${scopeClause}`);

    const activity = one(`SELECT
      (SELECT COUNT(*) FROM attempts WHERE user_id IN (SELECT id FROM users u ${scopeClause})) attempts,
      (SELECT COUNT(*) FROM attempts WHERE correct = 1 AND user_id IN (SELECT id FROM users u ${scopeClause})) correct,
      (SELECT COUNT(*) FROM sessions WHERE user_id IN (SELECT id FROM users u ${scopeClause})) sessions,
      (SELECT COUNT(*) FROM sql_runs WHERE user_id IN (SELECT id FROM users u ${scopeClause})) sqlRuns`);

    const classes = isAdmin(req.user)
      ? db.prepare(`SELECT c.*, u.username teacher_name,
          (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) member_count
          FROM classes c JOIN users u ON u.id = c.teacher_id ORDER BY c.created_at DESC`).all()
      : db.prepare(`SELECT c.*, u.username teacher_name,
          (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) member_count
          FROM classes c JOIN users u ON u.id = c.teacher_id
          WHERE c.teacher_id = ? ORDER BY c.created_at DESC`).all(req.user.id);

    const recent = db.prepare(`${LIST_SQL} ${scopeClause} ORDER BY u.created_at DESC LIMIT 5`)
      .all().map((r) => ({ ...shapeUser(r), stats: shapeStats(r) }));

    /* 待批改的作业数 —— 教师打开管理台第一个想知道的数字 */
    const pendingGrading = one(`
      SELECT COUNT(*) n FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      WHERE a.teacher_id = ? AND s.status = 'submitted'`, req.user.id).n || 0;

    return {
      scope: ids === null ? 'all' : `${ids.length} 名学生`,
      totals: {
        students: totals.users || 0,
        disabled: totals.disabled || 0,
        activeToday: totals.activeToday || 0,
        neverLoggedIn: totals.neverLoggedIn || 0,
      },
      activity: {
        attempts: activity.attempts || 0,
        correct: activity.correct || 0,
        accuracy: activity.attempts ? Math.round((activity.correct / activity.attempts) * 100) : 0,
        sessions: activity.sessions || 0,
        sqlRuns: activity.sqlRuns || 0,
        pendingGrading,
      },
      classes: classes.map((c) => ({
        id: c.id, name: c.name, code: c.code, term: c.term, status: c.status,
        teacherName: c.teacher_name, memberCount: c.member_count, isMine: c.teacher_id === req.user.id,
      })),
      recentStudents: recent,
    };
  });

  /* ============ 学生列表 ============ */
  fastify.get('/api/admin/students', {
    preHandler: fastify.requireTeacher,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          status: { type: 'string' },
          classId: { type: 'integer' },
          sort: { type: 'string' },
          dir: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req) => {
    const ids = scopeStudentIds(req.user);
    const where = ["u.role = 'student'"];
    const params = [];

    if (ids !== null) {
      where.push(ids.length ? `u.id IN (${ids.join(',')})` : '1 = 0');
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR u.real_name LIKE ? OR u.student_no LIKE ? OR u.note LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    if (STATUSES.includes(req.query.status)) { where.push('u.status = ?'); params.push(req.query.status); }
    if (req.query.classId) {
      where.push('EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = ? AND m.user_id = u.id)');
      params.push(req.query.classId);
    }

    const sortKey = SORTS[req.query.sort] ? req.query.sort : 'created';
    const dir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = req.query.limit ?? 50;
    const offset = req.query.offset ?? 0;
    const clause = `WHERE ${where.join(' AND ')}`;

    const rows = db.prepare(`${LIST_SQL} ${clause} ORDER BY ${SORTS[sortKey]} ${dir}, u.id ${dir} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n FROM users u ${clause}`).get(...params).n;

    return {
      students: rows.map((r) => ({
        ...shapeUser(r),
        stats: shapeStats(r),
        classes: db.prepare(`
          SELECT c.id, c.name FROM class_members m JOIN classes c ON c.id = m.class_id
          WHERE m.user_id = ?`).all(r.id),
      })),
      total, limit, offset,
    };
  });

  /* ============ 学生详情（学情）============ */
  fastify.get('/api/admin/students/:id', {
    preHandler: fastify.requireTeacher,
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return reply.code(404).send({ error: '学生不存在' });

    const deny = canManage(req.user, target);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    const uid = target.id;

    const recentAttempts = db.prepare(`
      SELECT a.kind, a.ref_id, a.kid, a.correct, a.score, a.date, a.ts, a.context, a.error_type,
             COALESCE(q.stem, l.title, nt.title, lb.title, k.title) AS title
      FROM attempts a
      LEFT JOIN questions q ON q.id = a.ref_id AND a.kind = 'question'
      LEFT JOIN sql_levels l ON l.id = a.ref_id AND a.kind = 'level'
      LEFT JOIN normalize_tasks nt ON nt.id = a.ref_id AND a.kind = 'normalize'
      LEFT JOIN labs lb ON lb.id = a.ref_id AND a.kind = 'lab'
      LEFT JOIN knowledge k ON k.id = a.kid
      WHERE a.user_id = ? ORDER BY a.ts DESC LIMIT 40`).all(uid);

    /* ★ 他写的 SQL —— 教师端最有价值的一块数据。
     * 「错了 3 次」不构成行动；「他把 JOIN 写成了逗号连接」才是。 */
    const sqlRuns = db.prepare(`
      SELECT id, dataset_id, level_id, sql, ok, ms, row_count, error, ts
      FROM sql_runs WHERE user_id = ? ORDER BY ts DESC LIMIT 30`).all(uid);

    const nodes = db.prepare(`
      SELECT s.kid, s.n, s.c, k.title FROM stats_node s
      LEFT JOIN knowledge k ON k.id = s.kid
      WHERE s.user_id = ? ORDER BY s.n DESC`).all(uid);

    const daily = db.prepare('SELECT date, n, c, minutes FROM stats_daily WHERE user_id = ? ORDER BY date DESC LIMIT 30')
      .all(uid).reverse();

    const mistakes = db.prepare(`
      SELECT ref_id, kind, kid, COUNT(*) tries, MAX(ts) last_ts FROM attempts
      WHERE user_id = ? AND kind IN ('question','level','normalize','lab')
      GROUP BY ref_id HAVING MAX(correct) = 0 ORDER BY last_ts DESC LIMIT 30`).all(uid);

    const settings = db.prepare('SELECT theme, daily_goal FROM user_settings WHERE user_id = ?').get(uid);
    const classes = db.prepare(`
      SELECT c.id, c.name, m.joined_at FROM class_members m
      JOIN classes c ON c.id = m.class_id WHERE m.user_id = ?`).all(uid);

    /* 这个学生的根因诊断 —— 教师找学生谈话时最该带着的东西。
     * 不是"你错得多"，而是"你卡在 GROUP BY 上，而且它拖着 7 个后续知识点"。 */
    const statMap = {};
    for (const n of nodes) statMap[n.kid] = { n: n.n, c: n.c };
    const meta = {};
    for (const k of db.prepare('SELECT id, title, chapter_id FROM knowledge').all()) {
      meta[k.id] = { title: k.title, chapterId: k.chapter_id };
    }
    const diagnosis = diagnose(statMap, db.prepare('SELECT from_kid, to_kid, type, strength FROM knowledge_edges').all(), meta);

    /* 会话列表给教师看，但**不返回 token_hash** ——
     * 那东西换不出 cookie（库里存的是哈希），但泄露它等于告诉别人
     * 「这些哈希值得拿去撞」，没必要。 */
    const sessions = db.prepare(`
      SELECT created_at, last_seen_at, expires_at, user_agent, ip
      FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 20`).all(uid);

    const logs = db.prepare(`SELECT id, actor_email, action, detail, at FROM admin_log
      WHERE target_id = ? ORDER BY at DESC LIMIT 30`).all(uid)
      .map((l) => ({ ...l, detail: safeJson(l.detail, {}) }));

    /* 学情汇总走 LIST_SQL 那条聚合查询 —— 和列表页用同一份 SQL。
     * 不要在这里另写一套统计：两处口径一旦漂移，
     * 列表页显示"正确率 80%"，详情页显示"75%"，
     * 而教师没有任何办法判断哪个是对的。 */
    const aggRow = db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(uid);

    return {
      student: {
        ...shapeUser(target),
        stats: shapeStats(aggRow || {}),
      },
      classes,
      recentAttempts: recentAttempts.map((a) => ({
        kind: a.kind, refId: a.ref_id, kid: a.kid, correct: a.correct === 1,
        score: a.score, date: a.date, ts: a.ts, context: a.context,
        errorType: a.error_type, title: a.title || a.ref_id,
      })),
      sqlRuns: sqlRuns.map((r) => ({
        id: r.id, datasetId: r.dataset_id, levelId: r.level_id, sql: r.sql,
        ok: r.ok === 1, ms: r.ms, rowCount: r.row_count, error: r.error, ts: r.ts,
      })),
      nodes: nodes.map((n) => ({
        kid: n.kid, title: n.title || n.kid, attempts: n.n, correct: n.c,
        mastery: Math.round(masteryOf(n.n, n.c) * 100),
      })),
      daily,
      mistakes: mistakes.map((m) => ({ refId: m.ref_id, kind: m.kind, kid: m.kid, tries: m.tries, lastTs: m.last_ts })),
      diagnosis,
      settings: settings ? { theme: settings.theme, dailyGoal: settings.daily_goal } : null,
      sessions,
      logs,
    };
  });

  /* ============ 新建学生（单个 / 批量）============ */
  fastify.post('/api/admin/students', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
          realName: { type: 'string' },
          studentNo: { type: 'string' },
          note: { type: 'string' },
          classId: { type: 'integer' },
          batch: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                username: { type: 'string' },
                realName: { type: 'string' },
                studentNo: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body || {};

    /* ---- 批量建号 ---- */
    if (Array.isArray(b.batch)) {
      if (!b.batch.length) return reply.code(400).send({ error: '批量列表是空的' });
      const created = [];
      const failed = [];

      for (const item of b.batch) {
        const email = String(item.email || '').trim().toLowerCase();
        const username = String(item.username || '').trim() || email.split('@')[0];
        const err = checkEmail(email) || checkUsername(username);
        if (err) { failed.push({ email, reason: err }); continue; }
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
          failed.push({ email, reason: '邮箱已存在' }); continue;
        }

        /* 批量建号用**随机初始密码**，一次性返回给教师。
         * 不让教师自己定：200 个人如果都用同一个密码，等于没有密码。 */
        const password = generatePassword(10);
        const { hash, salt } = await hashPassword(password);
        const info = db.prepare(`INSERT INTO users
          (email, username, password_hash, password_salt, avatar_hue, role, real_name, student_no, created_by, note)
          VALUES (?,?,?,?,?, 'student', ?,?,?,?)`).run(
          email, username, hash, salt, Math.floor(Math.random() * 360),
          String(item.realName || '').slice(0, 40),
          String(item.studentNo || '').slice(0, 40),
          req.user.id, String(b.note || '').slice(0, 500),
        );
        const id = Number(info.lastInsertRowid);
        db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
        db.prepare('INSERT OR IGNORE INTO game_state (user_id) VALUES (?)').run(id);
        if (b.classId) {
          const ok = canManageClass(req.user, b.classId);
          if (ok) db.prepare('INSERT OR IGNORE INTO class_members (class_id, user_id) VALUES (?,?)').run(b.classId, id);
        }
        created.push({ id, email, username, password });
      }

      audit(req, 'student_batch_create', { detail: { count: created.length, failed: failed.length, classId: b.classId || null } });
      return { ok: true, created, failed };
    }

    /* ---- 单个建号 ---- */
    const email = String(b.email || '').trim().toLowerCase();
    const username = String(b.username || '').trim();
    for (const err of [checkEmail(email), checkUsername(username)]) {
      if (err) return reply.code(400).send({ error: err });
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return reply.code(409).send({ error: '这个邮箱已经被占用了' });
    }

    const password = String(b.password || '').trim() || generatePassword(10);
    const pwErr = checkPasswordStrength(password);
    if (pwErr && b.password) return reply.code(400).send({ error: pwErr });
    const generated = !b.password;

    const { hash, salt } = await hashPassword(password);
    const info = db.prepare(`INSERT INTO users
      (email, username, password_hash, password_salt, avatar_hue, role, real_name, student_no, created_by, note)
      VALUES (?,?,?,?,?, 'student', ?,?,?,?)`).run(
      email, username, hash, salt, Math.floor(Math.random() * 360),
      String(b.realName || '').slice(0, 40),
      String(b.studentNo || '').slice(0, 40),
      req.user.id, String(b.note || '').slice(0, 500),
    );
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
    db.prepare('INSERT OR IGNORE INTO game_state (user_id) VALUES (?)').run(id);

    if (b.classId && canManageClass(req.user, b.classId)) {
      db.prepare('INSERT OR IGNORE INTO class_members (class_id, user_id) VALUES (?,?)').run(b.classId, id);
    }

    audit(req, 'student_create', { target: { id, email }, detail: { username, studentNo: b.studentNo || '' } });
    const row = db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(id);
    return {
      ok: true,
      // 初始密码只在这里出现一次，之后库里只有 scrypt 哈希
      initialPassword: generated ? password : undefined,
      student: { ...shapeUser(row), stats: shapeStats(row) },
    };
  });

  /* ============ 改学生资料 ============ */
  fastify.patch('/api/admin/students/:id', {
    preHandler: fastify.requireTeacher,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          username: { type: 'string' },
          realName: { type: 'string' },
          studentNo: { type: 'string' },
          note: { type: 'string' },
          status: { type: 'string' },
          role: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!cur) return reply.code(404).send({ error: '学生不存在' });

    const deny = canManage(req.user, cur);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    const b = req.body || {};
    const sets = [];
    const params = [];
    const changed = {};

    if (b.email !== undefined) {
      const email = String(b.email).trim().toLowerCase();
      const err = checkEmail(email);
      if (err) return reply.code(400).send({ error: err });
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, cur.id)) {
        return reply.code(409).send({ error: '这个邮箱已经被占用了' });
      }
      if (email !== cur.email) { sets.push('email = ?'); params.push(email); changed.email = [cur.email, email]; }
    }

    if (b.username !== undefined) {
      const username = String(b.username).trim();
      const err = checkUsername(username);
      if (err) return reply.code(400).send({ error: err });
      if (username !== cur.username) { sets.push('username = ?'); params.push(username); changed.username = [cur.username, username]; }
    }

    for (const [field, col, max] of [['realName', 'real_name', 40], ['studentNo', 'student_no', 40], ['note', 'note', 500]]) {
      if (b[field] !== undefined) {
        const v = String(b[field]).slice(0, max);
        if (v !== (cur[col] || '')) { sets.push(`${col} = ?`); params.push(v); changed[field] = [cur[col] || '', v]; }
      }
    }

    if (b.role !== undefined) {
      const err = canAssignRole(req.user, b.role);
      if (err) return reply.code(403).send({ error: err, code: 'FORBIDDEN' });
      if (b.role !== cur.role) { sets.push('role = ?'); params.push(b.role); changed.role = [cur.role, b.role]; }
    }

    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return reply.code(400).send({ error: '状态只能是 active 或 disabled' });
      if (b.status !== cur.status) {
        const d = b.status === 'disabled' ? canDisable(req.user, cur) : canManage(req.user, cur);
        if (d) return reply.code(403).send({ error: d, code: 'FORBIDDEN' });
        sets.push('status = ?'); params.push(b.status); changed.status = [cur.status, b.status];
      }
    }

    if (!sets.length) {
      const row = db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(cur.id);
      return { ok: true, changed: {}, student: { ...shapeUser(row), stats: shapeStats(row) } };
    }

    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, cur.id);

    /* 停用 → 当场踢掉它所有会话。
     * 只改 status 不踢会话的话，对方手里那个 30 天 cookie 还是有效的
     * （readSession 里虽然也拦了一道，但把行删掉更干净：
     *  管理台的「活跃设备」数字会立刻变成 0，不用等下次请求）。 */
    if (changed.status && changed.status[1] === 'disabled') {
      destroyUserSessions(cur.id);
      logAuth('teacher_disable', { email: cur.email, userId: cur.id, ip: req.ip });
    }

    audit(req, 'student_update', { target: cur, detail: changed });
    const row = db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(cur.id);
    return { ok: true, changed, student: { ...shapeUser(row), stats: shapeStats(row) } };
  });

  /* ============ 重置密码 ============ */
  fastify.post('/api/admin/students/:id/password', {
    preHandler: fastify.requireTeacher,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: { type: 'object', properties: { password: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!cur) return reply.code(404).send({ error: '学生不存在' });
    const deny = canManage(req.user, cur);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    const password = String(req.body?.password || '').trim() || generatePassword(10);
    const generated = !req.body?.password;
    if (!generated) {
      const err = checkPasswordStrength(password);
      if (err) return reply.code(400).send({ error: err });
    }

    const { hash, salt } = await hashPassword(password);
    db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(hash, salt, cur.id);

    // 重置密码必须踢掉旧会话，否则「重置」对已经登录的设备没有任何作用
    const killed = destroyUserSessions(cur.id);

    /* 审计里**不记密码原文**，连脱敏都不记。
     * 审计日志会被导出、会被截图，记进去等于把新密码留在一个
     * 比密码本身更不安全的地方。 */
    audit(req, 'student_password_reset', { target: cur, detail: { sessionsKilled: killed } });
    logAuth('teacher_password_reset', { email: cur.email, userId: cur.id, ip: req.ip });

    return { ok: true, sessionsKilled: killed, newPassword: generated ? password : undefined };
  });

  /* ============ 强制下线 ============ */
  fastify.post('/api/admin/students/:id/logout', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!cur) return reply.code(404).send({ error: '学生不存在' });
    const deny = canManage(req.user, cur);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    const killed = destroyUserSessions(cur.id);
    audit(req, 'student_force_logout', { target: cur, detail: { sessionsKilled: killed } });
    return { ok: true, sessionsKilled: killed };
  });

  /* ============ 删除学生 ============
   * 靠外键 ON DELETE CASCADE 连带清掉全部学习数据。
   * schema 里每张学习表的 user_id 都指向 users(id)，
   * 且 PRAGMA foreign_keys = ON 在连接建立时就设了 ——
   * 少任何一环都会留下孤儿数据。 */
  fastify.delete('/api/admin/students/:id', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!cur) return reply.code(404).send({ error: '学生不存在' });

    const deny = canDelete(req.user, cur);
    if (deny) return reply.code(403).send({ error: deny, code: 'FORBIDDEN' });

    /* 先数一遍再删，好让审计日志里留下「删掉了多少数据」——
     * 删完之后这些行就查不到了。 */
    const wiped = {
      attempts: db.prepare('SELECT COUNT(*) n FROM attempts WHERE user_id = ?').get(cur.id).n,
      cards: db.prepare('SELECT COUNT(*) n FROM cards WHERE user_id = ?').get(cur.id).n,
      sqlRuns: db.prepare('SELECT COUNT(*) n FROM sql_runs WHERE user_id = ?').get(cur.id).n,
      notes: db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = ?').get(cur.id).n,
      submissions: db.prepare('SELECT COUNT(*) n FROM submissions WHERE user_id = ?').get(cur.id).n,
    };

    db.prepare('DELETE FROM users WHERE id = ?').run(cur.id);
    audit(req, 'student_delete', { target: cur, detail: wiped });
    return { ok: true, wiped };
  });

  /* ============ 审计日志 ============ */
  fastify.get('/api/admin/logs', {
    preHandler: fastify.requireTeacher,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          action: { type: 'string' },
          mine: { type: 'integer' },
        },
      },
    },
  }, async (req) => {
    const where = [];
    const params = [];
    /* 教师只看得到**自己做过**的和**对自己学生做过**的。
     * 管理员看全部。审计日志本身也要有权限边界 ——
     * 否则 A 老师能通过日志看到 B 老师班上有哪些学生。 */
    if (!isAdmin(req.user)) {
      const ids = scopeStudentIds(req.user) || [];
      where.push(`(actor_id = ? OR target_id IN (${ids.length ? ids.join(',') : 'NULL'}))`);
      params.push(req.user.id);
    }
    if (req.query.mine === 1) { where.push('actor_id = ?'); params.push(req.user.id); }
    if (req.query.action) { where.push('action LIKE ?'); params.push(`${req.query.action}%`); }

    const rows = db.prepare(`
      SELECT * FROM admin_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY at DESC, id DESC LIMIT ?
    `).all(...params, req.query.limit ?? 80);

    return {
      logs: rows.map((r) => ({
        id: r.id, actorId: r.actor_id, actorEmail: r.actor_email,
        targetId: r.target_id, targetEmail: r.target_email,
        action: r.action, detail: safeJson(r.detail, {}), ip: r.ip, at: r.at,
      })),
    };
  });

  /* ============ 登录审计（教师看自己学生的登录情况）============ */
  fastify.get('/api/admin/auth-logs', {
    preHandler: fastify.requireTeacher,
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } } },
  }, async (req) => {
    const ids = scopeStudentIds(req.user);
    if (ids !== null && !ids.length) return { logs: [] };
    const clause = ids === null ? '' : `WHERE user_id IN (${ids.join(',')})`;
    const rows = db.prepare(`SELECT email, user_id, event, ip, user_agent, at FROM auth_log
      ${clause} ORDER BY at DESC LIMIT ?`).all(req.query.limit ?? 80);
    return { logs: rows };
  });

  /* ==================================================================
   *  内容管理
   *  教师可以增删改自己创建的内容；内置内容（owner_id IS NULL）只读。
   *  这条规则的意图：内置内容是判题基准的一部分，
   *  改坏了会让所有学生的判分出错 —— 想改就复制一份成自己的。
   * ================================================================== */

  fastify.post('/api/admin/questions', {
    preHandler: fastify.requireTeacher,
    schema: {
      body: {
        type: 'object',
        required: ['kid', 'type', 'stem', 'answer'],
        properties: {
          kid: { type: 'string' },
          type: { type: 'string' },
          difficulty: { type: 'integer', minimum: 1, maximum: 5 },
          stem: { type: 'string', maxLength: 4000 },
          options: { type: 'array' },
          answer: { type: 'string', maxLength: 1000 },
          analysis: { type: 'string', maxLength: 4000 },
          steps: { type: 'array' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body;
    if (!db.prepare('SELECT 1 FROM knowledge WHERE id = ?').get(b.kid)) {
      return reply.code(400).send({ error: '考点不存在' });
    }
    if (!['choice', 'multi', 'judge', 'blank', 'short'].includes(b.type)) {
      return reply.code(400).send({ error: '题型不合法' });
    }
    if ((b.type === 'choice' || b.type === 'multi') && !(b.options || []).length) {
      return reply.code(400).send({ error: '选项型题目必须提供选项' });
    }

    const id = `Q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(`INSERT INTO questions
      (id, kid, type, difficulty, stem, options, answer, analysis, steps, source, owner_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, b.kid, b.type, b.difficulty || 2, b.stem,
      b.options ? JSON.stringify(b.options) : null,
      b.answer, b.analysis || '', JSON.stringify(b.steps || []),
      'teacher', req.user.id,
    );
    audit(req, 'content_question_create', { detail: { id, kid: b.kid, type: b.type } });
    return { ok: true, id };
  });

  fastify.patch('/api/admin/questions/:id', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
    if (!q) return reply.code(404).send({ error: '题目不存在' });
    if (q.owner_id == null) return reply.code(403).send({ error: '内置题目不能修改。想改的话请复制一份成自己的题目。', code: 'BUILTIN_READONLY' });
    if (q.owner_id !== req.user.id && !isAdmin(req.user)) return reply.code(403).send({ error: '这不是你创建的题目', code: 'FORBIDDEN' });

    const b = req.body || {};
    const sets = [];
    const params = [];
    for (const [k, col] of [['stem', 'stem'], ['answer', 'answer'], ['analysis', 'analysis'], ['difficulty', 'difficulty']]) {
      if (b[k] !== undefined) { sets.push(`${col} = ?`); params.push(b[k]); }
    }
    if (b.options !== undefined) { sets.push('options = ?'); params.push(b.options ? JSON.stringify(b.options) : null); }
    if (b.steps !== undefined) { sets.push('steps = ?'); params.push(JSON.stringify(b.steps)); }
    if (!sets.length) return { ok: true };

    db.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id = ?`).run(...params, q.id);
    audit(req, 'content_question_update', { detail: { id: q.id, fields: Object.keys(b) } });
    return { ok: true };
  });

  fastify.delete('/api/admin/questions/:id', { preHandler: fastify.requireTeacher }, async (req, reply) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
    if (!q) return reply.code(404).send({ error: '题目不存在' });
    if (q.owner_id == null) return reply.code(403).send({ error: '内置题目不能删除', code: 'BUILTIN_READONLY' });
    if (q.owner_id !== req.user.id && !isAdmin(req.user)) return reply.code(403).send({ error: '这不是你创建的题目', code: 'FORBIDDEN' });

    db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
    audit(req, 'content_question_delete', { detail: { id: q.id, stem: q.stem.slice(0, 60) } });
    return { ok: true };
  });

  /* 我创建的内容 */
  fastify.get('/api/admin/content', { preHandler: fastify.requireTeacher }, async (req) => {
    const own = isAdmin(req.user) ? '1=1' : 'owner_id = ?';
    const p = isAdmin(req.user) ? [] : [req.user.id];
    return {
      questions: db.prepare(`SELECT id, kid, type, difficulty, stem, owner_id FROM questions
        WHERE owner_id IS NOT NULL AND ${own} ORDER BY id DESC`).all(...p)
        .map((q) => ({ ...q, mine: q.owner_id === req.user.id })),
      knowledge: db.prepare(`SELECT id, title, chapter_id, owner_id FROM knowledge
        WHERE owner_id IS NOT NULL AND ${own} ORDER BY id DESC`).all(...p)
        .map((k) => ({ ...k, mine: k.owner_id === req.user.id })),
      levels: db.prepare(`SELECT l.id, l.title, l.dataset_id, l.owner_id FROM sql_levels l
        WHERE l.owner_id IS NOT NULL AND ${isAdmin(req.user) ? '1=1' : 'l.owner_id = ?'} ORDER BY l.id DESC`)
        .all(...(isAdmin(req.user) ? [] : [req.user.id]))
        .map((l) => ({ ...l, mine: l.owner_id === req.user.id })),
      builtin: {
        questions: db.prepare('SELECT COUNT(*) n FROM questions WHERE owner_id IS NULL').get().n,
        knowledge: db.prepare('SELECT COUNT(*) n FROM knowledge WHERE owner_id IS NULL').get().n,
        levels: db.prepare('SELECT COUNT(*) n FROM sql_levels WHERE owner_id IS NULL').get().n,
      },
    };
  });

  /* ============ 数据库体检（管理员）============ */
  fastify.get('/api/admin/health', { preHandler: fastify.requireAdmin }, async () => {
    const one = (sql) => db.prepare(sql).get();
    const size = one('SELECT page_count * page_size bytes FROM pragma_page_count(), pragma_page_size()');
    return {
      dbPath: db.name,
      dbMb: Number(((size.bytes || 0) / 1024 / 1024).toFixed(2)),
      tables: one(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).n,
      users: one('SELECT COUNT(*) n FROM users').n,
      attempts: one('SELECT COUNT(*) n FROM attempts').n,
      sessions: one('SELECT COUNT(*) n FROM sessions').n,
      adminLogs: one('SELECT COUNT(*) n FROM admin_log').n,
      integrity: one('PRAGMA integrity_check').integrity_check,
    };
  });
}

/** 教师能不能管这个班。 */
function canManageClass(user, classId) {
  const c = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(classId);
  if (!c) return false;
  return isAdmin(user) || c.teacher_id === user.id;
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
