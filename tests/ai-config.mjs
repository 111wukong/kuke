/* AI 配置的两级规则
 *
 * ══════════════════════════════════════════════════════════════
 * 这个规则容易在重构时被改坏，而且改坏之后**不会报错** ——
 * 只是某个学生突然能用老师的额度了（或者反过来，老师建的账号
 * 突然用不了）。两种都不会让任何东西崩溃，只会让人困惑。
 * ══════════════════════════════════════════════════════════════
 *
 * 规则：
 *   老师配的全局配置 → 老师本人 + 老师创建的账号 自动用
 *   自助注册的账号   → 不继承（全局配置是老师的额度）
 *   个人配置         → 覆盖全局，只影响自己
 *   「有没有自己的配置」以 **API Key** 为准 —— Key 是「谁付钱」的标志
 */
import { startServer, makeClient, check, report } from './lib/harness.mjs';

const srv = await startServer({ env: { KUKE_ALLOW_REGISTER: '1' } });

try {
  /* ---------- 准备三个身份 ---------- */
  const teacher = makeClient(srv.base);
  const tLogin = await teacher.post('/api/auth/login', {
    email: 'teacher@test.local', password: 'Teacher123',
  });
  check('教师登录', tLogin.status === 200, `status=${tLogin.status}`);

  /* ① 老师建的账号 */
  const made = await teacher.post('/api/admin/students', {
    email: 'made@test.local', username: '老师建的', password: 'Student#12345',
  });
  check('老师建号成功', made.status === 200, `status=${made.status} ${JSON.stringify(made.body).slice(0, 90)}`);

  const madeClient = makeClient(srv.base);
  const mLogin = await madeClient.post('/api/auth/login', {
    email: 'made@test.local', password: 'Student#12345',
  });
  check('老师建的账号能登录', mLogin.status === 200, `status=${mLogin.status}`);

  /* ② 自助注册的账号 */
  const selfClient = makeClient(srv.base);
  const reg = await selfClient.post('/api/auth/register', {
    email: 'selfreg@test.local', username: '自助注册', password: 'Student#12345',
  });
  check('自助注册成功', reg.status === 200, `status=${reg.status} ${JSON.stringify(reg.body).slice(0, 90)}`);

  /* ---------- 1. 身份识别 ---------- */
  const tCfg = await teacher.get('/api/ai/config');
  check('教师被识别为 staff', tCfg.body?.accountOrigin === 'staff', `origin=${tCfg.body?.accountOrigin}`);
  check('教师可用全局', tCfg.body?.canUseGlobal === true);

  const mCfg = await madeClient.get('/api/ai/config');
  check('★ 老师建的账号识别为 teacher-created',
    mCfg.body?.accountOrigin === 'teacher-created', `origin=${mCfg.body?.accountOrigin}`);
  check('★ 老师建的账号可用全局', mCfg.body?.canUseGlobal === true);

  const sCfg = await selfClient.get('/api/ai/config');
  check('★ 自助注册的账号识别为 self-registered',
    sCfg.body?.accountOrigin === 'self-registered', `origin=${sCfg.body?.accountOrigin}`);
  check('★ 自助注册的账号不能用全局', sCfg.body?.canUseGlobal === false);
  check('★ 自助注册的账号初始状态是「没有可用配置」', sCfg.body?.blocked === true,
    `blocked=${sCfg.body?.blocked} reason=${sCfg.body?.blockedReason}`);
  check('  但学生自己读得到配置（界面要靠它显示提示）', sCfg.status === 200, `status=${sCfg.status}`);

  /* ---------- 2. 权限边界 ---------- */
  const hack = await selfClient.patch('/api/ai/config', { scope: 'global', apiKey: 'sk-hack' });
  check('★ 学生改全局配置被拒（403）', hack.status === 403, `status=${hack.status}`);

  const madeHack = await madeClient.patch('/api/ai/config', { scope: 'global', model: 'x' });
  check('★ 老师建的账号也不能改全局（403）', madeHack.status === 403, `status=${madeHack.status}`);

  /* ---------- 3. 老师配全局 → 他建的账号继承 ---------- */
  const setG = await teacher.patch('/api/ai/config', {
    scope: 'global', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', timeout: '120',
  });
  check('教师保存全局配置', setG.status === 200 && setG.body?.scope === 'global', `status=${setG.status}`);

  const mAfter = await madeClient.get('/api/ai/config');
  check('★ 老师建的账号自动继承全局配置（模型）', mAfter.body?.model === 'deepseek-chat',
    `model=${mAfter.body?.model}`);
  check('★ 老师建的账号自动继承全局配置（超时 120s → 120000ms）',
    mAfter.body?.timeout === 120000, `timeout=${mAfter.body?.timeout}`);

  const sAfter = await selfClient.get('/api/ai/config');
  check('★ 自助注册的账号仍然不继承（还是 blocked）', sAfter.body?.blocked === true,
    `blocked=${sAfter.body?.blocked}`);

  /* ---------- 4. 自助注册的学生自己配 ---------- */
  const own = await selfClient.patch('/api/ai/config', {
    scope: 'personal', apiKey: 'sk-owntest1234567890abcdef',
    baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k',
  });
  check('★ 自助注册的学生可以配自己的', own.status === 200 && own.body?.scope === 'personal',
    `status=${own.status}`);

  const sOwn = await selfClient.get('/api/ai/config');
  check('★ 配完后不再 blocked', sOwn.body?.blocked === false);
  check('★ 生效来源变成 personal', sOwn.body?.effectiveSource === 'personal',
    `source=${sOwn.body?.effectiveSource}`);
  check('★ 用的是他自己配的模型', sOwn.body?.model === 'moonshot-v1-8k', `model=${sOwn.body?.model}`);
  check('★ key 打码返回', /\*{8}/.test(sOwn.body?.keyMasked || ''), `masked=${sOwn.body?.keyMasked}`);

  /* ---------- 5. 个人配置不外溢 ---------- */
  const mFinal = await madeClient.get('/api/ai/config');
  check('★ 别人配的不影响老师建的账号',
    mFinal.body?.model === 'deepseek-chat' && mFinal.body?.effectiveSource !== 'personal',
    `model=${mFinal.body?.model} source=${mFinal.body?.effectiveSource}`);

  /* ---------- 6. 「有自己的配置」以 Key 为准 ---------- */
  await teacher.patch('/api/ai/config', { scope: 'personal', apiKey: '', baseUrl: '', model: '', timeout: '' });
  const modelOnly = await teacher.patch('/api/ai/config', { scope: 'personal', model: 'deepseek-reasoner' });
  check('只改模型名不填 Key 也返回成功', modelOnly.status === 200, `status=${modelOnly.status}`);

  const tAfter = await teacher.get('/api/ai/config');
  check('★ 但不算「有自己的配置」—— 仍然走全局（Key 是「谁付钱」的标志）',
    tAfter.body?.effectiveSource !== 'personal',
    `source=${tAfter.body?.effectiveSource}`);

  /* ---------- 7. 老师配自己的可以覆盖全局 ---------- */
  await teacher.patch('/api/ai/config', {
    scope: 'personal', apiKey: 'sk-teacherowntest1234567890', model: 'deepseek-reasoner',
  });
  const tOver = await teacher.get('/api/ai/config');
  check('★ 教师的个人配置覆盖全局',
    tOver.body?.effectiveSource === 'personal' && tOver.body?.model === 'deepseek-reasoner',
    `source=${tOver.body?.effectiveSource} model=${tOver.body?.model}`);
  check('  覆盖个人配置不会改坏全局配置', tOver.body?.global?.model === 'deepseek-chat',
    `global.model=${tOver.body?.global?.model}`);

  /* ---------- 8. 校验非法输入 ---------- */
  const badUrl = await teacher.patch('/api/ai/config', { scope: 'global', baseUrl: 'api.deepseek.com' });
  check('★ 地址缺协议头被拒（400）', badUrl.status === 400, `status=${badUrl.status}`);

  const badTimeout = await teacher.patch('/api/ai/config', { scope: 'global', timeout: '1' });
  check('★ 超时越界被拒（400）', badTimeout.status === 400, `status=${badTimeout.status}`);

} finally {
  await srv.stop();
}

report('AI 配置的两级规则');
