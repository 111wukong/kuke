/* 登录 / 注册
 *
 * ── 为什么两个页面放一个文件 ────────────────────────────────────
 * 它们共用同一套视觉外壳（左品牌 + 右表单）和同一套校验逻辑，
 * 拆成两个文件会复制一遍外壳。放在一起还能让"注册成功自动登录"
 * 这条链路在一个文件里看完整。
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Database, Mail, Lock, User as UserIcon, Ticket, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Field, Input, Callout } from '@/components/ui/Primitives';
import { ThemePicker } from '@/components/ui/Toaster';
import { useAuth } from '@/stores/auth';
import { useApp } from '@/stores/app';
import { ApiError } from '@/lib/api';

function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle: string; children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* 左侧品牌区。窄屏隐藏 —— 手机上那点空间应该全给表单。 */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-hairline p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan/30 bg-cyan/10 text-cyan">
            <Database size={20} />
          </span>
          <div>
            <div className="text-[17px] font-semibold text-fg">库课</div>
            <div className="text-[11px] text-fg-faint">数据库课程学习平台</div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-[30px] font-semibold leading-snug text-fg">
            数据库这门课，
            <br />
            光看是学不会的。
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-fg-soft">
            所以这里不是一份讲义，是一个能动手的环境。
            写完的 SQL 立刻执行、立刻判分；
            范式题给算法验算，不比对答案；索引有没有生效，
            由数据库自己的执行计划说了算。
          </p>

          <ul className="mt-7 space-y-2.5 text-[13px] text-fg-soft">
            {[
              ['SQL 实训场', '4 套教学库、45 道关卡，判题靠跑结果集而不是比对文本'],
              ['范式实验室', '闭包、候选键、范式判定、无损分解，全部自动验算'],
              ['索引与事务实验台', '结论来自 EXPLAIN 和优先图，不是来自我写的注释'],
              ['教师工作台', '建班、建号、布置作业、看学情根因，全流程闭环'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
                <span>
                  <b className="font-medium text-fg">{t}</b>
                  <span className="text-fg-mute"> —— {d}</span>
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
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-cyan/30 bg-cyan/10 text-cyan">
              <Database size={16} />
            </span>
            <span className="text-[15px] font-semibold text-fg">库课</span>
          </div>
          <ThemePicker compact />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-10">
          <div className="w-full max-w-[380px]">
            <h2 className="text-[22px] font-semibold text-fg">{title}</h2>
            <p className="mt-1 text-[13px] text-fg-mute">{subtitle}</p>
            <div className="mt-6">{children}</div>
            <div className="mt-5 text-center text-[12.5px] text-fg-mute">{footer}</div>
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
  const { toast } = useApp();
  const nav = useNavigate();

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
      footer={<>还没有账号？<Link to="/register" className="text-cyan hover:underline">注册一个</Link></>}
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
  const { toast } = useApp();
  const nav = useNavigate();

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
