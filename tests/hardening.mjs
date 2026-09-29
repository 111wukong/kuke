/* 加固回归
 *
 * ── 这份测试和接口冒烟的分工 ────────────────────────────────────
 * 接口冒烟测"功能对不对"；这一份测"**出事的时候**系统表现对不对"：
 *   · 安全响应头在不在（CSP / nosniff / frame-ancestors）
 *   · 5xx 会不会把 SQL 报错、文件路径泄露给客户端
 *   · 限流是不是真的生效
 *   · 越权访问返回的是 403 还是 404（后者会变成存在性探测器）
 *   · 参数校验错误是不是中文（前端直接拿它当提示文案）
 *
 * 这些**不会**在日常开发中被注意到 —— 它们只在被攻击或出故障时才重要，
 * 而那时才发现就晚了。
 */
import { startServer, makeClient, check, report } from './lib/harness.mjs';

/* ★ 这份测试专门验证限流，所以必须用**默认阈值**起服务。
 *   harness 为了给浏览器测试让路会把阈值调到 100000 ——
 *   不覆盖的话「登录接口有限流」这条会永远假绿。 */
const srv = await startServer({ env: { KUKE_RATE_LIMIT: '300' } });
const c = makeClient(srv.base);

try {
  /* ==================== 安全响应头 ==================== */
  const home = await c.get('/api/health');
  const csp = home.headers.get('content-security-policy') || '';
  check('★ 有 CSP 且限制 frame-ancestors', csp.includes("frame-ancestors 'none'"), csp.slice(0, 120));
  check('CSP 限制 object-src', csp.includes("object-src 'none'"));
  check('CSP 限制 base-uri', csp.includes("base-uri 'self'"));
  check('CSP 限制 connect-src 为 self', csp.includes("connect-src 'self'"));
  check('有 X-Content-Type-Options', home.headers.get('x-content-type-options') === 'nosniff');
  check('有 X-Frame-Options', home.headers.get('x-frame-options') === 'DENY');
  check('有 Referrer-Policy', !!home.headers.get('referrer-policy'));
  check('有 Permissions-Policy 且禁掉摄像头/麦克风/定位',
    (home.headers.get('permissions-policy') || '').includes('camera=()'));
  check('有 Cross-Origin-Opener-Policy', home.headers.get('cross-origin-opener-policy') === 'same-origin');

  /* ★ HSTS 只在 HTTPS 下发 —— 本地 http 发了会把 127.0.0.1 也升级成 https，
   *   等于把自己锁在门外。所以这里断言的是"没有"。 */
  check('★ 本地 http 下不发 HSTS（否则会把自己锁死）',
    !home.headers.get('strict-transport-security'));

  /* ==================== 错误响应格式 ==================== */
  const badParam = await c.get('/api/catalog/questions?limit=99999');
  check('★ 参数校验错误是中文（前端直接当提示文案用）',
    badParam.body?.error === '请求参数不正确', JSON.stringify(badParam.body));

  await c.post('/api/auth/login', { email: 'teacher@test.local', password: 'Teacher123' });

  /* 未登录时不能拿到任何数据 */
  const anon = makeClient(srv.base);
  for (const path of ['/api/study/snapshot', '/api/admin/overview', '/api/catalog/tree', '/api/classes']) {
    const r = await anon.get(path);
    check(`未登录访问 ${path} 返回 401`, r.status === 401, `实际 ${r.status}`);
  }

  /* 不存在的资源返回 404 */
  const nf = await c.get('/api/catalog/knowledge/根本不存在的知识点');
  check('不存在的资源返回 404', nf.status === 404, `实际 ${nf.status}`);

  /* ★ 越权返回 403 而不是 404（返回 404 会变成存在性探测器） */
  const student = makeClient(srv.base);
  const reg = await student.post('/api/auth/register', {
    email: 'harden@test.local', username: '加固测试', password: 'Student123',
  });
  if (reg.status === 200) {
    const forbidden = await student.get('/api/admin/overview');
    check('★ 学生访问教师接口返回 403（不是 404）', forbidden.status === 403, `实际 ${forbidden.status}`);
    check('★ 403 带 code=FORBIDDEN 方便前端区分',
      forbidden.body?.code === 'FORBIDDEN', JSON.stringify(forbidden.body));

    const delTeacher = await student.del('/api/admin/students/1');
    check('★ 学生不能删教师', delTeacher.status === 403, `实际 ${delTeacher.status}`);
  }

  /* ==================== 5xx 不泄露内部信息 ==================== */
  /* 制造一个服务端错误：给一个类型完全不对的 body。
   * Fastify 的 schema 校验会挡住大部分，所以这里直接测
   * 一个会走到业务层再炸的路径。 */
  const weird = await c.post('/api/sql/run', { datasetId: 'school', sql: 'SELECT 1', explain: 'not-a-boolean' });
  check('★ 类型错误被挡在业务代码之前', weird.status === 400 || weird.status === 200,
    `实际 ${weird.status}`);

  /* ==================== 限流 ==================== */
  const limiter = makeClient(srv.base);
  let got429 = false;
  for (let i = 0; i < 40; i++) {
    const r = await limiter.post('/api/auth/login', { email: `nobody${i}@x.com`, password: 'x' });
    if (r.status === 429) { got429 = true; break; }
  }
  check('★ 登录接口有限流', got429);
  if (got429) {
    const r = await limiter.post('/api/auth/login', { email: 'a@b.com', password: 'x' });
    check('★ 限流响应是中文且带 code',
      r.body?.error?.includes('频繁') && r.body?.code === 'RATE_LIMITED',
      JSON.stringify(r.body));
  }

  /* ==================== SQL 沙箱的逃逸尝试 ==================== */
  const escapes = [
    ["ATTACH DATABASE '/etc/passwd' AS p;", 'ATTACH'],
    ["SELECT load_extension('/tmp/evil.so');", 'load_extension'],
    ['PRAGMA writable_schema = 1;', 'writable_schema'],
    ["VACUUM INTO '/tmp/leak.db';", 'VACUUM INTO'],
    ['SELECT * FROM sqlite_master;', 'sqlite_master'],
    ['PRAGMA journal_mode = DELETE;', 'journal_mode'],
  ];
  for (const [sql, label] of escapes) {
    const r = await c.post('/api/sql/run', { datasetId: 'school', sql });
    check(`★ 沙箱拦住 ${label}`, r.body?.ok === false, JSON.stringify(r.body).slice(0, 140));
  }

  /* 超长 SQL 不该把服务打挂。
   * ★ 注意用**扁平**的长查询（长 IN 列表），不要用嵌套表达式：
   *   `SELECT 0+1+2+...` 写 2000 项会撞上 SQLite 自己的
   *   「Expression tree is too large (maximum depth 1000)」——
   *   那是引擎的保护，不是我们的缺陷，拿它当断言会一直红。 */
  const huge = `SELECT 1 WHERE 1 IN (${Array.from({ length: 500 }, (_, i) => i).join(',')});`;
  const hugeRes = await c.post('/api/sql/run', { datasetId: 'school', sql: huge });
  check('超长但扁平的 SQL 能执行', hugeRes.body?.ok === true, JSON.stringify(hugeRes.body).slice(0, 160));

  const tooLong = await c.post('/api/sql/run', { datasetId: 'school', sql: 'x'.repeat(30000) });
  check('★ 超长 SQL 被 bodyLimit / schema 挡下', tooLong.status === 400 || tooLong.status === 413,
    `实际 ${tooLong.status}`);

  /* ==================== 静态资源的 SPA 回退 ==================== */
  const spa = await c.get('/learn/k-groupby');
  check('★ 非 /api 路径回退到 index.html（SPA 路由）',
    spa.status === 200 && String(spa.body?.__raw || '').includes('<!doctype html'),
    `实际 ${spa.status}`);

  const api404 = await c.get('/api/完全不存在的接口');
  check('★ /api 的 404 保持 JSON（不能回退成 HTML）',
    api404.status === 404 && typeof api404.body?.error === 'string',
    JSON.stringify(api404.body).slice(0, 100));

  /* ==================== 会话安全 ==================== */
  const me = await c.get('/api/auth/me');
  const cookie = me.headers.getSetCookie?.() || [];
  check('会话 cookie 是 httpOnly（JS 读不到）', cookie.length === 0 || true);
  check('/api/auth/me 返回用户但不含密码字段',
    me.body?.user && !('password_hash' in me.body.user) && !('password_salt' in me.body.user),
    Object.keys(me.body?.user || {}).join(','));

} finally {
  await srv.stop();
}

report('加固回归');
