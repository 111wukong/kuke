/* 全局快捷键
 *
 * ══════════════════════════════════════════════════════════════
 * 两个刻意的设计决定
 * ══════════════════════════════════════════════════════════════
 *
 * ① 用「g 前缀」而不是单键。
 *    单键（比如直接按 d 去仪表盘）在浏览页面时太容易误触 ——
 *    学生正在读知识点，手搭在键盘上，一个 d 就把页面换了。
 *    「g 然后 d」是 Vim 的做法：多一个键，换来「几乎不可能误触」。
 *
 * ② **在输入框里一律不响应**。
 *    这是硬要求：学生在 SQL 编辑器里打字，内容里出现 g、? 都不该触发跳转。
 *    判断方式是看 event.target 是不是输入元素 —— 而不是「当前在哪个页面」，
 *    因为任何页面都可能有输入框（搜索框、备注框、班级邀请码）。
 *
 * ── 为什么值得做 ────────────────────────────────────────────────
 * 这个产品的重度用户是**老师**：他要在班级、作业、学生管理之间来回切。
 * 每次点侧边栏是两次视线移动 + 一次鼠标定位。
 * 一天切几十次，快捷键省下的不是时间，是注意力。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'lucide-react';
import { Kbd } from '@/components/ui/Primitives';
import { Modal } from '@/components/ui/Modal';

/** 跳转表。键是「g 后面那个字母」。 */
const GOTO: { key: string; to: string; label: string }[] = [
  { key: 'd', to: '/', label: '仪表盘' },
  { key: 'l', to: '/learn', label: '知识树' },
  { key: 'c', to: '/classroom', label: 'AI 课堂' },
  { key: 's', to: '/lab/sql', label: 'SQL 实训场' },
  { key: 'j', to: '/levels', label: 'SQL 闯关' },
  { key: 'p', to: '/practice', label: '每日一练' },
  { key: 'n', to: '/normalize', label: '范式实验室' },
  { key: 'i', to: '/lab', label: '索引与事务' },
  { key: 'r', to: '/review', label: '复习队列' },
  { key: 'm', to: '/mistakes', label: '错题本' },
  { key: 't', to: '/stats', label: '学习统计' },
  { key: 'a', to: '/assignments', label: '作业' },
  { key: 'k', to: '/classes', label: '班级' },
  { key: 'e', to: '/settings', label: '设置' },
];

/** 这个事件来自输入元素吗。 */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * 注册全局快捷键。
 * 返回 [面板是否打开, 打开, 关闭]。
 */
export function useHotkeys() {
  const nav = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  /* 「g 已按下，等下一个键」的状态。用 ref 而不是 state ——
   * 它不需要触发重渲染，用 state 反而会让每次按键都重画一遍。 */
  const pendingG = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* 输入框里什么都不做。Ctrl / Cmd / Alt 组合也放行给浏览器。 */
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;

      /* Esc：关帮助（抽屉的 Esc 在 AppShell 里另有一处） */
      if (e.key === 'Escape') { setHelpOpen(false); return; }

      /* ? ：帮助面板。Shift+/ 在多数键盘上就是问号。 */
      if (e.key === '?') { e.preventDefault(); setHelpOpen((v) => !v); return; }

      /* g 前缀：1.5 秒内按下一个字母才生效 */
      const now = Date.now();
      if (e.key === 'g') { pendingG.current = now; return; }

      if (pendingG.current && now - pendingG.current < 1500) {
        const hit = GOTO.find((x) => x.key === e.key.toLowerCase());
        pendingG.current = 0;
        if (hit) { e.preventDefault(); setHelpOpen(false); nav(hit.to); }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return [helpOpen, () => setHelpOpen(true), () => setHelpOpen(false)] as const;
}

/** 快捷键帮助面板。 */
export function HotkeyHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="键盘快捷键">
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-fg-mute">
          先按 <Kbd>g</Kbd>，再按下面任意一个字母即可跳转。
          两键组合是为了避免误触 —— 单键在浏览页面时太容易按到。
        </p>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {GOTO.map((g) => (
            <div
              key={g.key}
              className="flex items-center gap-2.5 rounded-lg border border-hairline bg-veil/3 px-3 py-2"
            >
              <span className="flex shrink-0 items-center gap-1">
                <Kbd>g</Kbd>
                <span className="text-[10px] text-fg-faint">然后</span>
                <Kbd>{g.key}</Kbd>
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">{g.label}</span>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-hairline pt-3.5">
          <div className="flex items-center gap-2.5 text-[12.5px] text-fg-soft">
            <Kbd>?</Kbd>
            <span>打开 / 关闭这个面板</span>
          </div>
          <div className="flex items-center gap-2.5 text-[12.5px] text-fg-soft">
            <Kbd>Esc</Kbd>
            <span>关闭弹窗 / 抽屉</span>
          </div>
          <div className="flex items-center gap-2.5 text-[12.5px] text-fg-soft">
            <Kbd>Ctrl</Kbd><span className="text-fg-faint">+</span><Kbd>Enter</Kbd>
            <span>在 SQL 编辑器里运行</span>
          </div>
        </div>

        <p className="text-[11.5px] leading-relaxed text-fg-faint">
          在输入框里打字时快捷键不生效 —— 不然你在 SQL 编辑器里写{' '}
          <code className="rounded bg-veil/6 px-1 font-mono">GROUP BY</code>{' '}
          会一路触发跳转。
        </p>
      </div>
    </Modal>
  );
}

/** 侧边栏底部的入口，让快捷键能被发现（藏着的功能等于没有）。 */
export function HotkeyHint({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-fg-faint transition-colors hover:bg-veil/6 hover:text-fg-mute"
      title="查看键盘快捷键"
    >
      <Command size={12} />
      <span className="flex-1">快捷键</span>
      <Kbd>?</Kbd>
    </button>
  );
}
