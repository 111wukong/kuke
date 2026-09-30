/* Markdown 渲染器
 *
 * ── 为什么自己写而不引 marked / react-markdown ──────────────────
 * 本课程的内容只用到九种语法：标题、粗体、斜体、行内代码、围栏代码块、
 * 表格、引用、有序/无序列表、分隔线，外加 $...$ 行内数学。
 * 引一个通用 Markdown 库，换来的是 40KB + 一整套 HTML 净化配置
 * （因为通用库默认输出 HTML 字符串，必须再挂一层 sanitizer）。
 * 自己写的话，**从设计上就不产生 HTML 字符串** ——
 * 除了 SQL 高亮那一处（它自己做了转义），其余全部走 React 元素。
 *
 * ── ★ 这个渲染器最容易出的缺陷：标记漏屏 ────────────────────────
 * 症状是气泡里看到裸露的 ** 或 $ 或 `，页面不报错、测试全绿。
 * 根因几乎都是**同一份内容被两种格式的输入混着喂**：
 *   · 模型/老师写的是 Markdown（**粗体**）
 *   · 本地数据里是裸 LaTeX（\sigma）
 * 所以本实现的顺序是固定的三层，不能调换：
 *   ① 分块（先切出代码块，代码块内部**不做任何行内解析**）
 *   ② 行内（在非代码块的文本上做，且行内代码优先于粗体）
 *   ③ 数学（最后处理 $...$，避免 $ 被当成普通字符吞掉）
 *
 * ── 另一个坑：中文排版 ─────────────────────────────────────────
 * 汉字之间不加空格、不加 letter-spacing；粗体用 font-weight 而不是
 * 换成别的颜色（中文加粗本来就不明显，换色会更乱）。
 */
import { type ReactNode, useMemo, Fragment } from 'react';
import { highlightSql, escapeHtml } from './sqlHighlight';
import { renderLatex } from './latex';

/* ============ 行内解析 ============ */

type InlineToken =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'math'; v: string }
  | { t: 'mathBlock'; v: string }
  | { t: 'link'; v: string; href: string };

/* 一次扫描搞定，顺序即优先级：
 *   行内代码 → 块级数学 → 行内数学 → 粗体 → 斜体 → 链接
 *
 * ★ `$$…$$` 必须排在 `$…$` **前面**。
 *   反过来的话，`$$F = \{A \to B\}$$` 会被单 `$` 那条先匹配成
 *   `$` + `$F = \{A \to B\}$` + `$` —— 屏幕上就是
 *   **两个裸露的美元号夹着一串原始反斜杠**。
 *   范式实验室里 15 道题的题干全踩在这上面。
 *
 * 行内代码必须最先，否则 `**` 会被当成粗体标记；
 * 数学要在粗体之前，因为 $...$ 里可能出现 * 号。 */
const INLINE_RE = new RegExp([
  '(`[^`\\n]+`)',                     // 1 行内代码
  '(\\$\\$[^$\\n]+\\$\\$)',           // 2 块级数学（$$…$$）
  '(\\$[^$\\n]+\\$)',                 // 3 行内数学
  '(\\*\\*[^*\\n]+\\*\\*)',           // 4 粗体
  /* ★ 斜体要卡住「星号两边不能是空白」。
   *   原来写作 \*[^*\n]+\*，于是 `2 * 3 * 4` 里的 `* 3 *`
   *   会被当成斜体吃掉 —— 而 AI 讲数学时到处都在写乘号。
   *   内容首尾都不许是空白，单字符也允许（`*x*`）。 */
  '(\\*[^\\s*](?:[^*\\n]*[^\\s*])?\\*)', // 5 斜体
  '(!?\\[[^\\]\\n]*\\]\\([^)\\s]+\\))', // 6 链接
].join('|'), 'g');

function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    const raw = m[0];
    if (m[1]) out.push({ t: 'code', v: raw.slice(1, -1) });
    else if (m[2]) out.push({ t: 'mathBlock', v: raw.slice(2, -2) });
    else if (m[3]) out.push({ t: 'math', v: raw.slice(1, -1) });
    else if (m[4]) out.push({ t: 'bold', v: raw.slice(2, -2) });
    else if (m[5]) out.push({ t: 'italic', v: raw.slice(1, -1) });
    else if (m[6]) {
      const lm = raw.match(/^!?\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (lm) out.push({ t: 'link', v: lm[1], href: lm[2] });
      else out.push({ t: 'text', v: raw });
    }
    last = m.index + raw.length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

/** 行内元素 → React 节点。
 *
 * ★ 只有**数学**这一处会产生 HTML 字符串（其余全部走 React 元素，
 *   从设计上就没有 XSS 面）。它安全的原因是 `renderLatex()` 内部
 *   **第一步就 escapeHtml** —— 公式里的 `<script>` 会先变成实体。
 *   这个顺序不能反，见 latex.ts 顶部的说明。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((tok, i) => {
    const k = `${keyPrefix}-i${i}`;
    switch (tok.t) {
      case 'code': return <code key={k} className="inline-code">{tok.v}</code>;
      /* ★ 数学要走**真正的转换**，不能只把原始 TeX 塞进一个 span。
       *   原来这里是 <span className="math">{tok.v}</span> ——
       *   于是 `$F = \{A \to B\}$` 在屏幕上原样显示成
       *   `F = \{A \to B\}`（反斜杠一条不少），而页面不报错、测试全绿。
       *   范式实验室 15 道题的题干、知识点正文里的 \sigma \pi \cup
       *   全踩在这上面。 */
      case 'math': return <span key={k} className="math" dangerouslySetInnerHTML={{ __html: renderLatex(tok.v) }} />;
      /* 块级公式用 span + display:block，**不要用 div** ——
       * div 落在 <p> 里会被浏览器强行拆出去，后面的文字跑到公式外面。 */
      case 'mathBlock': return <span key={k} className="math-block" dangerouslySetInnerHTML={{ __html: renderLatex(tok.v) }} />;
      case 'bold': return <strong key={k}>{renderInline(tok.v, k)}</strong>;
      /* ★ 粗体/斜体的内容要**递归解析**，不能当纯文本塞进去。
       *   模型特别爱把术语和公式一起加粗（`**当 $x \to 0$ 时**`），
       *   而外层正则先匹配到粗体、把里面整段当内容收下 ——
       *   不递归的话里面的 `$...$` 就原样漏到屏幕上，
       *   表现为「加粗那段里的公式没渲染」，而别的公式都好好的。 */
      case 'italic': return <em key={k}>{renderInline(tok.v, k)}</em>;
      case 'link': {
        // 只放行 http/https —— javascript: 和 data: 会被拦下
        const safe = /^https?:\/\//i.test(tok.href) ? tok.href : '#';
        return <a key={k} href={safe} target="_blank" rel="noopener noreferrer">{tok.v}</a>;
      }
      default: return <Fragment key={k}>{tok.v}</Fragment>;
    }
  });
}

/* ============ 块级解析 ============ */

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; lang: string; code: string }
  | { t: 'p'; text: string }
  | { t: 'quote'; lines: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' };

function splitRow(line: string): string[] {
  // 去掉首尾竖线后按 | 切。不处理转义的 \| —— 课程内容里用不到。
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());
}

function parseBlocks(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* ---- 围栏代码块 ----
     * ★ 一旦进入，直到闭合围栏为止**整段原样收下**，不做任何行内解析。
     * 少这一步，代码块里的 `**` 和 `$` 就会被当成 Markdown 标记处理掉。 */
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const lang = (fence[1] || '').toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过闭合围栏
      blocks.push({ t: 'code', lang, code: buf.join('\n') });
      continue;
    }

    if (!line.trim()) { i++; continue; }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2].trim() }); i++; continue; }

    /* ---- 表格 ----
     * 判定条件：本行含 |，且下一行是分隔行（|---|:--:|）。 */
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ t: 'quote', lines: buf });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ t: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ t: 'ol', items });
      continue;
    }

    // 段落：连续非空行合成一段
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim()
      && !/^\s*```/.test(lines[i])
      && !/^#{1,6}\s/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+[.)]\s+/.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]))) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ t: 'p', text: buf.join(' ') });
  }

  return blocks;
}

/* ============ 代码块组件 ============ */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  /* ★ 唯一使用 innerHTML 的地方。输入经 highlightSql 处理，
   * 它内部对每个 token 原文做了 escapeHtml（顺序是"先切 token 再转义"，
   * 不会把 span 标签也转掉）。标签名和类名都是常量，不含用户输入。 */
  const html = useMemo(
    () => (lang === 'sql' ? highlightSql(code) : escapeHtml(code)),
    [lang, code],
  );

  return (
    <div className="code-block relative">
      {lang && (
        <span className="absolute right-2.5 top-1.5 select-none text-[10px] uppercase tracking-wider text-fg-faint">
          {lang}
        </span>
      )}
      <pre className="p-3.5 pr-12">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/* ============ 对外组件 ============ */

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(source || ''), [source]);

  return (
    <div className={`prose-doc ${className || ''}`}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'h': {
            const Tag = (`h${Math.min(b.level, 4)}`) as 'h1';
            return <Tag key={k}>{renderInline(b.text, k)}</Tag>;
          }
          case 'code':
            return <CodeBlock key={k} lang={b.lang} code={b.code} />;
          case 'hr':
            return <hr key={k} />;
          case 'quote':
            return (
              <blockquote key={k}>
                {b.lines.map((l, j) => (
                  <p key={`${k}-${j}`}>{renderInline(l, `${k}-${j}`)}</p>
                ))}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={k}>
                {b.items.map((it, j) => <li key={`${k}-${j}`}>{renderInline(it, `${k}-${j}`)}</li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={k}>
                {b.items.map((it, j) => <li key={`${k}-${j}`}>{renderInline(it, `${k}-${j}`)}</li>)}
              </ol>
            );
          case 'table':
            return (
              /* ★ 必须包一层横向滚动容器 —— 课程里的对照表经常 5 列以上，
                 窄屏上会把整页撑破。 */
              <div key={k} className="table-wrap">
                <table>
                  <thead>
                    <tr>{b.head.map((h, j) => <th key={j}>{renderInline(h, `${k}-h${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, l) => <td key={l}>{renderInline(cell, `${k}-${j}-${l}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={k}>{renderInline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}

/** 单行 Markdown（表格单元格、标题这类地方用，不产生 <p>）。 */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInline(text || '', 'x')}</>;
}

export { parseBlocks, parseInline };
