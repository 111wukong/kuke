/* 复习队列（FSRS 间隔重复）
 *
 * ── 交互的核心：自评四档 ────────────────────────────────────────
 *   忘了 / 吃力 / 记得 / 很熟
 * 这四档直接喂给 FSRS，决定下次什么时候再出现。
 *
 * ★ 一个刻意的设计：不显示"下次复习时间"
 *   显示了会诱导学生按"我想让它晚点再来"去选，而不是按真实记忆程度。
 *   自评的准确性全靠诚实，而任何"按结果反推"的提示都会破坏它。
 *   所以复习完一张卡只给一个轻量反馈（下次间隔），不预告。
 */
import { useMemo, useState } from 'react';
import {
  RotateCcw, Brain, CheckCircle2, ChevronRight, CalendarClock, Sparkles,
} from 'lucide-react';
import { Card, SectionTitle, Badge, Button, Skeleton, Empty, Progress, Callout } from '@/components/ui/Primitives';
import { AppLink } from '@/lib/links';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn } from '@/lib/utils';

interface ReviewItem {
  cardId: string; type: string; state: string; reps: number; lapses: number;
  interval: number; due: string; retrievability: number | null;
  knowledge: { id: string; title: string } | null;
  question: { id: string; stem: string; type: string; options: any } | null;
}

const RATINGS = [
  { r: 1, label: '忘了', desc: '完全想不起来', tone: 'bad' },
  { r: 2, label: '吃力', desc: '想了很久才想起来', tone: 'warn' },
  { r: 3, label: '记得', desc: '稍作回忆就想起来', tone: 'ok' },
  { r: 4, label: '很熟', desc: '一看就知道', tone: 'accent' },
] as const;

export default function Review() {
  const { toast } = useApp();
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<{ rating: number; next: any }[]>([]);
  const [busy, setBusy] = useState(false);

  const { data, loading, reload } = useAsync<{
    items: ReviewItem[]; total: number; upcoming: { due: string; n: number }[];
  }>(
    'study:review',
    () => api.get('/api/study/review'),
    { ttl: 0 },
  );

  const items = data?.items || [];
  const item = items[idx];

  const stats = useMemo(() => {
    const n = done.length;
    const ok = done.filter((d) => d.rating >= 3).length;
    return { n, ok, rate: n ? Math.round((ok / n) * 100) : 0 };
  }, [done]);

  const grade = async (rating: number) => {
    if (!item) return;
    setBusy(true);
    try {
      const r = await api.post<any>(`/api/study/review/${item.cardId}`, { rating });
      setDone((d) => [...d, { rating, next: r.next }]);
      invalidatePrefix('study:');
      if (r.xpGained) { /* 静默加分，不打断节奏 */ }
      setIdx((i) => i + 1);
    } catch (e: any) {
      toast('error', '提交失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Skeleton className="h-96" />;

  const finished = idx >= items.length;

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* ---------- 顶部 ---------- */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <RotateCcw size={17} className="text-warn" />
              复习队列
            </h2>
            <p className="mt-0.5 text-[12px] text-fg-mute">
              FSRS-6 调度。按你上一次的回忆难度决定下次什么时候再出现。
            </p>
          </div>
          {items.length > 0 && (
            <div className="text-right">
              <div className="text-[15px] font-semibold tabular-nums text-fg">
                {Math.min(idx, items.length)}/{items.length}
              </div>
              <div className="text-[10.5px] text-fg-faint">今日到期</div>
            </div>
          )}
        </div>
        {items.length > 0 && (
          <div className="mt-3">
            <Progress value={Math.min(idx, items.length) / items.length} tone="warn" />
          </div>
        )}
      </Card>

      {/* ---------- 复习中 ---------- */}
      {!finished && item && (
        <>
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={item.type === 'mistake' ? 'bad' : 'info'}>
                {item.type === 'mistake' ? '错题' : '知识点'}
              </Badge>
              {item.state === 'new' && <Badge tone="accent">新卡</Badge>}
              {item.state === 'relearning' && <Badge tone="warn">重学中</Badge>}
              {item.reps > 0 && (
                <span className="text-[11px] text-fg-faint">
                  复习过 {item.reps} 次{item.lapses > 0 ? ` · 忘过 ${item.lapses} 次` : ''}
                </span>
              )}
              {item.retrievability !== null && (
                <span className="ml-auto text-[11px] text-fg-mute">
                  当前可回忆概率 ≈ {Math.round(item.retrievability * 100)}%
                </span>
              )}
            </div>

            {item.question ? (
              <div>
                <div className="text-[15px] font-medium leading-relaxed text-fg">{item.question.stem}</div>
                {item.question.options?.length ? (
                  <div className="mt-3 space-y-1">
                    {item.question.options.map((o: any) => (
                      <div key={o.key} className="rounded border border-hairline bg-veil/2 px-3 py-1.5 text-[13px] text-fg-soft">
                        <span className="mr-2 font-semibold text-cyan">{o.key}</span>{o.text}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : item.knowledge ? (
              <div>
                <div className="text-[11.5px] text-fg-faint">回忆一下这个知识点讲的是什么</div>
                <div className="mt-1 text-[17px] font-semibold text-fg">{item.knowledge.title}</div>
                <AppLink
                  to={`/learn/${item.knowledge.id}`}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] text-cyan hover:underline"
                >
                  打开知识点<ChevronRight size={12} />
                </AppLink>
              </div>
            ) : (
              <div className="text-[13px] text-fg-mute">这张卡没有关联内容</div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="刚才想起来的难度"
              desc="按真实情况选 —— 选得准，后面的复习节奏才排得对"
              icon={<Brain size={15} className="text-cyan" />}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RATINGS.map((r) => (
                <button
                  key={r.r}
                  disabled={busy}
                  onClick={() => grade(r.r)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border py-3.5 transition-colors disabled:opacity-50',
                    r.tone === 'bad' ? 'border-bad/30 hover:bg-bad-soft'
                      : r.tone === 'warn' ? 'border-warn/30 hover:bg-warn-soft'
                        : r.tone === 'ok' ? 'border-ok/30 hover:bg-ok-soft'
                          : 'border-cyan/30 hover:bg-cyan/10',
                  )}
                >
                  <span className={cn(
                    'text-[14px] font-semibold',
                    r.tone === 'bad' ? 'text-bad' : r.tone === 'warn' ? 'text-warn'
                      : r.tone === 'ok' ? 'text-ok' : 'text-cyan',
                  )}>
                    {r.label}
                  </span>
                  <span className="text-[10.5px] text-fg-faint">{r.desc}</span>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* ---------- 复习完 ---------- */}
      {finished && items.length > 0 && (
        <Card>
          <div className="py-4 text-center">
            <CheckCircle2 size={36} className="mx-auto text-ok" />
            <div className="mt-2 text-[17px] font-semibold text-fg">今天的复习清完了</div>
            <div className="mt-1 text-[13px] text-fg-soft">
              复习了 {stats.n} 张卡，其中 {stats.ok} 张记得（{stats.rate}%）
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <AppLink
                to="/practice"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg btn-accent px-4 text-[13px] font-medium"
              >
                去练新题
              </AppLink>
              <Button variant="outline" onClick={() => { setIdx(0); setDone([]); reload(); }}>
                重新检查队列
              </Button>
            </div>
          </div>

          {done.length > 0 && (
            <div className="mt-3 border-t border-hairline pt-3">
              <div className="mb-2 text-[11.5px] font-medium text-fg-mute">这一轮排出的下次复习</div>
              <div className="flex flex-wrap gap-1.5">
                {done.map((d, i) => (
                  <span
                    key={i}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[11px] tabular-nums',
                      d.rating === 1 ? 'border-bad/30 text-bad' : 'border-hairline text-fg-mute',
                    )}
                  >
                    {d.rating === 1 ? '忘了' : d.rating === 2 ? '吃力' : d.rating === 3 ? '记得' : '很熟'}
                    {' → '}
                    {d.next?.interval ?? 0} 天后
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ---------- 空队列 ---------- */}
      {finished && !items.length && (
        <Card>
          <Empty
            icon={<CheckCircle2 size={26} className="text-ok" />}
            title="复习队列是空的"
            desc="没有到期的卡片。答错的题会自动排进来，你也可以在知识点页手动加入。"
            action={(
              <div className="flex gap-2">
                <AppLink to="/practice" sameTab className="text-cyan hover:underline">去练新题</AppLink>
                <AppLink to="/mistakes" sameTab className="text-cyan hover:underline">看错题本</AppLink>
              </div>
            )}
          />
        </Card>
      )}

      {/* ---------- 未来安排 ---------- */}
      {data?.upcoming?.length ? (
        <Card>
          <SectionTitle
            title="接下来几天"
            desc={`队列里共 ${data.total} 张卡，下面是还没到期的`}
            icon={<CalendarClock size={15} className="text-fg-mute" />}
          />
          <div className="flex flex-wrap gap-2">
            {data.upcoming.map((u) => (
              <div key={u.due} className="rounded-lg border border-hairline bg-veil/2 px-2.5 py-1.5">
                <div className="text-[11px] text-fg-faint">{u.due.slice(5)}</div>
                <div className="text-[13px] font-semibold tabular-nums text-fg-soft">{u.n} 张</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Callout tone="info" title="关于间隔重复">
        <div className="flex items-start gap-2">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <div>
            每张卡有一个「稳定度」（记忆能保持多少天）和一个「难度」（这张卡对你有多难）。
            每次复习都用遗忘曲线反推你现在的回忆概率，再据此调整。
            效果是：同样多的复习次数，时间会更多地花在快忘掉的卡上。
          </div>
        </div>
      </Callout>
    </div>
  );
}
