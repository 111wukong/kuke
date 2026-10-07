/* 作业：列表 + 详情/作答/批改
 *
 * ── 一个页面三种身份 ────────────────────────────────────────────
 *   学生  → 看题目、作答、提交、看批改结果
 *   教师  → 看全班提交情况、逐份批改
 * 靠接口返回的 role 和 canManage 分流，不靠前端角色判断 ——
 * 因为"我能不能管这份作业"是服务端算出来的，前端猜不准。
 */
import { useEffect, useMemo, useState } from 'react';
import { usePageParams } from '@/components/layout/KeepAlivePages';
import {
  ClipboardList, CalendarClock, CheckCircle2, AlertTriangle, Users,
  ArrowLeft, Save, MessageSquare, Terminal, HelpCircle, Sigma, FlaskConical,
  ChevronRight, Award,
} from 'lucide-react';
import { Card, SectionTitle, Badge, Button, Skeleton, DetailSkeleton, TableSkeleton, Empty, Progress, Callout, Stat, Textarea, Input } from '@/components/ui/Primitives';
import { Markdown } from '@/lib/markdown';
import { AppLink } from '@/lib/links';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

/* ============================================================
   列表
   ============================================================ */

export function Assignments() {
  const { data, loading, error } = useAsync<any>(
    'assignments:list',
    () => api.get('/api/assignments'),
    { ttl: 15000 },
  );

  if (loading && !data) return <TableSkeleton rows={5} cols={4} />;
  if (error) return <Card><Empty title="加载失败" desc={error.message} /></Card>;

  const isTeacher = data?.role === 'teacher';
  const list = data?.assignments || [];

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
          <ClipboardList size={17} className="text-cyan" />
          {isTeacher ? '我布置的作业' : '我的作业'}
        </h2>
        <p className="mt-1 text-[12.5px] text-fg-mute">
          {isTeacher
            ? '点进任意一份可以看到全班的提交情况，并逐份批改。'
            : '只显示你所在班级的作业。截止时间过了仍然可以打开看，能不能补交由老师决定。'}
        </p>
      </Card>

      {list.length ? (
        <div className="space-y-2.5">
          {list.map((a: any) => {
            const overdue = isTeacher ? false : a.overdue;
            const graded = !isTeacher && a.myStatus === 'graded';
            const submitted = !isTeacher && a.myStatus === 'submitted';
            return (
              <AppLink
                key={a.id}
                to={`/assignments/${a.id}`}
                className="block"
              >
                <Card className={cn(
                  'transition-colors hover:border-cyan/40',
                  overdue && !submitted && !graded && 'border-l-2 border-l-bad',
                  graded && 'border-l-2 border-l-ok',
                )}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] font-semibold text-fg">{a.title}</span>
                        {isTeacher ? (
                          <>
                            <Badge tone="info">{a.className}</Badge>
                            <Badge tone={a.status === 'published' ? 'ok' : 'neutral'}>
                              {a.status === 'published' ? '进行中' : a.status === 'closed' ? '已关闭' : '草稿'}
                            </Badge>
                          </>
                        ) : (
                          <>
                            <Badge tone="info">{a.className}</Badge>
                            {graded && <Badge tone="ok">已批改 {a.myScore} 分</Badge>}
                            {submitted && <Badge tone="warn">已提交，待批改</Badge>}
                            {a.myStatus === 'pending' && (
                              overdue ? <Badge tone="bad">已逾期未交</Badge> : <Badge>未提交</Badge>
                            )}
                          </>
                        )}
                      </div>

                      {a.brief && (
                        <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-fg-mute">{a.brief}</p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-fg-mute">
                        <span className="flex items-center gap-1">
                          <CalendarClock size={11} />
                          {a.dueAt ? `截止 ${formatDateTime(a.dueAt)}` : '不限时'}
                        </span>
                        <span>{a.itemCount} 道题</span>
                        <span>满分 {a.totalPoints}</span>
                        {isTeacher && (
                          <span className="flex items-center gap-1">
                            <Users size={11} />
                            已交 {a.submittedCount}/{a.memberCount}
                            {a.gradedCount > 0 && ` · 已批 ${a.gradedCount}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight size={16} className="mt-1 shrink-0 text-fg-faint" />
                  </div>

                  {isTeacher && a.memberCount > 0 && (
                    <div className="mt-2.5">
                      <Progress value={a.submittedCount / a.memberCount} tone="accent" showLabel />
                    </div>
                  )}
                </Card>
              </AppLink>
            );
          })}
        </div>
      ) : (
        <Card>
          <Empty
            icon={<ClipboardList size={24} />}
            title={isTeacher ? '还没有布置过作业' : '暂时没有作业'}
            desc={isTeacher
              ? '在「班级」页里选一个班，就可以布置作业了'
              : '老师布置之后会出现在这里。先用「班级」页的邀请码加入班级。'}
            action={<AppLink to="/classes" sameTab className="text-cyan hover:underline">去看班级</AppLink>}
          />
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   详情
   ============================================================ */

const QTYPE: Record<string, string> = {
  choice: '单选', multi: '多选', judge: '判断', blank: '填空', short: '简答',
};

const KIND_ICON: Record<string, any> = {
  question: HelpCircle, level: Terminal, normalize: Sigma, lab: FlaskConical,
};

export function AssignmentDetail() {
  const { id } = usePageParams<{ id: string }>();
  const { toast } = useApp();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [gradeTarget, setGradeTarget] = useState<number | null>(null);
  const [gradeDraft, setGradeDraft] = useState<{ score: number; feedback: string; items: Record<string, number> }>({
    score: 0, feedback: '', items: {},
  });

  const { data, loading, error, reload } = useAsync<any>(
    `assignments:${id}`,
    () => api.get(`/api/assignments/${id}`),
    { ttl: 5000 },
  );

  const { data: subDetail } = useAsync<any>(
    gradeTarget ? `assignments:${id}:sub:${gradeTarget}` : 'noop:skip',
    () => api.get(`/api/assignments/${id}/submission/${gradeTarget}`),
    { ttl: 0, enabled: !!gradeTarget },
  );

  useEffect(() => {
    if (!subDetail) return;
    setGradeDraft({
      score: subDetail.submission.score ?? 0,
      feedback: subDetail.submission.feedback ?? '',
      items: Object.fromEntries(
        (subDetail.items || []).map((it: any) => [it.itemId, typeof it.score === 'number' ? it.score : 0]),
      ),
    });
  }, [subDetail]);

  const canManage = data?.canManage;
  const items = data?.items || [];

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<any>(`/api/assignments/${id}/submit`, {
        answers: items.map((it: any) => ({ itemId: it.id, answer: answers[it.id] ?? '' })),
      });
      toast('ok', `已提交，自动判分 ${r.score}/${r.totalPoints}`,
        r.manualCount ? `有 ${r.manualCount} 道题需要老师批改` : undefined);
      invalidatePrefix('assignments:');
      reload();
    } catch (e: any) {
      toast('error', '提交失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  const doGrade = async () => {
    if (gradeTarget === null) return;
    setBusy(true);
    try {
      await api.post(`/api/assignments/${id}/grade`, {
        userId: gradeTarget,
        score: gradeDraft.score,
        feedback: gradeDraft.feedback,
        itemScores: Object.entries(gradeDraft.items).map(([itemId, score]) => ({ itemId, score })),
      });
      toast('ok', '批改已保存');
      setGradeTarget(null);
      invalidatePrefix('assignments:');
    } catch (e: any) {
      toast('error', '保存失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  const autoSum = useMemo(() => {
    if (!subDetail) return 0;
    return Object.values(gradeDraft.items).reduce((s, n) => s + (Number(n) || 0), 0);
  }, [gradeDraft.items, subDetail]);

  if (loading && !data) return <DetailSkeleton />;
  if (error || !data) {
    return (
      <Card>
        <Empty title="作业不存在或你没有权限" desc={error?.message}
          action={<AppLink to="/assignments" sameTab className="text-cyan hover:underline">返回作业列表</AppLink>} />
      </Card>
    );
  }

  const a = data.assignment;

  return (
    <div className="space-y-4">
      <div>
        <AppLink to="/assignments" sameTab className="inline-flex items-center gap-1 text-[12.5px] text-fg-mute hover:text-cyan">
          <ArrowLeft size={13} />作业列表
        </AppLink>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[19px] font-semibold text-fg">{a.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-mute">
              <Badge tone="info">{a.className}</Badge>
              <span>老师：{a.teacherName}</span>
              <span className="flex items-center gap-1">
                <CalendarClock size={11} />
                {a.dueAt ? `截止 ${formatDateTime(a.dueAt)}` : '不限时'}
              </span>
              <span>满分 {a.totalPoints}</span>
            </div>
            {a.brief && (
              <div className="mt-3"><Markdown source={a.brief} /></div>
            )}
          </div>

          {!canManage && data.mySubmission && (
            <div className="shrink-0 text-right">
              <div className={cn(
                'text-[26px] font-semibold tabular-nums',
                data.mySubmission.status === 'graded' ? 'text-ok' : 'text-warn',
              )}>
                {data.mySubmission.score ?? '—'}
              </div>
              <div className="text-[12px] text-fg-faint">
                {data.mySubmission.status === 'graded' ? '已批改' : '待批改'}
              </div>
            </div>
          )}
        </div>

        {!canManage && data.mySubmission?.feedback && (
          <Callout tone="info" title="老师评语" className="mt-3">
            {data.mySubmission.feedback}
          </Callout>
        )}
      </Card>

      {/* ============ 教师视角 ============ */}
      {canManage && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="班级人数" value={data.stats?.members ?? 0} />
            <Stat label="已提交" value={data.stats?.submitted ?? 0} tone="accent" />
            <Stat label="已批改" value={data.stats?.graded ?? 0} tone="ok" />
            <Stat label="平均分" value={data.stats?.avgScore ?? '—'} tone="warn" />
          </div>

          <Card>
            <SectionTitle
              title="提交情况"
              desc="点「批改」逐份看答案、改分、写评语"
              icon={<Users size={15} className="text-cyan" />}
            />
            <div className="space-y-1.5">
              {(data.submissions || []).map((s: any) => (
                <div key={s.userId} className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-veil/2 p-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                    {s.realName || s.username}
                    {s.studentNo && <span className="ml-1.5 text-[12px] text-fg-faint">{s.studentNo}</span>}
                  </span>

                  {s.status === 'not_submitted' ? (
                    <Badge tone="neutral">未提交</Badge>
                  ) : s.status === 'graded' ? (
                    <>
                      <Badge tone="ok">已批改</Badge>
                      <span className="w-12 text-right text-[14px] font-semibold tabular-nums text-ok">{s.score}</span>
                    </>
                  ) : (
                    <>
                      <Badge tone="warn">待批改</Badge>
                      <span className="w-12 text-right text-[14px] font-semibold tabular-nums text-warn">
                        {s.score ?? '—'}
                      </span>
                    </>
                  )}

                  {s.submittedAt && (
                    <span className="text-[12px] text-fg-faint">{formatDate(s.submittedAt)}</span>
                  )}

                  {s.status !== 'not_submitted' && (
                    <Button size="sm" variant="outline" onClick={() => setGradeTarget(s.userId)}>
                      批改
                    </Button>
                  )}
                </div>
              ))}
              {!data.submissions?.length && (
                <Empty
                  title="班级里还没有学生"
                  desc="先让学生用班级邀请码入班，之后布置的作业才会出现在他们的待办里。"
                  action={<AppLink to="/classes" sameTab><Button size="sm">去班级页</Button></AppLink>}
                />
              )}
            </div>
          </Card>

          {/* ---------- 批改面板 ---------- */}
          {gradeTarget !== null && (
            <Card>
              <SectionTitle
                title={`批改：${subDetail?.student?.realName || subDetail?.student?.username || ''}`}
                right={<Button size="sm" variant="ghost" onClick={() => setGradeTarget(null)}>关闭</Button>}
              />

              {!subDetail ? (
                <Skeleton className="h-40" />
              ) : (
                <div className="space-y-3">
                  {(subDetail.items || []).map((it: any) => (
                    <div key={it.itemId} className="rounded-lg border border-hairline bg-veil/2 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {(() => { const I = KIND_ICON[it.kind] || HelpCircle; return <I size={13} className="text-fg-mute" />; })()}
                            <span className="text-[13px] font-medium text-fg">
                              {it.stem || it.refId}
                            </span>
                            <Badge tone="neutral">满分 {it.points}</Badge>
                            {it.manual && <Badge tone="info">已手改</Badge>}
                          </div>
                          {it.options?.length ? (
                            <div className="mt-1.5 space-y-0.5">
                              {it.options.map((o: any) => (
                                <div key={o.key} className="text-[12px] text-fg-mute">
                                  <span className="mr-1.5 font-semibold">{o.key}</span>{o.text}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[12px] text-fg-faint">给分</span>
                          <Input
                            type="number"
                            min={0}
                            max={it.points}
                            value={gradeDraft.items[it.itemId] ?? 0}
                            onChange={(e) => setGradeDraft((d) => ({
                              ...d,
                              items: { ...d.items, [it.itemId]: Number(e.target.value) },
                            }))}
                            className="w-16 text-center"
                          />
                          <span className="text-[12px] text-fg-faint">/ {it.points}</span>
                        </div>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="rounded border border-hairline bg-ink-1000/40 p-2">
                          <div className="mb-1 text-[12px] text-fg-faint">学生的作答</div>
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-fg-soft">
                            {it.answer || '（空）'}
                          </pre>
                        </div>
                        <div className="rounded border border-hairline bg-ink-1000/40 p-2">
                          <div className="mb-1 text-[12px] text-fg-faint">参考答案</div>
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-ok">
                            {it.correctAnswer || '—'}
                          </pre>
                        </div>
                      </div>

                      {it.analysis && (
                        <div className="mt-2 rounded border border-hairline bg-veil/3 p-2">
                          <div className="mb-1 text-[12px] text-fg-faint">解析</div>
                          <Markdown source={it.analysis} />
                        </div>
                      )}
                      {it.steps?.length ? (
                        <div className="mt-2">
                          <div className="mb-1 text-[12px] text-fg-faint">评分点</div>
                          <ul className="space-y-0.5">
                            {it.steps.map((s: any, i: number) => (
                              <li key={i} className="text-[12px] text-fg-mute">
                                <span className="mr-1.5 rounded bg-veil/10 px-1 text-[12px]">{s.pts}分</span>
                                {s.t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ))}

                  <div className="rounded-lg border border-hairline bg-veil/3 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[12.5px] text-fg-soft">总分</span>
                      <Input
                        type="number"
                        value={gradeDraft.score}
                        onChange={(e) => setGradeDraft((d) => ({ ...d, score: Number(e.target.value) }))}
                        className="w-20 text-center"
                      />
                      <span className="text-[12px] text-fg-faint">/ {a.totalPoints}</span>
                      <Button size="sm" variant="ghost" onClick={() => setGradeDraft((d) => ({ ...d, score: autoSum }))}>
                        用逐题之和（{autoSum}）
                      </Button>
                    </div>
                    <Textarea
                      className="mt-2.5"
                      rows={3}
                      value={gradeDraft.feedback}
                      onChange={(e) => setGradeDraft((d) => ({ ...d, feedback: e.target.value }))}
                      placeholder="写点评语。学生能在作业页看到。"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setGradeTarget(null)}>取消</Button>
                      <Button variant="accent" size="sm" onClick={doGrade} loading={busy}>
                        <Save size={13} />保存批改
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* ============ 学生视角 ============ */}
      {!canManage && (
        <>
          {data.mySubmission?.status === 'graded' && (
            <Card>
              <SectionTitle title="我的作答与批改" icon={<Award size={15} className="text-ok" />} />
              <div className="space-y-2">
                {(data.mySubmission.detail || []).map((d: any, i: number) => (
                  <div key={i} className="flex items-center gap-2.5 rounded border border-hairline bg-veil/2 px-3 py-2">
                    {d.correct
                      ? <CheckCircle2 size={14} className="shrink-0 text-ok" />
                      : d.needsManual
                        ? <MessageSquare size={14} className="shrink-0 text-warn" />
                        : <AlertTriangle size={14} className="shrink-0 text-bad" />}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">第 {i + 1} 题</span>
                    <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-fg">
                      {d.score ?? '—'} / {d.points}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <SectionTitle
              title={data.mySubmission ? '我的作答' : '作答'}
              desc={data.mySubmission?.status === 'graded'
                ? '已经批改过了，不能再修改。'
                : '交卷前可以随时改。提交后老师批改前也还能重交。'}
            />

            <div className="space-y-3">
              {items.map((it: any, idx: number) => {
                const Icon = KIND_ICON[it.kind] || HelpCircle;
                const locked = data.mySubmission?.status === 'graded';
                const content = it.question || it.level || it.task || it.lab;
                return (
                  <div key={it.id} className="rounded-lg border border-hairline bg-veil/2 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded bg-veil/10 text-[12px] font-semibold text-fg-mute">
                        {idx + 1}
                      </span>
                      <Icon size={13} className="text-fg-mute" />
                      <Badge tone="neutral">{it.points} 分</Badge>
                      {it.kind === 'question' && it.question && (
                        <Badge tone="info">{QTYPE[it.question.type] || it.question.type}</Badge>
                      )}
                    </div>

                    <div className="prose-doc text-[13px]">
                      <Markdown source={content?.stem || content?.title || '（题目内容缺失）'} />
                    </div>
                    {content?.brief && it.kind !== 'question' && (
                      <div className="mt-1.5"><Markdown source={content.brief} /></div>
                    )}

                    <div className="mt-2.5">
                      {it.kind === 'question' && it.question?.type === 'choice' && it.question.options?.length ? (
                        <div className="space-y-1">
                          {it.question.options.map((o: any) => (
                            <button
                              key={o.key}
                              disabled={locked}
                              onClick={() => setAnswers((a) => ({ ...a, [it.id]: o.key }))}
                              className={cn(
                                'flex w-full items-start gap-2 rounded border px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-default',
                                answers[it.id] === o.key
                                  ? 'border-cyan/50 bg-cyan/10 text-cyan'
                                  : 'border-hairline bg-ink-1000/30 text-fg-soft hover:border-cyan/30',
                              )}
                            >
                              <span className="font-semibold">{o.key}</span>
                              <span className="min-w-0 flex-1">{o.text}</span>
                            </button>
                          ))}
                        </div>
                      ) : it.kind === 'question' && it.question?.type === 'judge' ? (
                        <div className="flex gap-2">
                          {[{ k: 'T', t: '正确' }, { k: 'F', t: '错误' }].map((o) => (
                            <button
                              key={o.k}
                              disabled={locked}
                              onClick={() => setAnswers((a) => ({ ...a, [it.id]: o.k }))}
                              className={cn(
                                'flex-1 rounded border py-2 text-[13px] transition-colors disabled:cursor-default',
                                answers[it.id] === o.k
                                  ? 'border-cyan/50 bg-cyan/10 text-cyan'
                                  : 'border-hairline bg-ink-1000/30 text-fg-soft hover:border-cyan/30',
                              )}
                            >
                              {o.t}
                            </button>
                          ))}
                        </div>
                      ) : it.kind === 'lab' ? (
                        <div className="space-y-1">
                          {(it.lab?.payload?.options || []).map((o: any) => (
                            <button
                              key={o.key}
                              disabled={locked}
                              onClick={() => setAnswers((a) => ({ ...a, [it.id]: o.key }))}
                              className={cn(
                                'flex w-full items-start gap-2 rounded border px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-default',
                                answers[it.id] === o.key
                                  ? 'border-cyan/50 bg-cyan/10 text-cyan'
                                  : 'border-hairline bg-ink-1000/30 text-fg-soft hover:border-cyan/30',
                              )}
                            >
                              <span className="font-semibold">{o.key}</span>
                              <span className="min-w-0 flex-1">{o.label || o.text}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Textarea
                          rows={it.kind === 'question' && it.question?.type === 'short' ? 5 : 3}
                          disabled={locked}
                          value={answers[it.id] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [it.id]: e.target.value }))}
                          placeholder={
                            it.kind === 'level' ? '写下你的 SQL'
                              : it.kind === 'normalize' ? '写下答案，例如 AB 或 A,B'
                                : '写下你的答案'
                          }
                          className={cn(it.kind === 'level' && 'font-mono')}
                        />
                      )}
                    </div>

                    {it.level?.hint && !locked && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12px] text-warn hover:underline">看提示</summary>
                        <div className="mt-1 text-[12px] text-fg-mute">{it.level.hint}</div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            {data.mySubmission?.status !== 'graded' ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[12px] text-fg-faint">
                  {data.mySubmission ? '已提交过，可以重交' : '还没提交'}
                </span>
                <Button variant="accent" onClick={submit} loading={busy}>
                  {data.mySubmission ? '重新提交' : '提交作业'}
                </Button>
              </div>
            ) : (
              <Callout tone="ok" className="mt-4">
                这份作业已经批改完成，不能再修改了。
              </Callout>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
