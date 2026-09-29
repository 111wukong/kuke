/* 杂项接口 /api/misc/*
 *
 * 健康检查、全局搜索、站内公告。
 */
import { db, health } from '../db/index.js';
import { isAdmin } from '../lib/perms.js';

export default async function miscRoutes(fastify) {
  /* 健康检查。**不需要登录** —— 部署时反代和监控要用它探活，
   * 而那两样都不带 cookie。所以它只能回不敏感的信息。 */
  fastify.get('/api/health', async () => {
    const h = health();
    return {
      ok: true,
      tables: h.tables,
      users: h.users,
      uptime: Math.round(process.uptime()),
      version: '1.0.0',
    };
  });

  /* 全局搜索：知识点 / 题目 / 关卡 / 范式题 / 实验台 */
  fastify.get('/api/misc/search', {
    preHandler: fastify.requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: { q: { type: 'string', minLength: 1, maxLength: 60 } },
      },
    },
  }, async (req) => {
    const q = `%${String(req.query.q).trim()}%`;
    const LIMIT = 8;

    const knowledge = db.prepare(`
      SELECT k.id, k.title, k.summary, c.name AS chapter_name, cat.name AS category_name
      FROM knowledge k
      LEFT JOIN chapters c ON c.id = k.chapter_id
      LEFT JOIN categories cat ON cat.id = k.category_id
      WHERE k.title LIKE ? OR k.summary LIKE ? OR k.content LIKE ?
      ORDER BY k.sort_order LIMIT ?`).all(q, q, q, LIMIT);

    /* 题目只搜题干，不搜答案 —— 搜答案等于把答案间接暴露了。
     * 学生输入"3NF"如果连答案含 3NF 的题都搜出来，那是一次泄题。 */
    const questions = db.prepare(`
      SELECT id, kid, type, stem FROM questions
      WHERE stem LIKE ? ORDER BY id LIMIT ?`).all(q, LIMIT);

    const levels = db.prepare(`
      SELECT id, title, dataset_id, difficulty FROM sql_levels
      WHERE title LIKE ? OR brief LIKE ? ORDER BY seq LIMIT ?`).all(q, q, LIMIT);

    const normalizeTasks = db.prepare(`
      SELECT id, title, ask FROM normalize_tasks
      WHERE title LIKE ? OR brief LIKE ? ORDER BY sort_order LIMIT ?`).all(q, q, LIMIT);

    const labs = db.prepare(`
      SELECT id, kind, title FROM labs
      WHERE title LIKE ? OR brief LIKE ? ORDER BY kind, sort_order LIMIT ?`).all(q, q, LIMIT);

    const total = knowledge.length + questions.length + levels.length + normalizeTasks.length + labs.length;
    return { query: req.query.q, total, knowledge, questions, levels, normalizeTasks, labs };
  });

  /* 站内公告。写死在代码里 —— 这是个单机部署的教学系统，
   * 加一张公告表+管理界面，收益不如把力气花在内容上。
   * 需要时改这里一行即可。 */
  fastify.get('/api/misc/announcement', async () => ({
    announcement: null,
  }));

  /* 服务端配置快照。前端用它决定显示哪些入口
   * （比如关闭了自助注册就不显示注册链接）。 */
  fastify.get('/api/misc/config', async () => ({
    allowRegister: process.env.KUKE_ALLOW_REGISTER !== '0',
    hasBootstrap: true,
    version: '1.0.0',
  }));

  /* 我的会话列表（学生自己也能看，用于"这账号在哪些设备上登录了"） */
  fastify.get('/api/misc/sessions', { preHandler: fastify.requireAuth }, async (req) => {
    const rows = db.prepare(`
      SELECT created_at, last_seen_at, expires_at, user_agent, ip
      FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 20`).all(req.user.id);
    return { sessions: rows };
  });

  /* 数据库统计（管理员）。给管理台首页用。 */
  fastify.get('/api/misc/dbstats', { preHandler: fastify.requireAdmin }, async () => {
    const one = (sql) => db.prepare(sql).get();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all().map((t) => {
        const n = one(`SELECT COUNT(*) n FROM "${t.name}"`).n;
        return { name: t.name, rows: n };
      });
    const size = one('SELECT page_count * page_size bytes FROM pragma_page_count(), pragma_page_size()');
    return { tables, totalRows: tables.reduce((s, t) => s + t.rows, 0), sizeBytes: size.bytes || 0 };
  });
}
