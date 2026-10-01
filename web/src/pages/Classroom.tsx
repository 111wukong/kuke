/* AI 课堂
 *
 * 一个老师 + 三个水平不同的学生，围绕一个考点把课上一遍。
 *
 * ── 这个页面的设计目标：不让人当观众 ────────────────────────────
 * 多角色 agent 集群最容易做砸的地方是：四个 agent 聊得热闹，
 * 用户在旁边看。那不是上课，是一档节目。
 * 判断标准很简单 —— **整场下来有没有任何一步要求他动手？**
 *
 * 所以每一轮结束都会弹出答题卡。挂起是纯本地等待，不花 token，
 * 收益却是全部。
 *
 * ── 三处刻意的交互 ──────────────────────────────────────────────
 * ① 等作答期间**关掉插话入口**，并写清为什么 —— 老师不该被两条线拉扯
 * ② 一键「还是没懂 / 懂了，继续」两个按钮都要有 ——
 *    少一个这条链就断了：用户会硬撑着说「懂了」，整个答疑阶段白跑
 * ③ 引导占比做成一个数字 —— 让「这课到底在引导还是在念答案」可见
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Send, SkipForward, GraduationCap, Loader2, Gauge } from 'lucide-react';
import { Card, SectionTitle, Badge, Button, Select, Field, Empty } from '@/components/ui/Primitives';
import { Board, type BoardItem } from '@/components/ai/Board';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { startClass, answerClass, skipClass, interjectClass, type AiEvent } from '@/lib/aiStream';
/* ★ 用 kuke 自己的渲染器，**不要再自己写一个**。
 *   我一开始在 latex.ts 里写了个只认 $...$ 的 renderInline ——
 *   它不认 Markdown，于是老师写的 `**粗体**`、`- 列表` 全变成
 *   裸露的星号和短横线漏在气泡里。
 *   而 kuke 的 markdown.tsx 本来就处理了标题/粗斜体/代码/列表/表格/数学，
 *   还完全不产生 HTML 字符串（除了数学那一处，它自己做了转义）。 */
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

interface Kid { id: string; title: string; categoryId: string; chapterId: string; }
interface Mode { id: string; label: string; desc: string; estimate: number; }

type Entry =
  | { k: 'round'; round: number; phase: string; label: string }
  | { k: 'teacher'; text: string; move: string; live?: boolean }
  | { k: 'student'; role: string; name: string; text: string }
  | { k: 'user'; text: string }
  | { k: 'note'; text: string; level?: string }
  | { k: 'tool'; role: string; name: string; done: boolean; ok?: boolean; error?: string };

const ROLE_META: Record<string, { name: string; short: string; tag: string; cls: string }> = {
  teacher: { name: '陈老师', short: '师', tag: '老师', cls: 'from-amber to-amber/70' },
  a: { name: '林一鸣', short: 'A', tag: '优等生', cls: 'from-cyan to-cyan/70' },
  b: { name: '周雨桐', short: 'B', tag: '中等生', cls: 'from-violet to-violet/70' },
  c: { name: '马小虎', short: 'C', tag: '后进生', cls: 'from-rose to-rose/70' },
};

const MOVE_TONE: Record<string, string> = {
  focus: 'text-ok border-ok/40 bg-ok-soft',
  probing: 'text-blue border-blue/40 bg-blue/12',
  telling: 'text-amber border-amber/40 bg-warn-soft',
};

const PHASE_LABEL: Record<string, string> = {
  lecture: '讲透', explain: '讲授', clarify: '答疑重讲', practice: '练习', discuss: '研讨',
};

const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 逐字打字。学生发言是**一次性拿到**的，不打字就没有「正在说」的现场感。 */
function TypedText({ text }: { text: string }) {
  const [n, setN] = useState(() => (prefersReduced() ? text.length : 0));
  useEffect(() => {
    if (prefersReduced()) { setN(text.length); return; }
    const dur = Math.min(1600, Math.max(420, text.length * 16));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.floor(p * text.length));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  const done = n >= text.length;
  return (
    <>
      {/* ★ 打字期间走**纯文本**，打完再交给 Markdown。
          拿半截文本去渲染 Markdown 的话，未闭合的 `**` 和 `$`
          会周期性变成裸标记在屏幕上闪 —— 每一帧都闪一次。 */}
      {done
        ? <Markdown source={text} />
        : <span className="whitespace-pre-wrap">{text.slice(0, n)}</span>}
      {!done && <span className="ai-caret" />}
    </>
  );
}

export default function Classroom() {
  const [kid, setKid] = useState('');
  const [mode, setMode] = useState('class');
  const [feed, setFeed] = useState<Entry[]>([]);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [ask, setAsk] = useState<any>(null);
  const [answer, setAnswer] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [status, setStatus] = useState('准备中');
  const [moves, setMoves] = useState<{ focus: number; probing: number; telling: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [interjectText, setInterjectText] = useState('');

  const streamRef = useRef<HTMLElement | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const liveTeacher = useRef(false);

  /* ★ useAsync 的签名是 (key, fetcher) —— key 是缓存键，不是依赖数组。
   *   传数组进去会让缓存键变成 "a,b,c" 这种字符串，取到别处的数据。 */
  const { data: tree } = useAsync<any>('catalog-tree', () => api.get('/api/catalog/tree'));
  const { data: modes } = useAsync<Mode[]>('ai-modes', () => api.get('/api/ai/modes').then((r: any) => r.modes));

  const grouped = useMemo(() => {
    const out: [string, Kid[]][] = [];
    for (const cat of tree?.categories || []) {
      const list: Kid[] = [];
      for (const ch of cat.chapters || []) for (const k of ch.knowledge || []) list.push(k);
      if (list.length) out.push([cat.name, list]);
    }
    return out;
  }, [tree]);

  const scrollDown = useCallback(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => { scrollDown(); }, [feed, scrollDown]);

  useEffect(() => () => { acRef.current?.abort(); }, []);

  /* ---------- 事件 → 界面 ---------- */
  const handle = useCallback((e: AiEvent) => {
    switch (e.type) {
      case 'start':
        setSessionId(e.session.id);
        break;
      case 'status':
        setStatus(e.text);
        break;
      case 'round':
        liveTeacher.current = false;
        setFeed((f) => [...f, { k: 'round', round: e.round, phase: e.phase, label: e.meta?.label || PHASE_LABEL[e.phase] || e.phase }]);
        break;
      case 'speaking':
        liveTeacher.current = false;
        break;
      case 'delta':
        setFeed((f) => {
          const last = f[f.length - 1];
          if (last && last.k === 'teacher' && last.live) {
            return [...f.slice(0, -1), { ...last, text: e.text, move: e.move || last.move }];
          }
          liveTeacher.current = true;
          return [...f, { k: 'teacher', text: e.text, move: e.move, live: true }];
        });
        break;
      case 'patch':
        liveTeacher.current = false;
        setFeed((f) => {
          for (let i = f.length - 1; i >= 0; i--) {
            const it = f[i];
            if (it.k === 'teacher' && it.live) {
              const next = [...f];
              // 老师这一轮只调了工具没说话 → 不留空气泡
              if (!String(e.text || '').trim()) { next.splice(i, 1); return next; }
              next[i] = { k: 'teacher', text: e.text, move: e.move };
              return next;
            }
          }
          return e.text ? [...f, { k: 'teacher', text: e.text, move: e.move }] : f;
        });
        break;
      case 'turn':
        setFeed((f) => [...f, { k: 'student', role: e.turn.role, name: e.turn.name, text: e.turn.text }]);
        break;
      case 'user':
        setFeed((f) => [...f, { k: 'user', text: e.text }]);
        break;
      case 'note':
        setFeed((f) => [...f, { k: 'note', text: e.text, level: e.level }]);
        break;
      case 'tool':
        setFeed((f) => {
          if (e.phase === 'call') return [...f, { k: 'tool', role: e.role, name: e.name, done: false }];
          /* ★ 配对要找**第一个还没完成**的同名胶囊。
           *   用 find 拿第一个的话，同一个工具在一轮里被调两次时，
           *   两次 done 都会打在第一个上，第二个永远转圈。 */
          const idx = f.findIndex((x) => x.k === 'tool' && !x.done && x.name === e.name && x.role === e.role);
          if (idx < 0) return f;
          const next = [...f];
          next[idx] = { k: 'tool', role: e.role, name: e.name, done: true, ok: e.ok, error: e.error };
          return next;
        });
        break;
      case 'board':
        setBoard((b) => [...b, e.item]);
        break;
      case 'ask':
        setAsk(e.spec);
        setAwaiting(true);
        setStatus('该你了 —— 先答上面这道题');
        break;
      case 'error':
        setErr(e.message);
        setFeed((f) => [...f, { k: 'note', text: `出错了：${e.message}`, level: 'err' }]);
        break;
      case 'done':
        setAwaiting(false);
        setAsk(null);
        setRunning(false);
        setStatus('这一节结束了');
        setMoves(e.session?.moves || null);
        break;
      default:
        break;
    }
  }, []);

  /* ---------- 开课 ---------- */
  async function start() {
    if (running || !kid) return;
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setFeed([]); setBoard([]); setAsk(null); setErr(null);
    setMoves(null); setSessionId(null); setRunning(true); setAwaiting(false);
    setStatus('正在开课…');

    try {
      await startClass({ kid, mode }, handle, ac.signal);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(e?.message || String(e));
    } finally {
      setRunning(false);
      setAwaiting(false);
    }
  }

  /* ---------- 作答 ---------- */
  async function submit(text: string) {
    if (!sessionId || !text.trim()) return;
    const t = text.trim();
    setAsk(null);
    setAnswer('');
    setAwaiting(false);
    await answerClass(sessionId, t);
  }
  async function skip() {
    if (!sessionId) return;
    setAsk(null);
    setAnswer('');
    setAwaiting(false);
    await skipClass(sessionId);
  }
  async function interject() {
    if (!sessionId || !interjectText.trim()) return;
    const t = interjectText.trim();
    setInterjectText('');
    const ok = await interjectClass(sessionId, t);
    if (ok) setFeed((f) => [...f, { k: 'user', text: t }]);
  }

  /* ---------- ★ 门禁只在这一个地方算 ----------
   * 用「有没有一节正在跑的课」，不能用「有没有发言内容」——
   * 后者在建完 session、还没说话时是 false，输入框一渲染出来就是禁用的。 */
  const canInterject = running && !awaiting;

  const ratio = useMemo(() => {
    if (!moves) return null;
    const total = moves.focus + moves.probing + moves.telling;
    return total ? (moves.focus + moves.probing) / total : null;
  }, [moves]);

  const currentMode = (modes || []).find((m) => m.id === mode);

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[560px] gap-4">
      {/* ============ 左：设置 + 档案 ============ */}
      <div className="hidden w-[268px] shrink-0 flex-col gap-3 overflow-y-auto xl:flex">
        <Card>
          <SectionTitle title="开一节课" desc="选一个考点，老师会讲透它" accent />
          <div className="flex flex-col gap-3">
            <Field label="考点" required>
              <Select value={kid} onChange={(e) => setKid(e.target.value)} disabled={running}>
                <option value="">— 选一个考点 —</option>
                {grouped.map(([cat, list]) => (
                  <optgroup key={cat} label={cat}>
                    {list.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="上课方式">
              <Select value={mode} onChange={(e) => setMode(e.target.value)} disabled={running}>
                {(modes || []).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}（≈{m.estimate} 次调用）</option>
                ))}
              </Select>
            </Field>
            {currentMode && <p className="-mt-1 text-[11.5px] leading-relaxed text-fg-mute">{currentMode.desc}</p>}
            <Button variant="accent" onClick={start} disabled={running || !kid} loading={running}>
              <Play size={14} />{running ? '上课中…' : '开一节课'}
            </Button>
          </div>
        </Card>

        <Card>
          <SectionTitle title="引导占比" icon={<Gauge size={14} className="text-cyan" />}
            desc="老师是在引导，还是在替你做题" />
          {!moves ? (
            <p className="text-[12px] text-fg-mute">上完一节就能看到。占比长期偏低 = 老师在念答案。</p>
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12px] text-fg-mute">引导类动作占比</span>
                <span className="font-mono text-[15px] text-cyan">{ratio === null ? '—' : Math.round(ratio * 100) + '%'}</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-veil/8">
                <div className="bg-ok" style={{ width: `${(moves.focus / (moves.focus + moves.probing + moves.telling || 1)) * 100}%` }} />
                <div className="bg-blue" style={{ width: `${(moves.probing / (moves.focus + moves.probing + moves.telling || 1)) * 100}%` }} />
                <div className="bg-amber" style={{ width: `${(moves.telling / (moves.focus + moves.probing + moves.telling || 1)) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[10.5px] text-fg-mute">
                <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-sm bg-ok" />focus {moves.focus}</span>
                <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-sm bg-blue" />probing {moves.probing}</span>
                <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-sm bg-amber" />telling {moves.telling}</span>
              </div>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle title="四个角色" desc="差异靠机制，不靠形容词" />
          <div className="flex flex-col gap-2.5 text-[11.5px] leading-relaxed">
            {[
              ['teacher', '掌握全部资料与学情数据，能跑 SQL、能查你的错题'],
              ['a', '资料齐全，但容易**跳过边界条件**直接下结论'],
              ['b', '记得语法，但常把**语义前提记串**（WHERE / HAVING、NULL）'],
              ['c', '**只拿到一句摘要**，容易把相邻概念混为一谈'],
            ].map(([r, desc]) => {
              const m = ROLE_META[r];
              return (
                <div key={r} className="flex gap-2">
                  <span className={cn('grid h-6 w-6 flex-none place-items-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-scrim', m.cls)}>{m.short}</span>
                  <span className="text-fg-mute"><b className="text-fg-soft">{m.name}</b>：{desc.replace(/\*\*/g, '')}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-fg-mute">
            学生手里**没有**「写完整解答」的工具 —— 会跑 SQL 不等于会写解法。
            这条边界靠提示词约束不住，只能靠工具表约束。
          </p>
        </Card>
      </div>

      {/* ============ 中：对话流 ============ */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-none items-center gap-3">
          <Badge tone={running ? 'accent' : 'neutral'}>
            {running && <Loader2 size={11} className="mr-1 animate-spin" />}{status}
          </Badge>
          <span className="ml-auto truncate text-[12px] text-fg-mute">{err || ''}</span>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col" padded={false}>
          {/* id 是给测试和排查用的：断言「对话流里没有裸露的标记」时
              必须把范围收在这一个容器里 —— 扫 document.body 会把
              表单必填项那个 `*` 也算进来，报出一个假失败。 */}
          <div id="stream" ref={streamRef as any} className="flex-1 overflow-y-auto p-4">
            {feed.length === 0 && !running ? (
              <Empty
                icon={<GraduationCap size={22} />}
                title="左边选一个考点，然后开一节课"
                desc="陈老师会先把考点讲透，三个水平不同的同学会跟着讨论——他们说的每句话都算数，包括说错的那部分。每一轮结束都会停下来等你答。"
              />
            ) : (
              <div className="flex flex-col gap-3.5">
                {feed.map((it, i) => <FeedItem key={i} entry={it} />)}
                {running && awaiting && (
                  <div className="self-center text-[11.5px] text-fg-mute">老师停下了，等你的回答…</div>
                )}
              </div>
            )}
          </div>

          {/* ---- 答题卡 ---- */}
          {ask && (
            <div className="mx-4 mb-3 rounded-lg border border-cyan/40 bg-cyan/8 p-3.5">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-cyan">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />该你了
              </div>
              <div className="mb-2 text-[13.5px] text-fg"><Markdown source={ask.prompt} /></div>
              {ask.hint && <div className="mb-2 border-l-2 border-hairline-strong pl-2 text-[11.5px] text-fg-mute">提示：{ask.hint}</div>}
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="h-9 min-w-0 flex-1 rounded-lg border border-hairline-strong bg-ink-1000/40 px-3 text-[13.5px] text-fg outline-none focus:border-cyan/60"
                  placeholder={ask.placeholder}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  /* ★ 中文输入法组合期回车是在选字，不是在交答案 */
                  onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) submit(answer); }}
                />
                <Button variant="accent" onClick={() => submit(answer)} disabled={!answer.trim()}>交答案</Button>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2 border-t border-hairline pt-2.5">
                {/* ★ 两个按钮都要有 —— 少一个这条链就断了：
                    用户会硬撑着说「懂了」，整个答疑阶段白跑。 */}
                <Button size="sm" variant="outline" onClick={() => submit('还是没懂')}>还是没懂</Button>
                <Button size="sm" variant="outline" onClick={() => submit('懂了，继续')}>懂了，继续</Button>
                <Button size="sm" variant="ghost" onClick={skip}><SkipForward size={13} />跳过这题</Button>
              </div>
            </div>
          )}

          {/* ---- 插话 ---- */}
          <div className="flex-none border-t border-hairline p-3">
            <div className="flex gap-2">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-hairline-strong bg-ink-1000/40 px-3 text-[13.5px] text-fg outline-none disabled:opacity-50 focus:border-cyan/60"
                disabled={!canInterject}
                placeholder={
                  !running ? '先选一个考点，开一节课'
                    : awaiting ? '先把上面那道题交了，再插话'
                      : '插一句话（老师下一轮会看到）'
                }
                value={interjectText}
                onChange={(e) => setInterjectText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) interject(); }}
              />
              <Button variant="outline" disabled={!canInterject || !interjectText.trim()} onClick={interject}>
                <Send size={13} />插话
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-fg-mute">
              {!running ? '开课之后可以随时插话' : awaiting ? '等你答完这道题，插话入口才会打开' : '插的话老师下一轮会看到'}
            </p>
          </div>
        </Card>
      </div>

      {/* ============ 右：黑板 ============ */}
      <Card className="hidden w-[400px] shrink-0 flex-col xl:flex" padded={false}>
        <div className="flex flex-none items-center gap-2 border-b border-hairline px-4 py-3">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_9px_var(--color-cyan)]" />
          <span className="text-[12.5px] font-semibold text-fg-soft">黑板</span>
          {board.length > 0 && <span className="ml-auto font-mono text-[10.5px] text-fg-mute">{board.length} 块</span>}
        </div>
        <div className="min-h-0 flex-1">
          <Board items={board} />
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   一条发言
   ============================================================ */
function FeedItem({ entry }: { entry: Entry }) {
  if (entry.k === 'round') {
    return (
      <div className="my-1 flex items-center gap-3">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-hairline-strong to-transparent" />
        <span className="whitespace-nowrap rounded-full border border-hairline bg-scrim/40 px-3 py-0.5 text-[11px] text-fg-mute">
          第 <b className="text-cyan">{entry.round + 1}</b> 轮 · {entry.label}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-hairline-strong to-transparent" />
      </div>
    );
  }

  if (entry.k === 'note') {
    return (
      <div className={cn('self-center rounded-full border px-3.5 py-0.5 text-center text-[11.5px]',
        entry.level === 'warn' ? 'border-warn/30 text-warn'
          : entry.level === 'err' ? 'border-bad/40 text-bad'
            : 'border-hairline bg-scrim/30 text-fg-mute')}>
        {entry.text}
      </div>
    );
  }

  if (entry.k === 'tool') {
    return (
      <div className={cn('flex items-center gap-2 self-start rounded-full border px-3 py-0.5 font-mono text-[11px]',
        entry.done ? 'border-hairline text-fg-mute opacity-70' : 'border-dashed border-hairline-strong text-fg-mute')}>
        {entry.done
          ? <span className={entry.ok ? 'text-ok' : 'text-bad'}>{entry.ok ? '✓' : '✕'}</span>
          : <Loader2 size={10} className="animate-spin text-cyan" />}
        {ROLE_META[entry.role]?.name || entry.role} {entry.done ? '用了' : '正在调用'} {entry.name}
        {entry.done && !entry.ok && entry.error ? `：${String(entry.error).slice(0, 40)}` : ''}
      </div>
    );
  }

  if (entry.k === 'user') {
    return (
      <div className="flex flex-row-reverse gap-2.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-gradient-to-br from-fg-soft to-fg-faint text-[12px] font-bold text-scrim">我</span>
        <div className="max-w-[78%] rounded-2xl border border-cyan/30 bg-cyan/12 px-3.5 py-2 text-[13.5px] text-fg">
          {/* 用户自己打的字走纯文本 —— 他可能写 `2 * 3`，别被斜体正则吃掉 */}
          <span className="whitespace-pre-wrap">{entry.text}</span>
        </div>
      </div>
    );
  }

  /* ★ 先把 role 收成局部变量再判。
   *   直接写 entry.role 的话 TS 收窄不了联合类型（isTeacher 是个独立布尔），
   *   后面每一处都得再判一次 —— 这个项目里踩过两次。 */
  const isTeacher = entry.k === 'teacher';
  const roleKey = isTeacher ? 'teacher' : entry.role;
  const m = ROLE_META[roleKey] || ROLE_META.a;

  return (
    <div className="flex gap-2.5">
      <span className={cn('grid h-8 w-8 flex-none place-items-center rounded-xl bg-gradient-to-br text-[12px] font-bold text-scrim', m.cls)}>
        {m.short}
      </span>
      <div className="min-w-0 max-w-[84%]">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-mute">
          <span className="font-semibold text-fg-soft">{m.name}</span>
          <span className="rounded-full border border-hairline px-1.5">{m.tag}</span>
          {isTeacher && entry.move && (
            <span className={cn('rounded-full border px-1.5 font-mono text-[10px]', MOVE_TONE[entry.move] || '')}>{entry.move}</span>
          )}
        </div>
        <div className={cn('rounded-2xl border px-3.5 py-2.5 text-[13.5px] leading-relaxed text-fg',
          isTeacher ? 'border-l-2 border-hairline border-l-amber bg-warn-soft/40' : 'border-hairline bg-scrim/25',
          roleKey === 'a' && 'border-l-2 border-l-cyan',
          roleKey === 'b' && 'border-l-2 border-l-violet',
          roleKey === 'c' && 'border-l-2 border-l-rose')}>
          {isTeacher ? <Markdown source={entry.text} /> : <TypedText text={entry.text} />}
          {isTeacher && entry.live && <span className="ai-caret" />}
        </div>
      </div>
    </div>
  );
}
