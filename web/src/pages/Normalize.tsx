/* 范式实验室
 *
 * ── 四种问法，四种输入形态 ──────────────────────────────────────
 *   closure    求属性闭包   → 勾选属性
 *   keys       求候选键     → 一组一组的属性（可增删）
 *   nf         判断范式     → 四选一
 *   decompose  给出分解     → 一组一组的属性（可增删）
 *
 * ── ★ 分解题不比对标准答案 ──────────────────────────────────────
 * 正确的 3NF 分解通常不唯一（最小覆盖不唯一 → 合成结果不唯一）。
 * 所以判分是验**性质**：覆盖全部属性 + 无损连接 + 保持依赖 + 达标。
 * 页面上也要把这一点讲清楚，否则学生看到一个和自己不同的
 * "参考答案"会以为自己错了。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sigma, CheckCircle2, XCircle, Eye, Plus, Trash2,
  FunctionSquare, KeyRound, Layers, Scissors,
} from 'lucide-react';
import {
  Card, SectionTitle, Badge, Button, Skeleton, Empty, Callout, Progress,
} from '@/components/ui/Primitives';
import { Markdown } from '@/lib/markdown';
import { useAsync, invalidatePrefix } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn } from '@/lib/utils';

interface FD { lhs: string[]; rhs: string[] }
interface Task {
  id: string; kid: string; title: string; brief: string;
  attrs: string[]; fds: FD[]; ask: 'closure' | 'keys' | 'nf' | 'decompose';
  target: string; difficulty: number; solved: boolean; attempts: number;
}

const ASK_LABEL = {
  closure: { t: '求属性闭包', icon: FunctionSquare },
  keys: { t: '求候选键', icon: KeyRound },
  nf: { t: '判断范式等级', icon: Layers },
  decompose: { t: '给出分解', icon: Scissors },
};

/** FD 的可读写法：{A,B}→{C} 写成 AB→C */
const fmtFd = (fd: FD) => `${fd.lhs.join('')} → ${fd.rhs.join('')}`;

export default function Normalize() {
  const { toast } = useApp();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<any>(null);
  const [verdict, setVerdict] = useState<any>(null);
  const [derivation, setDerivation] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading } = useAsync<{ tasks: Task[] }>(
    'catalog:normalize-tasks',
    () => api.get('/api/catalog/normalize-tasks'),
    { ttl: 10000 },
  );

  const tasks = data?.tasks || [];
  const task = useMemo(() => tasks.find((t) => t.id === activeId) || tasks[0], [tasks, activeId]);

  // 切题时重置
  const pick = (t: Task) => {
    setActiveId(t.id);
    setVerdict(null);
    setDerivation(null);
    setAnswer(t.ask === 'keys' || t.ask === 'decompose' ? [[]] : t.ask === 'nf' ? '' : []);
  };

  /* ★ 初始化作答区。用 useEffect 而不是 useMemo ——
   *   useMemo 里做 setState 是副作用，React 不保证它在什么时机跑，
   *   而且它会在渲染期间触发另一次渲染。这类写法偶尔能跑，
   *   但在并发渲染下会出问题。 */
  useEffect(() => {
    if (!task) return;
    setVerdict(null);
    setDerivation(null);
    setAnswer(task.ask === 'keys' || task.ask === 'decompose' ? [[]] : task.ask === 'nf' ? '' : []);
  }, [task?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const r = await api.post<any>(`/api/study/normalize/${task.id}`, { answer: { value: answer } });
      setVerdict(r);
      invalidatePrefix('study:');
      invalidatePrefix('catalog:normalize-tasks');
      if (r.pass) toast('ok', '正确！', r.xpGained ? `+${r.xpGained} XP` : undefined);
      else toast('error', '还不对', r.message);
    } catch (e: any) {
      toast('error', '提交失败', e.message);
    } finally {
      setBusy(false);
    }
  };

  const showDerivation = async () => {
    try {
      const r = await api.get<any>(`/api/study/normalize/${task!.id}/explain`);
      setDerivation(r.derivation);
    } catch (e: any) {
      toast('warn', '看不了推导过程', e.message);
    }
  };

  if (loading && !tasks.length) return <Skeleton className="h-96" />;

  const solvedCount = tasks.filter((t) => t.solved).length;

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      {/* ---------- 左：题目列表 ---------- */}
      <div className="space-y-3">
        <Card>
          <div className="mb-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Sigma size={16} className="text-violet" />
              范式实验室
            </h2>
            <p className="mt-0.5 text-[11.5px] text-fg-mute">
              {solvedCount}/{tasks.length} 道已解出
            </p>
          </div>
          <Progress value={tasks.length ? solvedCount / tasks.length : 0} tone="ok" />
        </Card>

        <Card padded={false} className="overflow-hidden">
          <div className="max-h-[calc(100dvh-260px)] overflow-y-auto p-2">
            {tasks.map((t) => {
              const Ask = ASK_LABEL[t.ask];
              const active = t.id === task?.id;
              return (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className={cn(
                    'mb-1 flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
                    active
                      ? 'border-cyan/50 bg-cyan/10'
                      : t.solved
                        ? 'border-ok/25 bg-ok-soft hover:border-ok/40'
                        : 'border-hairline bg-veil/2 hover:border-cyan/30 hover:bg-veil/6',
                  )}
                >
                  {t.solved
                    ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                    : <Ask.icon size={14} className="mt-0.5 shrink-0 text-fg-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-fg">{t.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[10.5px] text-fg-faint">{Ask.t}</span>
                      {t.attempts > 0 && !t.solved && (
                        <span className="text-[10px] text-warn">试过 {t.attempts} 次</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ---------- 右：做题区 ---------- */}
      {!task ? (
        <Card><Empty title="还没有题目" /></Card>
      ) : (
        <div className="space-y-3">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{ASK_LABEL[task.ask].t}</Badge>
              <h2 className="text-[16px] font-semibold text-fg">{task.title}</h2>
            </div>
            <Markdown source={task.brief} />

            {/* 题目数据 */}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-lg border border-hairline bg-veil/3 p-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">属性集</div>
                <div className="flex flex-wrap gap-1">
                  {task.attrs.map((a) => (
                    <span key={a} className="rounded bg-veil/10 px-1.5 py-0.5 font-mono text-[12px] text-fg">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-hairline bg-veil/3 p-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">函数依赖集 F</div>
                <div className="space-y-0.5">
                  {task.fds.map((fd, i) => (
                    <div key={i} className="font-mono text-[12px] text-fg-soft">{fmtFd(fd)}</div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* ---------- 作答区 ---------- */}
          <Card>
            <SectionTitle
              title="你的答案"
              desc={task.ask === 'decompose'
                ? '分解题不比对标准答案 —— 只要满足「覆盖全部属性 + 无损连接 + 保持依赖 + 达标」就算对'
                : undefined}
            />

            {task.ask === 'closure' && (
              <div>
                <div className="mb-2 text-[12.5px] text-fg-soft">
                  求 <span className="font-mono font-semibold text-cyan">{task.target}</span> 的闭包
                  <span className="font-mono text-cyan">⁺</span> —— 勾选它一定能推出的属性
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {task.attrs.map((a) => {
                    const on = Array.isArray(answer) && answer.includes(a);
                    return (
                      <button
                        key={a}
                        onClick={() => setAnswer((v: string[]) =>
                          (on ? v.filter((x) => x !== a) : [...(v || []), a]))}
                        className={cn(
                          'h-9 w-9 rounded-lg border font-mono text-[13px] font-semibold transition-colors',
                          on ? 'border-cyan/50 bg-cyan/15 text-cyan' : 'border-hairline bg-veil/2 text-fg-soft hover:border-cyan/30',
                        )}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {task.ask === 'nf' && (
              <div className="flex flex-wrap gap-2">
                {['1NF', '2NF', '3NF', 'BCNF'].map((n) => (
                  <button
                    key={n}
                    onClick={() => setAnswer(n)}
                    className={cn(
                      'flex-1 rounded-lg border py-3 font-mono text-[14px] font-semibold transition-colors',
                      answer === n ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-hairline bg-veil/2 text-fg-soft hover:border-cyan/30',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            {(task.ask === 'keys' || task.ask === 'decompose') && (
              <GroupEditor
                attrs={task.attrs}
                groups={Array.isArray(answer) ? answer : [[]]}
                onChange={setAnswer}
                label={task.ask === 'keys' ? '候选键' : '分解出的关系'}
              />
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11.5px] text-fg-faint">
                {task.ask === 'keys' || task.ask === 'decompose'
                  ? '写 AB 或 A,B 都行 —— 系统按题目的属性集来切分'
                  : '选好后点提交'}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={showDerivation}>
                  <Eye size={13} />看推导
                </Button>
                <Button variant="accent" size="sm" onClick={submit} loading={busy}>
                  提交
                </Button>
              </div>
            </div>
          </Card>

          {/* ---------- 判定 ---------- */}
          {verdict && (
            <Card className={cn('border-l-2', verdict.pass ? 'border-l-ok' : 'border-l-bad')}>
              <div className="flex items-start gap-2.5">
                {verdict.pass
                  ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />
                  : <XCircle size={18} className="mt-0.5 shrink-0 text-bad" />}
                <div className="min-w-0 flex-1">
                  <div className={cn('text-[14px] font-semibold', verdict.pass ? 'text-ok' : 'text-bad')}>
                    {verdict.pass ? '正确' : '还不对'}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-fg-soft">
                    {verdict.message}
                  </pre>
                  {verdict.correctAnswer && !verdict.pass && task.ask !== 'decompose' && (
                    <div className="mt-2 rounded-lg border border-hairline bg-veil/3 p-2.5">
                      <div className="mb-1 text-[11.5px] text-fg-faint">正确答案</div>
                      <div className="font-mono text-[12.5px] text-ok">
                        {Array.isArray(verdict.correctAnswer)
                          ? (Array.isArray(verdict.correctAnswer[0])
                            ? verdict.correctAnswer.map((g: string[]) => `{${g.join(',')}}`).join('  ')
                            : `{${verdict.correctAnswer.join(',')}}`)
                          : String(verdict.correctAnswer)}
                      </div>
                    </div>
                  )}
                  {verdict.detail?.keys && (
                    <div className="mt-2 space-y-1 text-[12px] text-fg-soft">
                      <div>候选键：{verdict.detail.keys.map((k: string[]) => `{${k.join(',')}}`).join('、')}</div>
                      <div>主属性：{verdict.detail.prime.join(',') || '无'}</div>
                      <div>非主属性：{verdict.detail.nonPrime.join(',') || '无'}</div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ---------- 推导过程 ---------- */}
          {derivation && (
            <Card>
              <SectionTitle
                title="完整推导"
                desc="这是系统按算法算出来的，不是预置的文本 —— 所以它和你手算的结果一定一致"
              />
              <div className="space-y-3 text-[12.5px]">
                <DeriveRow title="各属性闭包">
                  <div className="grid gap-1 sm:grid-cols-2">
                    {derivation.closures?.map((c: any) => (
                      <div key={c.attr} className="font-mono text-fg-soft">
                        {c.attr}⁺ = {'{'}{c.closure.join(',')}{'}'}
                      </div>
                    ))}
                  </div>
                </DeriveRow>

                <DeriveRow title="候选键">
                  <div className="flex flex-wrap gap-1.5">
                    {derivation.keys?.map((k: string[], i: number) => (
                      <span key={i} className="rounded bg-cyan/12 px-2 py-0.5 font-mono text-cyan">
                        {k.join(',')}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-fg-mute">
                    必含属性：{derivation.mustAttrs?.join(',') || '无'} ·
                    需枚举：{derivation.optionalAttrs?.join(',') || '无'} ·
                    必不含：{derivation.neverAttrs?.join(',') || '无'}
                  </div>
                </DeriveRow>

                <DeriveRow title="最小覆盖 Fc">
                  <div className="space-y-0.5">
                    {derivation.minimalCover?.map((fd: FD, i: number) => (
                      <div key={i} className="font-mono text-fg-soft">{fmtFd(fd)}</div>
                    ))}
                  </div>
                </DeriveRow>

                <DeriveRow title="范式判定">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{derivation.normalForm?.nf}</Badge>
                    {derivation.normalForm?.note && (
                      <span className="text-[11.5px] text-fg-mute">{derivation.normalForm.note}</span>
                    )}
                  </div>
                  {derivation.normalForm?.violations?.bcnf?.length > 0 && (
                    <div className="mt-1.5 text-[11.5px] text-fg-mute">
                      违反 BCNF 的依赖：
                      {derivation.normalForm.violations.bcnf.map((v: any, i: number) => (
                        <span key={i} className="ml-1 font-mono">{fmtFd(v.fd)}</span>
                      ))}
                    </div>
                  )}
                </DeriveRow>

                <DeriveRow title="3NF 合成法的一个解">
                  <div className="flex flex-wrap gap-1.5">
                    {derivation.synthesize3NF?.map((r: string[], i: number) => (
                      <span key={i} className="rounded bg-veil/10 px-2 py-0.5 font-mono text-fg-soft">
                        ({r.join(',')})
                      </span>
                    ))}
                  </div>
                </DeriveRow>

                <DeriveRow title="BCNF 分解的一个解">
                  <div className="flex flex-wrap gap-1.5">
                    {derivation.decomposeBCNF?.map((r: string[], i: number) => (
                      <span key={i} className="rounded bg-veil/10 px-2 py-0.5 font-mono text-fg-soft">
                        ({r.join(',')})
                      </span>
                    ))}
                  </div>
                </DeriveRow>
              </div>
              <Callout tone="info" className="mt-3">
                分解的正确答案通常不唯一（最小覆盖不唯一 → 合成结果不唯一）。
                上面给的是**一个**可行解，只要你的分解满足性质要求，就是对的。
              </Callout>
            </Card>
          )}

          {!derivation && (
            <div className="text-center">
              <button
                onClick={showDerivation}
                className="text-[11.5px] text-fg-faint hover:text-cyan"
              >
                先自己推一遍，再看推导过程 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeriveRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-veil/2 p-3">
      <div className="mb-1.5 text-[11.5px] font-semibold text-fg-soft">{title}</div>
      {children}
    </div>
  );
}

/* ============ 属性组编辑器 ============ */

function GroupEditor({
  attrs, groups, onChange, label,
}: {
  attrs: string[]; groups: string[][]; onChange: (g: string[][]) => void; label: string;
}) {
  const setGroup = (gi: number, g: string[]) => onChange(groups.map((x, i) => (i === gi ? g : x)));

  return (
    <div className="space-y-2">
      {groups.map((g, gi) => (
        <div key={gi} className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-veil/2 p-2.5">
          <span className="shrink-0 text-[11.5px] text-fg-faint">
            {label} {gi + 1}
          </span>
          <div className="flex flex-wrap gap-1">
            {attrs.map((a) => {
              const on = g.includes(a);
              return (
                <button
                  key={a}
                  onClick={() => setGroup(gi, on ? g.filter((x) => x !== a) : [...g, a])}
                  className={cn(
                    'h-7 w-7 rounded border font-mono text-[12px] font-semibold transition-colors',
                    on ? 'border-cyan/50 bg-cyan/15 text-cyan' : 'border-hairline text-fg-mute hover:border-cyan/30',
                  )}
                >
                  {a}
                </button>
              );
            })}
          </div>
          {groups.length > 1 && (
            <button
              onClick={() => onChange(groups.filter((_, i) => i !== gi))}
              className="ml-auto shrink-0 rounded p-1 text-fg-faint hover:text-bad"
              title="删除这一组"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...groups, []])}>
        <Plus size={13} />再加一组
      </Button>
    </div>
  );
}
