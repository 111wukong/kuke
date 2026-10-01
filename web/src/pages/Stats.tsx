/* 学习统计
 *
 * ── 用「雷达图 + 依赖树」而不是「一堆数字」 ──────────────────────
 * 学生打开统计页想知道的是"我哪里弱、该补什么"，
 * 不是"我一共做了多少题"。所以主视觉是：
 *   ① 按分类的掌握度（一眼看出哪个模块拖后腿）
 *   ② 根因诊断的学习路径（按依赖顺序排好的待办）
 * 数字放在下面作为佐证。
 */
import { useMemo } from 'react';
import {
  ChartNoAxesColumn, TrendingUp, Route, CircleAlert,
  CheckCircle2, ArrowRight,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Skeleton, ChartSkeleton, Empty, Progress, Stat, Tabs,
} from '@/components/ui/Primitives';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { useState } from 'react';
import { AppLink } from '@/lib/links';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { cn, masteryColor, masteryLabel, formatDate } from '@/lib/utils';

export default function Stats() {
  const [tab, setTab] = useState<'overview' | 'nodes' | 'recent'>('overview');

  const { data, loading } = useAsync<any>(
    'study:stats',
    () => api.get('/api/study/stats'),
    { ttl: 15000 },
  );

  const { data: diag } = useAsync<any>(
    'study:diagnose',
    () => api.get('/api/study/diagnose'),
    { ttl: 30000 },
  );

  const { data: snap } = useAsync<any>(
    'study:snapshot',
    () => api.get('/api/study/snapshot'),
    { ttl: 15000 },
  );

  const radarData = useMemo(
    () => (data?.byCategory || []).map((c: any) => ({
      name: c.name,
      value: c.accuracy,
      fullMark: 100,
    })),
    [data],
  );

  const weakNodes = useMemo(
    () => (data?.nodes || []).filter((n: any) => n.mastery < 70).sort((a: any, b: any) => a.mastery - b.mastery),
    [data],
  );

  if (loading && !data) {
    return <div className="space-y-3"><Skeleton className="h-32" /><ChartSkeleton /><ChartSkeleton /></div>;
  }

  const s = snap?.snapshot;
  const diagnosis = diag?.diagnosis;

  return (
    <div className="space-y-4">
      {/* ---------- 概览数字 ---------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="累计作答" value={s?.totals.attempts ?? 0} sub={`${s?.totals.activeDays ?? 0} 个活跃日`} />
        <Stat label="总体正确率" value={`${s?.totals.accuracy ?? 0}%`} tone="accent"
          sub={`答对 ${s?.totals.correct ?? 0} 题`} />
        <Stat label="连续学习" value={`${s?.streak ?? 0} 天`} tone="warn" sub={`最高连击 ${s?.bestCombo ?? 0} 题`} />
        <Stat label="SQL 通关" value={`${s?.levels.passed ?? 0}/${s?.levels.total ?? 45}`} tone="ok" />
      </div>

      {/* ---------- 根因诊断 ---------- */}
      {diagnosis && (
        <Card>
          <SectionTitle
            title="诊断：薄弱点的根因"
            desc="沿依赖图往前找，优先补那些「补了它，后面的问题会一起好」的知识点"
            icon={<TrendingUp size={15} className="text-violet" />}
          />

          {diagnosis.roots.length ? (
            <div className="space-y-2.5">
              {diagnosis.roots.slice(0, 6).map((r: any, i: number) => (
                <div key={r.kid} className="rounded-lg border border-hairline bg-veil/3 p-3">
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
                        <span className="text-[11.5px] font-semibold tabular-nums"
                          style={{ color: masteryColor(r.mastery) }}>
                          {Math.round(r.mastery * 100)}% · {masteryLabel(r.mastery)}
                        </span>
                        <span className="text-[11px] text-fg-faint">{r.attempts} 题样本</span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-fg-mute">{r.reason}</p>
                      {r.symptoms?.length > 0 && (
                        <div className="mt-1.5">
                          <span className="text-[10.5px] text-fg-faint">它拖累的知识点：</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.symptoms.slice(0, 6).map((sym: any) => (
                              <AppLink
                                key={sym.kid}
                                to={`/learn/${sym.kid}`}
                                className="rounded border border-hairline px-1.5 py-0.5 text-[11px] text-fg-soft hover:border-cyan/40 hover:text-cyan"
                              >
                                {sym.title} · {Math.round(sym.mastery * 100)}%
                              </AppLink>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<CheckCircle2 size={22} className="text-ok" />}
              title={diagnosis.summary}
            />
          )}
        </Card>
      )}

      {/* ---------- 学习路径 ---------- */}
      {diagnosis?.path?.length ? (
        <Card>
          <SectionTitle
            title="建议的学习路径"
            desc="按依赖关系做了拓扑排序 —— 保证「先补的排在前面」，顺着往下做就行"
            icon={<Route size={15} className="text-cyan" />}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {diagnosis.path.slice(0, 14).map((p: any, i: number) => (
              <span key={p.kid} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={11} className="text-fg-faint" />}
                <AppLink
                  to={`/learn/${p.kid}`}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[11.5px] transition-colors',
                    p.isGap
                      ? 'border-bad/40 bg-bad-soft text-bad hover:border-bad/60'
                      : 'border-hairline bg-veil/3 text-fg-soft hover:border-cyan/40 hover:text-cyan',
                  )}
                  title={`掌握度 ${Math.round(p.mastery * 100)}%${p.isGap ? ' · 这是缺口' : ''}`}
                >
                  {p.title}
                  <span className="ml-1 tabular-nums opacity-70">{Math.round(p.mastery * 100)}%</span>
                </AppLink>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-fg-faint">
            红色的是薄弱点，其余是它的前置（已掌握，作为复习节点）
          </p>
        </Card>
      ) : null}

      {/* ---------- 明细 ---------- */}
      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-3"
          tabs={[
            { key: 'overview', label: '分类掌握度', icon: <ChartNoAxesColumn size={13} /> },
            { key: 'nodes', label: '薄弱知识点', count: weakNodes.length },
            { key: 'recent', label: '最近作答' },
          ]}
        />

        {tab === 'overview' && (
          radarData.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="var(--color-hairline)" />
                    <PolarAngleAxis
                      dataKey="name"
                      tick={{ fill: 'var(--color-fg-mute)', fontSize: 11 }}
                    />
                    <PolarRadiusAxis
                      angle={90} domain={[0, 100]}
                      tick={{ fill: 'var(--color-fg-faint)', fontSize: 10 }}
                      stroke="var(--color-hairline)"
                    />
                    <Radar
                      name="正确率"
                      dataKey="value"
                      stroke="var(--color-cyan)"
                      fill="var(--color-cyan)"
                      fillOpacity={0.28}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--glass-sheet-strong)',
                        border: '1px solid var(--color-hairline)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: 'var(--color-fg)',
                      }}
                      formatter={(v: any) => [`${v}%`, '正确率']}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {(data?.byCategory || []).map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-[12.5px] text-fg-soft">{c.name}</span>
                    <div className="flex-1"><Progress value={c.accuracy / 100} /></div>
                    <span className="w-20 shrink-0 text-right text-[11.5px] tabular-nums text-fg-mute">
                      {c.accuracy}% · {c.n} 题
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty
              title="还没有作答记录"
              desc="做过题之后，这里会按知识分类显示你的掌握度，并自动标出最该补的那几块。"
              action={<AppLink to="/practice"><Button>去做几道题</Button></AppLink>}
            />
          )
        )}

        {tab === 'nodes' && (
          weakNodes.length ? (
            <div className="space-y-1.5">
              {weakNodes.slice(0, 40).map((n: any) => (
                <div key={n.kid} className="flex items-center gap-3 rounded-lg border border-hairline bg-veil/2 p-2.5">
                  <AppLink to={`/learn/${n.kid}`} className="min-w-0 flex-1 truncate text-[13px] text-fg hover:text-cyan">
                    {n.title}
                  </AppLink>
                  <span className="shrink-0 text-[11px] text-fg-faint">{n.chapterName}</span>
                  <div className="w-24 shrink-0"><Progress value={n.mastery / 100} tone="bad" /></div>
                  <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums"
                    style={{ color: masteryColor(n.mastery / 100) }}>
                    {n.mastery}%
                  </span>
                  <AppLink to={`/practice?kid=${n.kid}`}
                    className="shrink-0 text-[11.5px] text-cyan hover:underline">
                    练
                  </AppLink>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<CheckCircle2 size={22} className="text-ok" />} title="没有掌握度低于 70% 的知识点" />
          )
        )}

        {tab === 'recent' && (
          data?.recent?.length ? (
            <div className="space-y-1">
              {data.recent.slice(0, 30).map((r: any) => (
                <div key={r.id} className="flex items-center gap-2.5 rounded border border-hairline bg-veil/2 px-2.5 py-1.5">
                  {r.correct
                    ? <CheckCircle2 size={13} className="shrink-0 text-ok" />
                    : <CircleAlert size={13} className="shrink-0 text-bad" />}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">
                    {String(r.title || r.refId).slice(0, 60)}
                  </span>
                  <Badge tone="neutral">{r.kind}</Badge>
                  <span className="shrink-0 text-[10.5px] text-fg-faint">{formatDate(r.ts)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="还没有作答记录" />
          )
        )}
      </Card>
    </div>
  );
}
