/* 数据钩子：useAsync + 跨页 SWR 缓存
 *
 * ── 为什么要自己写缓存 ──────────────────────────────────────────
 * 路由保活（KeepAlivePages）让切走的页面不卸载，所以它不会重新
 * 触发 useEffect 去拉数据。但"不重新拉"和"数据是新的"是两件事：
 * 学生在关卡页过了一关，回到仪表盘时那个"已过关数"必须变。
 *
 * 所以需要一个**显式 key 的缓存**：
 *   · 同一个 key 被多个页面用时，共享同一份数据（不重复请求）
 *   · 任何地方调 invalidate(key) 就能让所有用它的页面刷新
 *   · 页面重新激活时可以按需重拉（staleWhileRevalidate）
 *
 * ── 为什么不引 SWR / react-query ────────────────────────────────
 * 它们的核心价值是「自动重试、聚焦重拉、分页、乐观更新」这一整套。
 * 本系统只需要「共享 + 手动失效」两个能力，加起来 80 行。
 * 引一个库换来的是 bundle 变大 + 一层要学的抽象。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

type Entry<T = any> = {
  data?: T;
  error?: ApiError;
  loading: boolean;
  /** 数据来自哪个时刻。用于判断"够不够新"。 */
  at: number;
  /** 正在飞的请求，用于去重：同一 key 并发调用只发一次。 */
  inflight?: Promise<any>;
  subscribers: Set<() => void>;
};

const cache = new Map<string, Entry>();

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { loading: false, at: 0, subscribers: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(e: Entry) {
  e.subscribers.forEach((fn) => fn());
}

/** 手动失效：下一次用到这个 key 时会重新拉。 */
export function invalidate(key: string | RegExp) {
  const keys = typeof key === 'string'
    ? [...cache.keys()].filter((k) => k === key)
    : [...cache.keys()].filter((k) => key.test(k));
  for (const k of keys) {
    const e = cache.get(k);
    if (e) { e.at = 0; notify(e); }
  }
}

/** 失效一批（前缀匹配）。改了一个学生之后，列表和详情都要刷。 */
export function invalidatePrefix(prefix: string) {
  for (const [k, e] of cache) {
    if (k.startsWith(prefix)) { e.at = 0; notify(e); }
  }
}

/** 直接写入缓存（乐观更新用）。 */
export function setCache<T>(key: string, data: T) {
  const e = entry(key);
  e.data = data;
  e.error = undefined;
  e.at = Date.now();
  e.loading = false;
  notify(e);
}

export function getCache<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

/** 清空全部缓存（登出时用，否则下一个账号会看到上一个账号的数据）。 */
export function clearCache() {
  cache.clear();
}

type UseAsyncOptions = {
  /** 数据保鲜期（毫秒）。期内重新挂载不会重拉。默认 15 秒。 */
  ttl?: number;
  /** 为 false 时不发请求。用于依赖前置条件的场景。 */
  enabled?: boolean;
  /** 首次加载完成后的回调。 */
  onSuccess?: (data: any) => void;
};

export function useAsync<T = any>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: UseAsyncOptions = {},
) {
  const { ttl = 15_000, enabled = true, onSuccess } = opts;
  const [, force] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const rerender = useCallback(() => force((n) => n + 1), []);

  useEffect(() => {
    if (!key || !enabled) return;
    const e = entry(key);
    e.subscribers.add(rerender);

    const fresh = e.data !== undefined && Date.now() - e.at < ttl;
    if (!fresh && !e.inflight) {
      e.loading = true;
      notify(e);
      const p = fetcherRef.current()
        .then((data) => {
          e.data = data;
          e.error = undefined;
          e.at = Date.now();
          onSuccessRef.current?.(data);
        })
        .catch((err) => {
          e.error = err instanceof ApiError ? err : new ApiError(String(err?.message || err), 0);
        })
        .finally(() => {
          e.loading = false;
          e.inflight = undefined;
          notify(e);
        });
      e.inflight = p;
    }

    return () => { e.subscribers.delete(rerender); };
    // key 变了要重新订阅；ttl/enabled 变了也要重算
  }, [key, enabled, ttl, rerender]);

  const e = key ? cache.get(key) : undefined;

  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: e?.loading ?? (!!key && enabled && !e?.data),
    /** 强制重拉 */
    reload: useCallback(() => {
      if (!key) return;
      invalidate(key);
      const en = cache.get(key);
      if (en) notify(en);
    }, [key]),
  };
}

/** 变更操作：跑一个请求，成功后自动失效指定 key。 */
export function useMutate() {
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T,>(
    fn: () => Promise<T>,
    { invalidateKeys = [] as (string | RegExp)[] } = {},
  ): Promise<T> => {
    setPending(true);
    try {
      const r = await fn();
      for (const k of invalidateKeys) invalidate(k);
      return r;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending };
}

/** 轮询。用在不适合用 WebSocket 的轻量场景（比如"待批改数"）。 */
export function usePolling(key: string | null, fetcher: () => Promise<any>, ms: number, enabled = true) {
  const { data, reload } = useAsync(key, fetcher, { ttl: 0, enabled });
  useEffect(() => {
    if (!enabled || !key) return;
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [enabled, key, ms, reload]);
  return data;
}

/** 一次性动作（不缓存）。用于"提交"这类不该被缓存住的请求。 */
export async function once<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export { api };
