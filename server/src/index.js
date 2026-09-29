/* 库课 · 服务端入口
 *
 * 一个进程同时干两件事：
 *   /api/*  → JSON 接口
 *   其它    → 生产环境托管 web/dist（SPA fallback 到 index.html）
 * 开发时前端跑在 Vite（5173），/api 反向代理到这里。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';

import { initSchema, health, DB_PATH } from './db/index.js';
import { migrate, ensureBootstrapAccount } from './db/migrate.js';
import { seed } from './db/seed.js';
import { COOKIE_NAME, readSession, cleanupSessions } from './lib/session.js';
import { isAdmin, isTeacher, isStaff } from './lib/perms.js';
import { sqlPool } from './lib/sqlRunner.js';

import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import studyRoutes from './routes/study.js';
import sqlRoutes from './routes/sql.js';
import classRoutes from './routes/classes.js';
import assignmentRoutes from './routes/assignments.js';
import adminRoutes from './routes/admin.js';
import miscRoutes from './routes/misc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_DIST = path.resolve(ROOT, '../web/dist');
const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || '127.0.0.1';

/* ---------- trustProxy ----------
 * 默认**关闭**。
 *
 * 打开它意味着「相信 X-Forwarded-For」，而那个请求头客户端可以随便写。
 * 裸奔时开着它，按 IP 计数的限流就形同虚设 —— 每换一个头就换一个身份，
 * 登录接口可以无限次试密码。
 *
 * 只有确实跑在反向代理后面时才打开，并把值收窄到代理自己的地址，
 * 而不是一句 `true`：
 *   TRUST_PROXY=127.0.0.1            # 代理和 Node 同机
 *   TRUST_PROXY=172.16.0.0/12        # 容器网络
 * 逗号分隔，交给 Fastify 自己解析（它认 CIDR 列表）。
 */
function resolveTrustProxy() {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : false;
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 4 * 1024 * 1024,
  trustProxy: resolveTrustProxy(),
});

/* ---------- 统一错误格式 ----------
 * ★ 这个钩子必须**先于任何插件和路由注册**。
 *
 * 之前见过把它写在业务路由注册之后的做法 —— Fastify 不会把它继承给
 * 已经注册的子上下文，于是整块是死代码，带来三个用户看得见的后果：
 *   1. 429 回的是框架默认的英文 `{"error":"Too Many Requests"}`，
 *      而前端正好读 `body.error` 当提示文案 —— 中文界面弹英文；
 *   2. 参数校验错误回 `FST_ERR_VALIDATION` + "Bad Request"，同样是英文；
 *   3. 未捕获异常回 `err.message` 原文（SQL 报错、文件路径都在里面）。
 * 位置写错一次，这三条就一起回来。所以 hardening 测试里留了断言。
 */
app.setErrorHandler((err, req, reply) => {
  if (err.statusCode === 429) {
    return reply.code(429).send({ error: '操作太频繁了，缓一缓再试', code: 'RATE_LIMITED' });
  }
  if (err.validation) {
    return reply.code(400).send({ error: '请求参数不正确', detail: err.message });
  }

  /* 5xx 不回 err.message。
   * 它可能是 SQL 报错、文件绝对路径、上游返回的原文 —— 这些都不该给客户端。
   * 真实错误留在日志里，响应只给一个可对账的 requestId。 */
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status >= 500) {
    req.log.error({ err }, '未处理的服务端错误');
    return reply.code(500).send({ error: '服务器内部错误', requestId: req.id });
  }
  return reply.code(status).send({ error: err.message || '请求失败' });
});

/* ---------- 安全响应头 ---------- */
const CSP = [
  "default-src 'self'",
  // index.html 里有一段必须内联的启动脚本（首屏防闪主题），
  // 用哈希就得在改那段脚本时同步改响应头，对单人维护是纯负债。
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('Content-Security-Policy', CSP);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  /* HSTS 只在真的走 HTTPS 时发。本地 http 开发时发了它，
   * 浏览器会把 127.0.0.1 也升级成 https，直接把自己锁在外面。 */
  if (req.protocol === 'https') {
    reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  return payload;
});

/* ---------- 初始化数据 ---------- */
initSchema();
/* 补列必须紧跟建表：schema.sql 对已存在的表整条跳过，加列只能靠 ALTER TABLE。 */
const migrated = migrate();
if (migrated.length) app.log.info(`结构迁移：补了 ${migrated.join('、')}`);
seed({ quiet: true });

/* ---------- 引导账号 ---------- */
const boot = await ensureBootstrapAccount();
if (boot.action === 'created') {
  app.log.info(`已创建${boot.role === 'admin' ? '管理员' : '教师'}账号 ${boot.email}（id ${boot.id}）`);
  if (boot.generated) {
    /* ★ 随机密码只在这里出现这一次。
     * 之后库里只有 scrypt 哈希，谁也取不出来。
     * 没记下来就删号重建，或者用 KUKE_PASSWORD 环境变量指定。 */
    // eslint-disable-next-line no-console
    console.log('\n' + '━'.repeat(64));
    console.log(`  初始密码：${boot.password}`);
    console.log('  ↑ 只打印这一次。请立刻保存，并登录后改掉。');
    console.log(`  想自己指定：KUKE_PASSWORD=你的密码 KUKE_EMAIL=你的邮箱 npm start`);
    console.log('━'.repeat(64) + '\n');
  }
} else if (boot.action === 'exists') {
  app.log.info(`引导账号已存在：${boot.email}（${boot.role}）—— 不动它，也不重置密码`);
}

/* ---------- 鉴权装饰器 ----------
 * 三个层次：requireAuth / requireTeacher / requireAdmin。
 *
 * ★ 每个路由**显式**挂 preHandler，不靠"注册时统一加前缀钩子"。
 *   理由见 routes/admin.js 顶部第 1 条。
 *
 * 这三个装饰器只做「有没有登录 / 角色够不够」，**不做资源级权限**
 * （比如"这个学生是不是我班上的"）。资源级权限在各自的业务路由里
 * 用 perms.js 的 canManage 判断 —— 因为那需要先查出目标对象，
 * 而钩子阶段还拿不到。
 */
app.decorateRequest('user', null);

app.decorate('requireAuth', async (req, reply) => {
  const row = readSession(req.cookies?.[COOKIE_NAME]);
  if (!row) return reply.code(401).send({ error: '请先登录', code: 'UNAUTHENTICATED' });
  req.user = row;
});

app.decorate('requireTeacher', async (req, reply) => {
  const row = readSession(req.cookies?.[COOKIE_NAME]);
  if (!row) return reply.code(401).send({ error: '请先登录', code: 'UNAUTHENTICATED' });
  if (!isStaff(row)) return reply.code(403).send({ error: '这个操作需要教师权限', code: 'FORBIDDEN' });
  req.user = row;
});

app.decorate('requireAdmin', async (req, reply) => {
  const row = readSession(req.cookies?.[COOKIE_NAME]);
  if (!row) return reply.code(401).send({ error: '请先登录', code: 'UNAUTHENTICATED' });
  if (!isAdmin(row)) return reply.code(403).send({ error: '这个操作需要管理员权限', code: 'FORBIDDEN' });
  req.user = row;
});

/* ---------- 插件 ---------- */
await app.register(cookie);
await app.register(rateLimit, {
  global: true,
  /* ★ 限流阈值可以用环境变量调。
   *
   * 为什么需要这个口子：浏览器冒烟测试一次要加载 30+ 个页面，
   * 每个页面 8~10 个请求 —— 加起来正好撞上 300/分钟 的默认阈值，
   * 于是后半程的页面全部收到 429，探针页拿到的是 JSON 而不是 HTML，
   * 报出来是「探针页没有输出结果（__probe.html 没被正确提供？）」，
   * 看起来像静态托管坏了，其实是限流。
   *
   * 生产环境保持默认值；测试起的是本地一次性服务，调高它不削弱安全性。 */
  max: Number(process.env.KUKE_RATE_LIMIT) || 300,
  timeWindow: '1 minute',
  /* 限流按 IP。这里**不做**用户级限流 —— 用户级要读 cookie、
   * 查库，成本比 IP 高一个量级，而教学系统的并发量远没到需要它的程度。 */
  keyGenerator: (req) => req.ip,
  allowList: [],
});

/* ---------- 路由 ---------- */
await app.register(authRoutes);
await app.register(catalogRoutes);
await app.register(studyRoutes);
await app.register(sqlRoutes);
await app.register(classRoutes);
await app.register(assignmentRoutes);
await app.register(adminRoutes);
await app.register(miscRoutes);

/* ---------- 静态托管 ----------
 * ★ web/dist 是构建产物、不在仓库里。
 * 没有它时后端**退化成只提供 API** —— 打开首页看到 404，
 * 而服务本身是正常的，很容易误以为装错了。
 * 所以这里明确打印一条警告，而不是静默 404。 */
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });

  app.setNotFoundHandler((req, reply) => {
    /* SPA fallback：非 /api 的路径一律回 index.html，
     * 交给前端路由处理。但 /api 的 404 必须保持 JSON ——
     * 否则前端会拿到一坨 HTML 然后 JSON.parse 报错。 */
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: '接口不存在', code: 'NOT_FOUND' });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn(`前端产物不存在（${WEB_DIST}）。只提供 API，打开首页会 404。请先跑 npm run build。`);
  app.setNotFoundHandler((req, reply) => reply.code(404).send({
    error: '前端尚未构建。在项目根目录执行 npm run build 后重启。',
    code: 'NO_WEB_DIST',
  }));
}

/* ---------- 定时清理 ---------- */
const cleanupTimer = setInterval(() => {
  try {
    const n = cleanupSessions();
    if (n) app.log.info(`清理过期会话 ${n} 条`);
  } catch (e) {
    app.log.error({ err: e }, '清理会话失败');
  }
}, 3600_000);
cleanupTimer.unref();

/* ---------- 优雅退出 ----------
 * 必须显式关掉 SQL 沙箱的 worker 池，否则进程会挂着不退 ——
 * worker_threads 默认会阻止进程退出。 */
async function shutdown(signal) {
  app.log.info(`收到 ${signal}，正在退出`);
  clearInterval(cleanupTimer);
  try { await app.close(); } catch { /* 已经关了 */ }
  try { await sqlPool.close(); } catch { /* 同上 */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: PORT, host: HOST });
  const h = health();
  app.log.info(`库课已启动 · http://${HOST}:${PORT}`);
  app.log.info(`数据库 ${DB_PATH} · ${h.tables} 张表 · ${h.users} 个账号`);
  if (!fs.existsSync(WEB_DIST)) {
    app.log.warn('前端未构建，现在只有 API 可用。开发时请另开一个终端跑 npm run dev:web。');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
