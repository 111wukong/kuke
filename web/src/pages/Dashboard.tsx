/* 仪表盘
 *
 * ── 这个页面只回答一个问题：我现在该做什么 ──────────────────────
 * 不是"展示所有数据"。学生打开它，应该看到三件事：
 *   1. 今天还剩多少任务（复习队列 / 错题 / 新内容）
 *   2. 我的整体状态（等级、连续天数、掌握分布）
 *   3. 一句话告诉我下一步做什么（根因诊断的摘要）
 *
 * 所以布局顺序是：待办 → 诊断 → 概览。而不是把统计数字堆在最上面。
 */
import { useMemo } from 'react';
import {
  Flame, Zap, Target, TrendingUp, CircleAlert, RotateCcw, Sparkles,
  ArrowRight, BookOpen, Terminal, Flag, Sigma,
} from 'lucide-react';
import { Card, SectionTitle, Stat, Badge, Progress, Button, Skeleton, Empty, ListRow } from '@/components/ui/Primitives';
import { Heatmap } from '@/components/ui/Toaster';
import { AppLink } from '@/lib/links';
import { useAsync } from '@/lib/hooks';
import { useAuth } from '@/stores/auth';
import { useApp } from '@/stores/app';
import { cn, masteryColor } from '@/lib/utils';
import { api } from '@/lib/api';

interface Snapshot {
  xp: number; level: number; levelTitle: string;
  levelInfo: { into: number; need: number; progress: number };
  streak: number; combo: number; bestCombo: number;
  today: { attempts: number; correct: number };
  totals: { attempts: number; correct: number; accuracy: number; activeDays: number };
  wrong: number; dueCount: number;
  levels: { total: number; passed: number };
  heatmap: { date: string; n: number; c: number }[];
}

interface Plan {
  date: string; goal: number; done: number;
  review: { id: string; title?: string; type: string }[];
  mistakes: { refId: string; kind: string; kid: string }[];
  fresh: { id: string; title: string; ready: boolean; missing: number }[];
  summary: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { refreshSnapshot } = useApp();
  const { data, loading, error, reload } = useAsync<{ snapshot: Snapshot; plan: Plan }>(
    'study:snapshot',
    () => api.get('/api/study/snapshot'),
    { ttl: 5000 },
  );

  const { data: diag } = useAsync<{ diagnosis: any }>(
    'study:diagnose',
    () => api.get('/api/study/diagnose'),
    { ttl: 30000 },
  );

  const s = data?.snapshot;
  const plan = data?.plan;
  const diagnosis = diag?.diagnosis;

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return '凌晨了还在学';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }, []);

  if (loading && !s) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <Empty
          title="加载失败"
          desc={error.message}
          action={<Button variant="outline" onClick={reload}>重试</Button>}
        />
      </Card>
    );
  }

  const goalProgress = plan ? Math.min(1, plan.done / Math.max(1, plan.goal)) : 0;

  return (
    <div className="space-y-4">
      {/* ---------- 欢迎 + 今日进度 ---------- */}
      <Card className="relative overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[19px] font-semibold text-fg">
              {greeting}，{user?.username}
            </div>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-fg-soft">
              {plan?.summary || '开始今天的学习吧。'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {s && s.streak > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber/30 bg-warn-soft px-3 py-2">
                <Flame size={16} className="text-amber" />
                <div className="leading-tight">
                  <div className="text-[16px] font-semibold tabular-nums text-amber">{s.streak}</div>
                  <div className="text-[10px] text-fg-mute">连续天数</div>
                </div>
              </div>
            )}
            {s && (
              <div className="flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-2">
                <Zap size={16} className="text-cyan" />
                <div className="leading-tight">
                  <div className="text-[16px] font-semibold tabular-nums text-cyan">Lv.{s.level}</div>
                  <div className="text-[10px] text-fg-mute">{s.levelTitle}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1">
            <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
              <span className="text-fg-soft">今日进度</span>
              <span className="tabular-nums text-fg-mute">
                {plan?.done ?? 0} / {plan?.goal ?? 20} 题
              </span>
            </div>
            <Progress value={goalProgress} tone={goalProgress >= 1 ? 'ok' : 'accent'} />
          </div>
          {goalProgress >= 1 && <Badge tone="ok">今日目标已达成</Badge>}
        </div>
      </Card>

      {/* ---------- 四张概览卡 ---------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="待复习" icon={<RotateCcw size={12} />} tone={s?.dueCount ? 'warn' : undefined}
          value={s?.dueCount ?? 0}
          sub={s?.dueCount ? '间隔重复队列里到期了' : '队列已清空'}
        />
        <Stat
          label="错题" icon={<CircleAlert size={12} />} tone={s?.wrong ? 'bad' : undefined}
          value={s?.wrong ?? 0}
          sub={s?.wrong ? '曾经答错且还没答对过' : '没有遗留错题'}
        />
        <Stat
          label="总正确率" icon={<Target size={12} />} tone="accent"
          value={`${s?.totals.accuracy ?? 0}%`}
          sub={`累计 ${s?.totals.attempts ?? 0} 题 · ${s?.totals.activeDays ?? 0} 天`}
        />
        <Stat
          label="SQL 关卡" icon={<Flag size={12} />} tone="ok"
          value={`${s?.levels.passed ?? 0}/${s?.levels.total ?? 45}`}
          sub="通过 / 总数"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          {/* ---------- 今天做什么 ---------- */}
          <Card>
            <SectionTitle
              title="今天做什么"
              desc="按优先级排好了：先清复习队列，再补错题，最后学新内容"
              icon={<Sparkles size={15} className="text-cyan" />}
            />
            <div className="space-y-2">
              {plan?.review.length ? (
                <ListRow
                  title={`复习队列有 ${plan.review.length} 张卡`}
                  desc="间隔重复算法认为这些内容你快要忘了 —— 现在复习的性价比最高"
                  left={<RotateCcw size={15} className="text-warn" />}
                  right={<Badge tone="warn">{plan.review.length}</Badge>}
                  onClick={() => { window.location.href = '/review'; }}
                />
              ) : (
                <ListRow
                  title="复习队列是空的"
                  desc="没有到期的卡片，去练点新东西吧"
                  left={<RotateCcw size={15} className="text-fg-faint" />}
                />
              )}

              {plan?.mistakes.length ? (
                <ListRow
                  title={`错题本里还有 ${plan.mistakes.length} 道`}
                  desc="这些题你错过而且还没答对过"
                  left={<CircleAlert size={15} className="text-bad" />}
                  right={<Badge tone="bad">{plan.mistakes.length}</Badge>}
                  onClick={() => { window.location.href = '/mistakes'; }}
                />
              ) : null}

              {plan?.fresh.slice(0, 3).map((f) => (
                <ListRow
                  key={f.id}
                  title={f.title}
                  desc={f.ready ? '前置知识都掌握了，可以直接学' : `还有 ${f.missing} 个前置知识点没掌握`}
                  left={<BookOpen size={15} className={f.ready ? 'text-ok' : 'text-fg-faint'} />}
                  right={f.ready ? <Badge tone="ok">可以开始</Badge> : <Badge>建议先补前置</Badge>}
                  onClick={() => { window.location.href = `/learn/${f.id}`; }}
                />
              ))}
            </div>
          </Card>

          {/* ---------- 根因诊断 ---------- */}
          {diagnosis && (
            <Card>
              <SectionTitle
                title="诊断：最该先补什么"
                desc="沿知识依赖图回溯，找的是根因而不是症状"
                icon={<TrendingUp size={15} className="text-violet" />}
                right={<AppLink to="/stats" className="text-[12px] text-cyan hover:underline">完整统计</AppLink>}
              />

              {diagnosis.roots.length ? (
                <div className="space-y-2">
                  {diagnosis.roots.slice(0, 3).map((r: any, i: number) => (
                    <div
                      key={r.kid}
                      className="rounded-lg border border-hairline bg-veil/3 p-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                          i === 0 ? 'bg-bad/20 text-bad' : 'bg-veil/10 text-fg-mute',
                        )}>
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <AppLink to={`/learn/${r.kid}`} className="text-[13.5px] font-medium text-fg hover:text-cyan">
                              {r.title}
                            </AppLink>
                            <span
                              className="text-[11.5px] font-semibold tabular-nums"
                              style={{ color: masteryColor(r.mastery) }}
                            >
                              掌握度 {Math.round(r.mastery * 100)}%
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-fg-mute">{r.reason}</p>
                          {r.symptoms?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {r.symptoms.slice(0, 4).map((sym: any) => (
                                <Badge key={sym.kid} tone="neutral">
                                  {sym.title} · {Math.round(sym.mastery * 100)}%
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title={diagnosis.summary}
                  desc="做过几道题之后，这里会告诉你薄弱点的根因在哪"
                  icon={<TrendingUp size={22} />}
                />
              )}
            </Card>
          )}
        </div>

        {/* ---------- 右侧 ---------- */}
        <div className="space-y-4">
          <Card>
            <SectionTitle title="最近 4 周" desc="每格一天，颜色越深做得越多" />
            {s?.heatmap && <Heatmap data={s.heatmap} weeks={4} />}
          </Card>

          <Card>
            <SectionTitle title="快捷入口" />
            <div className="grid grid-cols-2 gap-2">
              {[
                { to: '/lab/sql', icon: Terminal, label: 'SQL 实训场', desc: '自由写查询' },
                { to: '/levels', icon: Flag, label: 'SQL 闯关', desc: '45 道关卡' },
                { to: '/practice', icon: Target, label: '每日一练', desc: '按考点刷题' },
                { to: '/normalize', icon: Sigma, label: '范式实验室', desc: '推演算法' },
              ].map((x) => (
                <AppLink
                  key={x.to}
                  to={x.to}
                  className="group flex flex-col gap-1 rounded-lg border border-hairline bg-veil/3 p-3 transition-colors hover:border-cyan/40 hover:bg-cyan/6"
                >
                  <x.icon size={16} className="text-cyan" />
                  <div className="text-[13px] font-medium text-fg">{x.label}</div>
                  <div className="text-[11px] text-fg-mute">{x.desc}</div>
                  <ArrowRight size={13} className="mt-0.5 text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-cyan" />
                </AppLink>
              ))}
            </div>
          </Card>

          {s && s.combo >= 3 && (
            <Card>
              <div className="flex items-center gap-3">
                <Zap size={20} className="text-amber" />
                <div>
                  <div className="text-[14px] font-semibold text-fg">连对 {s.combo} 题</div>
                  <div className="text-[11.5px] text-fg-mute">
                    最高连击 {s.bestCombo} · 连对越多 XP 加成越高
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="pt-1 text-center text-[11px] text-fg-faint">
        数据更新于刚刚 ·{' '}
        <button onClick={() => { reload(); refreshSnapshot(); }} className="text-cyan hover:underline">
          刷新
        </button>
      </div>
    </div>
  );
}
