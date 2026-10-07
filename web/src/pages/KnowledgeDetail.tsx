/* 知识点详情
 *
 * ── 页面结构对应学习动作的顺序 ──────────────────────────────────
 *   ① 正文（先看）
 *   ② 示例 SQL + 「拿去实训场跑」（动手）
 *   ③ 练几道（检验）
 *   ④ 前置 / 解锁 / 易混淆（补漏与延伸）
 *   ⑤ 笔记（留痕）
 * 把「前置」放在正文下面而不是上面，是因为大多数时候学生是从
 * 知识树顺着点进来的，前置早就掌握了；把前置顶在最上面
 * 等于每次都要先划过去一段和当前无关的内容。
 */
import { useState, useMemo } from 'react';
import { usePageParams } from '@/components/layout/KeepAlivePages';
import {
  ArrowLeft, ArrowRight, CircleAlert, Link2, Sigma,
  Play, NotebookPen, Trash2, Plus, Send, Terminal,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Skeleton, Empty, Textarea,
  DifficultyDots, Progress, ListRow,
} from '@/components/ui/Primitives';
import { Markdown } from '@/lib/markdown';
import { highlightSql } from '@/lib/sqlHighlight';
import { AppLink } from '@/lib/links';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { formatDate, masteryColor } from '@/lib/utils';

interface KDetail {
  knowledge: {
    id: string; title: string; summary: string; content: string; sqlDemo: string;
    difficulty: number; importance: number; tags: string[];
    chapterId: string; chapterName: string; categoryId: string; categoryName: string; categoryColor: string;
  };
  prereqs: { kid: string; title: string; strength: string; reason: string }[];
  unlocks: { kid: string; title: string; strength: string; reason: string }[];
  related: { kid: string; title: string; reason: string }[];
  confusable: { kid: string; title: string; reason: string }[];
  counts: { questions: number; levels: number; normalizeTasks: number };
  myStats: { attempts: number; correct: number };
}

export default function KnowledgeDetail() {
  const { kid } = usePageParams<{ kid: string }>();
  const { toast } = useApp();
  const [noteText, setNoteText] = useState('');

  const { data, loading, error } = useAsync<KDetail>(
    `catalog:knowledge:${kid}`,
    () => api.get(`/api/catalog/knowledge/${kid}`),
    { ttl: 120000 },
  );

  const { data: qs } = useAsync<{ questions: any[] }>(
    `catalog:questions:${kid}`,
    () => api.get(`/api/catalog/questions?kid=${kid}`),
    { ttl: 120000 },
  );

  const { data: notes, reload: reloadNotes } = useAsync<{ notes: any[] }>(
    `study:notes:${kid}`,
    () => api.get(`/api/study/notes?kid=${kid}`),
    { ttl: 5000 },
  );

  const { data: ddlData } = useAsync<{ ddl: string }>(
    'catalog:dataset:school:ddl',
    () => api.get('/api/catalog/datasets/school/ddl'),
    { ttl: 600000 },
  );

  const mastery = useMemo(() => {
    if (!data?.myStats.attempts) return null;
    return (data.myStats.correct + 1) / (data.myStats.attempts + 2);
  }, [data]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <Empty
          title="知识点不存在"
          desc={error?.message || '可能链接过期了'}
          action={<AppLink to="/learn" sameTab className="text-cyan hover:underline">返回知识树</AppLink>}
        />
      </Card>
    );
  }

  const k = data.knowledge;

  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.post('/api/study/notes', { kid: k.id, text: noteText.trim() });
      setNoteText('');
      reloadNotes();
      toast('ok', '笔记已保存');
    } catch (e: any) {
      toast('error', '保存失败', e.message);
    }
  };

  const delNote = async (id: string) => {
    try {
      await api.del(`/api/study/notes/${id}`);
      reloadNotes();
    } catch (e: any) {
      toast('error', '删除失败', e.message);
    }
  };

  const addCard = async () => {
    try {
      const r = await api.post('/api/study/cards', { knowledgeId: k.id });
      toast('ok', r.already ? '这张卡已经在复习队列里了' : '已加入复习队列');
    } catch (e: any) {
      toast('error', '加入失败', e.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* ---------- 面包屑 + 标题 ---------- */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-fg-mute">
          <AppLink to="/learn" sameTab className="hover:text-cyan">{k.categoryName}</AppLink>
          <span>/</span>
          <span>{k.chapterName}</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight text-fg">{k.title}</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-soft">{k.summary}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <DifficultyDots value={k.difficulty} />
              {k.importance >= 3 && <Badge tone="accent">重点考点</Badge>}
              {k.tags.map((t) => <Badge key={t}>{t}</Badge>)}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={addCard}>
              <Plus size={13} />加入复习
            </Button>
          </div>
        </div>

        {mastery !== null && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-hairline bg-veil/3 px-3.5 py-2.5">
            <span className="text-[12px] text-fg-mute">我的掌握度</span>
            <span className="text-[16px] font-semibold tabular-nums" style={{ color: masteryColor(mastery) }}>
              {Math.round(mastery * 100)}%
            </span>
            <div className="flex-1"><Progress value={mastery} /></div>
            <span className="text-[12px] text-fg-faint">
              {data.myStats.correct}/{data.myStats.attempts} 题
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {/* ---------- 正文 ---------- */}
          <Card>
            <Markdown source={k.content} />
          </Card>

          {/* ---------- 示例 SQL ---------- */}
          {k.sqlDemo && (
            <Card>
              <SectionTitle
                title="动手试试"
                desc="这段示例可以直接拿去实训场跑，也可以在这里改"
                icon={<Terminal size={15} className="text-cyan" />}
              />
              <div className="code-block relative">
                <pre className="p-3.5"><code dangerouslySetInnerHTML={{ __html: highlightSql(k.sqlDemo) }} /></pre>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <AppLink
                  to={`/lab/sql?sql=${encodeURIComponent(k.sqlDemo)}&dataset=school`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg btn-accent px-3 text-[12.5px] font-medium"
                >
                  <Play size={13} />在新标签里跑
                </AppLink>
                <AppLink
                  to="/lab/sql"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[12.5px] text-fg-soft hover:bg-veil/6"
                >
                  打开实训场
                </AppLink>
              </div>
            </Card>
          )}

          {/* ---------- 练几道 ---------- */}
          <Card>
            <SectionTitle
              title="练几道"
              desc={`这个知识点下有 ${data.counts.questions} 道客观题${data.counts.normalizeTasks ? `、${data.counts.normalizeTasks} 道范式题` : ''}${data.counts.levels ? `、${data.counts.levels} 个 SQL 关卡` : ''}`}
              right={<AppLink to={`/practice?kid=${k.id}`} className="text-[12px] text-cyan hover:underline">去练习</AppLink>}
            />
            {qs?.questions.length ? (
              <div className="space-y-2">
                {qs.questions.slice(0, 5).map((q) => (
                  <ListRow
                    key={q.id}
                    title={q.stem.length > 70 ? `${q.stem.slice(0, 70)}…` : q.stem}
                    desc={TYPE_LABEL[q.type] || q.type}
                    right={<DifficultyDots value={q.difficulty} />}
                  />
                ))}
                <AppLink
                  to={`/practice?kid=${k.id}`}
                  className="block pt-1 text-center text-[12.5px] text-cyan hover:underline"
                >
                  开始练习这 {qs.questions.length} 道题 →
                </AppLink>
              </div>
            ) : (
              <p className="text-[12.5px] text-fg-mute">这个知识点暂时没有配套练习题。</p>
            )}
          </Card>

          {/* ---------- 笔记 ---------- */}
          <Card>
            <SectionTitle
              title="我的笔记"
              desc="只有你自己看得到。老师能看到你的答题记录，但看不到笔记正文。"
              icon={<NotebookPen size={15} className="text-violet" />}
            />
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="记下易错点、自己的理解、或者疑问…"
              rows={3}
            />
            <div className="mt-2 flex justify-end">
              <Button variant="accent" size="sm" onClick={addNote} disabled={!noteText.trim()}>
                <Send size={13} />保存笔记
              </Button>
            </div>

            {notes?.notes.length ? (
              <div className="mt-3 space-y-2">
                {notes.notes.map((n) => (
                  <div key={n.id} className="group rounded-lg border border-hairline bg-veil/3 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-soft">{n.text}</p>
                      <button
                        onClick={() => delNote(n.id)}
                        className="shrink-0 rounded p-1 text-fg-faint opacity-0 transition-opacity hover:text-bad group-hover:opacity-100"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="mt-1 text-[12px] text-fg-faint">{formatDate(n.created_at)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-center text-[12px] text-fg-faint">还没有笔记</p>
            )}
          </Card>
        </div>

        {/* ---------- 右栏：依赖关系 ---------- */}
        <div className="space-y-4">
          {data.prereqs.length > 0 && (
            <Card>
              <SectionTitle
                title="先学这些"
                desc="缺了它们，这一节会学得很吃力"
                icon={<ArrowLeft size={15} className="text-warn" />}
              />
              <div className="space-y-1.5">
                {data.prereqs.map((p) => (
                  <AppLink
                    key={p.kid}
                    to={`/learn/${p.kid}`}
                    className="block rounded-lg border border-hairline bg-veil/2 p-2.5 transition-colors hover:border-warn/40 hover:bg-warn/6"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-fg">{p.title}</span>
                      <Badge tone={p.strength === 'hard' ? 'bad' : 'warn'}>
                        {p.strength === 'hard' ? '硬前置' : '软前置'}
                      </Badge>
                    </div>
                    {p.reason && <p className="mt-1 text-[12px] leading-relaxed text-fg-mute">{p.reason}</p>}
                  </AppLink>
                ))}
              </div>
            </Card>
          )}

          {data.unlocks.length > 0 && (
            <Card>
              <SectionTitle
                title="学完能解锁"
                desc="这些知识点都以当前这一节为前置"
                icon={<ArrowRight size={15} className="text-ok" />}
              />
              <div className="space-y-1.5">
                {data.unlocks.map((u) => (
                  <AppLink
                    key={u.kid}
                    to={`/learn/${u.kid}`}
                    className="block rounded-lg border border-hairline bg-veil/2 p-2.5 transition-colors hover:border-ok/40 hover:bg-ok/6"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-fg">{u.title}</span>
                      <Badge tone={u.strength === 'hard' ? 'bad' : 'neutral'}>
                        {u.strength === 'hard' ? '硬前置' : '软前置'}
                      </Badge>
                    </div>
                    {u.reason && <p className="mt-1 text-[12px] leading-relaxed text-fg-mute">{u.reason}</p>}
                  </AppLink>
                ))}
              </div>
            </Card>
          )}

          {data.confusable.length > 0 && (
            <Card>
              <SectionTitle
                title="容易和它混淆"
                desc="这几组概念考试里最爱考对比"
                icon={<CircleAlert size={15} className="text-rose" />}
              />
              <div className="space-y-1.5">
                {data.confusable.map((c) => (
                  <AppLink
                    key={c.kid}
                    to={`/learn/${c.kid}`}
                    className="block rounded-lg border border-hairline bg-veil/2 p-2.5 transition-colors hover:border-rose/40 hover:bg-rose/6"
                  >
                    <span className="text-[13px] font-medium text-fg">{c.title}</span>
                    {c.reason && <p className="mt-1 text-[12px] leading-relaxed text-fg-mute">{c.reason}</p>}
                  </AppLink>
                ))}
              </div>
            </Card>
          )}

          {data.related.length > 0 && (
            <Card>
              <SectionTitle title="相关知识点" icon={<Link2 size={15} className="text-cyan" />} />
              <div className="flex flex-wrap gap-1.5">
                {data.related.map((r) => (
                  <AppLink
                    key={r.kid}
                    to={`/learn/${r.kid}`}
                    className="rounded-md border border-hairline bg-veil/3 px-2 py-1 text-[12px] text-fg-soft hover:border-cyan/40 hover:text-cyan"
                    title={r.reason}
                  >
                    {r.title}
                  </AppLink>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <SectionTitle title="建表语句" desc="做 SQL 练习时随手可查" icon={<Sigma size={15} className="text-fg-mute" />} />
            <details className="group">
              <summary className="cursor-pointer list-none text-[12.5px] text-cyan hover:underline">
                展开「学生选课库」的表结构
              </summary>
              <pre className="code-block mt-2 max-h-64 overflow-auto p-3 text-[12px] leading-relaxed text-fg-soft">
                {ddlData?.ddl || '加载中…'}
              </pre>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  choice: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', short: '简答题',
};
