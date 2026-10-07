/* 弹窗
 *
 * ── 五个必须做对的地方 ──────────────────────────────────────────
 * 1. **Esc 关闭**。没有它，键盘用户会被困在弹窗里。
 * 2. **点遮罩关闭，但点内容不关闭**。这需要在内容上 stopPropagation ——
 *    漏了的话，在弹窗里选中文字拖到外面松手就会把弹窗关掉。
 * 3. **锁住背景滚动**。不锁的话，滚轮会穿透到下面的页面，
 *    用户会看到"弹窗没动，背景在滚"。
 * 4. **焦点圈在弹窗内**（focus trap）。弹窗之外的内容虽然被遮罩挡住，
 *    但 Tab 键照样能走进去 —— 键盘用户会在看不见的控件之间跳。
 * 5. **关闭时把焦点还给触发它的那个按钮**。不还的话，焦点掉回 <body>，
 *    下一次按 Tab 从页面最顶上重新开始 —— 用户刚才在列表第 40 行点的
 *    "删除"，关掉弹窗后被弹回页首，得重新滚回去。
 *
 * ★ 关于 effect 的依赖数组（这里有个容易踩的坑）
 *   早期版本写的是 `[open, onClose]`。但调用方几乎都写成内联箭头函数
 *   `<Modal onClose={() => setOpen(false)}>` —— 每次父组件渲染都是**新的
 *   函数引用**，于是 effect 反复「清理 → 重建」：每重建一次就把焦点重新
 *   聚焦到弹窗第一个控件。表现是「在输入框里打字打到一半，光标突然跳走」。
 *   现在用 ref 存回调，effect 只依赖 `open` —— 开一次、关一次，各执行一遍。
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 弹窗内可聚焦的元素。每次调用现查 —— 内容会变（错误提示、动态行）。 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  open, onClose, title, children, footer, width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  /* 打开前焦点在哪。关闭时还给它。 */
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    /* 记下触发者。用 document.activeElement 而不是让调用方传 —— 
     * 调用方有二十几处，逐个改 ref 既啰嗦又容易漏。 */
    triggerRef.current = document.activeElement as HTMLElement | null;

    /* 聚焦弹窗内第一个可聚焦元素；一个都没有就把焦点给容器本身
     * （容器有 tabIndex={-1}），否则焦点还留在弹窗外面。 */
    const focusFirst = () => {
      const list = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      const target = list?.length ? list[0] : dialogRef.current;
      target?.focus();
    };
    /* 等一帧 —— 弹窗刚挂载时子元素还没测量完，立刻 focus 有时会失败。 */
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;

      const list = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!list || list.length === 0) { e.preventDefault(); return; }

      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      /* 焦点跑到弹窗外了（比如从地址栏 Tab 回来），也拉回圈内。 */
      const outside = !dialogRef.current?.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    /* 锁背景滚动。★ 用 overflow: hidden 而不是 position: fixed ——
     * 后者会把页面滚回顶部（因为 fixed 元素脱离文档流，页面高度塌陷）。 */
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      /* 焦点归还。★ 只在元素还在文档里时还 —— 触发按钮所在的整行可能
       * 已经被删掉了（"删掉这一行"这个操作本身），focus 一个已卸载的
       * 元素会把焦点丢到 <body>，和没还一样。 */
      const t = triggerRef.current;
      if (t && document.contains(t)) t.focus();
    };
  }, [open]);

  if (!open) return null;

  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[width];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-scrim/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn('glass glass-strong rise-in my-auto w-full rounded-xl outline-none', w)}
        /* 点内容不关窗。少了这行，在弹窗里选中文字拖到外面松手就关了。 */
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div id={titleId} className="text-[14.5px] font-semibold text-fg">{title}</div>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-fg-mute transition-colors hover:bg-veil/8 hover:text-fg"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3.5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 确认框。用于删除这类不可逆操作 —— 它会明确写出"会发生什么"。 */
export function ConfirmModal({
  open, onClose, onConfirm, title, body, confirmText = '确认', danger, loading,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; body: ReactNode; confirmText?: string; danger?: boolean; loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={(
        <>
          {/* ★ 按钮从 h-8（32px）提到 h-9（36px）—— 桌面端可点击元素的最小高度。
              32px 在触摸屏上需要瞄准，而确认框恰恰是「不能点错」的地方。
              取消在左、确认在右，与系统对话框的方向一致。 */}
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-hairline-strong px-3.5 text-[13px] text-fg-soft hover:bg-veil/6"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium disabled:opacity-50',
              danger ? 'bg-bad text-white hover:brightness-110' : 'btn-accent',
            )}
          >
            {/* 异步操作期间给转圈 —— 只把文字改成「处理中…」的话，
                用户不知道是卡住了还是在跑。 */}
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? '处理中…' : confirmText}
          </button>
        </>
      )}
    >
      <div className="text-[13px] leading-relaxed text-fg-soft">{body}</div>
    </Modal>
  );
}
