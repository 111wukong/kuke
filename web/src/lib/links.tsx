/* 站内链接统一入口
 *
 * ── 为什么必须集中 ──────────────────────────────────────────────
 * 两个理由，都是踩出来的：
 *
 * 1. **新标签页打开**。这是一个"边学边查"的场景：学生在看知识点，
 *    想顺手去实训场跑一下示例；或者在做题时想回去翻知识点。
 *    整页跳转会丢掉当前页的滚动位置、展开状态和编辑器内容。
 *    所以站内链接默认 target="_blank"。
 *
 * 2. **改了行为要能一次改完**。如果各处直接写 <Link>，
 *    哪天要改成"同页跳转"就得全文搜。集中成一个组件之后，
 *    改一行全站生效。
 *
 * ★ 用 target="_blank" 时必须同时加 rel="noopener"：
 *   不加的话，新页面可以通过 window.opener 拿到原页面的引用并改它的地址
 *   （反向 tabnabbing）。现代浏览器对 <a target="_blank"> 已经默认
 *   加了 noopener，但显式写出来更稳妥，也兼容老浏览器。
 */
import type { ReactNode, AnchorHTMLAttributes } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

type Props = {
  to: string;
  children: ReactNode;
  /** 覆盖默认的新标签行为（比如"返回列表"这种明显该同页的）。 */
  sameTab?: boolean;
  className?: string;
  title?: string;
  onClick?: AnchorHTMLAttributes<HTMLAnchorElement>['onClick'];
};

export function AppLink({ to, children, sameTab, className, title, onClick }: Props) {
  if (sameTab) {
    return <Link to={to} className={className} title={title} onClick={onClick}>{children}</Link>;
  }
  return (
    <a
      href={to}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

/** 侧栏导航项。这个必须**同页**跳转 —— 它就是应用内部的主导航，
 *  点一次开一个新标签会把用户搞疯（而且保活路由会白做）。 */
export function AppNavLink({
  to, children, className, onClick, end,
}: {
  to: string; children: ReactNode; className?: string | ((p: { isActive: boolean }) => string);
  onClick?: () => void; end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={className as any} onClick={onClick}>
      {children}
    </NavLink>
  );
}

/** 当前路径，用于面包屑和"我在这"判断。 */
export function usePathname() {
  return useLocation().pathname;
}

export { Link, NavLink };
