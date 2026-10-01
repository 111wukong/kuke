/* 索引与事务实验台
 *
 * ── 这个页面的答案不是"我写的"，是引擎给的 ──────────────────────
 * 索引题的判定走的是真实 EXPLAIN QUERY PLAN：
 * 服务端对每个选项真的建一次索引、真的问一次优化器，
 * 然后把执行计划原样回给前端。
 * 所以页面上会把每条计划展示出来 —— 学生不只是在"对答案"，
 * 而是在看数据库自己怎么说。
 *
 * 事务题的判定走优先图：服务端按冲突操作建图、检测环。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  FlaskConical, Table2, GitBranch, CheckCircle2, XCircle, Lightbulb,
  ArrowRight, Zap, Info,
} from 'lucide-react';
import { Card, SectionTitle, Badge, Button, Empty, Tabs, DifficultyDots, SplitSkeleton } from '@/components/ui/Primitives';
import { Markdown } from '@/lib/markdown';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn } from '@/lib/utils';

interface LabBrief { id: string; kind: 'index' | 'txn'; title: string; difficulty: number; kid: string; solved: boolean }

export default function Labs() {
  const { toast } = useApp();
  const [kind, setKind] = useState<'index' | 'txn'>('index');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading } = useAsync<{ labs: LabBrief[] }>(
    'catalog:labs',
    () => api.get('/api/catalog/labs'),
    { ttl: 10000 },
  );

  const list = useMemo(() => (data?.labs || []).filter((l) => l.kind === kind), [data, kind]);
  const lab = useMemo(() => list.find((l) => l.id === activeId) || list[0], [list, activeId]);

  const { data: detail } = useAsync<any>(
    lab ? `catalog:lab:${lab.id}` : 'noop:skip',
    () => api.get(`/api/catalog/labs/${lab.id}`),
    { ttl: 60000, enabled: !!lab },
  );

  useEffect(() => {
    setPick('');
    setResult(null);
  }, [lab?.id]);

  const submit = async () => {
    if (!pick) { toast('warn', '先选一个答案'); return; }
    setBusy(true);
    try {
      const r = await api.post<any>(`/api/sql/labs/${lab!.id}/submit`, { pick });
      setResult(r);
      invalidatePrefix('catalog:labs');
      invalidatePrefix('study:');
      if (r.pass) toast('ok', '判断正确', r.xpGained ? `+${r.xpGained} XP` : undefined);
      else toast('error', '不对', '看看下面的执行计划，数据库自己给出了答案');
    } catch (e: any) {
      toast('error', '提交失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <SplitSkeleton mainHeight={320} />;
  }

  const payload = detail?.lab?.payload || {};
  const solvedCount = (data?.labs || []).filter((l) => l.kind === kind && l.solved).length;

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      {/* ---------- 左 ---------- */}
      <div className="space-y-3">
        <Card>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <FlaskConical size={16} className="text-emerald" />
            实验台
          </h2>
          <p className="mt-0.5 text-[11.5px] text-fg-mute">
            已解出 {solvedCount}/{list.length}
          </p>
          <div className="mt-3">
            <Tabs
              value={kind}
              onChange={(k) => { setKind(k); setActiveId(null); }}
              tabs={[
                { key: 'index', label: '索引', icon: <Table2 size={13} /> },
                { key: 'txn', label: '事务', icon: <GitBranch size={13} /> },
              ]}
            />
          </div>
        </Card>

        <Card padded={false} className="overflow-hidden">
          <div className="p-2">
            {list.map((l) => {
              const active = l.id === lab?.id;
              return (
                <button
                  key={l.id}
                  onClick={() => setActiveId(l.id)}
                  className={cn(
                    'mb-1 flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
                    active ? 'border-cyan/50 bg-cyan/10'
                      : l.solved ? 'border-ok/25 bg-ok-soft hover:border-ok/40'
                        : 'border-hairline bg-veil/2 hover:border-cyan/30 hover:bg-veil/6',
                  )}
                >
                  {l.solved
                    ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                    : <FlaskConical size={14} className="mt-0.5 shrink-0 text-fg-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-fg">{l.title}</div>
                    <DifficultyDots value={l.difficulty} />
                  </div>
                </button>
              );
            })}
            {!list.length && <div className="p-4 text-center text-[12px] text-fg-faint">这一栏还没有题目</div>}
          </div>
        </Card>
      </div>

      {/* ---------- 右 ---------- */}
      {!lab ? (
        <Card><Empty title="还没有实验" /></Card>
      ) : (
        <div className="space-y-3">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={kind === 'index' ? 'accent' : 'info'}>
                {kind === 'index' ? '索引实验' : '事务实验'}
              </Badge>
              <h2 className="text-[16px] font-semibold text-fg">{lab.title}</h2>
            </div>
            <Markdown source={detail?.lab?.brief || ''} />

            {/* 索引实验：把查询和数据集亮出来 */}
            {kind === 'index' && payload.query && (
              <div className="mt-3 rounded-lg border border-hairline bg-veil/3 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-fg-faint">
                  <Zap size={11} />要分析的查询
                  {detail?.lab?.dataset && (
                    <span className="ml-1 normal-case text-fg-mute">· {detail.lab.dataset.title}</span>
                  )}
                </div>
                <pre className="overflow-x-auto font-mono text-[12.5px] text-cyan">{payload.query}</pre>
              </div>
            )}

            {/* 事务实验：把调度表画出来 */}
            {kind === 'txn' && payload.schedule && (
              <div className="mt-3 overflow-hidden rounded-lg border border-hairline">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="bg-veil/6">
                      <th className="border-b border-hairline px-3 py-1.5 text-left font-medium text-fg-mute">顺序</th>
                      <th className="border-b border-hairline px-3 py-1.5 text-left font-medium text-fg-mute">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.schedule.map((op: any, i: number) => (
                      <tr key={i} className="odd:bg-veil/2">
                        <td className="border-b border-hairline px-3 py-1.5 tabular-nums text-fg-faint">{i + 1}</td>
                        <td className="border-b border-hairline px-3 py-1.5 font-mono text-fg">
                          <span className={op.op === 'w' ? 'text-bad' : 'text-cyan'}>{op.op}</span>
                          <sub className="text-fg-mute">{op.t.replace('T', '')}</sub>
                          <span className="text-fg-soft">({op.item})</span>
                          {op.op === 'w' && <span className="ml-2 text-[11px] text-fg-mute">写</span>}
                          {op.op === 'r' && <span className="ml-2 text-[11px] text-fg-mute">读</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ---------- 选项 ---------- */}
          <Card>
            <SectionTitle title="选一个" />
            <div className="space-y-2">
              {(payload.options || []).map((o: any) => {
                const label = o.label || o.text || '';
                const on = pick === o.key;
                const isCorrect = result && result.correctKeys?.includes(o.key);
                const isWrongPick = result && on && !isCorrect;
                return (
                  <button
                    key={o.key}
                    disabled={!!result}
                    onClick={() => setPick(o.key)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-default',
                      isCorrect ? 'border-ok/50 bg-ok-soft'
                        : isWrongPick ? 'border-bad/50 bg-bad-soft'
                          : on ? 'border-cyan/50 bg-cyan/10'
                            : 'border-hairline bg-veil/2 hover:border-cyan/40 hover:bg-cyan/5',
                    )}
                  >
                    <span className={cn(
                      'grid h-5 w-5 shrink-0 place-items-center rounded border text-[11px] font-semibold',
                      on || isCorrect ? 'border-transparent bg-cyan text-[var(--color-on-cyan)]' : 'border-hairline text-fg-mute',
                      isCorrect && 'bg-ok',
                      isWrongPick && 'bg-bad',
                    )}>
                      {o.key}
                    </span>
                    <span className={cn(
                      'min-w-0 flex-1 break-all text-[13px] leading-relaxed text-fg-soft',
                      o.ddl && 'font-mono text-[12.5px]',
                    )}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end">
              <Button variant="accent" onClick={submit} loading={busy} disabled={!pick || !!result}>
                提交判断
              </Button>
            </div>
          </Card>

          {/* ---------- 结果 + 执行计划 ---------- */}
          {result && (
            <>
              <Card className={cn('border-l-2', result.pass ? 'border-l-ok' : 'border-l-bad')}>
                <div className="flex items-start gap-2.5">
                  {result.pass
                    ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />
                    : <XCircle size={18} className="mt-0.5 shrink-0 text-bad" />}
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-[14px] font-semibold', result.pass ? 'text-ok' : 'text-bad')}>
                      {result.pass ? '判断正确' : '判断不对'}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-fg-soft">
                      正确答案：<span className="font-mono font-semibold">{result.correctKeys?.join(' 或 ')}</span>
                    </div>
                    {result.xpGained > 0 && (
                      <div className="mt-1 text-[12px] text-amber">+{result.xpGained} XP</div>
                    )}
                  </div>
                </div>
              </Card>

              {/* 索引实验：展示真实的执行计划 */}
              {kind === 'index' && result.plans?.length > 0 && (
                <Card>
                  <SectionTitle
                    title="数据库自己怎么说"
                    desc="下面每一条都是对这个选项真的跑了一次 EXPLAIN QUERY PLAN 得到的输出"
                    icon={<Info size={15} className="text-cyan" />}
                  />
                  <div className="space-y-2">
                    {result.plans.map((p: any) => (
                      <div
                        key={p.key}
                        className={cn(
                          'rounded-lg border p-2.5',
                          p.usesIndex ? 'border-ok/30 bg-ok-soft' : 'border-hairline bg-veil/2',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="grid h-5 w-5 place-items-center rounded bg-veil/10 text-[11px] font-semibold text-fg-soft">
                            {p.key}
                          </span>
                          <span className="break-all font-mono text-[11.5px] text-fg-mute">{p.label}</span>
                          {p.usesIndex
                            ? <Badge tone="ok">走索引</Badge>
                            : <Badge tone="neutral">全表扫描</Badge>}
                        </div>
                        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-fg-soft">
                          {p.detail}
                        </pre>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {result.explanation && (
                <Card>
                  <SectionTitle title="为什么" icon={<Lightbulb size={15} className="text-warn" />} />
                  <Markdown source={result.explanation} />
                </Card>
              )}
            </>
          )}

          {!result && (
            <div className="flex items-center justify-center gap-1.5 text-[11.5px] text-fg-faint">
              提交后会把真实的执行计划展示出来
              <ArrowRight size={11} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
