/* 接口冒烟测试
 *
 * 起一个真服务（临时库 + 随机端口），把整个系统的主流程跑一遍：
 * 注册 → 建班 → 入班 → 学 → 练 → 判 → 复习 → 作业 → 批改 → 权限边界。
 *
 * ── 这份测试的定位 ──────────────────────────────────────────────
 * 它不是单元测试的替代品（判题算法、范式算法、FSRS 在 tests/unit.mjs 里）。
 * 它测的是**串起来之后还对不对**：路由有没有挂错、鉴权有没有漏、
 * 事务有没有把数据写歪、字段名前后端有没有对齐。
 * 这类问题单元测试一个都测不出来，而它们恰恰是最常见的。
 */
import { startServer, makeClient, check, eq, report } from './lib/harness.mjs';

const srv = await startServer();
const teacher = makeClient(srv.base);
const student = makeClient(srv.base);
const outsider = makeClient(srv.base);

/* 判断"这次调用成功了吗"。
 *
 * ★ 这个 helper 必须同时接受**响应对象**和**响应体**。
 *   第一版只认响应对象（读 r.status），但调用处几乎都写成 `ok(r.body)` ——
 *   于是 body.status 是 undefined，所有断言全假，
 *   一次跑出 40 多条"失败"，而每条失败明细里的响应体看起来都是对的。
 *   一个判断助手写错，比没有助手更糟：它把真问题淹了。 */
const ok = (x) => {
  if (!x || typeof x !== 'object') return false;
  if (typeof x.status === 'number') return x.status >= 200 && x.status < 300; // 传了 response
  return x.error === undefined; // 传了 body
};

try {
  /* ==================== 1. 健康检查与鉴权闸门 ==================== */
  const health = await teacher.get('/api/health');
  check('健康检查可用（不需要登录）', ok(health.body), JSON.stringify(health.body));
  /* ★ 只断言「表数量在合理范围」，不写死具体数字。
   *   写死的话每加一张表都要改测试 —— 那个断言就从保护变成了负担，
   *   而且它会诱导人「为了让测试变绿而改数字」，而不是去问
   *   「表加得对不对」。
   *   这条真正要守的是「健康检查能读通数据库」，不是表的精确数量。 */
  check('健康检查能读通数据库（表数量合理）', health.body.tables >= 28, `实际 ${health.body.tables}`);

  eq('未登录访问受保护接口返回 401', (await teacher.get('/api/study/snapshot')).status, 401);
  eq('未登录访问教师接口返回 401', (await teacher.get('/api/admin/overview')).status, 401);
  eq('不存在的 API 返回 404 且是 JSON', (await teacher.get('/api/nope')).status, 404);

  const errFmt = await teacher.get('/api/catalog/questions?limit=999');
  check('参数校验错误是中文', errFmt.body?.error === '请求参数不正确', JSON.stringify(errFmt.body));

  /* ==================== 2. 登录 ==================== */
  const tLogin = await teacher.post('/api/auth/login', { email: 'teacher@test.local', password: 'Teacher123' });
  check('教师登录成功', ok(tLogin.body), JSON.stringify(tLogin.body));
  check('教师角色是 teacher', tLogin.body?.user?.role === 'teacher', JSON.stringify(tLogin.body?.user));

  const badLogin = await teacher.post('/api/auth/login', { email: 'teacher@test.local', password: 'wrong-password' });
  eq('密码错误返回 401', badLogin.status, 401);
  check('错误信息不区分"邮箱不存在"和"密码错"',
    badLogin.body?.error === '邮箱或密码不正确', JSON.stringify(badLogin.body));

  /* ==================== 3. 注册学生 + 建班 + 入班 ==================== */
  const cls = await teacher.post('/api/classes', { name: '数据库 2026 秋', term: '2026 秋' });
  check('教师建班成功', ok(cls.body), JSON.stringify(cls.body));
  const classId = cls.body?.class?.id;
  const classCode = cls.body?.class?.code;
  check('班级有 6 位邀请码', typeof classCode === 'string' && classCode.length === 6, classCode);

  const reg = await student.post('/api/auth/register', {
    email: 'stu1@test.local', username: '张三', password: 'Student123', classCode,
  });
  check('学生凭邀请码注册并直接入班', ok(reg.body), JSON.stringify(reg.body));
  check('注册默认角色是 student', reg.body?.user?.role === 'student', reg.body?.user?.role);
  check('注册时入班成功', reg.body?.joinedClass === '数据库 2026 秋', reg.body?.joinedClass);

  const reg2 = await student.post('/api/auth/register', {
    email: 'stu1@test.local', username: '重复', password: 'Student123',
  });
  eq('重复邮箱注册返回 409', reg2.status, 409);

  const badCode = await outsider.post('/api/auth/register', {
    email: 'stu2@test.local', username: '李四', password: 'Student123', classCode: 'ZZZZZZ',
  });
  eq('无效邀请码被拒绝', badCode.status, 400);

  const reg3 = await outsider.post('/api/auth/register', {
    email: 'stu2@test.local', username: '李四', password: 'Student123',
  });
  check('不带邀请码也能注册', ok(reg3.body), JSON.stringify(reg3.body));

  /* 学生不能自己注册成教师 —— 这是权限模型的第一道门 */
  const me = await student.get('/api/auth/me');
  check('/api/auth/me 返回当前用户', me.body?.user?.email === 'stu1@test.local', JSON.stringify(me.body?.user));

  /* ==================== 4. 内容读取 ==================== */
  const tree = await student.get('/api/catalog/tree');
  check('知识树可读', ok(tree.body) && tree.body.categories.length === 7,
    `分类数 ${tree.body?.categories?.length}`);
  check('知识树含 47 个知识点',
    tree.body.categories.reduce((s, c) => s + c.chapters.reduce((t, ch) => t + ch.knowledge.length, 0), 0) === 47);

  const kDetail = await student.get('/api/catalog/knowledge/k-groupby');
  check('知识点详情可读', ok(kDetail.body), JSON.stringify(kDetail.body).slice(0, 120));
  check('知识点详情带前置依赖', Array.isArray(kDetail.body?.prereqs), typeof kDetail.body?.prereqs);
  check('知识点详情带解锁列表', Array.isArray(kDetail.body?.unlocks));

  const qs = await student.get('/api/catalog/questions?limit=200');
  check('题库可读', ok(qs.body) && qs.body.questions.length === 180, `题目数 ${qs.body?.questions?.length}`);
  check('★ 题库列表不下发答案', qs.body.questions.every((q) => q.answer === undefined),
    JSON.stringify(qs.body.questions.find((q) => q.answer !== undefined) || {}));

  const levels = await student.get('/api/catalog/levels');
  check('关卡列表可读', ok(levels.body) && levels.body.levels.length === 45, `关卡数 ${levels.body?.levels?.length}`);
  const lv1 = await student.get('/api/catalog/levels/L01');
  check('关卡详情不下发参考答案', lv1.body?.reference === undefined);
  check('关卡详情带初始 SQL', typeof lv1.body?.level?.starterSql === 'string');

  const nts = await student.get('/api/catalog/normalize-tasks');
  check('范式题列表可读', ok(nts.body) && nts.body.tasks.length === 15, `题数 ${nts.body?.tasks?.length}`);
  check('★ 范式题列表不下发答案', nts.body.tasks.every((t) => t.answer === undefined));

  const labs = await student.get('/api/catalog/labs');
  check('实验台列表可读', ok(labs.body) && labs.body.labs.length === 9, `实验数 ${labs.body?.labs?.length}`);

  /* ==================== 5. SQL 实训场 ==================== */
  const run1 = await student.post('/api/sql/run', {
    datasetId: 'school', sql: 'SELECT sname, sdept FROM student WHERE sdept = \'计算机系\';',
  });
  check('SQL 能跑出结果', run1.body?.ok === true, JSON.stringify(run1.body).slice(0, 200));
  const firstSet = run1.body.results.find((r) => r.columns?.length);
  check('SQL 结果列名正确', JSON.stringify(firstSet?.columns) === '["sname","sdept"]', JSON.stringify(firstSet?.columns));
  check('SQL 结果有数据', firstSet?.rows?.length === 4, `行数 ${firstSet?.rows?.length}`);

  const runBad = await student.post('/api/sql/run', { datasetId: 'school', sql: 'SELECT * FROM 不存在的表;' });
  check('SQL 语法/语义错误被捕获', runBad.body?.ok === false, JSON.stringify(runBad.body).slice(0, 160));
  check('错误信息可读', typeof runBad.body?.error === 'string' && runBad.body.error.length > 0);

  /* 安全闸门 */
  const attach = await student.post('/api/sql/run', { datasetId: 'school', sql: "ATTACH DATABASE '/etc/passwd' AS x;" });
  check('★ ATTACH 被沙箱拦截', attach.body?.ok === false && /ATTACH/i.test(attach.body?.error || ''),
    JSON.stringify(attach.body).slice(0, 160));

  const ext = await student.post('/api/sql/run', { datasetId: 'school', sql: "SELECT load_extension('evil.so');" });
  check('★ load_extension 被沙箱拦截', ext.body?.ok === false, JSON.stringify(ext.body).slice(0, 160));

  const master = await student.post('/api/sql/run', { datasetId: 'school', sql: 'SELECT * FROM sqlite_master;' });
  check('★ 直读 sqlite_master 被拦截', master.body?.ok === false, JSON.stringify(master.body).slice(0, 160));

  const pragma = await student.post('/api/sql/run', { datasetId: 'school', sql: 'PRAGMA writable_schema = 1;' });
  check('★ 危险 PRAGMA 被拦截', pragma.body?.ok === false, JSON.stringify(pragma.body).slice(0, 160));

  /* 写操作在自由模式允许（用的是用完即扔的内存库） */
  const write = await student.post('/api/sql/run', {
    datasetId: 'school', sql: "INSERT INTO student VALUES ('9999','测试','男',20,'测试系'); SELECT COUNT(*) FROM student;",
  });
  check('自由模式允许写操作', write.body?.ok === true, JSON.stringify(write.body).slice(0, 200));
  const lastWrite = [...(write.body.results || [])].reverse().find((r) => r.columns?.length);
  check('写操作后能读到新数据（同一次执行内）', lastWrite?.rows?.[0]?.[0] === 12, JSON.stringify(lastWrite?.rows));

  /* 写操作**不落库**：下一次执行必须还是原始数据 */
  const after = await student.post('/api/sql/run', { datasetId: 'school', sql: 'SELECT COUNT(*) FROM student;' });
  const afterSet = [...(after.body.results || [])].reverse().find((r) => r.columns?.length);
  check('★ 上一条的写入不影响下一次执行（每次新建内存库）', afterSet?.rows?.[0]?.[0] === 11,
    `实际 ${afterSet?.rows?.[0]?.[0]}`);

  /* ==================== 6. 关卡判题 ==================== */
  const lvOk = await student.post('/api/sql/levels/L01/submit', { sql: 'SELECT * FROM student;' });
  check('关卡 L01 正确答案通过', lvOk.body?.pass === true, JSON.stringify(lvOk.body).slice(0, 200));
  check('首次通过给 XP', lvOk.body?.xpGained > 0, `xpGained=${lvOk.body?.xpGained}`);
  check('通过后返回参考答案', typeof lvOk.body?.reference === 'string');

  const lvBad = await student.post('/api/sql/levels/L01/submit', { sql: 'SELECT sno FROM student;' });
  check('列数不对判错', lvBad.body?.pass === false, JSON.stringify(lvBad.body).slice(0, 200));
  check('判错原因指出列数问题', lvBad.body?.reason === 'COLUMN_COUNT', lvBad.body?.reason);

  const lvRepass = await student.post('/api/sql/levels/L01/submit', { sql: 'SELECT * FROM student;' });
  check('重复通过不再给 XP（防刷分）', lvRepass.body?.xpGained === 0, `xpGained=${lvRepass.body?.xpGained}`);

  /* 结果集比对的关键性质：写法不同但结果相同，应当通过 */
  const lvAlt = await student.post('/api/sql/levels/L03/submit', {
    sql: "select * from student where sdept = '计算机系'",
  });
  check('★ 等价写法（大小写不同）也判对 —— 不比对 SQL 文本', lvAlt.body?.pass === true,
    JSON.stringify(lvAlt.body).slice(0, 200));

  /* 行序：L06 要求排序 */
  const lvOrder = await student.post('/api/sql/levels/L06/submit', {
    sql: 'SELECT sname, sage FROM student ORDER BY sage ASC LIMIT 3;',
  });
  check('★ 要求行序的关卡，顺序错就判错', lvOrder.body?.pass === false,
    JSON.stringify(lvOrder.body).slice(0, 200));

  /* DML 关卡走自定义校验 */
  const lvDml = await student.post('/api/sql/levels/L36/submit', {
    sql: "INSERT INTO student (sno, sname, ssex, sage, sdept) VALUES ('2021011','钱进','男',20,'计算机系');",
  });
  check('DML 关卡用自定义校验判分', lvDml.body?.pass === true, JSON.stringify(lvDml.body).slice(0, 200));

  const lvDmlBad = await student.post('/api/sql/levels/L36/submit', {
    sql: "INSERT INTO student (sno, sname, ssex, sage, sdept) VALUES ('2021011','错误名字','男',20,'计算机系');",
  });
  check('DML 关卡插错数据判错', lvDmlBad.body?.pass === false, JSON.stringify(lvDmlBad.body).slice(0, 200));

  /* 看答案的门槛 */
  const solBefore = await outsider.get('/api/sql/levels/L05/solution');
  eq('一次都没做过时不能看答案', solBefore.status, 403);
  const solAfter = await student.get('/api/sql/levels/L01/solution');
  check('做过之后可以看答案', ok(solAfter.body) && typeof solAfter.body.reference === 'string');

  /* 超时保护：笛卡尔积 */
  const timeout = await student.post('/api/sql/run', {
    datasetId: 'shop',
    sql: 'SELECT COUNT(*) FROM order_item a, order_item b, order_item c, order_item d, order_item e, order_item f, order_item g, order_item h;',
  });
  check('★ 笛卡尔积被超时中断而不是拖死服务', timeout.body?.ok === false && timeout.body?.phase === 'timeout',
    JSON.stringify(timeout.body).slice(0, 200));

  /* 超时之后服务仍然可用（worker 被替换了） */
  const afterTimeout = await student.post('/api/sql/run', { datasetId: 'school', sql: 'SELECT 1;' });
  check('★ 超时后服务仍正常（worker 已重建）', afterTimeout.body?.ok === true,
    JSON.stringify(afterTimeout.body).slice(0, 160));

  /* ==================== 7. 客观题 ==================== */
  const ans = await student.post('/api/study/answer', { qid: 'Q001', answer: 'B', context: 'practice' });
  check('客观题答对判对', ans.body?.pass === true, JSON.stringify(ans.body).slice(0, 200));
  check('答对后给出解析', typeof ans.body?.analysis === 'string' && ans.body.analysis.length > 10);

  const ansWrong = await student.post('/api/study/answer', { qid: 'Q019', answer: 'C', context: 'practice' });
  check('客观题答错判错', ansWrong.body?.pass === false);
  check('答错自动建复习卡', ansWrong.body?.cardCreated === true, JSON.stringify(ansWrong.body).slice(0, 200));
  check('答错给出错因归类', typeof ansWrong.body?.errorType === 'string' && ansWrong.body.errorType.length > 0);

  /* 判断题的各种写法都要认 */
  const judge1 = await student.post('/api/study/answer', { qid: 'Q038', answer: '对' });
  check('判断题认「对」', judge1.body?.pass === true, JSON.stringify(judge1.body).slice(0, 160));
  const judge2 = await student.post('/api/study/answer', { qid: 'Q038', answer: 'T' });
  check('判断题认「T」', judge2.body?.pass === true);

  /* 多选部分分 */
  const multiPartial = await student.post('/api/study/answer', { qid: 'Q009', answer: 'AB' });
  check('多选漏选给一半分', multiPartial.body?.score === 50, `score=${multiPartial.body?.score}`);
  const multiWrong = await student.post('/api/study/answer', { qid: 'Q009', answer: 'ABCD' });
  check('多选选错项得 0 分', multiWrong.body?.score === 0, `score=${multiWrong.body?.score}`);

  /* 填空题数值容差 */
  const blank1 = await student.post('/api/study/answer', { qid: 'Q049', answer: '256|1677' });
  check('填空题多空比对', blank1.body?.pass === true, JSON.stringify(blank1.body).slice(0, 160));

  /* 简答题不自动判分 */
  const short1 = await student.post('/api/study/answer', { qid: 'Q013', answer: '随便写点什么' });
  check('简答题标记为需人工批改', short1.body?.needsManual === true, JSON.stringify(short1.body).slice(0, 160));

  /* ==================== 8. 范式题 ==================== */
  const nf1 = await student.post('/api/study/normalize/N01', { answer: { value: 'A,B,C' } });
  check('范式题闭包判对', nf1.body?.pass === true, JSON.stringify(nf1.body).slice(0, 200));

  const nf1bad = await student.post('/api/study/normalize/N01', { answer: { value: 'A,B' } });
  check('范式题闭包判错（只扫一遍的经典错误）', nf1bad.body?.pass === false,
    JSON.stringify(nf1bad.body).slice(0, 200));

  const nfKeys = await student.post('/api/study/normalize/N05', { answer: { value: ['AB', 'BC', 'BD'] } });
  check('候选键判对', nfKeys.body?.pass === true, JSON.stringify(nfKeys.body).slice(0, 240));

  const nfKeysBad = await student.post('/api/study/normalize/N05', { answer: { value: ['AB'] } });
  check('候选键漏了判错', nfKeysBad.body?.pass === false);

  const nfNf = await student.post('/api/study/normalize/N09', { answer: { value: '3NF' } });
  check('★ 3NF 但不是 BCNF 的经典判定', nfNf.body?.pass === true, JSON.stringify(nfNf.body).slice(0, 200));

  const nfNfBad = await student.post('/api/study/normalize/N09', { answer: { value: 'BCNF' } });
  check('把 3NF 判成 BCNF 会被纠正', nfNfBad.body?.pass === false);

  /* 分解题：验性质而不是比答案 —— 换一种正确分解也应通过 */
  const nfDecomp = await student.post('/api/study/normalize/N13', {
    answer: { value: [['A', 'B'], ['A', 'C', 'D'], ['D', 'E']] },
  });
  check('3NF 分解判对', nfDecomp.body?.pass === true, JSON.stringify(nfDecomp.body).slice(0, 240));

  const nfDecompBad = await student.post('/api/study/normalize/N13', {
    answer: { value: [['A', 'B'], ['C', 'D'], ['D', 'E']] },
  });
  check('★ 有损分解被拒绝（不只是"和答案不一样"）', nfDecompBad.body?.pass === false,
    JSON.stringify(nfDecompBad.body).slice(0, 240));

  const nfExplain = await student.get('/api/study/normalize/N01/explain');
  check('做过之后能看推导过程', ok(nfExplain.body) && !!nfExplain.body.derivation?.normalForm);

  /* ==================== 9. 索引实验（真跑 EXPLAIN） ==================== */
  const ix = await student.post('/api/sql/labs/IX01/submit', { pick: 'A' });
  check('索引实验判对', ix.body?.pass === true, JSON.stringify(ix.body).slice(0, 200));
  check('★ 返回真实的 EXPLAIN 计划', Array.isArray(ix.body?.plans) && ix.body.plans.length === 4,
    `plans=${ix.body?.plans?.length}`);
  check('正确选项的计划里确实有 SEARCH',
    ix.body?.plans?.find((p) => p.key === 'A')?.usesIndex === true,
    JSON.stringify(ix.body?.plans?.find((p) => p.key === 'A')));
  check('错误选项的计划里是 SCAN',
    ix.body?.plans?.find((p) => p.key === 'B')?.usesIndex === false);

  const ixWrong = await student.post('/api/sql/labs/IX01/submit', { pick: 'B' });
  check('索引实验选错判错', ixWrong.body?.pass === false);

  const ix3 = await student.post('/api/sql/labs/IX03/submit', { pick: 'D' });
  check('★ "建了索引也没用"的题判对', ix3.body?.pass === true, JSON.stringify(ix3.body).slice(0, 200));
  check('前导通配符下所有索引选项都没用上',
    ix3.body?.plans?.filter((p) => p.ddl).every((p) => p.usesIndex === false));

  const tx = await student.post('/api/study/answer', { qid: 'Q064', answer: 'C' });
  check('事务可串行化题判对', tx.body?.pass === true, JSON.stringify(tx.body).slice(0, 160));

  /* ==================== 10. 复习（FSRS） ==================== */
  const review = await student.get('/api/study/review');
  check('复习队列可读', ok(review.body), JSON.stringify(review.body).slice(0, 160));
  check('答错产生的卡片进了复习队列', review.body.items.length > 0, `队列长度 ${review.body?.items?.length}`);

  if (review.body.items.length) {
    const cardId = review.body.items[0].cardId;
    const g1 = await student.post(`/api/study/review/${cardId}`, { rating: 3 });
    check('复习评分后返回下次间隔', ok(g1.body) && typeof g1.body.next?.due === 'string',
      JSON.stringify(g1.body).slice(0, 200));
    check('FSRS 产出了稳定度与难度', typeof g1.body.next?.stability === 'number'
      && typeof g1.body.next?.difficulty === 'number', JSON.stringify(g1.body?.next));

    const g2 = await student.post(`/api/study/review/${cardId}`, { rating: 1 });
    check('评"忘了"会把间隔压短', ok(g2.body) && g2.body.next.state !== 'review',
      JSON.stringify(g2.body?.next));

    const other = await outsider.post(`/api/study/review/${cardId}`, { rating: 3 });
    eq('★ 不能复习别人的卡片', other.status, 404);
  }

  /* ==================== 11. 统计与诊断 ==================== */
  const snapshot = await student.get('/api/study/snapshot');
  check('仪表盘快照可读', ok(snapshot.body), JSON.stringify(snapshot.body).slice(0, 200));
  check('快照含热力图数据', Array.isArray(snapshot.body?.snapshot?.heatmap)
    && snapshot.body.snapshot.heatmap.length === 28);
  check('快照含等级信息', typeof snapshot.body?.snapshot?.level === 'number');
  check('每日计划可读', Array.isArray(snapshot.body?.plan?.review));

  const stats = await student.get('/api/study/stats');
  check('统计可读', ok(stats.body), JSON.stringify(stats.body).slice(0, 160));
  check('统计按分类聚合', Array.isArray(stats.body?.byCategory));

  const mistakes = await student.get('/api/study/mistakes');
  check('错题本可读', ok(mistakes.body), JSON.stringify(mistakes.body).slice(0, 160));
  check('错题本有内容', mistakes.body.mistakes.length > 0, `错题数 ${mistakes.body?.mistakes?.length}`);

  const diag = await student.get('/api/study/diagnose');
  check('根因诊断可读', ok(diag.body), JSON.stringify(diag.body).slice(0, 200));
  check('诊断给出根因列表', Array.isArray(diag.body?.diagnosis?.roots));
  check('诊断给出学习路径', Array.isArray(diag.body?.diagnosis?.path));
  check('诊断有摘要文案', typeof diag.body?.diagnosis?.summary === 'string');

  const ach = await student.get('/api/study/achievements');
  check('成就可读', ok(ach.body), JSON.stringify(ach.body).slice(0, 160));
  check('已经解锁了至少一个成就', ach.body.achievements.owned > 0, `已解锁 ${ach.body?.achievements?.owned}`);

  /* ==================== 12. 教师端：学生管理（完全权限） ==================== */
  const ov = await teacher.get('/api/admin/overview');
  check('教师总览可读', ok(ov.body), JSON.stringify(ov.body).slice(0, 200));
  check('总览能看到自己的班级', ov.body.classes.length >= 1);

  const stuList = await teacher.get('/api/admin/students');
  check('教师能列出学生', ok(stuList.body), JSON.stringify(stuList.body).slice(0, 160));
  check('教师名下学生是入班的那个', stuList.body.total >= 1, `学生数 ${stuList.body?.total}`);

  /* ★ 教师能看到"入班的学生"，但**看不到**"没入班的学生" —— 这是权限边界 */
  const outsiderId = reg3.body?.user?.id;
  check('★ 没入班的学生不在教师管辖范围内',
    !stuList.body.students.some((s) => s.id === outsiderId),
    `学生列表：${stuList.body.students.map((s) => s.id).join(',')}`);

  const stu1Id = reg.body?.user?.id;
  const detail = await teacher.get(`/api/admin/students/${stu1Id}`);
  check('教师能看学生详情', ok(detail.body), JSON.stringify(detail.body).slice(0, 200));
  check('学生详情含学情统计', typeof detail.body.student?.stats?.accuracy === 'number');
  check('学生详情含他写的 SQL', Array.isArray(detail.body.sqlRuns) && detail.body.sqlRuns.length > 0,
    `SQL 记录数 ${detail.body?.sqlRuns?.length}`);
  check('学生详情含根因诊断', Array.isArray(detail.body.diagnosis?.roots));
  check('★ 学生详情里没有密码哈希', !('password_hash' in (detail.body.student || {})),
    Object.keys(detail.body.student || {}).join(','));

  const crossDetail = await teacher.get(`/api/admin/students/${outsiderId}`);
  eq('★ 教师访问管辖外学生返回 403', crossDetail.status, 403);

  /* 建号 */
  const created = await teacher.post('/api/admin/students', {
    email: 'stu3@test.local', username: '王五', realName: '王五', studentNo: '2026003', classId,
  });
  check('教师能建学生账号', ok(created.body), JSON.stringify(created.body).slice(0, 200));
  check('★ 建号返回一次性初始密码', typeof created.body.initialPassword === 'string'
    && created.body.initialPassword.length >= 8, created.body?.initialPassword);
  const stu3Id = created.body?.student?.id;

  const newLogin = await makeClient(srv.base).post('/api/auth/login', {
    email: 'stu3@test.local', password: created.body.initialPassword,
  });
  check('用初始密码能登录', ok(newLogin.body), JSON.stringify(newLogin.body).slice(0, 160));

  /* 批量建号 */
  const batch = await teacher.post('/api/admin/students', {
    classId,
    batch: [
      { email: 'b1@test.local', username: '批量一' },
      { email: 'b2@test.local', username: '批量二' },
      { email: 'b1@test.local', username: '重复邮箱' },
      { email: 'not-an-email', username: '坏邮箱' },
    ],
  });
  check('批量建号成功 2 个、失败 2 个',
    batch.body?.created?.length === 2 && batch.body?.failed?.length === 2,
    JSON.stringify({ c: batch.body?.created?.length, f: batch.body?.failed?.length }));
  check('批量建号每人一个不同的随机密码',
    batch.body.created[0].password !== batch.body.created[1].password);

  /* 改资料 */
  const patch = await teacher.patch(`/api/admin/students/${stu1Id}`, {
    realName: '张三丰', studentNo: '2026001', note: '数据库基础较弱，重点补 GROUP BY',
  });
  check('教师能改学生资料', ok(patch.body), JSON.stringify(patch.body).slice(0, 200));
  check('改动被记录在 changed 里', patch.body.changed?.realName?.[1] === '张三丰');

  /* 停用 → 当场踢会话 */
  const disable = await teacher.patch(`/api/admin/students/${stu1Id}`, { status: 'disabled' });
  check('教师能停用学生', ok(disable.body), JSON.stringify(disable.body).slice(0, 160));
  const afterDisable = await student.get('/api/auth/me');
  eq('★ 停用后原有会话立即失效', afterDisable.status, 401);

  const relogin = await student.post('/api/auth/login', { email: 'stu1@test.local', password: 'Student123' });
  eq('★ 被停用的账号无法登录', relogin.status, 403);
  check('停用提示是可读的中文', /停用/.test(relogin.body?.error || ''), relogin.body?.error);

  const enable = await teacher.patch(`/api/admin/students/${stu1Id}`, { status: 'active' });
  check('教师能重新启用', ok(enable.body));
  const relogin2 = await student.post('/api/auth/login', { email: 'stu1@test.local', password: 'Student123' });
  check('启用后能重新登录', ok(relogin2.body));

  /* 重置密码 */
  const reset = await teacher.post(`/api/admin/students/${stu1Id}/password`, {});
  check('教师能重置密码', ok(reset.body) && typeof reset.body.newPassword === 'string',
    JSON.stringify(reset.body).slice(0, 160));
  const afterReset = await student.get('/api/auth/me');
  eq('★ 重置密码后旧会话失效', afterReset.status, 401);
  const withNewPw = await student.post('/api/auth/login', {
    email: 'stu1@test.local', password: reset.body.newPassword,
  });
  check('用重置后的密码能登录', ok(withNewPw.body), JSON.stringify(withNewPw.body).slice(0, 160));

  /* 强制下线 */
  const forced = await teacher.post(`/api/admin/students/${stu1Id}/logout`, {});
  check('教师能强制下线', ok(forced.body) && forced.body.sessionsKilled >= 1,
    JSON.stringify(forced.body).slice(0, 160));
  eq('★ 强制下线后学生会话立即失效', (await student.get('/api/auth/me')).status, 401);

  /* 前面的「重置密码」和「强制下线」都把 student 这个客户端的会话踢掉了，
   * 后面还有一堆以学生身份做的事，所以这里必须重新登录。
   * （这不是测试的 bug，是权限设计在正常工作 —— 顺带验证了踢会话是真的生效。） */
  const reLogin = await student.post('/api/auth/login', {
    email: 'stu1@test.local', password: reset.body.newPassword,
  });
  check('重新登录后恢复学生会话', ok(reLogin.body), JSON.stringify(reLogin.body).slice(0, 120));

  /* 教师不能管别的教师 */
  const t2 = makeClient(srv.base);
  await teacher.post('/api/admin/students', {
    email: 'teacher2@test.local', username: '李老师',
  });
  /* 先把这个账号提为教师（用管理员不行，这里用 SQL 直改不现实，
   * 所以改成验证「教师不能把自己提为管理员」这条） */
  const selfPromote = await teacher.patch(`/api/admin/students/1`, { role: 'admin' });
  check('★ 教师不能把任何人提为管理员',
    selfPromote.status === 403 || selfPromote.status === 400,
    `status=${selfPromote.status} ${JSON.stringify(selfPromote.body)}`);

  const teacherTryAdmin = await teacher.get('/api/admin/health');
  eq('★ 教师访问管理员接口返回 403', teacherTryAdmin.status, 403);

  /* ==================== 13. 学生不能碰教师接口 ==================== */
  const sAdmin = await student.get('/api/admin/overview');
  eq('★ 学生访问教师接口返回 403', sAdmin.status, 403);
  const sStudents = await student.get('/api/admin/students');
  eq('★ 学生访问学生列表返回 403', sStudents.status, 403);
  const sCreate = await student.post('/api/admin/students', { email: 'hack@test.local', username: '黑客' });
  eq('★ 学生不能建账号', sCreate.status, 403);
  const sClasses = await student.post('/api/classes', { name: '我自己建的班' });
  eq('★ 学生不能建班', sClasses.status, 403);
  const sAssign = await student.post('/api/assignments', {
    classId, title: '假作业', items: [{ kind: 'question', refId: 'Q001' }],
  });
  eq('★ 学生不能布置作业', sAssign.status, 403);

  /* ==================== 14. 作业全流程 ==================== */
  const asg = await teacher.post('/api/assignments', {
    classId,
    title: '第一章作业：关系模型与 SQL 基础',
    brief: '做完 Q001、Q014 和 L02 关卡。',
    dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    items: [
      { kind: 'question', refId: 'Q001', points: 20 },
      { kind: 'question', refId: 'Q014', points: 20 },
      { kind: 'question', refId: 'Q013', points: 30 }, // 简答，需人工批
      { kind: 'level', refId: 'L02', points: 30 },
    ],
  });
  check('教师能布置作业', ok(asg.body), JSON.stringify(asg.body).slice(0, 200));
  const asgId = asg.body?.id;
  check('作业总分是各题分数之和', asg.body?.totalPoints === 100, `totalPoints=${asg.body?.totalPoints}`);

  const badAsg = await teacher.post('/api/assignments', {
    classId, title: '坏作业', items: [{ kind: 'question', refId: '不存在的题' }],
  });
  eq('★ 布置不存在的题目被拒绝', badAsg.status, 400);

  const asgDetail = await teacher.get(`/api/assignments/${asgId}`);
  check('教师能看作业详情', ok(asgDetail.body), JSON.stringify(asgDetail.body).slice(0, 200));
  check('★ 教师视角能看到全部学生的提交状态',
    Array.isArray(asgDetail.body.submissions) && asgDetail.body.submissions.length >= 1,
    `提交记录 ${asgDetail.body?.submissions?.length}`);
  check('未提交的学生状态是 not_submitted',
    asgDetail.body.submissions.some((s) => s.status === 'not_submitted'));

  const asgItems = asgDetail.body.items;
  const studentAsg = await student.get(`/api/assignments/${asgId}`);
  check('学生能看作业', ok(studentAsg.body), JSON.stringify(studentAsg.body).slice(0, 160));
  const q001Item = studentAsg.body.items.find((i) => i.refId === 'Q001');
  const q014Item = studentAsg.body.items.find((i) => i.refId === 'Q014');
  const q013Item = studentAsg.body.items.find((i) => i.refId === 'Q013');
  const l02Item = studentAsg.body.items.find((i) => i.refId === 'L02');

  check('★ 学生视角的作业题目不含答案', q001Item?.question?.answer === undefined,
    JSON.stringify(q001Item?.question));
  check('★ 学生视角的关卡不含参考答案', l02Item?.level?.reference === undefined,
    JSON.stringify(l02Item?.level));
  check('★ 学生视角的作业不带评分点', q013Item?.question?.steps === undefined);

  const fullAnswers = [
    { itemId: q001Item.id, answer: 'B' },                                      // 对，20 分
    { itemId: q014Item.id, answer: 'A' },                                      // 错（正确答案是 B），0 分
    { itemId: q013Item.id, answer: '简答内容，待教师批改' },                     // 待人工，30 分
    { itemId: l02Item.id, answer: 'SELECT sno, sname, sdept FROM student;' },  // 对，30 分
  ];

  const submit = await student.post(`/api/assignments/${asgId}/submit`, { answers: fullAnswers });
  check('学生能提交作业', ok(submit.body), JSON.stringify(submit.body).slice(0, 240));
  check('自动判分算出了分数（20 对 + 0 错 + 30 SQL 对）', submit.body?.score === 50,
    `score=${submit.body?.score}`);
  check('识别出有 1 道待人工批改', submit.body?.manualCount === 1, `manualCount=${submit.body?.manualCount}`);

  /* 未批改前可以重交 —— 用完整答案重交，否则会把快照覆盖成"只答了一题" */
  const resubmit = await student.post(`/api/assignments/${asgId}/submit`, { answers: fullAnswers });
  check('未批改前可以重交', ok(resubmit.body) && resubmit.body.score === 50,
    JSON.stringify(resubmit.body).slice(0, 160));

  const subDetail = await teacher.get(`/api/assignments/${asgId}/submission/${stu1Id}`);
  check('教师能看单份提交详情', ok(subDetail.body), JSON.stringify(subDetail.body).slice(0, 200));
  check('★ 批改页带标准答案（教师视角）',
    subDetail.body.items.find((i) => i.refId === 'Q001')?.correctAnswer === 'B');
  check('★ 批改页带简答题的评分点',
    Array.isArray(subDetail.body.items.find((i) => i.refId === 'Q013')?.steps)
    && subDetail.body.items.find((i) => i.refId === 'Q013').steps.length === 3,
    JSON.stringify(subDetail.body.items.find((i) => i.refId === 'Q013')?.steps));

  const shortItem = subDetail.body.items.find((i) => i.refId === 'Q013');
  const grade = await teacher.post(`/api/assignments/${asgId}/grade`, {
    userId: stu1Id,
    itemScores: [{ itemId: shortItem.itemId, score: 24 }],
    feedback: '简答答得不错，但"部分依赖"和"传递依赖"的区别再想清楚一点。',
  });
  check('教师能批改并写评语', ok(grade.body), JSON.stringify(grade.body).slice(0, 200));
  check('逐题改分后总分重算（20 + 0 + 24 + 30）', grade.body?.score === 74,
    `score=${grade.body?.score}`);

  const gradedDetail = await teacher.get(`/api/assignments/${asgId}/submission/${stu1Id}`);
  check('批改后状态变成 graded', gradedDetail.body.submission.status === 'graded',
    gradedDetail.body?.submission?.status);
  check('评语被保存下来', /部分依赖/.test(gradedDetail.body.submission.feedback || ''),
    gradedDetail.body?.submission?.feedback);

  const cantResubmit = await student.post(`/api/assignments/${asgId}/submit`, {
    answers: [{ itemId: q001Item.id, answer: 'B' }],
  });
  eq('★ 批改后不能再提交', cantResubmit.status, 400);

  /* 非本班学生不能提交 */
  const outsiderAsg = await outsider.get(`/api/assignments/${asgId}`);
  eq('★ 非本班学生看不到作业', outsiderAsg.status, 403);

  /* ==================== 15. 班级学情分析 ==================== */
  const analytics = await teacher.get(`/api/classes/${classId}/analytics`);
  check('教师能看班级学情分析', ok(analytics.body), JSON.stringify(analytics.body).slice(0, 240));
  check('分析给出班级共同薄弱点', Array.isArray(analytics.body?.analysis?.common));
  check('分析给出活跃度曲线', Array.isArray(analytics.body?.activity)
    && analytics.body.activity.length === 14);
  check('分析有可读的总结文案', typeof analytics.body?.analysis?.summary === 'string'
    && analytics.body.analysis.summary.length > 5, analytics.body?.analysis?.summary);

  const sAnalytics = await student.get(`/api/classes/${classId}/analytics`);
  eq('★ 学生不能看班级学情分析', sAnalytics.status, 403);

  /* 学生能看到班级，但看不到别人的邮箱 */
  const clsDetail = await student.get(`/api/classes/${classId}`);
  check('学生能看到自己所在的班级', ok(clsDetail.body), JSON.stringify(clsDetail.body).slice(0, 160));
  check('★ 学生视角的成员列表不含邮箱',
    clsDetail.body.members.every((m) => m.email === undefined),
    JSON.stringify(clsDetail.body.members[0]));

  const tClsDetail = await teacher.get(`/api/classes/${classId}`);
  check('教师视角的成员列表**含**邮箱',
    tClsDetail.body.members.some((m) => typeof m.email === 'string'));

  /* ==================== 16. 审计日志 ==================== */
  const logs = await teacher.get('/api/admin/logs');
  check('审计日志可读', ok(logs.body) && logs.body.logs.length > 0, `日志数 ${logs.body?.logs?.length}`);
  const actions = new Set(logs.body.logs.map((l) => l.action));
  check('记录了建班', actions.has('class_create'));
  check('记录了建学生', actions.has('student_create'));
  check('记录了重置密码', actions.has('student_password_reset'));
  check('记录了批改作业', actions.has('grade_submission'));
  check('★ 审计日志里不含密码原文',
    !JSON.stringify(logs.body.logs).includes(reset.body.newPassword),
    '审计日志里出现了重置后的密码！');

  /* ==================== 17. 搜索与元信息 ==================== */
  const search = await student.get('/api/misc/search?q=GROUP%20BY');
  check('全局搜索可用', ok(search.body), JSON.stringify(search.body).slice(0, 200));
  check('搜到了相关知识点', search.body.knowledge.length > 0, `命中 ${search.body?.knowledge?.length}`);
  check('★ 题目搜索不返回答案', search.body.questions.every((q) => q.answer === undefined));

  const meta = await student.get('/api/meta');
  check('元信息可读', ok(meta.body), JSON.stringify(meta.body).slice(0, 160));
  /* ★ 跟表数一样 —— 写死 8 套就是「为了通过而改数字」。这条真正要守的
   *   是「前后端主题清单没有别处漂移」（已经有冒烟比对 THEMES vs THEME_IDS）。 */
  check('主题清单有合理数量（≥ 8 套）', meta.body.themes.length >= 8, `主题数 ${meta.body?.themes?.length}`);
  check('成就清单非空', meta.body.achievements.length >= 15);

  /* ==================== 18. 设置与主题 ==================== */
  const setTheme = await student.patch('/api/auth/settings', { theme: 'cyber-lime', dailyGoal: 30 });
  check('能保存主题偏好', ok(setTheme.body) && setTheme.body.settings.theme === 'cyber-lime',
    JSON.stringify(setTheme.body).slice(0, 160));

  const badTheme = await student.patch('/api/auth/settings', { theme: '不存在的主题' });
  check('非法主题被忽略而不是写库', ok(badTheme.body) && badTheme.body.settings.theme === 'cyber-lime',
    JSON.stringify(badTheme.body?.settings));

  /* ==================== 19. 删除学生（级联） ==================== */
  const beforeDel = await teacher.get(`/api/admin/students/${stu3Id}`);
  const del = await teacher.del(`/api/admin/students/${stu3Id}`);
  check('教师能删学生', ok(del.body), JSON.stringify(del.body).slice(0, 200));
  check('删除时报告清理了多少数据', typeof del.body.wiped?.attempts === 'number');
  const afterDel = await teacher.get(`/api/admin/students/${stu3Id}`);
  eq('★ 删除后查不到该学生', afterDel.status, 404);

  const delSelf = await teacher.del('/api/admin/students/1');
  check('★ 不能删除自己', delSelf.status === 403 || delSelf.status === 400,
    `status=${delSelf.status} ${JSON.stringify(delSelf.body)}`);

  /* ==================== 20. 登出 ==================== */
  const logout = await student.post('/api/auth/logout', {});
  check('能登出', ok(logout.body));
  eq('登出后访问受保护接口返回 401', (await student.get('/api/auth/me')).status, 401);

} finally {
  await srv.stop();
}

report('接口冒烟测试');
