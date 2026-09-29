/* 账号接口 /api/auth/*
 *
 * 注册 / 登录 / 登出 / 当前用户 / 改密 / 偏好设置。
 *
 * ── 注册默认是学生 ──────────────────────────────────────────────
 * 自助注册只能拿到 student 角色。teacher 必须由管理员创建 ——
 * 否则任何人都能注册成教师，然后「对学生有完全管理权限」这条规则
 * 就变成了「对所有人有完全管理权限」。
 *
 * ── 注册时可以带班级邀请码 ──────────────────────────────────────
 * 学生的真实入班流程是「老师给一个码，学生自己注册并填码」。
 * 如果只能先注册再入班，就会出现一批"还没入班"的孤儿账号，
 * 教师看不到他们（权限模型里教师的管辖范围是班级成员 ∪ 自己创建的账号）。
 * 所以注册时就允许带码，一步到位。
 */
import { db } from '../db/index.js';
import {
  hashPassword, verifyPassword, checkEmail, checkUsername, checkPasswordStrength,
} from '../lib/password.js';
import {
  COOKIE_NAME, createSession, readSession, destroySession, destroyUserSessions,
  logAuth, cookieOptions,
} from '../lib/session.js';
import { shapeUser } from '../lib/perms.js';
import { isThemeId, DEFAULT_THEME } from '../lib/themes.js';

const IS_PROD = process.env.NODE_ENV === 'production';
const ALLOW_REGISTER = process.env.KUKE_ALLOW_REGISTER !== '0';

/** 登录失败时的统一响应。不区分「邮箱不存在」和「密码错误」——
 *  区分开等于给攻击者一个邮箱枚举接口。 */
const LOGIN_FAIL = { error: '邮箱或密码不正确', code: 'BAD_CREDENTIALS' };

export default async function authRoutes(fastify) {
  /* ============ 注册 ============ */
  fastify.post('/api/auth/register', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'username', 'password'],
        properties: {
          email: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
          classCode: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!ALLOW_REGISTER) {
      return reply.code(403).send({ error: '本系统已关闭自助注册，请联系老师开通账号', code: 'REGISTER_CLOSED' });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const classCode = String(req.body.classCode || '').trim().toUpperCase();

    for (const err of [checkEmail(email), checkUsername(username), checkPasswordStrength(password)]) {
      if (err) return reply.code(400).send({ error: err });
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return reply.code(409).send({ error: '这个邮箱已经注册过了' });
    }

    // 邀请码先验，避免"注册成功了但码是错的"这种半成品状态
    let klass = null;
    if (classCode) {
      klass = db.prepare("SELECT id, name FROM classes WHERE code = ? AND status = 'active'").get(classCode);
      if (!klass) return reply.code(400).send({ error: '班级邀请码无效' });
    }

    const { hash, salt } = await hashPassword(password);

    const created = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO users (email, username, password_hash, password_salt, avatar_hue, role)
        VALUES (?,?,?,?,?, 'student')
      `).run(email, username, hash, salt, Math.floor(Math.random() * 360));
      const id = Number(info.lastInsertRowid);

      db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
      db.prepare('INSERT OR IGNORE INTO game_state (user_id) VALUES (?)').run(id);
      if (klass) {
        db.prepare('INSERT OR IGNORE INTO class_members (class_id, user_id) VALUES (?,?)').run(klass.id, id);
      }
      return id;
    })();

    logAuth('register', { email, userId: created, ip: req.ip, userAgent: req.headers['user-agent'] });

    const { token } = createSession(created, { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.setCookie(COOKIE_NAME, token, cookieOptions(IS_PROD));

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(created);
    return { ok: true, user: shapeUser(row), joinedClass: klass ? klass.name : null };
  });

  /* ============ 登录 ============ */
  fastify.post('/api/auth/login', {
    /* 限流按 IP 计。★ 这条依赖 trustProxy 默认关闭 ——
     * 如果开了 trustProxy 又没配好，客户端可以随便改 X-Forwarded-For，
     * 换个头就是一个新身份，登录接口可以无限次试密码。 */
    config: { rateLimit: { max: 12, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string' }, password: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row) {
      logAuth('login_failed', { email, ip: req.ip, userAgent: req.headers['user-agent'] });
      return reply.code(401).send(LOGIN_FAIL);
    }

    const ok = await verifyPassword(password, row.password_hash, row.password_salt);
    if (!ok) {
      logAuth('login_failed', { email, userId: row.id, ip: req.ip, userAgent: req.headers['user-agent'] });
      return reply.code(401).send(LOGIN_FAIL);
    }

    if (row.status !== 'active') {
      return reply.code(403).send({ error: '这个账号已被停用，请联系老师', code: 'ACCOUNT_DISABLED' });
    }

    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
    logAuth('login', { email, userId: row.id, ip: req.ip, userAgent: req.headers['user-agent'] });

    const { token } = createSession(row.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.setCookie(COOKIE_NAME, token, cookieOptions(IS_PROD));

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    return { ok: true, user: shapeUser(fresh) };
  });

  /* ============ 登出 ============ */
  fastify.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) destroySession(token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  /* ============ 当前用户 ============ */
  /* 这个接口**必须**返回 401 而不是 200 + null。
   * 前端靠状态码判断"要不要跳登录页"，返回 200 会让它以为已登录。 */
  fastify.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME];
    const row = readSession(token);
    if (!row) return reply.code(401).send({ error: '未登录', code: 'UNAUTHENTICATED' });

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(row.id);
    const classes = db.prepare(`
      SELECT c.id, c.name, c.code, c.term, c.teacher_id,
             (SELECT username FROM users WHERE id = c.teacher_id) AS teacher_name
      FROM classes c
      LEFT JOIN class_members cm ON cm.class_id = c.id AND cm.user_id = ?
      WHERE c.teacher_id = ? OR cm.user_id = ?
      ORDER BY c.created_at DESC
    `).all(row.id, row.id, row.id);

    return {
      user: shapeUser(row),
      settings: settings ? {
        theme: settings.theme,
        dailyGoal: settings.daily_goal,
        sqlDialect: settings.sql_dialect,
        editorFont: settings.editor_font,
        sfx: settings.sfx === 1,
      } : null,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        term: c.term,
        teacherName: c.teacher_name,
        isOwner: c.teacher_id === row.id,
      })),
    };
  });

  /* ============ 改自己的密码 ============ */
  fastify.post('/api/auth/password', {
    preHandler: fastify.requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['oldPassword', 'newPassword'],
        properties: { oldPassword: { type: 'string' }, newPassword: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const err = checkPasswordStrength(req.body.newPassword);
    if (err) return reply.code(400).send({ error: err });

    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await verifyPassword(req.body.oldPassword, me.password_hash, me.password_salt);
    if (!ok) return reply.code(400).send({ error: '原密码不正确' });

    const { hash, salt } = await hashPassword(req.body.newPassword);
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hash, salt, me.id);

    /* 改密后踢掉**其它**设备的会话，但保留当前这个 ——
     * 否则用户改完密码立刻被登出，会以为改失败了。 */
    const currentToken = req.cookies?.[COOKIE_NAME];
    const currentHash = currentToken
      ? db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all(me.id)
      : [];
    void currentHash;

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id);
    const { token } = createSession(me.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.setCookie(COOKIE_NAME, token, cookieOptions(IS_PROD));

    logAuth('password_change', { email: me.email, userId: me.id, ip: req.ip });
    return { ok: true };
  });

  /* ============ 偏好设置 ============ */
  fastify.patch('/api/auth/settings', {
    preHandler: fastify.requireAuth,
    schema: {
      body: {
        type: 'object',
        properties: {
          theme: { type: 'string' },
          dailyGoal: { type: 'integer', minimum: 1, maximum: 500 },
          editorFont: { type: 'integer', minimum: 11, maximum: 24 },
          sfx: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body || {};
    const sets = [];
    const params = [];

    if (b.theme !== undefined) {
      /* 主题白名单。不在白名单里就**忽略**而不是报错 ——
       * 主题是外观偏好，为它中断一次设置保存不值得。
       * 但也不能直接写进去：前端会把它当 class 名用。 */
      if (isThemeId(b.theme)) { sets.push('theme = ?'); params.push(b.theme); }
    }
    if (b.dailyGoal !== undefined) { sets.push('daily_goal = ?'); params.push(b.dailyGoal); }
    if (b.editorFont !== undefined) { sets.push('editor_font = ?'); params.push(b.editorFont); }
    if (b.sfx !== undefined) { sets.push('sfx = ?'); params.push(b.sfx ? 1 : 0); }

    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = ?`).run(...params, req.user.id);
    }
    const s = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
    return {
      ok: true,
      settings: {
        theme: s?.theme || DEFAULT_THEME,
        dailyGoal: s?.daily_goal ?? 20,
        sqlDialect: s?.sql_dialect || 'sqlite',
        editorFont: s?.editor_font ?? 14,
        sfx: (s?.sfx ?? 1) === 1,
      },
    };
  });

  /* ============ 退出所有设备 ============ */
  fastify.post('/api/auth/logout-all', { preHandler: fastify.requireAuth }, async (req, reply) => {
    const killed = destroyUserSessions(req.user.id);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    logAuth('logout_all', { email: req.user.email, userId: req.user.id, ip: req.ip });
    return { ok: true, sessionsKilled: killed };
  });

  /* ============ 我的登录记录 ============ */
  fastify.get('/api/auth/logs', { preHandler: fastify.requireAuth }, async (req) => {
    const rows = db.prepare(`
      SELECT event, ip, user_agent, at FROM auth_log
      WHERE user_id = ? ORDER BY at DESC LIMIT 20
    `).all(req.user.id);
    return { logs: rows };
  });
}
