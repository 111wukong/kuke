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
 * 3. **href 必须由路由算出来**。见下面 AppLink 里的 ★ 说明 ——
 *    裸 <a href> 不认 basename，而本站是子路径部署。
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

/* ── ★★ 为什么"新标签打开"也必须用 <Link>，不能写裸 <a href> ──────
 *
 * 本站部署在 https://aiallcc.club/kuke/ 这个**子路径**下（根路径归「研数」），
 * 路由的 basename 是 /kuke/。但 basename 只有 React Router 自己认 ——
 * <Link> / <NavLink> / navigate() 会把它拼进 href，
 * 而原生 `<a href={to}>` 是浏览器解析的，完全不知道 basename 这回事。
 *
 * 后果：写 `<a href="/levels/12">` 会解析成
 *   https://aiallcc.club/levels/12 —— 那是**隔壁应用**的地址。
 * 而这个缺陷的表现极具误导性：不报错、不 404，只是"点进去变成了研数"
 * （研数是 SPA，任何未知路径都回它自己首页，所以看起来像"跳转成功了，
 * 只是内容不对"）。
 *
 * 这个 bug 真实发生过：全站 53 处 AppLink 里 34 处没写 sameTab，
 * 于是这 34 个入口——SQL 闯关的关卡卡片、知识树的"去练习"、
 * 错题本、学情统计、SQL 实验台——点下去全跳到研数。
 * 而带 sameTab 的 19 处走 NavLink/Link，一切正常。
 * 现象是"有的功能好、大部分功能跑隔壁去"，很容易被当成权限或数据问题。
 *
 * 修法不是给每个 href 手拼前缀，而是**统一交给 Link** ——
 * 它内部用 useHref(to) 算 href（自动带 basename），
 * 同时把 target 原样透传给 <a>。
 * Link 的点击处理器遇到 target="_blank" 会主动放行、不 preventDefault
 * （react-router 里写的是 "Let browser handle target=_blank"），
 * 所以新标签页的行为一字不变，只是地址对了。
 *
 * ★ 一句话规则：**站内跳转一律别自己写 href**。
 *   要新标签就 <Link target="_blank">，要同页就 <Link>。
 */
export function AppLink({ to, children, sameTab, className, title, onClick }: Props) {
  if (sameTab) {
    return <Link to={to} className={className} title={title} onClick={onClick}>{children}</Link>;
  }
  return (
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
      onClick={onClick}
    >
      {children}
    </Link>
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
