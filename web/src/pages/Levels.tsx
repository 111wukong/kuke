/* SQL 闯关：列表 + 做题页
 *
 * ── 为什么关卡要"闯"而不是"随便挑" ──────────────────────────────
 * 45 道关卡按难度递增排，前面的概念在后面反复用到。
 * 但**不锁关** —— 锁关会让"我就想练 JOIN"的学生被迫先做完
 * 10 道单表查询。所以是"推荐顺序"而不是"强制顺序"。
 * 视觉上把已通过的标绿、未通过的保持中性，学生自己看得见进度。
 */
import { useState, useMemo, useEffect } from 'react';
import { usePageParams } from '@/components/layout/KeepAlivePages';
import {
  Flag, CheckCircle2, Circle, ChevronLeft, ChevronRight, Play, Lightbulb,
  Eye, Trophy, Sparkles, AlertTriangle, ArrowLeft,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Skeleton, Empty, Progress, Callout, DifficultyDots,
} from '@/components/ui/Primitives';
import { SqlEditor } from '@/components/sql/SqlEditor';
import { ResultTable, SchemaBrowser } from '@/components/sql/SqlParts';
import { Markdown } from '@/lib/markdown';
import { AppLink } from '@/lib/links';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn } from '@/lib/utils';

/* ============================================================
   列表页
   ============================================================ */

interface LevelBrief {
  id: string; datasetId: string; chapterId: string; kid: string; seq: number;
  title: string; difficulty: number; orderMatters: boolean; passed: boolean; attempts: number;
}

export function Levels() {
  const { data, loading } = useAsync<{ levels: LevelBrief[] }>(
    'catalog:levels',
    () => api.get('/api/catalog/levels'),
    { ttl: 10000 },
  );

  const byDataset = useMemo(() => {
    const m = new Map<string, LevelBrief[]>();
    for (const l of data?.levels || []) {
      if (!m.has(l.datasetId)) m.set(l.datasetId, []);
      m.get(l.datasetId)!.push(l);
    }
    return m;
  }, [data]);

  const passed = (data?.levels || []).filter((l) => l.passed).length;
  const total = data?.levels.length || 0;

  if (loading && !data) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>;
  }

  const DS_NAME: Record<string, string> = {
    school: '学生选课库', shop: '电商订单库', library: '图书借阅库', company: '员工部门库',
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <Flag size={17} className="text-cyan" />
              SQL 闯关
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-mute">
              从单表查询一路做到窗口函数。判题靠**跑结果集**，不比对 SQL 文本 ——
              同一个答案怎么写都算对。
            </p>
          </div>
          <div className="min-w-[160px]">
            <div className="mb-1 flex items-baseline justify-between text-[12px]">
              <span className="text-fg-soft">通关进度</span>
              <span className="tabular-nums text-fg-mute">{passed}/{total}</span>
            </div>
            <Progress value={total ? passed / total : 0} tone="ok" />
          </div>
        </div>
      </Card>

      {[...byDataset.entries()].map(([dsId, list]) => {
        const done = list.filter((l) => l.passed).length;
        return (
          <Card key={dsId}>
            <SectionTitle
              title={DS_NAME[dsId] || dsId}
              desc={`${list.length} 关，已通过 ${done} 关`}
              right={<Badge tone={done === list.length ? 'ok' : 'neutral'}>{done}/{list.length}</Badge>}
            />
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((l) => (
                <AppLink
                  key={l.id}
                  to={`/levels/${l.id}`}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-lg border p-2.5 transition-colors',
                    l.passed
                      ? 'border-ok/30 bg-ok-soft hover:border-ok/50'
                      : 'border-hairline bg-veil/2 hover:border-cyan/40 hover:bg-cyan/5',
                  )}
                >
                  {l.passed
                    ? <CheckCircle2 size={15} className="shrink-0 text-ok" />
                    : <Circle size={15} className="shrink-0 text-fg-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-mono text-fg-faint">#{l.seq}</span>
                      <span className="truncate text-[12.5px] font-medium text-fg group-hover:text-cyan">
                        {l.title}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <DifficultyDots value={l.difficulty} />
                      {l.orderMatters && <span className="text-[10px] text-warn">要求行序</span>}
                      {l.attempts > 0 && !l.passed && (
                        <span className="text-[10px] text-fg-faint">试过 {l.attempts} 次</span>
                      )}
                    </div>
                  </div>
                </AppLink>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ============================================================
   做题页
   ============================================================ */

interface LevelDetailData {
  level: {
    id: string; datasetId: string; datasetTitle: string; datasetDescription: string;
    chapterId: string; kid: string; seq: number; title: string; brief: string;
    hint: string; starterSql: string; difficulty: number;
    orderMatters: boolean; requireColumns: boolean; hasCheckSql: boolean;
  };
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

export function LevelDetail() {
  const { id } = usePageParams<{ id: string }>();
  const { toast } = useApp();
  const [sql, setSql] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verdict, setVerdict] = useState<any>(null);
  const [showHint, setShowHint] = useState(false);
  const [solution, setSolution] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());

  const { data, loading, error } = useAsync<LevelDetailData>(
    `catalog:level:${id}`,
    () => api.get(`/api/catalog/levels/${id}`),
    { ttl: 60000 },
  );

  const { data: dsData } = useAsync<{ datasets: any[] }>(
    'catalog:datasets',
    () => api.get('/api/catalog/datasets'),
    { ttl: 600000 },
  );

  const tables = useMemo(() => {
    const ds = dsData?.datasets?.find((d) => d.id === data?.level.datasetId);
    return ds?.tables || [];
  }, [dsData, data]);

  // 换关卡时重置状态
  useEffect(() => {
    if (data?.level) {
      setSql(data.level.starterSql || '');
      setVerdict(null);
      setShowHint(false);
      setSolution(null);
    }
  }, [data?.level.id, data?.level]);

  const submit = async () => {
    if (!sql.trim()) { toast('warn', '先写点 SQL 再提交'); return; }
    setSubmitting(true);
    try {
      const r = await api.post<any>(`/api/sql/levels/${id}/submit`, {
        sql,
        usedHint: showHint,
        durationMs: Date.now() - startedAt,
      });
      setVerdict(r);
      invalidatePrefix('catalog:levels');
      invalidatePrefix('study:');

      if (r.pass) {
        toast('ok', r.alreadyPassed ? '再次通过' : '过关！',
          r.xpGained ? `+${r.xpGained} XP` : undefined);
        if (r.unlocked?.length) {
          toast('ok', '解锁了成就', r.unlocked.join('、'));
        }
      } else {
        toast('error', '还没通过', r.message);
      }
    } catch (e: any) {
      toast('error', '提交失败', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const reveal = async () => {
    try {
      const r = await api.get<{ reference: string }>(`/api/sql/levels/${id}/solution`);
      setSolution(r.reference);
      toast('info', '参考答案已显示', '对照着看，重点是想清楚它为什么这么写');
    } catch (e: any) {
      toast('warn', '暂时看不了', e.message);
    }
  };

  if (loading && !data) {
    return (
      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <Empty title="关卡不存在" desc={error?.message}
          action={<AppLink to="/levels" sameTab className="text-cyan hover:underline">返回关卡列表</AppLink>} />
      </Card>
    );
  }

  const L = data.level;

  return (
    <div className="space-y-3">
      {/* ---------- 顶部导航 ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AppLink to="/levels" sameTab className="inline-flex items-center gap-1 text-[12.5px] text-fg-mute hover:text-cyan">
            <ArrowLeft size={13} />关卡列表
          </AppLink>
          <span className="text-fg-faint">/</span>
          <span className="text-[12.5px] text-fg-soft">{L.datasetTitle}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {data.prev && (
            <AppLink to={`/levels/${data.prev.id}`} sameTab
              className="inline-flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[12px] text-fg-soft hover:bg-veil/6">
              <ChevronLeft size={13} />上一关
            </AppLink>
          )}
          {data.next && (
            <AppLink to={`/levels/${data.next.id}`} sameTab
              className="inline-flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[12px] text-fg-soft hover:bg-veil/6">
              下一关<ChevronRight size={13} />
            </AppLink>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {/* ---------- 题面 ---------- */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-fg-faint">#{L.seq}</span>
              <h1 className="text-[17px] font-semibold text-fg">{L.title}</h1>
              <DifficultyDots value={L.difficulty} />
              {L.orderMatters && <Badge tone="warn">要求行序</Badge>}
              {L.requireColumns && <Badge tone="info">要求列名</Badge>}
              {L.hasCheckSql && <Badge tone="accent">写操作题</Badge>}
            </div>
            <Markdown source={L.brief} />

            {showHint && L.hint && (
              <Callout tone="warn" title="提示" className="mt-3">
                <code className="inline-code">{L.hint}</code>
              </Callout>
            )}
          </Card>

          {/* ---------- 编辑器 ---------- */}
          <SqlEditor
            value={sql}
            onChange={setSql}
            onRun={submit}
            running={submitting}
            minRows={7}
            maxRows={18}
            onHint={() => setShowHint(true)}
            onReveal={reveal}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="accent" onClick={submit} loading={submitting}>
              <Play size={14} />提交答案
            </Button>
            <span className="text-[11.5px] text-fg-faint">
              提交后会跑参考答案和你的答案，比对结果集
            </span>
          </div>

          {/* ---------- 判定结果 ---------- */}
          {verdict && (
            <Card className={cn(
              'border-l-2',
              verdict.pass ? 'border-l-ok' : 'border-l-bad',
            )}>
              <div className="flex items-start gap-2.5">
                {verdict.pass
                  ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />
                  : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" />}
                <div className="min-w-0 flex-1">
                  <div className={cn('text-[14px] font-semibold', verdict.pass ? 'text-ok' : 'text-bad')}>
                    {verdict.pass ? (verdict.alreadyPassed ? '通过（重复提交不重复给分）' : '过关！') : '还没通过'}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-fg-soft">
                    {verdict.message}
                  </pre>

                  {verdict.xpGained > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[12px] text-amber">
                      <Sparkles size={12} />+{verdict.xpGained} XP
                      {verdict.firstTry && <Badge tone="ok">首次通过</Badge>}
                    </div>
                  )}

                  {verdict.unlocked?.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-violet">
                      <Trophy size={12} />解锁成就：{verdict.unlocked.join('、')}
                    </div>
                  )}
                </div>
              </div>

              {/* 你的结果 vs 期望结果 */}
              {verdict.actual && (
                <div className="mt-3 space-y-2">
                  <div className="text-[12px] font-medium text-fg-soft">你的结果</div>
                  <ResultTable rs={{
                    sql: '', columns: verdict.actual.columns, rows: verdict.actual.rows,
                  }} maxHeight={200} />
                  {verdict.expected && !verdict.pass && (
                    <>
                      <div className="text-[12px] font-medium text-fg-soft">
                        期望的结果（参考答案跑出来的）
                      </div>
                      <ResultTable rs={{
                        sql: '', columns: verdict.expected.columns, rows: verdict.expected.rows,
                      }} maxHeight={200} />
                    </>
                  )}
                </div>
              )}

              {verdict.reference && (
                <div className="mt-3">
                  <div className="mb-1 text-[12px] font-medium text-fg-soft">参考答案</div>
                  <pre className="code-block p-3 font-mono text-[12px] text-fg-soft">{verdict.reference}</pre>
                </div>
              )}
            </Card>
          )}

          {solution && (
            <Card>
              <SectionTitle
                title="参考答案"
                desc="注意：看答案之前先想清楚自己卡在哪一步，不然这一关就白做了"
                icon={<Eye size={15} className="text-cyan" />}
              />
              <pre className="code-block overflow-x-auto p-3 font-mono text-[12px] text-fg-soft">{solution}</pre>
            </Card>
          )}
        </div>

        {/* ---------- 右栏 ---------- */}
        <div className="space-y-3">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-3.5 py-2.5">
              <div className="text-[12.5px] font-medium text-fg">{L.datasetTitle}</div>
              <p className="mt-0.5 text-[10.5px] text-fg-faint">点表名或列名插入到编辑器</p>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2.5">
              <SchemaBrowser tables={tables} onInsert={(t) => setSql((v) => `${v}${t}`)} />
            </div>
          </Card>

          {!showHint && L.hint && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowHint(true)}>
              <Lightbulb size={13} />看提示
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
