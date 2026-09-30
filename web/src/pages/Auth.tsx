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
import { ApiError } from '@/lib/api';

function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle: string; children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.08fr_1fr]">
      {/* 背景光斑。三团缓慢漂移的色块，给整个页面一个"活"的底色。
          它们只负责氛围，不承载信息，所以 aria-hidden + 不吃指针事件。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span
          className="absolute -left-[12%] top-[-18%] h-[46rem] w-[46rem] rounded-full opacity-[0.16] blur-[110px]"
          style={{ background: 'var(--color-cyan)', animation: 'drift 26s ease-in-out infinite' }}
        />
        <span
          className="absolute right-[-10%] top-[24%] h-[38rem] w-[38rem] rounded-full opacity-[0.15] blur-[110px]"
          style={{ background: 'var(--color-violet)', animation: 'drift 32s ease-in-out infinite reverse' }}
        />
        <span
          className="absolute bottom-[-24%] left-[32%] h-[34rem] w-[34rem] rounded-full opacity-[0.10] blur-[110px]"
          style={{ background: 'var(--color-magenta)', animation: 'drift 38s ease-in-out infinite' }}
        />
      </div>

      {/* 左侧品牌区。窄屏隐藏 —— 手机上那点空间应该全给表单。 */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-hairline p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-2.5">
          <span className="relative grid h-10 w-10 place-items-center">
            <span
              className="absolute inset-0 rounded-xl opacity-60 blur-[9px]"
              style={{ backgroundImage: 'var(--grad-spectrum)' }}
              aria-hidden="true"
            />
            <span className="glass relative grid h-10 w-10 place-items-center rounded-xl text-cyan">
              <Database size={20} />
            </span>
          </span>
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-fg">库课</div>
            <div className="text-[11px] text-fg-faint">数据库课程学习平台</div>
          </div>
        </div>

        <div className="max-w-lg">
          <h1 className="text-[32px] font-semibold leading-[1.22] tracking-tight text-fg xl:text-[38px]">
            数据库这门课，
            <br />
            <span className="grad-text">光看是学不会的。</span>
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
              ['教师工作台', '建班、建号、布置作业、看学情根因，全流程闭环', Users],
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

        <div className="flex items-center gap-2 text-[11.5px] text-fg-faint">
          <ShieldCheck size={13} />
          服务端会话鉴权 · SQL 在隔离沙箱中执行 · 教师权限按班级隔离
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="glass grid h-8 w-8 place-items-center rounded-lg text-cyan">
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
