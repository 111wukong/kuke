/* 每日一练 / 按考点练习
 *
 * ── 一个页面承担两种入口 ────────────────────────────────────────
 *   /practice            → 每日一练（混合全部考点）
 *   /practice?kid=xxx    → 只练某个考点
 * 拆成两个页面会复制一整套答题逻辑，而它们的差别只是"题目从哪来"。
 *
 * ── 答题交互的几个决定 ──────────────────────────────────────────
 * 1. **答完立刻出判定和解析**，不等到最后统一交卷。
 *    练习的目的是学会，不是考试。延迟反馈会让人忘记自己当时在想什么。
 * 2. **答错后要等用户主动点"下一题"**，不自动跳。
 *    自动跳会让人来不及看解析 —— 那这一题就白错了。
 * 3. **多选必须先点"提交"**，不能点一个选项就判。
 *    多选的语义就是"选完为止"。
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, XCircle, ChevronRight, RotateCcw, Sparkles, Trophy,
  Target, AlertTriangle, Lightbulb, BookOpen,
} from 'lucide-react';
import { Card, Badge, Button, DetailSkeleton, Empty, Progress, DifficultyDots } from '@/components/ui/Primitives';
import { Markdown } from '@/lib/markdown';
import { AppLink } from '@/lib/links';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn } from '@/lib/utils';

interface Q {
  id: string; kid: string; type: 'choice' | 'multi' | 'judge' | 'blank' | 'short';
  difficulty: number; stem: string; options: { key: string; text: string }[] | null;
}

interface Verdict {
  pass: boolean; score?: number; message: string; needsManual?: boolean;
  correctAnswer?: any; analysis?: string; steps?: { t: string; pts: number }[];
  errorType?: string; combo?: number; comboBonus?: number; xpGained?: number;
  cardCreated?: boolean; unlocked?: string[];
}

const TYPE_LABEL: Record<string, string> = {
  choice: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', short: '简答题',
};

export default function Practice() {
  const [sp] = useSearchParams();
  const kid = sp.get('kid') || '';
  const { toast } = useApp();

  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState({ n: 0, ok: 0 });

  const { data, loading, error, reload } = useAsync<{ questions: Q[] }>(
    `catalog:questions:practice:${kid || 'all'}`,
    () => api.get(`/api/catalog/questions?limit=60${kid ? `&kid=${kid}` : ''}`),
    { ttl: 60000 },
  );

  const { data: kidInfo } = useAsync<{ knowledge: any }>(
    kid ? `catalog:knowledge:${kid}` : 'noop:skip',
    () => api.get(`/api/catalog/knowledge/${kid}`),
    { ttl: 120000, enabled: !!kid },
  );

  /* 打乱顺序。固定顺序会让第二次练变成"背答案的位置"，
   * 而位置记忆对掌握知识没有任何帮助。 */
  const questions = useMemo(() => {
    const list = [...(data?.questions || [])];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }, [data]);

  const q = questions[idx];

  const submit = async (ans?: string) => {
    const a = ans !== undefined ? ans : answer;
    if (!q) return;
    if (q.type !== 'judge' && q.type !== 'choice' && q.type !== 'multi' && !a.trim()) {
      toast('warn', '先作答再提交');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<Verdict>('/api/study/answer', {
        qid: q.id, answer: a, context: 'practice',
      });
      setVerdict(r);
      setSession((s) => ({ n: s.n + 1, ok: s.ok + (r.pass ? 1 : 0) }));
      invalidatePrefix('study:');
      if (r.unlocked?.length) toast('ok', '解锁成就', r.unlocked.join('、'));
    } catch (e: any) {
      toast('error', '提交失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setVerdict(null);
    setAnswer('');
    if (idx + 1 < questions.length) setIdx(idx + 1);
    else {
      toast('ok', `练完了这一轮：${session.ok + (verdict?.pass ? 1 : 0)}/${session.n + 1} 正确`);
      setIdx(0);
      reload();
    }
  };

  if (loading && !data) return <DetailSkeleton />;
  if (error) return <Card><Empty title="加载失败" desc={error.message} action={<Button onClick={reload}>重试</Button>} /></Card>;

  if (!questions.length) {
    return (
      <Card>
        <Empty
          title={kid ? '这个考点暂时没有练习题' : '题库是空的'}
          desc={kid ? '去知识树看看别的内容，或者直接进 SQL 闯关' : undefined}
          action={<AppLink to="/learn" sameTab className="text-cyan hover:underline">去知识树</AppLink>}
        />
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* ---------- 顶部 ---------- */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Target size={16} className="text-cyan" />
              {kid ? (kidInfo?.knowledge?.title || '考点练习') : '每日一练'}
            </h2>
            <p className="mt-0.5 text-[12px] text-fg-mute">
              {kid
                ? '只练这个考点的题'
                : '从全部考点里抽题。答错会自动进错题本和复习队列。'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {session.n > 0 && (
              <div className="text-right">
                <div className="text-[15px] font-semibold tabular-nums text-ok">
                  {session.ok}/{session.n}
                </div>
                <div className="text-[10px] text-fg-faint">本轮正确</div>
              </div>
            )}
            <Badge tone="neutral">{idx + 1} / {questions.length}</Badge>
          </div>
        </div>
        <div className="mt-3">
          <Progress value={(idx + 1) / questions.length} />
        </div>
      </Card>

      {/* ---------- 题目 ---------- */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{TYPE_LABEL[q.type]}</Badge>
          <DifficultyDots value={q.difficulty} />
          {!kid && q.kid && (
            <AppLink to={`/learn/${q.kid}`} className="text-[11.5px] text-fg-mute hover:text-cyan">
              查看相关知识点 →
            </AppLink>
          )}
        </div>

        <div className="prose-doc">
          <Markdown source={q.stem} />
        </div>

        {/* 选项 / 输入区 */}
        <div className="mt-4 space-y-2">
          {q.type === 'choice' || q.type === 'multi' ? (
            (q.options || []).map((o) => {
              const picked = q.type === 'multi' ? answer.includes(o.key) : answer === o.key;
              const isCorrect = verdict && q.type !== 'multi' && verdict.correctAnswer === o.key;
              const isWrongPick = verdict && !verdict.pass && picked && q.type !== 'multi';
              return (
                <button
                  key={o.key}
                  disabled={!!verdict}
                  onClick={() => {
                    if (q.type === 'multi') {
                      setAnswer((v) => (v.includes(o.key) ? v.replace(o.key, '') : v + o.key));
                    } else {
                      setAnswer(o.key);
                      submit(o.key);
                    }
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                    'disabled:cursor-default',
                    isCorrect ? 'border-ok/50 bg-ok-soft'
                      : isWrongPick ? 'border-bad/50 bg-bad-soft'
                        : picked ? 'border-cyan/50 bg-cyan/10'
                          : 'border-hairline bg-veil/2 hover:border-cyan/40 hover:bg-cyan/5',
                  )}
                >
                  <span className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center rounded border text-[11px] font-semibold',
                    picked || isCorrect ? 'border-transparent bg-cyan text-[var(--color-on-accent)]' : 'border-hairline text-fg-mute',
                    isCorrect && 'bg-ok',
                    isWrongPick && 'bg-bad',
                  )}>
                    {o.key}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-fg-soft">{o.text}</span>
                </button>
              );
            })
          ) : q.type === 'judge' ? (
            <div className="flex gap-2">
              {[{ k: 'T', t: '正确' }, { k: 'F', t: '错误' }].map((o) => {
                const picked = answer === o.k;
                const isCorrect = verdict && verdict.correctAnswer === o.k;
                const isWrongPick = verdict && !verdict.pass && picked;
                return (
                  <button
                    key={o.k}
                    disabled={!!verdict}
                    onClick={() => { setAnswer(o.k); submit(o.k); }}
                    className={cn(
                      'flex-1 rounded-lg border py-3 text-[14px] font-medium transition-colors disabled:cursor-default',
                      isCorrect ? 'border-ok/50 bg-ok-soft text-ok'
                        : isWrongPick ? 'border-bad/50 bg-bad-soft text-bad'
                          : picked ? 'border-cyan/50 bg-cyan/10 text-cyan'
                            : 'border-hairline bg-veil/2 text-fg-soft hover:border-cyan/40 hover:bg-cyan/5',
                    )}
                  >
                    {o.t}
                  </button>
                );
              })}
            </div>
          ) : q.type === 'blank' ? (
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              disabled={!!verdict}
              placeholder="填答案。多个空用 | 分隔，例如：256|1677"
              className={cn(
                'h-11 w-full rounded-lg border bg-ink-1000/40 px-3.5 font-mono text-[14px] text-fg',
                'focus:border-cyan/50 focus:outline-none focus:ring-2 focus:ring-cyan/20',
                verdict?.pass ? 'border-ok/50' : verdict ? 'border-bad/50' : 'border-hairline',
              )}
            />
          ) : (
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={!!verdict}
              rows={6}
              placeholder="写下你的答案。简答题由老师批改，但你可以对照参考答案自己先看一遍。"
              className="w-full resize-y rounded-lg border border-hairline bg-ink-1000/40 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-fg focus:border-cyan/50 focus:outline-none focus:ring-2 focus:ring-cyan/20"
            />
          )}
        </div>

        {/* 多选和填空、简答需要手动提交 */}
        {!verdict && (q.type === 'multi' || q.type === 'blank' || q.type === 'short') && (
          <div className="mt-3 flex justify-end">
            <Button variant="accent" onClick={() => submit()} loading={busy}>
              提交答案
            </Button>
          </div>
        )}
      </Card>

      {/* ---------- 判定与解析 ---------- */}
      {verdict && (
        <Card className={cn('border-l-2', verdict.pass ? 'border-l-ok' : 'border-l-bad')}>
          <div className="flex items-start gap-2.5">
            {verdict.pass
              ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />
              : verdict.needsManual
                ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
                : <XCircle size={18} className="mt-0.5 shrink-0 text-bad" />}
            <div className="min-w-0 flex-1">
              <div className={cn(
                'text-[14px] font-semibold',
                verdict.pass ? 'text-ok' : verdict.needsManual ? 'text-warn' : 'text-bad',
              )}>
                {verdict.pass ? '答对了' : verdict.needsManual ? '已提交，等老师批改' : '答错了'}
                {verdict.score !== undefined && !verdict.needsManual && (
                  <span className="ml-2 text-[12px] font-normal text-fg-mute">得分 {verdict.score}</span>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-soft">{verdict.message}</p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {verdict.xpGained ? (
                  <span className="flex items-center gap-1 text-[12px] text-amber">
                    <Sparkles size={12} />+{verdict.xpGained} XP
                    {verdict.comboBonus && verdict.comboBonus > 1 && (
                      <Badge tone="warn">连击 ×{verdict.comboBonus.toFixed(1)}</Badge>
                    )}
                  </span>
                ) : null}
                {verdict.cardCreated && <Badge tone="info">已加入复习队列</Badge>}
                {verdict.unlocked?.length ? (
                  <span className="flex items-center gap-1 text-[12px] text-violet">
                    <Trophy size={12} />{verdict.unlocked.join('、')}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* 评分点（简答题） */}
          {verdict.steps?.length ? (
            <div className="mt-3 rounded-lg border border-hairline bg-veil/3 p-3">
              <div className="mb-1.5 text-[12px] font-medium text-fg-soft">评分点</div>
              <ul className="space-y-1">
                {verdict.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] text-fg-soft">
                    <span className="shrink-0 rounded bg-veil/10 px-1.5 text-[10.5px] tabular-nums text-fg-mute">
                      {s.pts}分
                    </span>
                    {s.t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 解析 */}
          {verdict.analysis && (
            <div className="mt-3 rounded-lg border border-hairline bg-veil/3 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-fg-soft">
                <Lightbulb size={13} className="text-warn" />解析
              </div>
              <Markdown source={verdict.analysis} />
            </div>
          )}

          {!verdict.pass && verdict.correctAnswer !== undefined && q.type !== 'short' && (
            <div className="mt-2.5 text-[12.5px] text-fg-soft">
              正确答案：<span className="font-mono font-semibold text-ok">{String(verdict.correctAnswer)}</span>
            </div>
          )}

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {!verdict.pass && !verdict.needsManual && (
              <Button variant="outline" size="sm" onClick={() => { setVerdict(null); setAnswer(''); }}>
                <RotateCcw size={13} />重做这题
              </Button>
            )}
            <Button variant="accent" size="sm" onClick={next}>
              下一题<ChevronRight size={13} />
            </Button>
          </div>
        </Card>
      )}

      {!verdict && (
        <div className="flex items-center justify-center gap-2 text-[11.5px] text-fg-faint">
          <BookOpen size={12} />
          答错会自动进错题本，并按间隔重复安排复习
        </div>
      )}
    </div>
  );
}
