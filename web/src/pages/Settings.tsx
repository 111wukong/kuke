/* 设置
 *
 * 四块：外观 / 学习偏好 / 账号安全 / 登录记录。
 * 顺序按"用户想改的频率"排 —— 外观和偏好最常改，改密最少。
 */
import { useEffect, useState } from 'react';
import {
  Palette, SlidersHorizontal, ShieldCheck, History, LogOut, Save,
  Monitor, KeyRound, Check,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Field, Input, Callout, Select,
  Skeleton,
} from '@/components/ui/Primitives';
import { ThemePicker } from '@/components/ui/Toaster';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';
import { THEMES } from '@/lib/themes';
import { formatDateTime, avatarStyle } from '@/lib/utils';

export default function Settings() {
  const { user, settings, patchSettings, logout } = useAuth();
  const { toast } = useApp();
  const { id: themeId } = useTheme();

  const [dailyGoal, setDailyGoal] = useState(settings?.dailyGoal ?? 20);
  const [editorFont, setEditorFont] = useState(settings?.editorFont ?? 14);
  const [savingPref, setSavingPref] = useState(false);

  const [pw, setPw] = useState({ old: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (settings) {
      setDailyGoal(settings.dailyGoal);
      setEditorFont(settings.editorFont);
    }
  }, [settings]);

  const { data: snap } = useAsync<any>('study:snapshot', () => api.get('/api/study/snapshot'), { ttl: 20000 });
  const { data: logs, reload: reloadLogs } = useAsync<any>('auth:logs', () => api.get('/api/auth/logs'), { ttl: 0 });
  const { data: sessions } = useAsync<any>('auth:sessions', () => api.get('/api/misc/sessions'), { ttl: 0 });

  const savePrefs = async () => {
    setSavingPref(true);
    try {
      await patchSettings({ dailyGoal, editorFont });
      toast('ok', '偏好已保存');
    } catch (e: any) {
      toast('error', '保存失败', e.message);
    } finally {
      setSavingPref(false);
    }
  };

  const changePassword = async () => {
    if (pw.next !== pw.confirm) { toast('warn', '两次输入的新密码不一致'); return; }
    if (pw.next.length < 8) { toast('warn', '新密码至少 8 位'); return; }
    setSavingPw(true);
    try {
      await api.post('/api/auth/password', { oldPassword: pw.old, newPassword: pw.next });
      toast('ok', '密码已修改', '其它设备上的登录已经全部失效');
      setPw({ old: '', next: '', confirm: '' });
      reloadLogs();
    } catch (e: any) {
      toast('error', '修改失败', e.message);
    } finally {
      setSavingPw(false);
    }
  };

  const s = snap?.snapshot;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* ---------- 账号概览 ---------- */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[20px] font-bold text-white"
            style={avatarStyle(user?.avatarHue ?? 0)}
          >
            {user?.username.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-semibold text-fg">{user?.username}</span>
              <Badge tone={user?.role === 'student' ? 'neutral' : 'accent'}>
                {{ student: '学生', teacher: '教师', admin: '管理员' }[user?.role || 'student']}
              </Badge>
              {user?.realName && <span className="text-[12.5px] text-fg-mute">{user.realName}</span>}
              {user?.studentNo && <span className="text-[12px] text-fg-faint">学号 {user.studentNo}</span>}
            </div>
            <div className="mt-0.5 text-[12px] text-fg-mute">{user?.email}</div>
          </div>
          {s && (
            <div className="flex gap-4">
              <div className="text-center">
                <div className="text-[18px] font-semibold tabular-nums text-cyan">{s.level}</div>
                <div className="text-[10.5px] text-fg-faint">等级</div>
              </div>
              <div className="text-center">
                <div className="text-[18px] font-semibold tabular-nums text-amber">{s.streak}</div>
                <div className="text-[10.5px] text-fg-faint">连续天数</div>
              </div>
              <div className="text-center">
                <div className="text-[18px] font-semibold tabular-nums text-fg">{s.totals.attempts}</div>
                <div className="text-[10.5px] text-fg-faint">累计题数</div>
              </div>
            </div>
          )}
        </div>
        {user?.note && (
          <Callout tone="info" title="老师备注" className="mt-3">
            {user.note}
          </Callout>
        )}
      </Card>

      {/* ---------- 外观 ---------- */}
      <Card>
        <SectionTitle
          title="外观"
          desc="8 套主题，点一下立即生效。选择跟着账号走，换台电脑也是同一套。"
          icon={<Palette size={15} className="text-cyan" />}
        />
        <ThemePicker />
        <div className="mt-3 flex items-center gap-2 text-[11.5px] text-fg-faint">
          <Check size={12} className="text-ok" />
          当前：{THEMES.find((t) => t.id === themeId)?.name}
        </div>
      </Card>

      {/* ---------- 学习偏好 ---------- */}
      <Card>
        <SectionTitle
          title="学习偏好"
          desc="影响仪表盘的目标和 SQL 编辑器的字号"
          icon={<SlidersHorizontal size={15} className="text-violet" />}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="每日目标题数" hint="仪表盘上的进度条用它">
            <Select value={dailyGoal} onChange={(e) => setDailyGoal(Number(e.target.value))}>
              {[10, 15, 20, 30, 40, 60, 100].map((n) => (
                <option key={n} value={n}>{n} 题</option>
              ))}
            </Select>
          </Field>
          <Field label="SQL 编辑器字号" hint="写长语句时大一点更舒服">
            <Select value={editorFont} onChange={(e) => setEditorFont(Number(e.target.value))}>
              {[12, 13, 14, 15, 16, 18].map((n) => (
                <option key={n} value={n}>{n} px</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="accent" size="sm" onClick={savePrefs} loading={savingPref}
            disabled={dailyGoal === settings?.dailyGoal && editorFont === settings?.editorFont}
          >
            <Save size={13} />保存偏好
          </Button>
        </div>
      </Card>

      {/* ---------- 改密码 ---------- */}
      <Card>
        <SectionTitle
          title="修改密码"
          desc="改完之后，其它设备上的登录会立即失效（当前这台不会）"
          icon={<KeyRound size={15} className="text-warn" />}
        />
        <div className="space-y-3">
          <Field label="当前密码" required>
            <Input
              type="password" autoComplete="current-password"
              value={pw.old} onChange={(e) => setPw((p) => ({ ...p, old: e.target.value }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="新密码" hint="至少 8 位，至少两类字符" required>
              <Input
                type="password" autoComplete="new-password"
                value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
              />
            </Field>
            <Field label="再输一次" required>
              <Input
                type="password" autoComplete="new-password"
                value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              />
            </Field>
          </div>
          {pw.next && pw.confirm && pw.next !== pw.confirm && (
            <Callout tone="warn">两次输入的新密码不一致</Callout>
          )}
          <div className="flex justify-end">
            <Button
              variant="accent" size="sm" onClick={changePassword} loading={savingPw}
              disabled={!pw.old || !pw.next || pw.next !== pw.confirm}
            >
              修改密码
            </Button>
          </div>
        </div>
      </Card>

      {/* ---------- 活跃设备 ---------- */}
      <Card>
        <SectionTitle
          title="活跃设备"
          desc="最近登录过这台账号的设备。发现不认识的可以「退出所有设备」。"
          icon={<Monitor size={15} className="text-fg-mute" />}
          right={(
            <Button
              size="sm" variant="danger"
              onClick={async () => {
                try {
                  await api.post('/api/auth/logout-all', {});
                  toast('ok', '已退出所有设备');
                  await logout();
                } catch (e: any) { toast('error', '操作失败', e.message); }
              }}
            >
              <LogOut size={12} />退出所有设备
            </Button>
          )}
        />
        {sessions?.sessions?.length ? (
          <div className="space-y-1.5">
            {sessions.sessions.map((x: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-veil/2 px-2.5 py-2">
                <Monitor size={13} className="shrink-0 text-fg-mute" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg-soft">
                  {shortUa(x.user_agent)}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-faint">{x.ip || '—'}</span>
                <span className="shrink-0 text-[11px] text-fg-faint">{formatDateTime(x.last_seen_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-fg-mute">没有活跃会话记录。</p>
        )}
      </Card>

      {/* ---------- 登录记录 ---------- */}
      <Card>
        <SectionTitle
          title="登录记录"
          desc="你自己的账号活动。发现异常登录请立刻改密码。"
          icon={<History size={15} className="text-fg-mute" />}
        />
        {logs?.logs?.length ? (
          <div className="space-y-1">
            {logs.logs.map((l: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-veil/2 px-2.5 py-1.5">
                <Badge tone={
                  l.event === 'login' ? 'ok'
                    : l.event === 'login_failed' ? 'bad'
                      : 'neutral'
                }>
                  {EVENT_LABEL[l.event] || l.event}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-mute">
                  {shortUa(l.user_agent)}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-faint">{l.ip || '—'}</span>
                <span className="shrink-0 text-[11px] text-fg-faint">{formatDateTime(l.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-fg-mute">还没有记录。</p>
        )}
      </Card>

      {/* ---------- 隐私说明 ---------- */}
      <Card>
        <SectionTitle
          title="关于隐私"
          desc="这个系统里，谁能看到什么"
          icon={<ShieldCheck size={15} className="text-ok" />}
        />
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-soft">
          <li>· <b className="text-fg">老师</b>能看到你的：作答记录、你写的每一条 SQL、错题、掌握度、复习进度、打卡情况。</li>
          <li>· <b className="text-fg">老师看不到</b>你的：密码（数据库里只有哈希，谁也取不出来）、你的笔记正文、你的登录密码。</li>
          <li>· <b className="text-fg">同班同学</b>能看到你的：排行榜上的聚合数字（正确率、等级）。看不到你的错题和明细。</li>
          <li>· <b className="text-fg">老师对你的操作</b>（改资料、重置密码、停用、删除）都会记进审计日志，含操作时间和前后值。</li>
        </ul>
      </Card>

      {!settings && <Skeleton className="h-20" />}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  login: '登录', logout: '登出', register: '注册',
  login_failed: '登录失败', password_change: '改密',
  admin_password_reset: '被重置密码', admin_disable: '被停用',
  logout_all: '退出所有设备',
};

/** UA 字符串太长了，截成一个可读的短描述。
 *  完整 UA 对排查问题有用，但对"这是不是我"这个判断是噪声。 */
function shortUa(ua?: string): string {
  if (!ua) return '未知设备';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
        : /Firefox\//.test(ua) ? 'Firefox'
          : '浏览器';
  const os = /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
      : /iPhone|iPad/.test(ua) ? 'iOS'
        : /Android/.test(ua) ? 'Android'
          : /Linux/.test(ua) ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}
