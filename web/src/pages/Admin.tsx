/* 教师工作台
 *
 * ── 权限边界在界面上是可见的 ────────────────────────────────────
 * 教师只能看到自己名下学生（班级成员 ∪ 自己创建的账号）。
 * 这不是前端过滤 —— 服务端返回的列表本来就只有这些。
 * 如果教师试图访问管辖外的学生，服务端返 403，页面给出明确提示。
 *
 * ── 危险的操作用两步确认 ────────────────────────────────────────
 * 删除学生是不可逆的（级联清掉全部学习数据），所以：
 *   · 确认弹窗里明确写出"会删掉多少条数据"
 *   · 不是简单的"确定吗？"
 * 停用是可逆的，一步确认即可。
 */
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck, Users, School, ClipboardList, Database, ScrollText, Search,
  Plus, UserPlus, KeyRound, LogOut, Ban, Trash2, CheckCircle2, AlertTriangle,
  TrendingUp, Terminal, BookOpen, ArrowLeft, RefreshCw, Download,
  CircleAlert, FileText, BarChart3, Layers,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Skeleton, Empty, Progress, Stat, Input,
  Field, Select, Callout, Tabs, ListRow, Textarea,
} from '@/components/ui/Primitives';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { AppLink } from '@/lib/links';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api, qs } from '@/lib/api';
import { useApp } from '@/stores/app';
import { useAuth, isAdmin } from '@/stores/auth';
import { cn, formatDate, formatDateTime, masteryColor, avatarStyle, copyText } from '@/lib/utils';

/* ============================================================
   工作台
   ============================================================ */

export function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'overview' | 'students' | 'classes' | 'assignments' | 'content' | 'audit'>('overview');

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <ShieldCheck size={17} className="text-cyan" />
              教师工作台
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-mute">
              你能管理的学生 = 你名下班级的成员 + 你亲手创建的账号。
              所有写操作都会记进审计日志。
            </p>
          </div>
          {isAdmin(user) && <Badge tone="accent">管理员权限</Badge>}
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          className="mt-3"
          tabs={[
            { key: 'overview', label: '总览', icon: <BarChart3 size={13} /> },
            { key: 'students', label: '学生管理', icon: <Users size={13} /> },
            { key: 'classes', label: '班级', icon: <School size={13} /> },
            { key: 'assignments', label: '作业', icon: <ClipboardList size={13} /> },
            { key: 'content', label: '内容', icon: <Database size={13} /> },
            { key: 'audit', label: '审计日志', icon: <ScrollText size={13} /> },
          ]}
        />
      </Card>

      {tab === 'overview' && <Overview />}
      {tab === 'students' && <Students />}
      {tab === 'classes' && <ClassesTab />}
      {tab === 'assignments' && <AssignmentsTab />}
      {tab === 'content' && <ContentTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

/* ============================================================
   总览
   ============================================================ */

function Overview() {
  const { data, loading } = useAsync<any>('admin:overview', () => api.get('/api/admin/overview'), { ttl: 10000 });

  if (loading && !data) return <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="学生总数" value={data?.totals.students ?? 0} sub={data?.scope} />
        <Stat label="今日活跃" value={data?.totals.activeToday ?? 0} tone="ok"
          sub={`从未登录 ${data?.totals.neverLoggedIn ?? 0} 人`} />
        <Stat label="累计作答" value={data?.activity.attempts ?? 0} tone="accent"
          sub={`正确率 ${data?.activity.accuracy ?? 0}%`} />
        <Stat label="待批改" value={data?.activity.pendingGrading ?? 0}
          tone={data?.activity.pendingGrading ? 'warn' : undefined}
          sub={data?.activity.pendingGrading ? '有作业等你批' : '没有待批作业'} />
      </div>

      {data?.activity.pendingGrading > 0 && (
        <Callout tone="warn" title="有作业待批改">
          去「作业」标签页逐份批改。学生提交之后只有在老师批改完才会看到最终分数。
        </Callout>
      )}

      <Card>
        <SectionTitle
          title="我的班级"
          desc={`${data?.classes.length ?? 0} 个班`}
          icon={<School size={15} className="text-violet" />}
        />
        {data?.classes.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.classes.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-hairline bg-veil/2 p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">{c.name}</span>
                  {c.status === 'archived' && <Badge tone="neutral">已归档</Badge>}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11.5px] text-fg-mute">
                  <span>{c.memberCount} 名学生</span>
                  <span className="font-mono tracking-wider text-cyan">{c.code}</span>
                </div>
                {!c.isMine && <Badge tone="info" className="mt-1.5">{c.teacherName} 的班</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="还没有班级" desc="去「班级」标签页建一个" />
        )}
      </Card>

      <Card>
        <SectionTitle title="最近加入的学生" icon={<UserPlus size={15} className="text-cyan" />} />
        {data?.recentStudents.length ? (
          <div className="space-y-1.5">
            {data.recentStudents.map((s: any) => (
              <ListRow
                key={s.id}
                title={s.realName || s.username}
                desc={`${s.email} · 加入于 ${formatDate(s.createdAt)}`}
                right={<Badge tone="neutral">Lv.{s.stats.level}</Badge>}
              />
            ))}
          </div>
        ) : (
          <Empty title="还没有学生" desc="建班之后把邀请码发出去，或者直接在这里批量建号" />
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   学生管理
   ============================================================ */

function Students() {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [resetResult, setResetResult] = useState<any>(null);

  const key = `admin:students:${q}:${sort}:${dir}:${status}`;
  const { data, loading, reload } = useAsync<any>(
    key,
    () => api.get(`/api/admin/students${qs({ q, sort, dir, status, limit: 100 })}`),
    { ttl: 5000 },
  );

  const refresh = () => { invalidatePrefix('admin:'); reload(); };

  const doReset = async (s: any) => {
    try {
      const r = await api.post<any>(`/api/admin/students/${s.id}/password`, {});
      setResetResult({ student: s, password: r.newPassword });
      refresh();
    } catch (e: any) { toast('error', '重置失败', e.message); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜姓名、邮箱、学号、备注…"
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="active">在用</option>
            <option value="disabled">已停用</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="created">加入时间</option>
            <option value="lastActive">最近活跃</option>
            <option value="attempts">作答数</option>
            <option value="accuracy">正确率</option>
            <option value="xp">经验值</option>
            <option value="username">姓名</option>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}>
            {dir === 'desc' ? '降序' : '升序'}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw size={13} /></Button>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={13} />建一个学生
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBatchOpen(true)}>
            <UserPlus size={13} />批量建号
          </Button>
          <span className="ml-auto self-center text-[11.5px] text-fg-mute">
            共 {data?.total ?? 0} 名学生
          </span>
        </div>
      </Card>

      {loading && !data ? (
        <Skeleton className="h-64" />
      ) : data?.students.length ? (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-veil/5">
                  {['学生', '班级', '作答', '正确率', '活跃', '等级', '最后活跃', '操作'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-hairline px-3 py-2 text-left font-medium text-fg-mute">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.students.map((s: any) => (
                  <tr key={s.id} className="odd:bg-veil/2 hover:bg-veil/5">
                    <td className="border-b border-hairline px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                          style={avatarStyle(s.avatarHue)}
                        >
                          {s.username.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                          <AppLink
                            to={`/admin/students/${s.id}`}
                            className="block truncate font-medium text-fg hover:text-cyan"
                          >
                            {s.realName || s.username}
                          </AppLink>
                          <div className="truncate text-[10.5px] text-fg-faint">
                            {s.studentNo || s.email}
                          </div>
                        </div>
                        {s.status === 'disabled' && <Badge tone="bad">停用</Badge>}
                      </div>
                    </td>
                    <td className="border-b border-hairline px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {s.classes.length
                          ? s.classes.map((c: any) => <Badge key={c.id} tone="info">{c.name}</Badge>)
                          : <span className="text-[11px] text-fg-faint">未入班</span>}
                      </div>
                    </td>
                    <td className="border-b border-hairline px-3 py-2 tabular-nums text-fg-soft">{s.stats.attempts}</td>
                    <td className="border-b border-hairline px-3 py-2">
                      <span className="tabular-nums font-medium" style={{ color: masteryColor(s.stats.accuracy / 100) }}>
                        {s.stats.accuracy}%
                      </span>
                    </td>
                    <td className="border-b border-hairline px-3 py-2 tabular-nums text-fg-soft">
                      {s.stats.activeDays} 天
                    </td>
                    <td className="border-b border-hairline px-3 py-2 tabular-nums text-fg-soft">Lv.{s.stats.level}</td>
                    <td className="border-b border-hairline px-3 py-2 text-[11px] text-fg-mute">
                      {s.stats.lastActive || '从未'}
                    </td>
                    <td className="border-b border-hairline px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditing(s)}
                          className="rounded p-1 text-fg-mute hover:bg-veil/8 hover:text-fg"
                          title="编辑资料"
                        >
                          <FileText size={13} />
                        </button>
                        <button
                          onClick={() => doReset(s)}
                          className="rounded p-1 text-fg-mute hover:bg-veil/8 hover:text-warn"
                          title="重置密码"
                        >
                          <KeyRound size={13} />
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const r = await api.post<any>(`/api/admin/students/${s.id}/logout`, {});
                              toast('ok', `已强制 ${s.username} 下线`, `踢掉 ${r.sessionsKilled} 个会话`);
                            } catch (e: any) { toast('error', '操作失败', e.message); }
                          }}
                          className="rounded p-1 text-fg-mute hover:bg-veil/8 hover:text-fg"
                          title="强制下线"
                        >
                          <LogOut size={13} />
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await api.patch(`/api/admin/students/${s.id}`, {
                                status: s.status === 'disabled' ? 'active' : 'disabled',
                              });
                              toast('ok', s.status === 'disabled' ? '已启用' : '已停用（该学生的所有会话已失效）');
                              refresh();
                            } catch (e: any) { toast('error', '操作失败', e.message); }
                          }}
                          className={cn('rounded p-1 hover:bg-veil/8', s.status === 'disabled' ? 'text-ok' : 'text-fg-mute hover:text-bad')}
                          title={s.status === 'disabled' ? '启用' : '停用'}
                        >
                          {s.status === 'disabled' ? <CheckCircle2 size={13} /> : <Ban size={13} />}
                        </button>
                        <button
                          onClick={() => setConfirmDel(s)}
                          className="rounded p-1 text-fg-mute hover:bg-bad/10 hover:text-bad"
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <Empty
            icon={<Users size={24} />}
            title={q ? '没有匹配的学生' : '还没有学生'}
            desc={q ? `没找到包含「${q}」的学生` : '建班发邀请码，或者直接批量建号'}
          />
        </Card>
      )}

      <CreateStudentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={refresh}
      />
      <BatchCreateModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onDone={refresh}
      />

      {/* 编辑资料 */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`编辑：${editing?.realName || editing?.username || ''}`}
      >
        {editing && (
          <EditForm
            student={editing}
            onDone={() => { setEditing(null); refresh(); }}
          />
        )}
      </Modal>

      {/* 重置密码结果 */}
      <Modal
        open={!!resetResult}
        onClose={() => setResetResult(null)}
        title="密码已重置"
        width="sm"
        footer={<Button variant="accent" onClick={() => setResetResult(null)}>知道了</Button>}
      >
        <Callout tone="warn" title="这个密码只显示这一次">
          数据库里只有哈希，之后谁也取不出来。请现在抄给学生。
          该学生的所有设备已自动下线。
        </Callout>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-hairline bg-ink-1000/50 p-3">
          <code className="flex-1 font-mono text-[16px] font-semibold tracking-wider text-cyan">
            {resetResult?.password}
          </code>
          <Button
            size="sm" variant="outline"
            onClick={async () => {
              if (await copyText(resetResult.password)) toast('ok', '已复制');
            }}
          >
            复制
          </Button>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={async () => {
          try {
            const r = await api.del<any>(`/api/admin/students/${confirmDel.id}`);
            toast('ok', `已删除 ${confirmDel.username}`,
              `连带清掉 ${r.wiped.attempts} 条作答、${r.wiped.cards} 张复习卡、${r.wiped.sqlRuns} 条 SQL 记录`);
            setConfirmDel(null);
            refresh();
          } catch (e: any) { toast('error', '删除失败', e.message); }
        }}
        title="删除学生"
        danger
        confirmText="确认删除，不可恢复"
        body={(
          <>
            <p>确定要删除「<b>{confirmDel?.realName || confirmDel?.username}</b>」吗？</p>
            <div className="mt-2 rounded-lg border border-bad/30 bg-bad-soft p-2.5">
              <div className="flex items-center gap-1.5 font-semibold text-bad">
                <AlertTriangle size={14} />这个操作不可恢复
              </div>
              <p className="mt-1 text-fg-soft">
                会连带删除他的全部学习数据：作答记录 {confirmDel?.stats.attempts} 条、
                复习卡 {confirmDel?.stats.cards} 张、SQL 运行记录 {confirmDel?.stats.sqlRuns} 条、
                以及所有作业提交。审计日志里会留下这次删除的记录。
              </p>
            </div>
            <p className="mt-2 text-fg-mute">
              如果只是想让他暂时不能登录，用「停用」就够了 —— 那是可逆的。
            </p>
          </>
        )}
      />
    </div>
  );
}

function EditForm({ student, onDone }: { student: any; onDone: () => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    realName: student.realName || '',
    studentNo: student.studentNo || '',
    username: student.username || '',
    email: student.email || '',
    note: student.note || '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/admin/students/${student.id}`, form);
      toast('ok', '已保存');
      onDone();
    } catch (e: any) {
      toast('error', '保存失败', e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="真实姓名"><Input value={form.realName} onChange={(e) => setForm((f) => ({ ...f, realName: e.target.value }))} /></Field>
        <Field label="学号"><Input value={form.studentNo} onChange={(e) => setForm((f) => ({ ...f, studentNo: e.target.value }))} /></Field>
        <Field label="昵称"><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></Field>
        <Field label="邮箱"><Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
      </div>
      <Field label="备注" hint="只有教师和管理员看得到">
        <Textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          placeholder="例如：基础较弱，重点补 GROUP BY" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>取消</Button>
        <Button variant="accent" onClick={save} loading={busy}>保存</Button>
      </div>
    </div>
  );
}

function CreateStudentModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ email: '', username: '', realName: '', studentNo: '', classId: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const { data: cls } = useAsync<any>('classes:list', () => api.get('/api/classes'), { ttl: 30000 });

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<any>('/api/admin/students', {
        ...form,
        classId: form.classId ? Number(form.classId) : undefined,
      });
      setResult(r);
      onDone();
    } catch (e: any) {
      toast('error', '创建失败', e.message);
    } finally { setBusy(false); }
  };

  const close = () => { setResult(null); setForm({ email: '', username: '', realName: '', studentNo: '', classId: '' }); onClose(); };

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? '学生已创建' : '新建学生'}
      footer={result
        ? <Button variant="accent" onClick={close}>知道了</Button>
        : (
          <>
            <Button variant="outline" onClick={close}>取消</Button>
            <Button variant="accent" onClick={create} loading={busy}
              disabled={!form.email.trim() || !form.username.trim()}>创建</Button>
          </>
        )}
    >
      {result ? (
        <div className="space-y-3">
          <Callout tone="ok" title="创建成功">
            初始密码只显示这一次，请现在抄给学生。
          </Callout>
          <div className="rounded-lg border border-hairline bg-ink-1000/50 p-3">
            <div className="text-[11.5px] text-fg-faint">邮箱</div>
            <div className="font-mono text-[13px] text-fg">{result.student.email}</div>
            <div className="mt-2 text-[11.5px] text-fg-faint">初始密码</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-[16px] font-semibold tracking-wider text-cyan">
                {result.initialPassword}
              </code>
              <Button size="sm" variant="outline"
                onClick={async () => { if (await copyText(result.initialPassword)) toast('ok', '已复制'); }}>
                复制
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="邮箱" required><Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="student@school.edu" /></Field>
            <Field label="昵称" required><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="学生姓名" /></Field>
            <Field label="真实姓名" hint="选填"><Input value={form.realName} onChange={(e) => setForm((f) => ({ ...f, realName: e.target.value }))} /></Field>
            <Field label="学号" hint="选填"><Input value={form.studentNo} onChange={(e) => setForm((f) => ({ ...f, studentNo: e.target.value }))} /></Field>
          </div>
          <Field label="加入班级" hint="选填">
            <Select value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
              <option value="">暂不入班</option>
              {(cls?.teaching || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Callout tone="info">
            密码由系统随机生成，创建后显示一次。也可以让学生自己用邀请码注册。
          </Callout>
        </div>
      )}
    </Modal>
  );
}

function BatchCreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const { data: cls } = useAsync<any>('classes:list', () => api.get('/api/classes'), { ttl: 30000 });

  /* 每行一个学生。支持「邮箱,昵称,姓名,学号」和「邮箱 昵称」两种写法 ——
   * 老师从 Excel 里复制出来的通常是逗号或制表符分隔。 */
  const parsed = useMemo(() => {
    return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[,，\t]+/).map((s) => s.trim());
      return { email: parts[0] || '', username: parts[1] || '', realName: parts[2] || '', studentNo: parts[3] || '' };
    });
  }, [text]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<any>('/api/admin/students', {
        batch: parsed, classId: classId ? Number(classId) : undefined,
      });
      setResult(r);
      onDone();
    } catch (e: any) {
      toast('error', '批量创建失败', e.message);
    } finally { setBusy(false); }
  };

  const download = () => {
    const lines = ['邮箱,昵称,姓名,学号,初始密码'];
    for (const c of result?.created || []) {
      lines.push([c.email, c.username, c.realName || '', c.studentNo || '', c.password].join(','));
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `库课-新建账号-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const close = () => { setResult(null); setText(''); setClassId(''); onClose(); };

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? `批量创建结果` : '批量建号'}
      width="lg"
      footer={result
        ? (
          <>
            <Button variant="outline" onClick={download}><Download size={13} />下载 CSV</Button>
            <Button variant="accent" onClick={close}>知道了</Button>
          </>
        )
        : (
          <>
            <Button variant="outline" onClick={close}>取消</Button>
            <Button variant="accent" onClick={create} loading={busy} disabled={!parsed.length}>
              创建 {parsed.length} 个账号
            </Button>
          </>
        )}
    >
      {result ? (
        <div className="space-y-3">
          <div className="flex gap-3">
            <Stat label="创建成功" value={result.created.length} tone="ok" />
            <Stat label="失败" value={result.failed.length} tone={result.failed.length ? 'bad' : undefined} />
          </div>
          {result.failed.length > 0 && (
            <Callout tone="warn" title="这些没建成">
              <ul className="space-y-0.5">
                {result.failed.map((f: any, i: number) => (
                  <li key={i}><code className="font-mono">{f.email}</code> —— {f.reason}</li>
                ))}
              </ul>
            </Callout>
          )}
          <Callout tone="info" title="密码只显示这一次">
            每个人的密码都是随机生成的、互不相同。下载 CSV 保存下来再分发 ——
            建议让学生第一次登录后自己改掉。
          </Callout>
          <div className="max-h-64 overflow-auto rounded-lg border border-hairline">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0">
                <tr className="bg-veil/8">
                  <th className="border-b border-hairline px-2 py-1.5 text-left font-medium text-fg-mute">邮箱</th>
                  <th className="border-b border-hairline px-2 py-1.5 text-left font-medium text-fg-mute">昵称</th>
                  <th className="border-b border-hairline px-2 py-1.5 text-left font-medium text-fg-mute">初始密码</th>
                </tr>
              </thead>
              <tbody>
                {result.created.map((c: any, i: number) => (
                  <tr key={i} className="odd:bg-veil/2">
                    <td className="border-b border-hairline px-2 py-1 font-mono">{c.email}</td>
                    <td className="border-b border-hairline px-2 py-1">{c.username}</td>
                    <td className="border-b border-hairline px-2 py-1 font-mono text-cyan">{c.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="学生名单" hint="每行一个：邮箱,昵称,姓名,学号（后三项可省）">
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-mono text-[12px]"
              placeholder={'zhangsan@school.edu,张三,张三,2026001\nlisi@school.edu,李四\nwangwu@school.edu,王五,王五,2026003'}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="加入班级" hint="选填">
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-56">
                <option value="">暂不入班</option>
                {(cls?.teaching || []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <span className="pb-2 text-[12px] text-fg-mute">
              已识别 <b className="text-fg">{parsed.length}</b> 行
            </span>
          </div>
          <Callout tone="info">
            每个账号会分配一个<b>互不相同</b>的随机密码，创建后一次性显示，可下载成 CSV。
            不让所有人用同一个密码 —— 那等于没有密码。
          </Callout>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   班级 / 作业 / 内容 / 审计
   ============================================================ */

function ClassesTab() {
  return (
    <Card>
      <SectionTitle title="班级管理" desc="建班、改邀请码、看成员学情都在这里" icon={<School size={15} className="text-violet" />} />
      <Callout tone="info">
        班级的完整管理界面（建班、邀请码、成员列表、学情分析、移出成员）在独立的「班级」页里 ——
        因为学生也要用那个页面入班，两边共用同一份数据。
      </Callout>
      <div className="mt-3">
        <AppLink
          to="/classes"
          sameTab
          className="inline-flex h-9 items-center gap-2 rounded-lg btn-accent px-4 text-[13px] font-medium"
        >
          <School size={14} />打开班级管理
        </AppLink>
      </div>
    </Card>
  );
}

function AssignmentsTab() {
  const { data, loading } = useAsync<any>('assignments:list', () => api.get('/api/assignments'), { ttl: 10000 });

  if (loading && !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle
          title="作业"
          desc="布置作业在班级页里操作（选班级 → 挑题 → 设截止时间）"
          icon={<ClipboardList size={15} className="text-cyan" />}
        />
        <AppLink
          to="/assignments"
          sameTab
          className="inline-flex h-9 items-center gap-2 rounded-lg btn-accent px-4 text-[13px] font-medium"
        >
          <ClipboardList size={14} />打开作业管理
        </AppLink>
      </Card>

      {data?.assignments?.length ? (
        <Card>
          <SectionTitle title="我布置过的" />
          <div className="space-y-1.5">
            {data.assignments.map((a: any) => (
              <AppLink key={a.id} to={`/assignments/${a.id}`} sameTab className="block">
                <ListRow
                  title={a.title}
                  desc={`${a.className} · ${a.itemCount} 道题 · 已交 ${a.submittedCount}/${a.memberCount}${a.gradedCount ? ` · 已批 ${a.gradedCount}` : ''}`}
                  right={a.gradedCount < a.submittedCount
                    ? <Badge tone="warn">待批 {a.submittedCount - a.gradedCount}</Badge>
                    : <Badge tone="ok">批改完成</Badge>}
                />
              </AppLink>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ContentTab() {
  const { data, loading } = useAsync<any>('admin:content', () => api.get('/api/admin/content'), { ttl: 10000 });

  if (loading && !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle
          title="内容管理"
          desc="内置内容只读，你创建的内容可以改"
          icon={<Database size={15} className="text-emerald" />}
        />
        <Callout tone="info" title="为什么内置内容不能改">
          内置内容是<b>判题基准</b>的一部分 —— 改坏了会让所有学生的判分出错。
          想改的话，复制一份成自己的题目再改。
        </Callout>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="内置题目" value={data?.builtin.questions ?? 0} sub="只读" />
          <Stat label="内置知识点" value={data?.builtin.knowledge ?? 0} sub="只读" />
          <Stat label="内置关卡" value={data?.builtin.levels ?? 0} sub="只读" />
        </div>
      </Card>

      <Card>
        <SectionTitle title="我创建的内容" />
        {data?.questions?.length || data?.knowledge?.length || data?.levels?.length ? (
          <div className="space-y-3">
            {data.questions?.length ? (
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-fg-soft">题目（{data.questions.length}）</div>
                <div className="space-y-1">
                  {data.questions.map((q: any) => (
                    <div key={q.id} className="flex items-center gap-2 rounded border border-hairline bg-veil/2 px-2.5 py-1.5">
                      <Badge tone="neutral">{q.type}</Badge>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">{q.stem}</span>
                      <span className="shrink-0 text-[11px] text-fg-faint">{q.kid}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {data.knowledge?.length ? (
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-fg-soft">知识点（{data.knowledge.length}）</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.knowledge.map((k: any) => (
                    <span key={k.id} className="rounded border border-hairline px-2 py-0.5 text-[12px] text-fg-soft">
                      {k.title}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {data.levels?.length ? (
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-fg-soft">SQL 关卡（{data.levels.length}）</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.levels.map((l: any) => (
                    <span key={l.id} className="rounded border border-hairline px-2 py-0.5 text-[12px] text-fg-soft">
                      {l.title}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Empty
            title="还没有创建过内容"
            desc="内置的 74 道客观题、45 个 SQL 关卡、15 道范式题已经够用一学期了。想加自己的题可以走 API。"
          />
        )}
      </Card>
    </div>
  );
}

function AuditTab() {
  const [action, setAction] = useState('');
  const [mine, setMine] = useState(false);

  const { data, loading } = useAsync<any>(
    `admin:logs:${action}:${mine}`,
    () => api.get(`/api/admin/logs${qs({ limit: 120, action, mine: mine ? 1 : undefined })}`),
    { ttl: 10000 },
  );

  const ACTION_LABEL: Record<string, string> = {
    student_create: '创建学生',
    student_batch_create: '批量创建学生',
    student_update: '修改学生资料',
    student_password_reset: '重置密码',
    student_force_logout: '强制下线',
    student_delete: '删除学生',
    class_create: '创建班级',
    class_update: '修改班级',
    class_delete: '删除班级',
    class_rotate_code: '更换邀请码',
    class_remove_member: '移出班级成员',
    assignment_create: '布置作业',
    assignment_update: '修改作业',
    assignment_delete: '删除作业',
    grade_submission: '批改作业',
    content_question_create: '新建题目',
    content_question_update: '修改题目',
    content_question_delete: '删除题目',
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="按操作类型筛选，例如 student_"
            className="max-w-xs"
          />
          <Button variant={mine ? 'accent' : 'outline'} size="sm" onClick={() => setMine((v) => !v)}>
            只看我做的
          </Button>
          <span className="ml-auto text-[11.5px] text-fg-mute">{data?.logs.length ?? 0} 条</span>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        {loading && !data ? <Skeleton className="h-64" /> : data?.logs.length ? (
          <div className="divide-y divide-[color:var(--color-hairline)]">
            {data.logs.map((l: any) => (
              <div key={l.id} className="flex flex-wrap items-start gap-2.5 px-3.5 py-2.5 hover:bg-veil/4">
                <Badge tone={
                  l.action.includes('delete') ? 'bad'
                    : l.action.includes('create') ? 'ok'
                      : l.action.includes('password') ? 'warn'
                        : 'neutral'
                }>
                  {ACTION_LABEL[l.action] || l.action}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="font-medium text-fg">{l.actorEmail}</span>
                    {l.targetEmail && (
                      <>
                        <span className="text-fg-faint">→</span>
                        <span className="text-fg-soft">{l.targetEmail}</span>
                      </>
                    )}
                  </div>
                  {l.detail && Object.keys(l.detail).length > 0 && (
                    <pre className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-fg-mute">
                      {JSON.stringify(l.detail)}
                    </pre>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">{l.ip || ''}</span>
                <span className="shrink-0 text-[10.5px] text-fg-faint">{formatDateTime(l.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={<ScrollText size={24} />}
            title="没有审计记录"
            desc="所有管理操作（建号、改资料、重置密码、批改作业）都会记在这里"
          />
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   学生详情
   ============================================================ */

export function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useApp();
  const [tab, setTab] = useState<'overview' | 'sql' | 'nodes' | 'attempts'>('overview');

  const { data, loading, error, reload } = useAsync<any>(
    `admin:student:${id}`,
    () => api.get(`/api/admin/students/${id}`),
    { ttl: 10000 },
  );

  if (loading && !data) return <Skeleton className="h-96" />;

  if (error) {
    return (
      <Card>
        <Empty
          icon={<AlertTriangle size={24} className={error.status === 403 ? 'text-warn' : 'text-bad'} />}
          title={error.status === 403 ? '这个学生不在你的管辖范围内' : '加载失败'}
          desc={error.message}
          action={<AppLink to="/admin" sameTab className="text-cyan hover:underline">返回工作台</AppLink>}
        />
      </Card>
    );
  }

  const s = data.student;
  const diag = data.diagnosis;

  return (
    <div className="space-y-4">
      <div>
        <AppLink to="/admin" sameTab className="inline-flex items-center gap-1 text-[12.5px] text-fg-mute hover:text-cyan">
          <ArrowLeft size={13} />教师工作台
        </AppLink>
      </div>

      {/* 学生概况 */}
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[20px] font-bold text-white"
            style={avatarStyle(s.avatarHue)}
          >
            {(s.realName || s.username).slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-semibold text-fg">{s.realName || s.username}</span>
              {s.studentNo && <Badge tone="neutral">学号 {s.studentNo}</Badge>}
              {s.status === 'disabled' && <Badge tone="bad">已停用</Badge>}
              {data.classes.map((c: any) => <Badge key={c.id} tone="info">{c.name}</Badge>)}
            </div>
            <div className="mt-1 text-[12px] text-fg-mute">
              {s.email} · 加入于 {formatDate(s.createdAt)}
              {s.lastLoginAt && ` · 最后登录 ${formatDate(s.lastLoginAt)}`}
            </div>
            {s.note && (
              <Callout tone="info" className="mt-2">备注：{s.note}</Callout>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const r = await api.post<any>(`/api/admin/students/${s.id}/password`, {});
                toast('ok', '密码已重置', `新密码：${r.newPassword}（只显示这一次）`);
                reload();
              } catch (e: any) { toast('error', '失败', e.message); }
            }}>
              <KeyRound size={12} />重置密码
            </Button>
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const r = await api.post<any>(`/api/admin/students/${s.id}/logout`, {});
                toast('ok', '已强制下线', `踢掉 ${r.sessionsKilled} 个会话`);
              } catch (e: any) { toast('error', '失败', e.message); }
            }}>
              <LogOut size={12} />强制下线
            </Button>
            <Button
              size="sm" variant={s.status === 'disabled' ? 'accent' : 'danger'}
              onClick={async () => {
                try {
                  await api.patch(`/api/admin/students/${s.id}`, {
                    status: s.status === 'disabled' ? 'active' : 'disabled',
                  });
                  toast('ok', s.status === 'disabled' ? '已启用' : '已停用');
                  reload();
                } catch (e: any) { toast('error', '失败', e.message); }
              }}
            >
              {s.status === 'disabled' ? <><CheckCircle2 size={12} />启用</> : <><Ban size={12} />停用</>}
            </Button>
          </div>
        </div>
      </Card>

      {/* 学情数字 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="作答总数" value={s.stats.attempts} />
        <Stat label="正确率" value={`${s.stats.accuracy}%`} tone={s.stats.accuracy >= 70 ? 'ok' : s.stats.accuracy >= 50 ? 'warn' : 'bad'} />
        <Stat label="错题" value={s.stats.wrong} tone={s.stats.wrong ? 'bad' : undefined} />
        <Stat label="SQL 运行" value={s.stats.sqlRuns} tone="accent" />
        <Stat label="活跃天数" value={s.stats.activeDays} sub={`Lv.${s.stats.level}`} />
      </div>

      {/* 根因诊断 */}
      {diag?.summary && (
        <Card>
          <SectionTitle
            title="根因诊断"
            desc="沿依赖图回溯出来的根因。找他谈话时最该带着的就是这个。"
            icon={<TrendingUp size={15} className="text-violet" />}
          />
          <Callout tone={diag.roots?.length ? 'warn' : 'ok'}>{diag.summary}</Callout>
          {diag.roots?.length ? (
            <div className="mt-3 space-y-2">
              {diag.roots.slice(0, 5).map((r: any, i: number) => (
                <div key={r.kid} className="rounded-lg border border-hairline bg-veil/2 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-bad/20 text-[10.5px] font-bold text-bad">
                      {i + 1}
                    </span>
                    <span className="text-[13px] font-medium text-fg">{r.title}</span>
                    <span className="text-[11.5px] font-semibold tabular-nums"
                      style={{ color: masteryColor(r.mastery) }}>
                      {Math.round(r.mastery * 100)}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-fg-mute">{r.reason}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      )}

      {/* 明细 */}
      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-3"
          tabs={[
            { key: 'overview', label: '知识点掌握', icon: <Layers size={13} /> },
            { key: 'sql', label: '他写的 SQL', count: data.sqlRuns.length },
            { key: 'attempts', label: '最近作答', count: data.recentAttempts.length },
          ]}
        />

        {tab === 'overview' && (
          data.nodes.length ? (
            <div className="space-y-1.5">
              {data.nodes.map((n: any) => (
                <div key={n.kid} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">{n.title}</span>
                  <div className="w-28 shrink-0"><Progress value={n.mastery / 100} /></div>
                  <span className="w-24 shrink-0 text-right text-[11.5px] tabular-nums"
                    style={{ color: masteryColor(n.mastery / 100) }}>
                    {n.mastery}% · {n.correct}/{n.attempts}
                  </span>
                </div>
              ))}
            </div>
          ) : <Empty title="还没有作答记录" />
        )}

        {tab === 'sql' && (
          data.sqlRuns.length ? (
            <div className="space-y-2">
              <Callout tone="info">
                这一栏是教师端最有价值的数据 ——「错了 3 次」不构成行动，
                「他把 JOIN 写成了逗号连接」才是。
              </Callout>
              {data.sqlRuns.map((r: any) => (
                <div key={r.id} className={cn(
                  'rounded-lg border p-2.5',
                  r.ok ? 'border-hairline bg-veil/2' : 'border-bad/25 bg-bad-soft',
                )}>
                  <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-fg-faint">
                    {r.ok ? <Terminal size={11} /> : <CircleAlert size={11} className="text-bad" />}
                    <span>{formatDate(r.ts)}</span>
                    <span>{r.datasetId}</span>
                    {r.levelId && <Badge tone="info">{r.levelId}</Badge>}
                    {r.ok && <span>{r.ms}ms · {r.rowCount} 行</span>}
                  </div>
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-fg-soft">
                    {r.sql}
                  </pre>
                  {r.error && <div className="mt-1 text-[11.5px] text-bad">{r.error}</div>}
                </div>
              ))}
            </div>
          ) : <Empty title="还没有 SQL 运行记录" desc="他去实训场跑过查询之后，这里会显示每一条" />
        )}

        {tab === 'attempts' && (
          data.recentAttempts.length ? (
            <div className="space-y-1">
              {data.recentAttempts.map((a: any, i: number) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-veil/2 px-2.5 py-1.5">
                  {a.correct
                    ? <CheckCircle2 size={13} className="shrink-0 text-ok" />
                    : <CircleAlert size={13} className="shrink-0 text-bad" />}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">
                    {String(a.title || a.refId).slice(0, 70)}
                  </span>
                  <Badge tone="neutral">{a.kind}</Badge>
                  {a.errorType && <Badge tone="warn">{a.errorType}</Badge>}
                  <span className="shrink-0 text-[10.5px] text-fg-faint">{a.date}</span>
                </div>
              ))}
            </div>
          ) : <Empty title="还没有作答记录" />
        )}
      </Card>

      {/* 会话 */}
      {data.sessions?.length ? (
        <Card>
          <SectionTitle
            title="活跃会话"
            desc="不返回 token —— 库里存的是哈希，给了也没用"
            icon={<BookOpen size={15} className="text-fg-mute" />}
          />
          <div className="space-y-1">
            {data.sessions.map((x: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-veil/2 px-2.5 py-1.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-fg-mute">{x.user_agent || '未知设备'}</span>
                <span className="font-mono text-fg-faint">{x.ip || '—'}</span>
                <span className="text-fg-faint">{formatDateTime(x.last_seen_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 对这个学生的管理操作记录 */}
      {data.logs?.length ? (
        <Card>
          <SectionTitle
            title="这个账号被做过的操作"
            icon={<ScrollText size={15} className="text-fg-mute" />}
          />
          <div className="space-y-1">
            {data.logs.map((l: any) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-veil/2 px-2.5 py-1.5 text-[11.5px]">
                <Badge tone="neutral">{l.action}</Badge>
                <span className="min-w-0 flex-1 truncate text-fg-mute">
                  by {l.actor_email}
                </span>
                <span className="text-fg-faint">{formatDateTime(l.at)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
