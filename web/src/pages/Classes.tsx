/* 班级
 *
 * ── 学生和教师看到的是两个不同的页面 ────────────────────────────
 * 学生：加入班级、看自己所在的班、看班级排名
 * 教师：建班、邀请码、成员学情、班级共性薄弱点、从班级跳去布置作业
 * 两者共用一个路由，靠角色分流 —— 因为"班级"这个概念对两边
 * 是同一份数据的不同视角，拆成两个路由反而会让"我到底在哪个页面"变模糊。
 */
import { useState } from 'react';
import {
  Users, Plus, Ticket, Copy, Check, RefreshCw, TrendingDown,
  UserMinus, Trash2, GraduationCap, BookOpen, BarChart3, Clock,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Skeleton, Empty, Progress, Input,
  Field, Callout, ListRow,
} from '@/components/ui/Primitives';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { AppLink } from '@/lib/links';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { useAuth, isStaff } from '@/stores/auth';
import { cn, copyText, formatDate, masteryColor, avatarStyle } from '@/lib/utils';

export default function Classes() {
  const { user } = useAuth();
  const staff = isStaff(user);
  return staff ? <TeacherClasses /> : <StudentClasses />;
}

/* ============================================================
   学生
   ============================================================ */

function StudentClasses() {
  const { toast } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, loading, reload } = useAsync<any>(
    'classes:list',
    () => api.get('/api/classes'),
    { ttl: 10000 },
  );

  const join = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<any>('/api/classes/join', { code: code.trim().toUpperCase() });
      toast('ok', r.already ? '你已经在这个班级里了' : `已加入「${r.class.name}」`);
      setCode('');
      reload();
      invalidatePrefix('classes:');
    } catch (e: any) {
      toast('error', '加入失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Skeleton className="h-72" />;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="加入班级"
          desc="找老师要 6 位邀请码。加入之后，老师就能看到你的学习情况，也能给你布置作业。"
          icon={<Ticket size={15} className="text-cyan" />}
        />
        <div className="flex flex-wrap gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
            placeholder="例如 K7M2XQ"
            maxLength={6}
            className="w-40 font-mono tracking-widest"
          />
          <Button variant="accent" onClick={join} loading={busy} disabled={!code.trim()}>
            加入
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle title="我所在的班级" icon={<GraduationCap size={15} className="text-violet" />} />
        {data?.joined?.length ? (
          <div className="space-y-2.5">
            {data.joined.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-hairline bg-veil/2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-fg">{c.name}</span>
                      {c.term && <Badge tone="neutral">{c.term}</Badge>}
                      {c.isOwner && <Badge tone="accent">我是老师</Badge>}
                    </div>
                    <div className="mt-1 text-[11.5px] text-fg-mute">
                      任课教师：{c.teacherName} · {c.memberCount} 名成员
                    </div>
                  </div>
                  {!c.isOwner && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api.post(`/api/classes/${c.id}/leave`, {});
                          toast('ok', `已退出「${c.name}」`);
                          reload();
                        } catch (e: any) { toast('error', '退出失败', e.message); }
                      }}
                    >
                      <UserMinus size={13} />退出
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={<GraduationCap size={22} />}
            title="还没有加入任何班级"
            desc="输入老师给的邀请码就能加入。不加入也能用，只是老师看不到你的学习情况、也收不到作业。"
          />
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   教师
   ============================================================ */

function TeacherClasses() {
  const { toast } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', term: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);

  const { data, loading, reload } = useAsync<any>(
    'classes:list',
    () => api.get('/api/classes'),
    { ttl: 10000 },
  );

  const classes = data?.teaching || [];
  const active = classes.find((c: any) => c.id === activeId) || classes[0];

  const { data: detail, reload: reloadDetail } = useAsync<any>(
    active ? `classes:${active.id}` : 'noop:skip',
    () => api.get(`/api/classes/${active.id}`),
    { ttl: 5000, enabled: !!active },
  );

  const { data: analytics } = useAsync<any>(
    active ? `classes:${active.id}:analytics` : 'noop:skip',
    () => api.get(`/api/classes/${active.id}/analytics`),
    { ttl: 20000, enabled: !!active },
  );

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<any>('/api/classes', form);
      toast('ok', `班级「${r.class.name}」已创建`, `邀请码：${r.class.code}`);
      setCreateOpen(false);
      setForm({ name: '', term: '', description: '' });
      reload();
      invalidatePrefix('classes:');
    } catch (e: any) {
      toast('error', '创建失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (id: number, code: string) => {
    if (await copyText(code)) {
      setCopied(id);
      toast('ok', '邀请码已复制', '发给学生，他们注册时填这个码就能入班');
      setTimeout(() => setCopied(null), 2000);
    } else {
      toast('warn', '复制失败', '请手动选中复制');
    }
  };

  if (loading && !data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <Users size={17} className="text-cyan" />
              我的班级
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-mute">
              班级是权限的载体：你能管理的学生 = 你名下班级的成员 + 你亲手创建的账号。
            </p>
          </div>
          <Button variant="accent" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />建班级
          </Button>
        </div>
      </Card>

      {classes.length ? (
        <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
          {/* 左：班级列表 */}
          <div className="space-y-1.5">
            {classes.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  c.id === active?.id
                    ? 'border-cyan/50 bg-cyan/10'
                    : 'border-hairline bg-veil/2 hover:border-cyan/30 hover:bg-veil/6',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">{c.name}</span>
                  {c.status === 'archived' && <Badge tone="neutral">已归档</Badge>}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-mute">
                  <span>{c.memberCount} 名学生</span>
                  {c.term && <span>· {c.term}</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="font-mono text-[11px] tracking-wider text-cyan">{c.code}</span>
                  <span
                    onClick={(e) => { e.stopPropagation(); copyCode(c.id, c.code); }}
                    className="rounded p-0.5 text-fg-faint hover:text-cyan"
                  >
                    {copied === c.id ? <Check size={11} /> : <Copy size={11} />}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* 右：班级详情 */}
          <div className="space-y-3">
            {detail?.class && (
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[16px] font-semibold text-fg">{detail.class.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-mute">
                      {detail.class.term && <Badge tone="neutral">{detail.class.term}</Badge>}
                      <span>{detail.members.length} 名学生</span>
                      <span>创建于 {formatDate(detail.class.createdAt)}</span>
                    </div>
                    {detail.class.description && (
                      <p className="mt-1.5 text-[12.5px] text-fg-soft">{detail.class.description}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm" variant="outline"
                      onClick={async () => {
                        try {
                          const r = await api.post<any>(`/api/classes/${active.id}/rotate-code`, {});
                          toast('ok', '邀请码已重置', `新码：${r.code}`);
                          reload(); reloadDetail();
                        } catch (e: any) { toast('error', '重置失败', e.message); }
                      }}
                    >
                      <RefreshCw size={12} />换邀请码
                    </Button>
                    <AppLink
                      to="/admin"
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-hairline px-2.5 text-[12.5px] text-fg-soft hover:bg-veil/6"
                    >
                      <BarChart3 size={12} />去布置作业
                    </AppLink>
                    <Button size="sm" variant="danger" onClick={() => setConfirmDel(detail.class)}>
                      <Trash2 size={12} />删班
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-lg border border-hairline bg-veil/3 p-2.5">
                  <Ticket size={14} className="shrink-0 text-cyan" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-fg-faint">邀请码（发给学生，注册时填）</div>
                    <div className="font-mono text-[15px] font-semibold tracking-[0.2em] text-cyan">
                      {detail.class.code}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => copyCode(active.id, detail.class.code)}>
                    {copied === active.id ? <><Check size={12} />已复制</> : <><Copy size={12} />复制</>}
                  </Button>
                </div>
              </Card>
            )}

            {/* 学情分析 */}
            {analytics?.analysis && (
              <Card>
                <SectionTitle
                  title="班级学情"
                  desc="按依赖图汇总的共性薄弱点 —— 一个知识点超过一半学生不牢，那是讲法需要调整"
                  icon={<TrendingDown size={15} className="text-warn" />}
                />

                <Callout tone={analytics.analysis.common?.[0]?.ratio >= 0.5 ? 'warn' : 'info'} className="mb-3">
                  {analytics.analysis.summary}
                </Callout>

                {analytics.analysis.common?.length ? (
                  <div className="space-y-2">
                    {analytics.analysis.common.slice(0, 8).map((c: any) => (
                      <div key={c.kid} className="flex items-center gap-3">
                        <AppLink
                          to={`/learn/${c.kid}`}
                          className="w-36 shrink-0 truncate text-[12.5px] text-fg hover:text-cyan"
                        >
                          {c.title}
                        </AppLink>
                        <div className="flex-1">
                          <Progress
                            value={c.ratio}
                            tone={c.ratio >= 0.5 ? 'bad' : 'warn'}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right text-[11.5px] tabular-nums text-fg-mute">
                          {c.students}/{analytics.total} 人 · {Math.round(c.avgMastery * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="班级整体掌握情况良好" desc="没有出现普遍性薄弱点" />
                )}

                {analytics.inactive?.length ? (
                  <div className="mt-3 border-t border-hairline pt-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-fg-soft">
                      <Clock size={12} className="text-bad" />
                      最近没来的学生（{analytics.inactive.length} 人）
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {analytics.inactive.slice(0, 12).map((u: any) => (
                        <AppLink
                          key={u.id}
                          to={`/admin/students/${u.id}`}
                          className="rounded border border-bad/25 bg-bad-soft px-2 py-0.5 text-[11.5px] text-bad hover:border-bad/50"
                          title={u.lastActive ? `最后活跃 ${u.lastActive}` : '从未活跃'}
                        >
                          {u.username}
                        </AppLink>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            )}

            {/* 成员 */}
            {detail?.members && (
              <Card>
                <SectionTitle
                  title={`班级成员（${detail.members.length}）`}
                  desc="点名字进学生详情页 —— 能看到他写的每一条 SQL 和根因诊断"
                  icon={<Users size={15} className="text-cyan" />}
                />
                <div className="space-y-1.5">
                  {detail.members.map((m: any) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-veil/2 p-2.5">
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                        style={avatarStyle(m.avatarHue)}
                      >
                        {m.username.slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <AppLink
                            to={`/admin/students/${m.id}`}
                            className="truncate text-[13px] font-medium text-fg hover:text-cyan"
                          >
                            {m.realName || m.username}
                          </AppLink>
                          {m.studentNo && <span className="text-[11px] text-fg-faint">{m.studentNo}</span>}
                          {m.status === 'disabled' && <Badge tone="bad">已停用</Badge>}
                        </div>
                        <div className="mt-0.5 text-[11px] text-fg-mute">
                          Lv.{m.stats.level} · 正确率 {m.stats.accuracy}% · 活跃 {m.stats.activeDays} 天
                        </div>
                      </div>
                      <span className="shrink-0 text-[11.5px] tabular-nums"
                        style={{ color: masteryColor(m.stats.accuracy / 100) }}>
                        {m.stats.accuracy}%
                      </span>
                      <Button
                        size="sm" variant="ghost"
                        onClick={async () => {
                          try {
                            await api.del(`/api/classes/${active.id}/members/${m.id}`);
                            toast('ok', `已把 ${m.username} 移出班级`);
                            reloadDetail(); reload();
                          } catch (e: any) { toast('error', '移出失败', e.message); }
                        }}
                      >
                        <UserMinus size={12} />
                      </Button>
                    </div>
                  ))}
                  {!detail.members.length && (
                    <Empty title="还没有学生" desc="把邀请码发给学生，他们注册时填上就会出现在这里" />
                  )}
                </div>
              </Card>
            )}

            {/* 班级作业 */}
            {detail?.assignments?.length ? (
              <Card>
                <SectionTitle title="班级作业" icon={<BookOpen size={15} className="text-violet" />} />
                <div className="space-y-1.5">
                  {detail.assignments.map((a: any) => (
                    <ListRow
                      key={a.id}
                      title={a.title}
                      desc={`${a.itemCount} 道题 · 已交 ${a.submittedCount}/${detail.members.length}${a.gradedCount ? ` · 已批 ${a.gradedCount}` : ''}`}
                      right={a.dueAt ? <span className="text-[11px] text-fg-faint">{formatDate(a.dueAt)} 截止</span> : null}
                    />
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      ) : (
        <Card>
          <Empty
            icon={<Users size={24} />}
            title="还没有班级"
            desc="建一个班，拿到邀请码发给学生。学生入班之后你就能看到他们的学情、布置作业。"
            action={<Button variant="accent" onClick={() => setCreateOpen(true)}><Plus size={14} />建第一个班级</Button>}
          />
        </Card>
      )}

      {/* 建班弹窗 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建班级"
        footer={(
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button variant="accent" onClick={create} loading={busy} disabled={!form.name.trim()}>创建</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Field label="班级名称" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例如：数据库系统原理 2026 秋"
            />
          </Field>
          <Field label="学期" hint="选填">
            <Input
              value={form.term}
              onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
              placeholder="例如：2026 秋"
            />
          </Field>
          <Field label="说明" hint="选填">
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="例如：周三下午 3-4 节"
            />
          </Field>
          <Callout tone="info">
            创建后会生成一个 6 位邀请码。学生注册时填这个码就能直接入班，
            之后你就能看到他们的学习情况、给他们布置作业。
          </Callout>
        </div>
      </Modal>

      {/* 删班确认 */}
      <ConfirmModal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={async () => {
          try {
            const r = await api.del<any>(`/api/classes/${confirmDel.id}`);
            toast('ok', `班级已删除`, `已解除与 ${r.releasedStudents} 名学生的关联（学生账号和数据都还在）`);
            setConfirmDel(null);
            reload(); invalidatePrefix('classes:');
          } catch (e: any) { toast('error', '删除失败', e.message); }
        }}
        title="删除班级"
        danger
        confirmText="确认删除"
        body={(
          <>
            <p>确定要删除「<b>{confirmDel?.name}</b>」吗？</p>
            <p className="mt-2 text-fg-mute">
              这只会解除班级与学生的关联 —— <b>学生账号和他们的学习数据都不会被删除</b>。
              班级下的作业也会一起删掉。
            </p>
          </>
        )}
      />
    </div>
  );
}
