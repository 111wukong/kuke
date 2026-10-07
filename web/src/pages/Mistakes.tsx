/* 错题本
 *
 * ── 错题的口径：曾经答错、且至今没答对过 ────────────────────────
 * 不是"最后一次答错"。一道题错了三次、第四次对了，它不该还挂在这里。
 * 反过来，第一次对了、后来错了 —— 也算错题（说明忘了）。
 * 所以判定条件是 MAX(correct) = 0。
 *
 * 这个口径页面上要写清楚。学生看到一道题"明明答对了还在这"，
 * 会以为系统坏了。
 */
import { useMemo, useState } from 'react';
import {
  CircleAlert, ArrowRight, RotateCcw, Terminal, Sigma, FlaskConical,
  HelpCircle, Filter, TrendingDown,
} from 'lucide-react';
import { Card, SectionTitle, Badge, Button, TableSkeleton, Empty, Tabs, Progress } from '@/components/ui/Primitives';
import { AppLink } from '@/lib/links';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Mistake {
  refId: string; kind: string; type: string; title: string;
  kid: string; kidTitle: string; tries: number; lastTs: number; errorType: string;
}

const KIND_ICON: Record<string, any> = {
  question: HelpCircle, level: Terminal, normalize: Sigma, lab: FlaskConical,
};

const KIND_LABEL: Record<string, string> = {
  question: '客观题', level: 'SQL 关卡', normalize: '范式题', lab: '实验台',
};

const ERROR_LABEL: Record<string, string> = {
  concept: '概念混淆',
  recall: '记错/算错',
  unanswered: '没作答',
  forget: '遗忘了',
  syntax: '语法错误',
  wrong: '答案错误',
};

/** 错题回跳的目标。不同 kind 的题在不同的页面里。 */
function targetOf(m: Mistake): { to: string; label: string } {
  if (m.kind === 'level') return { to: `/levels/${m.refId}`, label: '重做这一关' };
  if (m.kind === 'normalize') return { to: '/normalize', label: '去范式实验室' };
  if (m.kind === 'lab') return { to: '/lab', label: '去实验台' };
  return { to: `/practice?kid=${m.kid}`, label: '练同考点的题' };
}

export default function Mistakes() {
  const [filter, setFilter] = useState<'all' | 'question' | 'level' | 'normalize' | 'lab'>('all');

  const { data, loading, error, reload } = useAsync<{
    mistakes: Mistake[]; total: number; byError: { error_type: string; n: number }[];
  }>(
    'study:mistakes',
    () => api.get('/api/study/mistakes?limit=200'),
    { ttl: 5000 },
  );

  const list = useMemo(
    () => (data?.mistakes || []).filter((m) => filter === 'all' || m.kind === filter),
    [data, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.mistakes.length || 0 };
    for (const m of data?.mistakes || []) c[m.kind] = (c[m.kind] || 0) + 1;
    return c;
  }, [data]);

  /** 按考点聚合，找出"错得最集中的地方"。这比按时间排序有用得多 ——
   *  错题本的价值不在于逐条消灭，而在于看出自己卡在哪个概念上。 */
  const byKid = useMemo(() => {
    const m = new Map<string, { kid: string; title: string; n: number }>();
    for (const x of data?.mistakes || []) {
      if (!x.kid) continue;
      if (!m.has(x.kid)) m.set(x.kid, { kid: x.kid, title: x.kidTitle || x.kid, n: 0 });
      m.get(x.kid)!.n++;
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [data]);

  if (loading && !data) return <TableSkeleton rows={6} cols={4} />;
  if (error) return <Card><Empty title="加载失败" desc={error.message} action={<Button onClick={reload}>重试</Button>} /></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <CircleAlert size={17} className="text-bad" />
              错题本
            </h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-fg-mute">
              这里放的是「<b className="text-fg-soft">曾经答错、而且至今没有答对过</b>」的题。
              答错一次之后又答对了的题会自动从这里消失 —— 所以清单会自己变短。
            </p>
          </div>
          {data && data.total > 0 && (
            <div className="text-right">
              <div className="text-[26px] font-semibold tabular-nums text-bad">{data.total}</div>
              <div className="text-[12px] text-fg-faint">道待消化</div>
            </div>
          )}
        </div>

        {data?.byError?.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-[12px] text-fg-mute">
              <TrendingDown size={12} />错因分布
            </span>
            {data.byError.map((e) => (
              <Badge key={e.error_type} tone={e.error_type === 'concept' ? 'bad' : 'warn'}>
                {ERROR_LABEL[e.error_type] || e.error_type} · {e.n}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ---------- 按考点聚合 ---------- */}
      {byKid.length > 0 && (
        <Card>
          <SectionTitle
            title="错得最集中的考点"
            desc="错题本的价值不在于逐条消灭，而在于看出自己卡在哪个概念上"
            icon={<Filter size={15} className="text-warn" />}
          />
          <div className="space-y-2">
            {byKid.slice(0, 5).map((k) => (
              <div key={k.kid} className="flex items-center gap-3">
                <AppLink to={`/learn/${k.kid}`} className="w-40 shrink-0 truncate text-[12.5px] text-fg hover:text-cyan">
                  {k.title}
                </AppLink>
                <div className="flex-1">
                  <Progress value={k.n / Math.max(1, byKid[0].n)} tone="bad" />
                </div>
                <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-fg-mute">{k.n} 道</span>
                <AppLink
                  to={`/practice?kid=${k.kid}`}
                  className="shrink-0 text-[12px] text-cyan hover:underline"
                >
                  去练
                </AppLink>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ---------- 清单 ---------- */}
      <Card>
        <Tabs
          value={filter}
          onChange={setFilter}
          className="mb-3"
          tabs={[
            { key: 'all', label: '全部', count: counts.all },
            { key: 'question', label: '客观题', count: counts.question },
            { key: 'level', label: 'SQL 关卡', count: counts.level },
            { key: 'normalize', label: '范式题', count: counts.normalize },
            { key: 'lab', label: '实验台', count: counts.lab },
          ]}
        />

        {list.length ? (
          <div className="space-y-1.5">
            {list.map((m) => {
              const Icon = KIND_ICON[m.kind] || HelpCircle;
              const t = targetOf(m);
              return (
                <div
                  key={`${m.kind}-${m.refId}`}
                  className="flex items-start gap-3 rounded-lg border border-hairline bg-veil/2 p-3"
                >
                  <Icon size={15} className="mt-0.5 shrink-0 text-bad" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium text-fg">{m.title}</span>
                      <Badge tone="neutral">{KIND_LABEL[m.kind] || m.kind}</Badge>
                      {m.errorType && ERROR_LABEL[m.errorType] && (
                        <Badge tone={m.errorType === 'concept' ? 'bad' : 'warn'}>
                          {ERROR_LABEL[m.errorType]}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-mute">
                      {m.kidTitle && (
                        <AppLink to={`/learn/${m.kid}`} className="hover:text-cyan">
                          {m.kidTitle}
                        </AppLink>
                      )}
                      <span>错了 {m.tries} 次</span>
                      <span>{formatDate(m.lastTs)}</span>
                    </div>
                  </div>
                  <AppLink
                    to={t.to}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline px-2 py-1 text-[12px] text-fg-soft hover:border-cyan/40 hover:text-cyan"
                  >
                    {t.label}
                    <ArrowRight size={11} />
                  </AppLink>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={<CircleAlert size={24} />}
            title={filter === 'all' ? '错题本是空的' : '这一类没有错题'}
            desc={filter === 'all' ? '要么你还没做过题，要么你把错的都改对了 —— 两种都挺好。' : undefined}
            action={filter === 'all'
              ? <AppLink to="/practice" sameTab className="text-cyan hover:underline">去练几道</AppLink>
              : undefined}
          />
        )}
      </Card>

      {list.length > 0 && (
        <div className="text-center">
          <AppLink
            to="/review"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-cyan hover:underline"
          >
            <RotateCcw size={13} />
            按间隔重复复习这些题
          </AppLink>
        </div>
      )}
    </div>
  );
}
