/* 库课 · 服务端入口
 *
 * 一个进程同时干两件事：
 *   /api/*  → JSON 接口
 *   其它    → 生产环境托管 web/dist（SPA fallback 到 index.html）
 * 开发时前端跑在 Vite（5173），/api 反向代理到这里。
 */
/* ★ 这个 import 必须排在最前面。
 *   它在模块加载时就把 .env 装进 process.env 了，而下面每一行
 *   读 process.env 的代码都依赖这件事 —— 顺序一乱，读到的就是空的。
 *   规则见 lib/env.js：凭据类以 .env 为准，其余以环境变量为准。 */
import { warnShadowed } from './lib/env.js';
import { aiHealth } from './ai/llm.js';

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
import { userOrIpKey, rateLimitScale } from './lib/rateLimit.js';
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
import aiRoutes from './routes/ai.js';

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
  /* 日志级别。生产默认 warn。
   *
   * 实测数据：info 级别下，300 并发压测 20 秒产生了 1.0GB 日志
   * （每个请求两行：incoming + completed）。公网部署时这既是磁盘压力，
   * 也是 IO 压力，而且真正有用的错误信息被淹在几百万行请求日志里。
   * 请求级日志交给 Nginx 的 access_log 去做，那里才是它该待的地方。 */
  logger: {
    level: process.env.LOG_LEVEL
      || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  },
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
  /* ★ 阈值和分桶方式都改过一轮，理由见 lib/rateLimit.js 顶部。
   *
   * 原来：max 300 / 分钟，keyGenerator = req.ip。
   * 问题：学校机房是一个 NAT 出口，300 个学生共享同一个 req.ip ——
   *       一次页面加载就要 8~10 个请求，300/分钟 只够 30 个学生打开页面。
   *       实测（bench/run.mjs session --c 300 --ip same）：成功率 5%。
   *
   * 现在：keyGenerator 按「已登录用户 / 未登录 IP」分桶。
   *       已登录的学生各有一份 300/分钟的配额，互不挤占；
   *       未登录的匿名流量仍按 IP 计，防的是扫描和 DoS。
   *       未登录阈值放宽到 1200 —— 要装得下「一个机房同时打开登录页」。 */
  max: Number(process.env.KUKE_RATE_LIMIT) || 1200,
  timeWindow: '1 minute',
  keyGenerator: userOrIpKey,
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
await app.register(aiRoutes);

/* ---------- 静态托管 ----------
 * ★ web/dist 是构建产物、不在仓库里。
 * 没有它时后端**退化成只提供 API** —— 打开首页看到 404，
 * 而服务本身是正常的，很容易误以为装错了。
 * 所以这里明确打印一条警告，而不是静默 404。 */
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    /* 缓存策略按文件类型决定，所以关掉插件自带的那一份。
     *
     * ★ 第一个参数是 **Fastify 的 reply**，不是 Node 的 http.ServerResponse。
     *   写成 `res.setHeader(...)` 会在**第一次请求静态资源时**抛
     *   TypeError: res.setHeader is not a function，而且因为它在
     *   fastify-static 的 pumpSendToReply 里被调用，异常会直接冒到
     *   顶层把进程打挂 —— 表现是「服务起来后一切正常，直到有人打开首页」。
     *   查插件源码确认签名：setHeaders?.(reply, metadata.path, metadata.stat) */
    cacheControl: false,
    setHeaders(reply, filePath) {
      /* Vite 产物带内容哈希（index-BlbmVkrY.js）—— 内容一变文件名就变，
       * 所以可以永久缓存。这一条把回访用户的加载从「重下约 900KB」
       * 降到「只下 2KB 的 index.html」。
       *
       * 公网部署时这条尤其重要：学生的带宽和服务器出口流量都要钱。 */
      if (/[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico)$/.test(filePath)) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        /* ★ index.html 绝对不能长缓存。它是产物的入口 ——
         * 缓存住之后，即使静态资源的哈希变了，用户也永远不会去请求新名字，
         * 结果是「发了新版但所有人还在用旧前端」，而且刷新也不管用。
         * no-cache 不是不缓存，是「每次都要回来问一句」，
         * 命中 304 时只花几十字节。 */
        reply.header('Cache-Control', 'no-cache');
      }
    },
  });

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

  /* ★ AI 那一块的状态单独报一行。
   *   没配 key 时不说的话，用户会以为「AI 功能坏了」——
   *   而实际上只是少了一行配置。 */
  const ai = aiHealth();
  if (!ai.hasKey) {
    app.log.warn('AI 功能未启用：没有配置 DEEPSEEK_API_KEY。'
      + '在项目根目录执行 cp .env.example .env，填上 key 再重启。');
  } else {
    app.log.info(`AI 已配置 · 模型 ${ai.model} · 密钥来自 ${ai.keySource === 'env-file' ? '.env' : '环境变量'}`);
  }
  /* 被遮蔽的环境变量要**大声**说：静默用错 key 是最难查的一类问题
   * （健康检查说「已配置」，每条消息却 401）。 */
  warnShadowed((line) => app.log.warn(line));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
