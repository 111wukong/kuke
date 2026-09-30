/* 应用根组件
 *
 * 职责：决定渲染「登录页」还是「应用外壳」，以及启动时的引导。
 *
 * ── 三态而不是两态 ──────────────────────────────────────────────
 * auth.status 有 'loading' | 'ready' 两档，加上 user 是否为空，
 * 组合出三种渲染结果：
 *   loading        → 显示加载态（**不要**显示登录页）
 *   ready + null   → 登录页
 *   ready + user   → 应用
 *
 * 少了 loading 这一档，首屏会先闪一下登录页再跳进应用 ——
 * 因为 /api/auth/me 还没回来，user 是 null。
 */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Login, Register } from '@/pages/Auth';
import { useAuth } from '@/stores/auth';
import { useTheme, syncThemeFromServer } from '@/stores/theme';
import { useApp } from '@/stores/app';
import { Database, Loader2 } from 'lucide-react';

function Boot() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-cyan/30 bg-cyan/10 text-cyan">
          <Database size={22} />
        </span>
        <div className="flex items-center gap-2 text-[13px] text-fg-mute">
          <Loader2 size={14} className="animate-spin" />
          正在加载…
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, settings, status, bootstrap } = useAuth();
  const { set: setTheme } = useTheme();
  const { refreshSnapshot, loadConfig } = useApp();

  useEffect(() => { bootstrap(); }, [bootstrap]);

  /* 服务端配置在**启动时**拉一次，不能等登录之后 ——
   * 登录页要用 allowRegister 决定显不显示注册入口。
   * 它是个无副作用的 GET，未登录也能打。 */
  useEffect(() => { loadConfig(); }, [loadConfig]);

  /* 登录后把服务端的主题和快照应用回来。
   * 主题必须在这里同步 —— 否则会出现"换台电脑登录后，
   * 颜色是本机上次选的，而不是这个账号选的"。 */
  useEffect(() => {
    if (!user) return;
    syncThemeFromServer(settings?.theme);
    refreshSnapshot();
  }, [user, settings?.theme, refreshSnapshot, setTheme]);

  if (status === 'loading') return <Boot />;

  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* 未登录时任何路径都送去登录页。
                用 replace 而不是 push —— 否则用户按返回键会回到
                刚刚那个受保护路径，又被弹回来，来回打转。 */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            {/* 已登录时访问 /login 直接回首页 */}
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Navigate to="/" replace />} />
            <Route path="*" element={<AppShell />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
