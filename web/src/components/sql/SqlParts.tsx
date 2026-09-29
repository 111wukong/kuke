/* SQL 相关的小组件：结果表、数据集浏览器、执行信息条
 *
 * ── 结果表里 NULL 必须**显式显示成 NULL** ───────────────────────
 * 留空的话，学生分不清"这一格是 NULL"和"这一格是空字符串" ——
 * 而这门课里 NULL 语义是重点，混淆这两者会直接导致做错题。
 * 所以 NULL 用斜体灰色字显式写出来，空字符串则显示成一对引号。
 */
import { useState } from 'react';
import { Table2, Key, Link2, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { cn, copyText } from '@/lib/utils';
import { Badge } from '@/components/ui/Primitives';

export interface ResultSet {
  sql: string;
  kind?: string;
  columns: string[];
  rows: any[][];
  rowCount?: number;
  truncated?: boolean;
  changes?: number;
  error?: string;
  blocked?: boolean;
}

/* ============ 单元格 ============ */

export function Cell({ v }: { v: any }) {
  if (v === null || v === undefined) {
    return <span className="font-mono text-[12px] italic text-fg-faint">NULL</span>;
  }
  if (typeof v === 'number') {
    return <span className="font-mono text-[12.5px] tabular-nums text-fg">{v}</span>;
  }
  if (typeof v === 'string' && v === '') {
    // 空字符串显示成一对引号，和 NULL 区分开
    return <span className="font-mono text-[12px] text-fg-mute">&apos;&apos;</span>;
  }
  const s = String(v);
  return (
    <span className="font-mono text-[12.5px] text-fg" title={s.length > 60 ? s : undefined}>
      {s.length > 120 ? `${s.slice(0, 120)}…` : s}
    </span>
  );
}

/* ============ 结果表 ============ */

export function ResultTable({ rs, maxHeight = 360 }: { rs: ResultSet; maxHeight?: number }) {
  const [copied, setCopied] = useState(false);

  if (rs.error) {
    return (
      <div className={cn(
        'rounded-lg border p-3',
        rs.blocked ? 'border-warn/30 bg-warn-soft' : 'border-bad/30 bg-bad-soft',
      )}>
        <div className={cn('text-[12.5px] font-medium', rs.blocked ? 'text-warn' : 'text-bad')}>
          {rs.blocked ? '这条语句被沙箱拦下了' : '执行出错'}
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] text-fg-soft">{rs.error}</pre>
      </div>
    );
  }

  // 写操作没有结果集，但有影响行数
  if (!rs.columns?.length) {
    return (
      <div className="rounded-lg border border-hairline bg-veil/3 p-3 text-[12.5px] text-fg-soft">
        {rs.kind ? `执行成功：${rs.kind.toUpperCase()}` : '执行成功'}
        {typeof rs.changes === 'number' && (
          <span className="ml-2 text-fg-mute">影响了 <b className="text-fg">{rs.changes}</b> 行</span>
        )}
      </div>
    );
  }

  const copyAsTsv = async () => {
    const tsv = [rs.columns.join('\t'), ...rs.rows.map((r) => r.map((c) => (c === null ? '' : String(c))).join('\t'))].join('\n');
    if (await copyText(tsv)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-hairline">
      <div className="flex items-center justify-between gap-2 border-b border-hairline bg-veil/4 px-2.5 py-1.5">
        <div className="flex items-center gap-2 text-[11.5px] text-fg-mute">
          <Table2 size={13} />
          <span>{rs.rows.length} 行 · {rs.columns.length} 列</span>
          {rs.truncated && <Badge tone="warn">已截断显示</Badge>}
        </div>
        <button
          onClick={copyAsTsv}
          className="inline-flex items-center gap-1 rounded border border-hairline px-1.5 py-0.5 text-[11px] text-fg-mute hover:bg-veil/6 hover:text-fg"
          title="复制为 TSV（可直接粘进 Excel）"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border-b border-r border-hairline bg-ink-900/90 px-2 py-1.5 text-right text-[10.5px] font-medium text-fg-faint backdrop-blur">
                #
              </th>
              {rs.columns.map((c, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-hairline bg-ink-900/90 px-2.5 py-1.5 text-left text-[11.5px] font-semibold text-cyan backdrop-blur"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rs.rows.map((row, ri) => (
              <tr key={ri} className="odd:bg-veil/2 hover:bg-veil/6">
                <td className="border-b border-r border-hairline px-2 py-1 text-right font-mono text-[10.5px] text-fg-faint">
                  {ri + 1}
                </td>
                {row.map((c, ci) => (
                  <td key={ci} className="border-b border-hairline px-2.5 py-1 align-top">
                    <Cell v={c} />
                  </td>
                ))}
              </tr>
            ))}
            {!rs.rows.length && (
              <tr>
                <td colSpan={rs.columns.length + 1} className="px-3 py-5 text-center text-[12.5px] text-fg-mute">
                  查询成功，但没有返回任何行。
                  <div className="mt-0.5 text-[11.5px] text-fg-faint">
                    想想是不是 WHERE 条件太严了，或者关联字段写错了。
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============ 执行信息条 ============ */

export function RunMeta({ ms, warnCount }: { ms: number; warnCount?: number }) {
  const tone = ms < 50 ? 'text-ok' : ms < 300 ? 'text-fg-mute' : 'text-warn';
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-fg-mute">
      <span>耗时 <b className={tone}>{ms} ms</b></span>
      {!!warnCount && <span className="text-warn">{warnCount} 条提醒</span>}
    </div>
  );
}

/* ============ 数据集浏览器 ============ */

interface ColumnMeta { name: string; type: string; pk?: boolean; fk?: string; comment?: string }
interface TableMeta { name: string; comment: string; rows: number; columns: ColumnMeta[] }

export function SchemaBrowser({
  tables, onInsert, className,
}: { tables: TableMeta[]; onInsert?: (text: string) => void; className?: string }) {
  const [open, setOpen] = useState<string | null>(tables[0]?.name ?? null);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {tables.map((t) => {
        const isOpen = open === t.name;
        return (
          <div key={t.name} className="overflow-hidden rounded-lg border border-hairline bg-veil/2">
            <button
              onClick={() => setOpen(isOpen ? null : t.name)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-veil/5"
            >
              {isOpen ? <ChevronDown size={13} className="text-fg-faint" /> : <ChevronRight size={13} className="text-fg-faint" />}
              <span
                className="font-mono text-[12.5px] font-semibold text-cyan hover:underline"
                onClick={(e) => { if (onInsert) { e.stopPropagation(); onInsert(t.name); } }}
                title={onInsert ? '点击插入表名' : undefined}
              >
                {t.name}
              </span>
              <span className="truncate text-[11px] text-fg-mute">{t.comment}</span>
              <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-fg-faint">{t.rows} 行</span>
            </button>

            {isOpen && (
              <div className="border-t border-hairline">
                {t.columns.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center gap-1.5 border-b border-hairline/60 px-2.5 py-1.5 last:border-b-0 hover:bg-veil/4"
                  >
                    {/* lucide 的图标组件不接受 title 属性，
                        想给 tooltip 必须包一层带 title 的元素。 */}
                    {c.pk ? (
                      <span title="主键" className="shrink-0"><Key size={10} className="text-amber" /></span>
                    ) : c.fk ? (
                      <span title={`外键 → ${c.fk}`} className="shrink-0"><Link2 size={10} className="text-violet" /></span>
                    ) : (
                      <span className="w-[10px] shrink-0" />
                    )}
                    <button
                      className="shrink-0 font-mono text-[11.5px] text-fg hover:text-cyan"
                      onClick={() => onInsert?.(c.name)}
                      title={onInsert ? '点击插入列名' : undefined}
                    >
                      {c.name}
                    </button>
                    <span className="shrink-0 text-[10.5px] uppercase text-fg-faint">{c.type}</span>
                    {c.comment && <span className="truncate text-[11px] text-fg-mute">{c.comment}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============ 建表语句弹窗内容 ============ */

export function DdlView({ ddl }: { ddl: string }) {
  return (
    <pre className="code-block max-h-[60vh] overflow-auto p-3 font-mono text-[12px] leading-relaxed text-fg-soft">
      {ddl}
    </pre>
  );
}
