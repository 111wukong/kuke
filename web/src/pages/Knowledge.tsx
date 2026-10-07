/* 知识树
 *
 * ── 用「依赖关系」而不是「章节顺序」做主要入口 ──────────────────
 * 章节顺序是教材的写法（线性），但学生的真实困境是
 * "我该先学哪个"。所以这个页面除了按分类浏览，
 * 还提供一个"可学性"视图：前置都掌握了的排在前面。
 *
 * 这不是替代教材顺序，是多给一个视角 ——
 * 复习和补漏时，"可学性"比"第几章"有用得多。
 */
import { useMemo, useState } from 'react';
import { Network, Search, ChevronRight, CheckCircle2, Circle, Lock, ListTree, Sparkles } from 'lucide-react';
import { Card, SectionTitle, Badge, Input, Skeleton, Empty, Tabs, Progress } from '@/components/ui/Primitives';
import { AppLink } from '@/lib/links';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface KNode { id: string; title: string; summary: string; difficulty: number; importance: number; tags: string[] }
interface Chapter { id: string; name: string; summary: string; knowledge: KNode[] }
interface Category { id: string; name: string; color: string; description: string; chapters: Chapter[] }

export default function Knowledge() {
  const [tab, setTab] = useState<'outline' | 'ready'>('outline');
  const [q, setQ] = useState('');

  const { data, loading, error, reload } = useAsync<{ categories: Category[]; stats: any }>(
    'catalog:tree',
    () => api.get('/api/catalog/tree'),
    { ttl: 300000 },
  );

  const { data: statData } = useAsync<{ nodes: any[] }>(
    'study:stats',
    () => api.get('/api/study/stats'),
    { ttl: 20000 },
  );

  const masteryMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of statData?.nodes || []) m.set(n.kid, n.mastery / 100);
    return m;
  }, [statData]);

  const { data: diagData } = useAsync<{ diagnosis: any }>(
    'study:diagnose',
    () => api.get('/api/study/diagnose'),
    { ttl: 30000 },
  );

  /* 「可学性」排序：前置都已掌握的知识点排前面。
   * 数据从诊断接口的 path 里拿不到全部，所以这里直接用
   * 依赖边自己算一遍 —— 比再开一个接口便宜。 */
  const readyList = useMemo(() => {
    const all: KNode[] = (data?.categories || []).flatMap((c) => c.chapters.flatMap((ch) => ch.knowledge));
    const edges = (data as any)?.edges || [];
    const prereq = new Map<string, string[]>();
    for (const e of edges) {
      if (e.type !== 'prereq' || e.strength !== 'hard') continue;
      if (!prereq.has(e.to_kid)) prereq.set(e.to_kid, []);
      prereq.get(e.to_kid)!.push(e.from_kid);
    }
    return all.map((k) => {
      const need = prereq.get(k.id) || [];
      const missing = need.filter((n) => (masteryMap.get(n) ?? 0) < 0.7);
      const touched = masteryMap.has(k.id);
      return { ...k, missing: missing.length, touched, ready: missing.length === 0 && !touched };
    })
      .filter((k) => !k.touched)
      .sort((a, b) => (a.missing - b.missing) || (b.importance - a.importance));
  }, [data, masteryMap]);

  const filtered = useMemo(() => {
    if (!q.trim()) return data?.categories || [];
    const needle = q.trim().toLowerCase();
    return (data?.categories || []).map((c) => ({
      ...c,
      chapters: c.chapters.map((ch) => ({
        ...ch,
        knowledge: ch.knowledge.filter((k) =>
          k.title.toLowerCase().includes(needle) || k.summary.toLowerCase().includes(needle)),
      })).filter((ch) => ch.knowledge.length),
    })).filter((c) => c.chapters.length);
  }, [data, q]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  if (error) {
    return <Card><Empty title="加载失败" desc={error.message} action={
      <button className="text-cyan hover:underline" onClick={reload}>重试</button>} /></Card>;
  }

  const stats = (data as any)?.stats;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <Network size={17} className="text-cyan" />
              数据库系统原理 · 知识树
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-mute">
              {stats?.categories} 个分类 · {stats?.chapters} 章 · {stats?.knowledge} 个知识点 ·{' '}
              {stats?.edges} 条依赖关系
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜知识点…"
              className="pl-9"
              /* ⌘/Ctrl+K 会聚焦到这里（见 layout/Hotkeys.tsx） */
              data-search-input
            />
          </div>
        </div>

        <div className="mt-3">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'outline', label: '按课程大纲', icon: <ListTree size={13} /> },
              { key: 'ready', label: '按可学性排序', icon: <Sparkles size={13} />, count: readyList.length },
            ]}
          />
        </div>
      </Card>

      {tab === 'outline' && (
        <div className="space-y-3">
          {filtered.map((cat) => {
            const all = cat.chapters.flatMap((ch) => ch.knowledge);
            const done = all.filter((k) => (masteryMap.get(k.id) ?? 0) >= 0.7).length;
            return (
              <Card key={cat.id}>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="h-7 w-1.5 rounded-full" style={{ background: cat.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-[14.5px] font-semibold text-fg">{cat.name}</h3>
                      <span className="text-[12px] tabular-nums text-fg-mute">
                        掌握 {done}/{all.length}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-fg-mute">{cat.description}</p>
                  </div>
                  <div className="hidden w-24 shrink-0 sm:block">
                    <Progress value={all.length ? done / all.length : 0} />
                  </div>
                </div>

                <div className="space-y-3">
                  {cat.chapters.map((ch) => (
                    <div key={ch.id}>
                      <div className="mb-1.5 flex items-baseline gap-2">
                        <span className="text-[12.5px] font-medium text-fg-soft">{ch.name}</span>
                        <span className="text-[12px] text-fg-faint">{ch.summary}</span>
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {ch.knowledge.map((k) => {
                          const m = masteryMap.get(k.id);
                          const mastered = m !== undefined && m >= 0.7;
                          const tried = m !== undefined;
                          return (
                            <AppLink
                              key={k.id}
                              to={`/learn/${k.id}`}
                              className={cn(
                                'group flex items-start gap-2 rounded-lg border border-hairline bg-veil/2 p-2.5 transition-colors',
                                'hover:border-cyan/40 hover:bg-cyan/5',
                              )}
                            >
                              {mastered
                                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                                : tried
                                  ? <Circle size={14} className="mt-0.5 shrink-0 text-warn" />
                                  : <Circle size={14} className="mt-0.5 shrink-0 text-fg-faint" />}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[13px] font-medium text-fg group-hover:text-cyan">
                                    {k.title}
                                  </span>
                                  {k.importance >= 3 && <Badge tone="accent">重点</Badge>}
                                </div>
                                <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-fg-mute">
                                  {k.summary}
                                </p>
                                {tried && (
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <span className="text-[12px] tabular-nums text-fg-faint">
                                      掌握度 {Math.round((m ?? 0) * 100)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                              <ChevronRight size={13} className="mt-0.5 shrink-0 text-fg-faint group-hover:text-cyan" />
                            </AppLink>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          {!filtered.length && <Card><Empty title="没有匹配的知识点" desc={`没找到包含「${q}」的内容`} /></Card>}
        </div>
      )}

      {tab === 'ready' && (
        <Card>
          <SectionTitle
            title="现在可以学的"
            desc="前置知识点都已掌握（掌握度 ≥ 70%）的知识点，按缺口从小到大排"
            icon={<Sparkles size={15} className="text-cyan" />}
          />
          {readyList.length ? (
            <div className="space-y-1.5">
              {readyList.slice(0, 30).map((k) => (
                <AppLink
                  key={k.id}
                  to={`/learn/${k.id}`}
                  className="group flex items-center gap-3 rounded-lg border border-hairline bg-veil/2 p-3 transition-colors hover:border-cyan/40 hover:bg-cyan/5"
                >
                  {k.missing === 0
                    ? <CheckCircle2 size={15} className="shrink-0 text-ok" />
                    : <Lock size={15} className="shrink-0 text-fg-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13.5px] font-medium text-fg group-hover:text-cyan">{k.title}</span>
                      {k.importance >= 3 && <Badge tone="accent">重点</Badge>}
                      {k.missing === 0
                        ? <Badge tone="ok">前置已备</Badge>
                        : <Badge tone="warn">缺 {k.missing} 个前置</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-fg-mute">{k.summary}</p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-fg-faint group-hover:text-cyan" />
                </AppLink>
              ))}
            </div>
          ) : (
            <Empty
              title={diagData?.diagnosis?.summary || '所有知识点都学过了'}
              desc="去「每日一练」巩固一下，或者直接进 SQL 闯关练手"
            />
          )}
        </Card>
      )}
    </div>
  );
}
