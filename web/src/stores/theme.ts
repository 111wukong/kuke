/* 主题状态
 *
 * ── 为什么初始值从 localStorage 读，而不是等服务端 ──────────────
 * index.html 里的内联脚本已经在 bundle 之前把 data-theme 挂上了。
 * 如果 store 的初始值是默认主题，那么 JS 一跑就会把属性改回默认，
 * 用户会看到"先对后错"的闪变 —— 比首屏闪更糟，因为它闪的是**已经对了的**颜色。
 *
 * 所以初始值必须和那个内联脚本读同一个键。
 */
import { create } from 'zustand';
import { api } from '@/lib/api';
import { THEME_STORAGE_KEY, DEFAULT_THEME, themeOf, type ThemeDef } from '@/lib/themes';
import { useAuth } from './auth';

interface ThemeState {
  id: string;
  def: ThemeDef;
  set: (id: string, opts?: { persist?: boolean }) => void;
}

function initialId(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v) return v;
  } catch { /* 隐私模式下 localStorage 会抛，忽略 */ }
  // 没存过就跟随系统偏好 —— 用户的操作系统已经是暗色了，
  // 还给他一个刺眼的亮色主题是很不礼貌的。
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'paper';
  } catch { /* 老浏览器没有 matchMedia */ }
  return DEFAULT_THEME;
}

function apply(id: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem(THEME_STORAGE_KEY, id); } catch { /* 存不下就算了 */ }
}

const startId = initialId();
apply(startId);

export const useTheme = create<ThemeState>((set) => ({
  id: startId,
  def: themeOf(startId),

  set(id, { persist = true } = {}) {
    apply(id);
    set({ id, def: themeOf(id) });
    /* 同步到服务端，让主题跟着账号走（换台电脑也是同一套）。
     * ★ 失败要静默吞掉：主题是外观偏好，服务端保存失败不该弹错误 ——
     *   用户看到的是"我点了一下颜色，然后弹了个报错"，非常莫名其妙。
     *   本地已经生效了，这就够了。 */
    if (persist && useAuth.getState().user) {
      api.patch('/api/auth/settings', { theme: id }).catch(() => {});
    }
  },
}));

/** 登录后把服务端的主题应用回来。 */
export function syncThemeFromServer(themeId: string | undefined) {
  if (!themeId) return;
  const cur = useTheme.getState().id;
  if (themeId === cur) return;
  // persist: false —— 这是从服务端读来的，不用再写回去
  useTheme.getState().set(themeId, { persist: false });
}
