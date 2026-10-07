/* 登录 / 注册
 *
 * ── 为什么两个页面放一个文件 ────────────────────────────────────
 * 它们共用同一套视觉外壳（左品牌 + 右表单）和同一套校验逻辑，
 * 拆成两个文件会复制一遍外壳。放在一起还能让"注册成功自动登录"
 * 这条链路在一个文件里看完整。
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Database, Mail, Lock, User as UserIcon, Ticket, ArrowRight, ShieldCheck, Terminal, Sigma, FlaskConical, Users } from 'lucide-react';
import { Button, Field, Input, Callout } from '@/components/ui/Primitives';
import { ThemePicker } from '@/components/ui/Toaster';
import { useAuth } from '@/stores/auth';
import { useApp } from '@/stores/app';
import { useTheme } from '@/stores/theme';
import { ApiError } from '@/lib/api';

function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle: string; children: ReactNode; footer: ReactNode;
}) {
  const { def: theme } = useTheme();
  const isXianxia = theme.id === 'xianxia';
  const isShanshui = theme.id === 'shanshui';

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.08fr_1fr]">
      {/* 背景：一层极淡的斜向渐变 + 一道分隔线，就这些。
       *
       * ★ 2026-10-01 改。原来这里是**三团会漂移的巨型色斑**
       *   （46rem / 38rem / 34rem，blur-[110px]，青/紫/品红各一，
       *   各自跑一条 26–38 秒的 drift 动画）。
       *
       *   那是整站"AI 味"最重的一处：三个彩虹光斑在背后缓慢蠕动，
       *   是 2023 年以后 AI 产品落地页的固定配方。而登录页要完成的事
       *   只有一件 —— 让人把账号密码填进去。背景越安静，表单越清楚。
       *
       *   顺带去掉的还有三个长跑动画：它们在低端机上一直占着合成层，
       *   而收益是"页面看起来是活的"—— 登录页不需要活着。 */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <span
          className="absolute inset-0 opacity-[0.5]"
          style={{
            background:
              'radial-gradient(60rem 34rem at 8% -10%, var(--halo-1), transparent 62%),'
              + 'radial-gradient(48rem 30rem at 96% 10%, var(--halo-2), transparent 60%)',
          }}
        />
      </div>

      {/* 左侧品牌区。窄屏隐藏 —— 手机上那点空间应该全给表单。
       *
       * ★ 2026-10-07：仙侠主题下，左侧背景加云海仙岛图 + 飞剑装饰图。
       *   山水主题下沿用原有横幅（body::after 挂的）。
       *   其它主题保持纯色 + halo 渐变。 */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-hairline p-10 lg:flex xl:p-14">
        {/* 仙侠主题专属：云海仙岛背景图 */}
        {isXianxia && (
          <img
            src="/img/xianxia-xiandao.jpg"
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
            aria-hidden="true"
          />
        )}
        {/* 仙侠主题专属：飞剑装饰图，右下角 */}
        {isXianxia && (
          <img
            src="/img/xianxia-feijian.jpg"
            alt=""
            className="pointer-events-none absolute bottom-0 right-0 h-[55%] w-auto object-contain opacity-25"
            style={{ maskImage: 'radial-gradient(ellipse at 70% 80%, #000 30%, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse at 70% 80%, #000 30%, transparent 75%)' }}
            aria-hidden="true"
          />
        )}
        {/* 仙侠/山水主题专属：冷宣纸/米黄渐变蒙版，让文字浮起来 */}
        {isXianxia && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'linear-gradient(135deg, rgba(232,227,212,0.85) 0%, rgba(232,227,212,0.60) 40%, rgba(232,227,212,0.30) 70%, transparent 100%)',
            }}
            aria-hidden="true"
          />
        )}

        <div className="relative flex items-center gap-2.5">
          {/* ★ 去掉渐变光晕，改成实色方块（理由同侧栏 Brand）。
           *   仙侠主题下用飞剑 SVG（与侧栏 brand 同构）。
           *   山水主题下用「库」字印章。
           *   其它主题用 Database 图标。 */}
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-cyan text-on-accent">
            <Database size={19} className={isXianxia || isShanshui ? 'hidden' : ''} />
            {isShanshui && (
              <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
                <text x="32" y="32" textAnchor="middle" dominantBaseline="central"
                  fontFamily="'LXGW WenKai GB', 'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', serif"
                  fontSize="38" fontWeight="700" fill="currentColor" letterSpacing="-1">库</text>
              </svg>
            )}
            {isXianxia && (
              <svg viewBox="0 0 64 64" className="h-full w-full" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M32 8 L32 38" />
                <path d="M27 12 L37 12 L32 16 Z" fill="currentColor" />
                <circle cx="32" cy="20" r="1.5" fill="currentColor" stroke="none" />
                <path d="M22 6 C26 5 32 5 42 4" opacity="0.7" />
                <ellipse cx="32" cy="48" rx="9" ry="2.4" opacity="0.65" />
                <ellipse cx="32" cy="48" rx="6" ry="1.6" opacity="0.4" />
              </svg>
            )}
          </span>
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-fg">库课</div>
            <div className="text-[12px] text-fg-faint">数据库课程学习平台</div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-[32px] font-semibold leading-[1.22] tracking-tight text-fg xl:text-[38px]">
            数据库这门课，
            <br />
            {/* ★ 从渐变字改成单色强调。青→紫→品红那道彩虹是"AI 产品
             *   落地页"的标志性配色，而这句标题要表达的只是"光看没用" ——
             *   一个实色强调就够了，颜色本身不该成为内容。 */}
            <span className="text-cyan">光看是学不会的。</span>
          </h1>
          <p className="mt-5 text-[14px] leading-relaxed text-fg-soft">
            所以这里不是一份讲义，是一个能动手的环境。
            写完的 SQL 立刻执行、立刻判分；
            范式题给算法验算，不比对答案；索引有没有生效，
            由数据库自己的执行计划说了算。
          </p>

          <ul className="mt-8 space-y-3.5">
            {[
              ['SQL 实训场', '4 套教学库、45 道关卡，判题靠跑结果集而不是比对文本', Terminal],
              ['范式实验室', '闭包、候选键、范式判定、无损分解，全部算法验算', Sigma],
              ['索引与事务实验台', '结论来自 EXPLAIN 和优先图，不是来自我写的注释', FlaskConical],
              ['教师工作台', '建班、建号、布置作业、看学情', Users],
            ].map(([t, d, Icon]: any, i) => (
              <li key={t} className="stagger flex gap-3" style={{ '--i': i } as React.CSSProperties}>
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-hairline bg-veil/5 text-cyan">
                  <Icon size={14} />
                </span>
                <span className="min-w-0">
                  <b className="text-[13.5px] font-medium text-fg">{t}</b>
                  <span className="block text-[12.5px] leading-relaxed text-fg-mute">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-[12px] text-fg-faint">
          <ShieldCheck size={13} />
          服务端会话鉴权 · SQL 在隔离沙箱中执行 · 教师权限按班级隔离
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-cyan text-on-accent">
              <Database size={16} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-fg">库课</span>
          </div>
          <ThemePicker compact />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-10">
          <div className="w-full max-w-[390px]">
            <div className="rise-in">
              <h2 className="text-[24px] font-semibold tracking-tight text-fg">{title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-mute">{subtitle}</p>
              <div className="mt-7">{children}</div>
              <div className="mt-6 text-center text-[12.5px] text-fg-mute">{footer}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 登录 ============ */

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const { toast, config } = useApp();
  const nav = useNavigate();

  /* ★ 注册入口要跟着服务端开关走。
   *   以前这里写死了一个「注册一个」链接，而生产环境（NODE_ENV=production）
   *   默认关闭自助注册 —— 学生点进去、填完表单、提交，才收到 403
   *   「本系统已关闭自助注册」。前后端都在说实话，只是说的不是同一件事。
   *   config 还没拉到（null）时按「不显示」处理，理由见 stores/app.ts。 */
  const canRegister = config?.allowRegister === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast('ok', '登录成功');
      nav('/', { replace: true });
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="登录"
      subtitle="用邮箱和密码进入你的学习空间"
      footer={
        canRegister
          ? <>还没有账号？<Link to="/register" className="text-cyan hover:underline">注册一个</Link></>
          : <>没有账号？让老师给你开通，或问老师要班级邀请码。</>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="邮箱" required>
          <div className="relative">
            <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              className="pl-9"
              required
            />
          </div>
        </Field>

        <Field label="密码" required>
          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pl-9"
              required
            />
          </div>
        </Field>

        {err && <Callout tone="bad">{err}</Callout>}

        <Button type="submit" variant="accent" size="lg" className="w-full" loading={busy}>
          登录
          <ArrowRight size={15} />
        </Button>
      </form>
    </AuthShell>
  );
}

/* ============ 注册 ============ */

export function Register() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [classCode, setClassCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { register } = useAuth();
  const { toast, config } = useApp();
  const nav = useNavigate();

  /* 服务端明确关闭了自助注册时，直接给一句解释，而不是让学生
   * 填完表单再吃 403。
   *
   * 判断用 === false 而不是 falsy：config 还没拉到时是 null，
   * 这时**不拦** —— 用户可能是直接访问 /register 深链接，
   * 给表单比给一个可能过时的「已关闭」提示更稳妥。 */
  const closed = config?.allowRegister === false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await register({
        email: email.trim(),
        username: username.trim(),
        password,
        classCode: classCode.trim() || undefined,
      });
      toast('ok', '注册成功', r.joinedClass ? `已加入班级「${r.joinedClass}」` : undefined);
      nav('/', { replace: true });
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : '注册失败');
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    return (
      <AuthShell
        title="注册已关闭"
        subtitle="这个系统目前不开放自助注册"
        footer={<>已经有账号了？<Link to="/login" className="text-cyan hover:underline">去登录</Link></>}
      >
        <Callout tone="info" title="怎么拿到账号">
          两种方式：让老师给你开通一个，或者问老师要班级邀请码。
        </Callout>
        <p className="mt-3 text-[12.5px] leading-relaxed text-fg-mute">
          如果老师已经发了邀请码，说明他那边可以一键批量建号 ——
          把邀请码发给他就行，不用自己注册。
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="注册"
      subtitle="注册后即可开始学习。有班级邀请码的话填上，老师就能看到你的学习情况。"
      footer={<>已经有账号了？<Link to="/login" className="text-cyan hover:underline">去登录</Link></>}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="邮箱" required>
          <div className="relative">
            <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="username" className="pl-9" required
            />
          </div>
        </Field>

        <Field label="昵称" hint="老师点名时会看到" required>
          <div className="relative">
            <UserIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="你的名字" autoComplete="nickname" className="pl-9" required
            />
          </div>
        </Field>

        <Field label="密码" hint="至少 8 位，别只用一种字符" required>
          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete="new-password" className="pl-9" required
            />
          </div>
        </Field>

        <Field label="班级邀请码" hint="选填，6 位">
          <div className="relative">
            <Ticket size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              value={classCode}
              onChange={(e) => setClassCode(e.target.value.toUpperCase())}
              placeholder="例如 K7M2XQ"
              maxLength={6}
              className="pl-9 font-mono tracking-widest"
            />
          </div>
        </Field>

        {err && <Callout tone="bad">{err}</Callout>}

        <Button type="submit" variant="accent" size="lg" className="w-full" loading={busy}>
          注册并进入
          <ArrowRight size={15} />
        </Button>
      </form>
    </AuthShell>
  );
}
