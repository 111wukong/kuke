/* 鉴权状态
 *
 * ── 为什么用 zustand 而不是 Context ─────────────────────────────
 * auth 被侧栏、顶栏、几乎每个页面用。用 Context 的话，
 * 任何一次 user 变化都会重渲整棵树 —— 而这个应用有路由保活，
 * 树很大，重渲一次的代价肉眼可见。
 * zustand 的订阅是选择器级的，只有真正用了 user 的组件会重渲。
 *
 * ── 401 全局处理 ────────────────────────────────────────────────
 * 会话过期时任何接口都可能返回 401。这里监听 api.ts 广播的事件，
 * 统一清空状态。页面自己只管展示，不用各自处理"登录过期"。
 */
import { create } from 'zustand';
import { api, AUTH_EXPIRED_EVENT, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/hooks';

export type Role = 'student' | 'teacher' | 'admin';

export interface User {
  id: number;
  email: string;
  username: string;
  role: Role;
  status: 'active' | 'disabled';
  note: string;
  realName: string;
  studentNo: string;
  avatarHue: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ClassBrief {
  id: number;
  name: string;
  code: string;
  term: string;
  teacherName: string;
  isOwner: boolean;
}

export interface Settings {
  theme: string;
  dailyGoal: number;
  sqlDialect: string;
  editorFont: number;
  sfx: boolean;
}

interface AuthState {
  user: User | null;
  settings: Settings | null;
  classes: ClassBrief[];
  /** 'loading' 表示还没问过服务端"我是谁"。
   *  这个三态很关键：只分"有 user / 没 user"的话，
   *  首屏会先闪一下登录页再跳回应用。 */
  status: 'loading' | 'ready';
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; password: string; classCode?: string }) => Promise<{ joinedClass: string | null }>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  patchSettings: (s: Partial<Settings>) => Promise<void>;
  setUser: (u: User) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  settings: null,
  classes: [],
  status: 'loading',

  async bootstrap() {
    try {
      const r = await api.get('/api/auth/me', { skipAuthBroadcast: true });
      set({ user: r.user, settings: r.settings, classes: r.classes, status: 'ready' });
    } catch (e) {
      // 401 是正常的"没登录"，不该当成错误上报
      if (!(e instanceof ApiError) || e.status !== 401) {
        console.warn('[auth] 引导失败', e);
      }
      set({ user: null, settings: null, classes: [], status: 'ready' });
    }
  },

  async login(email, password) {
    const r = await api.post('/api/auth/login', { email, password }, { skipAuthBroadcast: true });
    clearCache(); // ★ 换账号必须先清缓存，否则会看到上一个账号的数据
    set({ user: r.user });
    await get().bootstrap();
  },

  async register(data) {
    const r = await api.post('/api/auth/register', data, { skipAuthBroadcast: true });
    clearCache();
    set({ user: r.user });
    await get().bootstrap();
    return { joinedClass: r.joinedClass ?? null };
  },

  async logout() {
    try { await api.post('/api/auth/logout', {}); } catch { /* 已经失效了也无所谓 */ }
    clearCache();
    set({ user: null, settings: null, classes: [], status: 'ready' });
  },

  async patchSettings(s) {
    const r = await api.patch('/api/auth/settings', s);
    set({ settings: r.settings });
  },

  setUser(u) { set({ user: u }); },
}));

/* 全局 401：清空登录态。
 * ★ 这里**不跳转**。跳转交给路由层做 —— 由它根据 user 是否为 null
 *   决定渲染登录页还是应用页。在 store 里硬跳会把路由状态搞乱
 *   （比如用户正在填表，一跳转填的东西全丢，而他其实只是会话过期了）。 */
if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    const s = useAuth.getState();
    if (s.user) {
      clearCache();
      useAuth.setState({ user: null, settings: null, classes: [], status: 'ready' });
    }
  });
}

/** 角色判断的小工具。前端这些判断**只用于显示/隐藏入口**，不是鉴权 ——
 *  真正的门在服务端（每条 /api/admin/* 都挂了 preHandler）。 */
export const isStudent = (u: User | null) => u?.role === 'student';
export const isTeacher = (u: User | null) => u?.role === 'teacher';
export const isAdmin = (u: User | null) => u?.role === 'admin';
export const isStaff = (u: User | null) => u?.role === 'teacher' || u?.role === 'admin';
