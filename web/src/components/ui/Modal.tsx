/* 弹窗
 *
 * ── 三个必须做对的地方 ──────────────────────────────────────────
 * 1. **Esc 关闭**。没有它，键盘用户会被困在弹窗里。
 * 2. **点遮罩关闭，但点内容不关闭**。这需要在内容上 stopPropagation ——
 *    漏了的话，在弹窗里选中文字拖到外面松手就会把弹窗关掉。
 * 3. **锁住背景滚动**。不锁的话，滚轮会穿透到下面的页面，
 *    用户会看到"弹窗没动，背景在滚"。
 */
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);

    /* 锁背景滚动。★ 用 overflow: hidden 而不是 position: fixed ——
     * 后者会把页面滚回顶部（因为 fixed 元素脱离文档流，页面高度塌陷）。 */
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[width];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-scrim/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn('glass glass-strong rise-in my-auto w-full rounded-xl', w)}
        /* 点内容不关窗。少了这行，在弹窗里选中文字拖到外面松手就关了。 */
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div className="text-[14.5px] font-semibold text-fg">{title}</div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-fg-mute transition-colors hover:bg-veil/8 hover:text-fg"
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
          <button
            onClick={onClose}
            className="h-8 rounded-lg border border-hairline-strong px-3 text-[13px] text-fg-soft hover:bg-veil/6"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'h-8 rounded-lg px-3 text-[13px] font-medium disabled:opacity-50',
              danger ? 'bg-bad text-white hover:brightness-110' : 'btn-accent',
            )}
          >
            {loading ? '处理中…' : confirmText}
          </button>
        </>
      )}
    >
      <div className="text-[13px] leading-relaxed text-fg-soft">{body}</div>
    </Modal>
  );
}
