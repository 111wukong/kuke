/* SQL 编辑器
 *
 * ── 实现方式：透明 textarea 叠在高亮层上 ────────────────────────
 * 不用 contentEditable（IME 中文输入会崩），不引 CodeMirror（200KB）。
 * 做法是：
 *   底层  <pre>      —— 放着高亮后的 HTML，不可交互
 *   上层  <textarea> —— 真实输入，文字**透明**、光标可见
 * 两层必须像素级对齐，否则光标会跑到文字中间。
 *
 * ── ★ 对齐这件事只有一次机会做对 ────────────────────────────────
 * 下面这些属性**两层必须完全一致**，任何一项不同都会错位：
 *   字体族 / 字号 / 行高 / letter-spacing / tab-size / padding / border / white-space
 * 所以它们统一写在 SHARED 常量里，两处都引用它 ——
 * 分别写两遍的话，改一处忘另一处就会错位，而且症状是"打字时光标飘"，
 * 很难联想到是 padding 差了两像素。
 *
 * ── 另一个坑：textarea 的换行规则 ───────────────────────────────
 * textarea 默认 white-space: pre-wrap，长行会自动折行。
 * 高亮层必须用同样的规则，否则折行位置不同 → 错位。
 * 但 pre-wrap 在 SQL 里不理想（一条长语句折成三行很难读），
 * 所以这里用 nowrap + 横向滚动，两层都设。
 */
import {
  useCallback, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent,
} from 'react';
import { Play, Eraser, Wand2, Loader2, Lightbulb, Eye } from 'lucide-react';
import { highlightSql, formatSql } from '@/lib/sqlHighlight';
import { cn } from '@/lib/utils';

/** 两层共享的排版参数。**只此一份** —— 见文件头的说明。 */
const SHARED: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  lineHeight: '1.7',
  letterSpacing: '0',
  tabSize: 2,
  padding: '12px 14px',
  border: '0',
  margin: 0,
  whiteSpace: 'pre',
  wordWrap: 'normal',
  overflowWrap: 'normal',
};

export interface SqlEditorProps {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  onFormat?: () => void;
  running?: boolean;
  placeholder?: string;
  /** 最小行数。编辑器高度会随内容长到 maxRows，超过才滚动。 */
  minRows?: number;
  maxRows?: number;
  readOnly?: boolean;
  fontSize?: number;
  className?: string;
  /** 工具栏右侧的额外按钮（比如"看提示"）。 */
  extraTools?: React.ReactNode;
  onHint?: () => void;
  onReveal?: () => void;
  showFormat?: boolean;
}

export function SqlEditor({
  value, onChange, onRun, onFormat, running,
  placeholder = '在这里写 SQL…  按 Ctrl/⌘ + Enter 运行',
  minRows = 5, maxRows = 22,
  readOnly, fontSize, className,
  extraTools, onHint, onReveal, showFormat = true,
}: SqlEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [lineCount, setLineCount] = useState(minRows);

  const html = useMemo(() => highlightSql(value), [value]);

  const shared = useMemo(
    () => (fontSize ? { ...SHARED, fontSize: `${fontSize}px` } : SHARED),
    [fontSize],
  );

  /* 高度自适应：按内容行数长，超过 maxRows 就内部滚动。
   * 用 useLayoutEffect 而不是 useEffect —— 后者在 paint 之后跑，
   * 用户会看到高度"跳"一下。 */
  useLayoutEffect(() => {
    const rows = value.split('\n').length;
    setLineCount(Math.max(minRows, Math.min(maxRows, rows)));
  }, [value, minRows, maxRows]);

  const syncScroll = useCallback(() => {
    if (!preRef.current || !taRef.current) return;
    preRef.current.scrollTop = taRef.current.scrollTop;
    preRef.current.scrollLeft = taRef.current.scrollLeft;
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/⌘ + Enter 运行。这是 SQL 工具的通用快捷键。
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun?.();
      return;
    }
    /* Tab 插入两个空格而不是跳焦点。
     * ★ 但必须留一个逃生口：Shift+Tab 仍然跳到下一个控件 ——
     * 否则键盘用户会被这个编辑器困住（Tab 出不去）。 */
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const next = value.slice(0, s) + '  ' + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  }, [value, onChange, onRun]);

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl border border-hairline bg-ink-1000/50', className)}>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline bg-veil/3 px-2.5 py-1.5">
        {onRun && (
          <button
            onClick={onRun}
            disabled={running}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium btn-accent disabled:opacity-50"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {running ? '执行中' : '运行'}
          </button>
        )}
        {showFormat && (
          <button
            onClick={() => { onChange(formatSql(value)); onFormat?.(); }}
            disabled={readOnly}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[12.5px] text-fg-soft hover:bg-veil/6 disabled:opacity-40"
            title="整理成易读的格式"
          >
            <Wand2 size={13} />
            格式化
          </button>
        )}
        <button
          onClick={() => onChange('')}
          disabled={readOnly || !value}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[12.5px] text-fg-soft hover:bg-veil/6 disabled:opacity-40"
        >
          <Eraser size={13} />
          清空
        </button>

        {onHint && (
          <button
            onClick={onHint}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[12.5px] text-warn hover:bg-warn/10"
          >
            <Lightbulb size={13} />
            提示
          </button>
        )}
        {onReveal && (
          <button
            onClick={onReveal}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[12.5px] text-fg-soft hover:bg-veil/6"
          >
            <Eye size={13} />
            看答案
          </button>
        )}

        <span className="ml-auto hidden items-center gap-1 text-[11px] text-fg-faint sm:flex">
          <kbd className="rounded border border-hairline px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd>
          <span>+</span>
          <kbd className="rounded border border-hairline px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
          <span>运行</span>
        </span>
        {extraTools}
      </div>

      {/* 编辑区：高亮层 + 输入层 */}
      <div className="relative">
        <pre
          ref={preRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-auto"
          style={shared}
        >
          <code dangerouslySetInnerHTML={{ __html: html + '\n' }} />
        </pre>

        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          readOnly={readOnly}
          placeholder={placeholder}
          className="relative w-full resize-none bg-transparent outline-none placeholder:text-fg-faint"
          style={{
            ...shared,
            height: `${lineCount * 1.7 * (fontSize || 13) + 24}px`,
            /* ★ 文字透明但光标可见。少了 caret-color，光标会跟着文字一起消失，
             * 用户根本不知道自己在哪打字。 */
            color: 'transparent',
            caretColor: 'var(--color-fg)',
          }}
        />
      </div>
    </div>
  );
}
