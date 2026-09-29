/* 路由保活
 *
 * ── 解决什么问题 ────────────────────────────────────────────────
 * 学生在 SQL 实训场写了一条长查询，去知识点页查个表名，回来发现
 * 编辑器被清空了 —— 因为切页时组件卸载了。这在"边学边查"的场景里
 * 是致命的：这个应用的核心用法就是来回切。
 *
 * ── 怎么做 ──────────────────────────────────────────────────────
 * 不用 react-router 的 <Routes>（它会卸载不匹配的页面），
 * 而是：自己按当前 path 找到匹配的页面定义，把所有**访问过的**页面
 * 全部渲染出来，非当前页用 `display: none` 藏起来。
 *
 * ── 三个必须处理的细节 ──────────────────────────────────────────
 *
 * 1. **滚动位置**。保活之后不能再"路由变化就滚到顶"了 ——
 *    每个页面各有各的滚动位置，统一切到 0 等于把保活的意义抹掉一半。
 *    所以按 path 分别记住和恢复。这里要区分两种滚动容器：
 *    window（页面级）和内部容器（比如结果表）。
 *    只处理 window 就够 —— 内部容器的滚动是 DOM 自己的状态，
 *    元素没被卸载，它本来就留着。
 *
 * 2. **同 path 不同参数的页面不能共用一个实例**。
 *    /learn/k-select 和 /learn/k-groupby 是两个不同的知识点，
 *    共用一个实例会显示错误的内容。所以保活的 key 必须是**实际路径**
 *    而不是路由模式。
 *
 * 3. **上限**。访问 200 个页面就渲染 200 个 DOM 树，内存会炸。
 *    超过上限时丢掉最久没访问的那个。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, matchPath } from 'react-router-dom';

export interface PageDef {
  path: string;
  node: ReactNode;
}

const MAX_ALIVE = 12;

interface Alive {
  key: string;
  path: string;
  node: ReactNode;
  lastSeen: number;
}

export function KeepAlivePages({ pages, container }: { pages: PageDef[]; container?: React.RefObject<HTMLElement | null> }) {
  const location = useLocation();
  const [alive, setAlive] = useState<Alive[]>([]);
  const seq = useRef(0);

  /* 找到当前 path 匹配的页面定义。
   * 用 matchPath 而不是字符串相等 —— /learn/:kid 这种带参数的路由
   * 必须能匹配上。 */
  const matched = pages.find((p) => matchPath(p.path, location.pathname));

  useEffect(() => {
    if (!matched) return;
    const key = location.pathname; // ★ key 用实际路径，不用路由模式

    setAlive((prev) => {
      const exist = prev.find((a) => a.key === key);
      if (exist) {
        return prev.map((a) => (a.key === key ? { ...a, lastSeen: ++seq.current } : a));
      }
      const next: Alive[] = [...prev, {
        key,
        path: matched.path,
        node: matched.node,
        lastSeen: ++seq.current,
      }];
      if (next.length > MAX_ALIVE) {
        // 丢掉最久没访问的
        const victim = next.reduce((min, a) => (a.lastSeen < min.lastSeen ? a : min), next[0]);
        return next.filter((a) => a !== victim);
      }
      return next;
    });
  }, [location.pathname, matched]);

  /* 滚动位置：离开时存，回来时恢复。
   *
   * ★ 这里踩过一个坑，写清楚免得后人重犯：
   *   第一版把滚动位置存在 alive 数组里（state），于是每次滚动都会
   *   setAlive → 依赖 alive 的 effect 重跑 → 重新注册监听器 →
   *   而且恢复逻辑又跑一遍，把 scrollTop 强行写回旧值，
   *   表现是"滚到一半被弹回去"。
   *   正确做法：位置存 ref（不触发渲染），effect 只依赖 pathname。 */
  const scrollRef = useRef<Map<string, number>>(new Map());
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    const el = container?.current;
    const read = () => (el ? el.scrollTop : window.scrollY);
    const write = (v: number) => {
      if (el) el.scrollTop = v;
      else window.scrollTo({ top: v, behavior: 'auto' });
    };

    // 1) 存下刚才那一页的位置
    scrollRef.current.set(prevPath.current, read());

    // 2) 恢复这一页的位置。等一帧 —— DOM 刚从 display:none 切回可见，
    //    此时设 scrollTop 才生效（隐藏元素的滚动范围是 0）。
    const target = scrollRef.current.get(location.pathname) ?? 0;
    const raf = requestAnimationFrame(() => write(target));
    prevPath.current = location.pathname;

    // 3) 监听滚动。只往 ref 里写，不 setState。
    const onScroll = () => { scrollRef.current.set(location.pathname, read()); };
    const t: any = el || window;
    t.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      t.removeEventListener('scroll', onScroll);
    };
  }, [location.pathname, container]);

  if (!matched) return null;

  return (
    <>
      {alive.map((a) => {
        const active = a.key === location.pathname;
        return (
          <div
            key={a.key}
            /* 用 hidden 属性而不是条件渲染 —— 条件渲染等于卸载。
             * 用 display:none 才能保住子组件的 state 和 DOM。 */
            style={{ display: active ? undefined : 'none' }}
            aria-hidden={!active}
          >
            {a.node}
          </div>
        );
      })}
    </>
  );
}
