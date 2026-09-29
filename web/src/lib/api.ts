/* API 客户端
 *
 * ── 一个刻意的设计：401 全局广播 ─────────────────────────────────
 * 会话过期时任何接口都可能返回 401。如果每个调用点各自处理，
 * 就会出现「这个页面跳登录了、那个页面还在转圈」的不一致。
 * 所以这里统一发一个事件，由 auth store 统一处理（清空用户 + 跳登录）。
 *
 * ── 为什么不用 axios ────────────────────────────────────────────
 * fetch 够用，而且错误处理逻辑本来就要自己写（要读 body.error 当文案）。
 * 引一个 30KB 的库换一层薄封装不划算。
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: any;

  constructor(message: string, status: number, code?: string, detail?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** 会话失效时广播。auth store 订阅它。 */
export const AUTH_EXPIRED_EVENT = 'kuke:auth-expired';

type Options = {
  method?: string;
  body?: any;
  /** 跳过 401 广播。登录接口自己用 —— 密码错也是 401，
   *  但那时不该触发"会话过期"的全局处理。 */
  skipAuthBroadcast?: boolean;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, skipAuthBroadcast, signal } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // 网络层失败（断网、服务没起）。文案要能指向真正的原因。
    throw new ApiError('网络请求失败，检查一下服务是否在运行', 0, 'NETWORK');
  }

  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch {
      /* 服务端返回了非 JSON（比如反代返回的 HTML 错误页）。
       * 这种情况必须给出可读提示，否则用户看到的是
       * 「Unexpected token '<'」这种毫无信息量的报错。 */
      throw new ApiError(
        res.ok ? '服务器返回了无法解析的内容' : `请求失败（HTTP ${res.status}）`,
        res.status, 'BAD_RESPONSE',
      );
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !skipAuthBroadcast) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(
      data?.error || `请求失败（HTTP ${res.status}）`,
      res.status,
      data?.code,
      data?.detail,
    );
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string, o?: Options) => request<T>(path, { ...o, method: 'GET' }),
  post: <T = any>(path: string, body?: any, o?: Options) => request<T>(path, { ...o, method: 'POST', body }),
  patch: <T = any>(path: string, body?: any, o?: Options) => request<T>(path, { ...o, method: 'PATCH', body }),
  del: <T = any>(path: string, o?: Options) => request<T>(path, { ...o, method: 'DELETE' }),
};

/** 拼查询串。值为 undefined / '' 的键会被丢掉 ——
 *  否则会出现 `?kid=&limit=20` 这种让服务端校验失败的空参数。 */
export function qs(params: Record<string, any>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
