/* AI 黑板
 *
 * ── 黑板是一串动作，不是一张图 ──────────────────────────────────
 * 只有「画个图」的黑板本质是展示区，看两眼就走了。所以这里是动作族：
 *
 *   sql       —— 真的在教学库上跑出来的结果表（库课独有）
 *   graph     —— 函数图像，曲线从左到右描出来，参数可拖
 *   steps     —— 解题步骤，逐条错开落下
 *   latex     —— 公式 / 标准 SQL
 *   page      —— 翻页标记（不算块）
 *   clear     —— 擦除标记（不算块）
 *   highlight —— 打在已有块上的光（不算块）
 *
 * ── ★ 增量动画的记账（这里有个必踩的坑）────────────────────────
 * 黑板是**整块重画**的。如果不管新旧，每追加一行都会让整块黑板
 * 重播一遍入场动画 —— 看着像在抽搐。
 *
 * 正解：把「已经画了几块」记在容器上，只有超出的部分才带动画类。
 * 三个坑：
 *   ① 记账口径必须和渲染口径一致 —— highlight / page / clear 不渲染成块，
 *      就不能算进块数，否则计数比实际多，**该播动画的块不播**（静默失效）。
 *   ② 首次读不到标记时，fallback 是「当前块数」而不是 0 ——
 *      写 0 的话第一次收到新动作会把已有内容全当成新的，重播一遍。
 *   ③ 翻页 / 擦除之后要重置计数。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ResultTable, type ResultSet } from '@/components/sql/SqlParts';
import { highlightSql } from '@/lib/sqlHighlight';
import { compile, samplePoints } from '@/lib/expr';
import { renderLatex } from '@/lib/latex';
import { InlineMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export interface BoardItem {
  kind: 'sql' | 'graph' | 'steps' | 'latex' | 'page' | 'clear' | 'highlight';
  by?: string;
  [k: string]: any;
}

/** ★ 这个常量是**唯一口径**：哪些 kind 真的画成「一块」。
 *   它同时决定「记账数几块」和「highlight 在哪些块里找目标」。
 *   和服务端 tools.js 的 BOARD_BLOCK_KINDS 必须一致。 */
export const BOARD_BLOCK_KINDS: BoardItem['kind'][] = ['sql', 'graph', 'steps', 'latex'];

const isBlock = (it: BoardItem) => BOARD_BLOCK_KINDS.includes(it.kind);

/** 按 page 标记分页；clear 把之前的全部作废。 */
function groupPages(items: BoardItem[]): { pages: BoardItem[][]; lastClear: number } {
  const pages: BoardItem[][] = [[]];
  let lastClear = -1;
  items.forEach((it, i) => {
    if (!it) return;
    if (it.kind === 'clear') { pages.length = 0; pages.push([]); lastClear = i; return; }
    if (it.kind === 'page') { pages.push([]); return; }
    pages[pages.length - 1].push(it);
  });
  return { pages, lastClear };
}

function blockText(it: BoardItem): string {
  if (!it) return '';
  if (it.kind === 'sql') return `${it.sql || ''} ${it.datasetTitle || ''} ${(it.columns || []).join(' ')}`;
  if (it.kind === 'graph') return `${it.title || ''} ${it.expr || ''}`;
  if (it.kind === 'steps') return `${it.title || ''} ${(it.steps || []).join(' ')}`;
  if (it.kind === 'latex') return `${it.tex || ''} ${it.caption || ''}`;
  return '';
}

const ROLE_NAME: Record<string, string> = {
  teacher: '陈老师', a: '林一鸣', b: '周雨桐', c: '马小虎',
};

/* ============================================================
   图：可拖参数的曲线
   ============================================================ */
const GW = 460;
const GH = 280;
const GP = 34;

function GraphBlock({ item, fresh }: { item: BoardItem; fresh: boolean }) {
  const [scope, setScope] = useState<Record<string, number>>(() =>
    Object.fromEntries((item.params || []).map((p: any) => [p.name, p.value])),
  );
  /* 拖过之后就不再是「刚出现的块」了 —— 入场动画不该重播。
   * 语义上也对：他都在拖它了，它显然不是刚出现的。 */
  const [touched, setTouched] = useState(false);

  const fn = useMemo(() => {
    try { return compile(item.expr, (item.params || []).map((p: any) => p.name)); }
    catch { return null; }
  }, [item.expr, item.params]);

  const d = useMemo(() => {
    if (!fn) return '';
    const sx = (x: number) => GP + ((x - item.xmin) / (item.xmax - item.xmin)) * (GW - 2 * GP);
    const sy = (y: number) => GH - GP - ((y - item.ymin) / (item.ymax - item.ymin)) * (GH - 2 * GP);
    const pts = samplePoints(fn, item.xmin, item.xmax, 320, scope);
    let path = '';
    let pen = false;
    for (const [x, y] of pts) {
      if (y === null) { pen = false; continue; }
      const py = sy(y);
      if (py < -GH * 3 || py > GH * 4) { pen = false; continue; }
      path += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + py.toFixed(1);
      pen = true;
    }
    return path;
  }, [fn, item.xmin, item.xmax, item.ymin, item.ymax, scope]);

  /* 刻度：挑一个「整」的步长，分 4 段。
   * 分 6 段的话标签会挤成一团 —— 黑板这一栏只有四百来像素宽。 */
  const ticks = useMemo(() => {
    const stepOf = (span: number) => {
      const raw = span / 4;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const n = raw / mag;
      return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
    };
    const xs: number[] = []; const ys: number[] = [];
    const sx = stepOf(item.xmax - item.xmin);
    const sy = stepOf(item.ymax - item.ymin);
    for (let x = Math.ceil(item.xmin / sx) * sx; x <= item.xmax + 1e-9; x += sx) xs.push(Math.round(x * 1e6) / 1e6);
    for (let y = Math.ceil(item.ymin / sy) * sy; y <= item.ymax + 1e-9; y += sy) ys.push(Math.round(y * 1e6) / 1e6);
    return { xs, ys };
  }, [item.xmin, item.xmax, item.ymin, item.ymax]);

  const px = (x: number) => GP + ((x - item.xmin) / (item.xmax - item.xmin)) * (GW - 2 * GP);
  const py = (y: number) => GH - GP - ((y - item.ymin) / (item.ymax - item.ymin)) * (GH - 2 * GP);
  const ox = Math.max(GP, Math.min(GW - GP, px(0)));
  const oy = Math.max(GP, Math.min(GH - GP, py(0)));
  const clipId = `clip-${String(item.title || item.expr).replace(/[^\w]/g, '').slice(0, 16)}`;

  const params = item.params || [];

  return (
    <div>
      {item.title && <div className="mb-2 font-mono text-[11px] text-fg-mute">{item.title}</div>}
      <svg viewBox={`0 0 ${GW} ${GH}`} className="block w-full" role="img" aria-label={item.title || item.expr}>
        <defs>
          <clipPath id={clipId}>
            <rect x={GP} y={GP} width={GW - 2 * GP} height={GH - 2 * GP} />
          </clipPath>
        </defs>
        {ticks.xs.map((x) => (
          <g key={`x${x}`}>
            <line x1={px(x)} y1={GP} x2={px(x)} y2={GH - GP} stroke="currentColor" strokeWidth={1} className="text-fg-faint/15" />
            <text x={px(x)} y={GH - GP + 14} textAnchor="middle" className="fill-fg-mute font-mono text-[11px]">{x}</text>
          </g>
        ))}
        {ticks.ys.map((y) => (
          <g key={`y${y}`}>
            <line x1={GP} y1={py(y)} x2={GW - GP} y2={py(y)} stroke="currentColor" strokeWidth={1} className="text-fg-faint/15" />
            <text x={GP - 6} y={py(y) + 4} textAnchor="end" className="fill-fg-mute font-mono text-[11px]">{y}</text>
          </g>
        ))}
        <line x1={GP} y1={oy} x2={GW - GP} y2={oy} stroke="currentColor" strokeWidth={1} className="text-fg-faint/40" />
        <line x1={ox} y1={GP} x2={ox} y2={GH - GP} stroke="currentColor" strokeWidth={1} className="text-fg-faint/40" />
        <text x={GW - GP + 2} y={oy + 4} className="fill-fg-mute font-mono text-[11px]">x</text>
        <text x={ox + 6} y={GP - 2} className="fill-fg-mute font-mono text-[11px]">y</text>
        <g clipPath={`url(#${clipId})`}>
          {/* pathLength="1" 把路径长度归一化，描线动画就不用去量真实长度 */}
          <path
            pathLength={1}
            d={d}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            className={cn('stroke-cyan', fresh && !touched && 'ai-draw')}
            style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--color-cyan) 45%, transparent))' }}
          />
        </g>
      </svg>

      {params.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-dashed border-hairline-strong pt-3">
          {params.map((p: any) => (
            <label key={p.name} className="flex items-center gap-3">
              <span className="w-4 flex-none font-mono text-[12px] text-violet">{p.name}</span>
              <input
                type="range"
                className="ai-range h-1 flex-1"
                min={p.min}
                max={p.max}
                step={(p.max - p.min) / 200}
                value={scope[p.name] ?? p.value}
                onChange={(e) => { setTouched(true); setScope((s) => ({ ...s, [p.name]: Number(e.target.value) })); }}
              />
              <span className="w-12 flex-none text-right font-mono text-[11px] text-fg-soft">
                {Math.round((scope[p.name] ?? p.value) * 1000) / 1000}
              </span>
            </label>
          ))}
          <p className="text-[10.5px] text-fg-mute">拖一下滑块看曲线怎么变。坐标轴是钉死的 —— 不钉的话整张图会跟着手抖。</p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   一块
   ============================================================ */
function Block({ item, fresh, lit }: { item: BoardItem; fresh: boolean; lit?: BoardItem }) {
  const cls = cn('relative rounded-xl border bg-scrim/25 p-3 transition-colors',
    lit ? 'border-amber/60 bg-amber-soft shadow-[0_0_26px_-8px_var(--color-amber)]' : 'border-hairline');

  let body: React.ReactNode = null;

  if (item.kind === 'sql') {
    const rs: ResultSet = {
      sql: item.sql, columns: item.columns || [], rows: item.rows || [],
      rowCount: item.rowCount, truncated: item.truncated,
    };
    body = (
      <>
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-cyan">SQL</span>
          <span className="text-[11px] text-fg-mute">{item.datasetTitle || item.dataset}</span>
          {item.ms != null && <span className="ml-auto font-mono text-[10.5px] text-fg-mute">{item.ms}ms</span>}
        </div>
        <pre
          className="mb-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-code-bg p-2.5 font-mono text-[12px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlightSql(item.sql) }}
        />
        <ResultTable rs={rs} maxHeight={260} />
      </>
    );
  } else if (item.kind === 'graph') {
    body = <GraphBlock item={item} fresh={fresh} />;
  } else if (item.kind === 'steps') {
    body = (
      <>
        {item.title && <div className="mb-2 font-mono text-[11px] text-fg-mute">{item.title}</div>}
        <ol className="flex flex-col">
          {(item.steps || []).map((s: string, i: number) => (
            <li
              key={i}
              className={cn('relative border-b border-dashed border-hairline py-1.5 pl-8 text-[13px] leading-relaxed text-fg last:border-0',
                fresh && 'ai-step')}
              style={fresh ? { animationDelay: `${0.05 + i * 0.12}s` } : undefined}
            >
              <span className="absolute left-0 top-1.5 grid h-[19px] w-[19px] place-items-center rounded-md bg-gradient-to-br from-amber to-amber/70 font-mono text-[10px] font-bold text-scrim">
                {i + 1}
              </span>
              <InlineMarkdown text={s} />
            </li>
          ))}
        </ol>
      </>
    );
  } else if (item.kind === 'latex') {
    const isSql = item.lang === 'sql';
    body = (
      <>
        {isSql ? (
          <pre
            className="overflow-x-auto rounded-lg bg-code-bg p-3 font-mono text-[12.5px] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightSql(item.tex) }}
          />
        ) : (
          <div className="overflow-x-auto py-3 text-center text-[17px] leading-loose text-fg"
            dangerouslySetInnerHTML={{ __html: renderLatex(item.tex) }} />
        )}
        {item.caption && <div className="mt-1 text-center text-[11px] text-fg-mute">{item.caption}</div>}
      </>
    );
  }

  return (
    <div className={cls} data-kind={item.kind}>
      {lit && (
        <span className="absolute -top-2 right-3 rounded-full bg-amber px-2 text-[10px] font-bold text-scrim">圈</span>
      )}
      {body}
      {lit?.why && (
        <div className="mt-2 border-l-2 border-amber/50 pl-2 text-[11px] text-amber">{String(lit.why)}</div>
      )}
      {item.by && (
        <span className="absolute -bottom-2 left-3 rounded-full border border-hairline bg-scrim px-2 text-[9.5px] text-fg-mute">
          {ROLE_NAME[item.by] || item.by}
        </span>
      )}
    </div>
  );
}

/* ============================================================
   黑板
   ============================================================ */
export function Board({ items }: { items: BoardItem[] }) {
  const [page, setPage] = useState(0);
  /* ★ 记账 ref：读的是**上次提交后**的值，写发生在 useEffect 里。
   *   在 render 里直接写 ref 会在 StrictMode 双渲染下算错。 */
  const bookRef = useRef({ blocks: 0, clear: -1, page: 0 });

  const { pages, lastClear } = useMemo(() => groupPages(items), [items]);
  const total = Math.max(1, pages.length);
  const pageIdx = Math.max(0, Math.min(total - 1, page));
  const pageItems = pages[pageIdx] || [];
  const drawn = pageItems.filter(isBlock);
  const lights = pageItems.filter((it) => it.kind === 'highlight');

  const prev = bookRef.current;
  /* 翻页或擦除之后，整页都是「新出现的」，从头播动画 */
  const freshFrom = (prev.clear !== lastClear || prev.page !== pageIdx) ? 0 : prev.blocks;

  useEffect(() => {
    bookRef.current = { blocks: drawn.length, clear: lastClear, page: pageIdx };
  }, [drawn.length, lastClear, pageIdx]);

  /* 翻页/擦除后把页码拉回合法范围 */
  useEffect(() => {
    if (page > total - 1) setPage(total - 1);
  }, [page, total]);

  if (!drawn.length) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <div className="mb-3 text-[34px] leading-none text-fg-faint/40">∅</div>
          <p className="text-[12.5px] text-fg-mute">老师写上去的东西会出现在这里</p>
          <p className="mt-1 text-[11.5px] text-fg-faint">SQL 结果、曲线、解题步骤、公式</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-3.5 overflow-y-auto p-4"
      /* ★ 容器上带记账属性。这不只是给测试看的 ——
       *   它是「这一页已经画了几块」的唯一真相来源。 */
      data-blocks={drawn.length}
      data-clear={lastClear}
      data-page={pageIdx}
    >
      {total > 1 && (
        <div className="flex flex-none items-center gap-2 text-[10.5px] text-fg-mute">
          <button className="rounded border border-hairline px-2 disabled:opacity-30" disabled={pageIdx <= 0} onClick={() => setPage(pageIdx - 1)}>‹</button>
          <span className="font-mono">{pageIdx + 1}/{total}</span>
          <button className="rounded border border-hairline px-2 disabled:opacity-30" disabled={pageIdx >= total - 1} onClick={() => setPage(pageIdx + 1)}>›</button>
        </div>
      )}

      {pageItems.map((it, i) => {
        if (it.kind === 'highlight') return null;
        const blockIdx = drawn.indexOf(it);
        const lit = lights.find((l) => blockText(it).includes(String(l.target || '')));
        return <Block key={`${i}-${it.kind}`} item={it} fresh={blockIdx >= freshFrom} lit={lit} />;
      })}
    </div>
  );
}
