/* 应用状态：侧栏、全局快照、消息提示
 *
 * 快照（XP / 等级 / 连续打卡 / 待复习数）放在这里而不是各页面自己拉，
 * 是因为侧栏底部一直在显示它 —— 每页各拉一次等于每页都有一次请求，
 * 而且数字会不一致（A 页刚答完题，B 页还是旧的）。
 */
import { create } from 'zustand';
import { api } from '@/lib/api';

export interface Snapshot {
  xp: number;
  level: number;
  levelTitle: string;
  levelInfo: { into: number; need: number; progress: number };
  streak: number;
  combo: number;
  bestCombo: number;
  today: { attempts: number; correct: number };
  totals: { attempts: number; correct: number; accuracy: number; activeDays: number };
  wrong: number;
  dueCount: number;
  levels: { total: number; passed: number };
  heatmap: { date: string; n: number; c: number; minutes: number }[];
}

export interface PlanItem {
  id?: string;
  refId?: string;
  kind?: string;
  kid?: string;
  title?: string;
  knowledgeId?: string;
  questionId?: string;
  type?: string;
}

export interface DailyPlan {
  date: string;
  goal: number;
  done: number;
  review: PlanItem[];
  mistakes: PlanItem[];
  fresh: (PlanItem & { ready: boolean; missing: number })[];
  summary: string;
}

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** 可选的副标题，用于放更长的说明（比如判题的差异详情）。 */
  detail?: string;
  /** 自动消失的时长（毫秒）。悬停暂停时要拿它算剩余时间。 */
  duration: number;
}

/* 服务端配置快照。
 *
 * ★ 这个接口（/api/misc/config）早就有了，但前端**从来没用过它** ——
 *   于是生产环境关掉自助注册之后，登录页仍然显示「还没有账号？注册一个」，
 *   学生点进去、填完表单、提交，才收到 403「本系统已关闭自助注册」。
 *   前后端都在说实话，只是说的不是同一件事。
 *
 * 拉不到时按 **allowRegister: false** 处理（保守）：
 * 少显示一个入口，用户最多问一句老师；
 * 多显示一个点了会失败的入口，用户会以为系统坏了。 */
export interface ServerConfig {
  allowRegister: boolean;
  version: string;
}

interface AppState {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;

  snapshot: Snapshot | null;
  plan: DailyPlan | null;
  refreshSnapshot: () => Promise<void>;

  /** 服务端配置（是否开放自助注册等）。null = 还没拉到。 */
  config: ServerConfig | null;
  loadConfig: () => Promise<void>;

  toasts: Toast[];
  toast: (kind: ToastKind, text: string, detail?: string) => void;
  dismiss: (id: number) => void;
  /** 鼠标悬停在提示上时暂停倒计时 —— 正在读的内容不该被抽走。 */
  pauseToast: (id: number) => void;
  /** 鼠标移开继续倒计时，从暂停处接着走，不重新计时。 */
  resumeToast: (id: number) => void;
}

let toastSeq = 0;

/* 提示的倒计时句柄。
 *
 * ★ 放在模块级 Map 而不是 zustand state 里 —— 它每秒都在变，
 *   放进 state 会让每次 set 都触发全组件树重渲染，而这些数字
 *   一个组件都不需要看到。Map 只服务于 dismiss/pause/resume 三个动作。
 *
 * handle 为 null = 当前处于「悬停暂停」状态，remaining 是剩下的毫秒数。 */
const toastTimers = new Map<number, {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}>();

/** 各档提示的停留时长。skill 的通行区间是 4–6 秒：
 *  · error 6.5s —— 判题失败会带「你少了哪几行」这种需要逐行读的详情；
 *  · warn  5s   —— 需要看一眼才能决定要不要处理；
 *  · 其余  4.2s —— 原先是 3.2s。一句话的提示（「已保存」）够，
 *                  但「已加入复习队列，明天见」这种就偏紧，
 *                  用户眼睛刚扫到就没了。4.2s 仍在舒适区内。 */
const TOAST_MS: Record<ToastKind, number> = { error: 6500, warn: 5000, info: 4200, ok: 4200 };

export const useApp = create<AppState>((set, get) => ({
  navOpen: false,
  setNavOpen: (v) => set({ navOpen: v }),

  snapshot: null,
  plan: null,

  async refreshSnapshot() {
    try {
      const r = await api.get('/api/study/snapshot');
      set({ snapshot: r.snapshot, plan: r.plan });
    } catch {
      /* 快照拉失败不该影响页面本身。侧栏数字暂时不变而已。 */
    }
  },

  config: null,

  async loadConfig() {
    try {
      const r = await api.get('/api/misc/config');
      set({
        config: {
          // 服务端没给这个字段时按「不允许」处理，理由见 ServerConfig 注释
          allowRegister: r?.allowRegister === true,
          version: r?.version || '',
        },
      });
    } catch {
      set({ config: { allowRegister: false, version: '' } });
    }
  },

  toasts: [],

  toast(kind, text, detail) {
    const id = ++toastSeq;
    const duration = TOAST_MS[kind] ?? 4200;
    /* ★ 新提示追加到**末尾**（不是开头）。容器固定在右下角、flex-col，
     *   所以末尾那条离底边最近 —— 也就是最靠近用户视线落点的位置。
     *   skill 里「newest on top」是针对**顶部**提示栏的建议；
     *   照搬到右下角会让新消息跑到离视线最远的一格，反而更难被注意到。 */
    set({ toasts: [...get().toasts, { id, kind, text, detail, duration }] });
    toastTimers.set(id, {
      handle: setTimeout(() => get().dismiss(id), duration),
      remaining: duration,
      startedAt: Date.now(),
    });
  },

  dismiss(id) {
    const rec = toastTimers.get(id);
    if (rec?.handle) clearTimeout(rec.handle);
    toastTimers.delete(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  pauseToast(id) {
    const rec = toastTimers.get(id);
    /* 已经在暂停态（handle 为 null）就什么都不做 —— 鼠标在子元素之间
     * 移动会连发多次 mouseenter，不加这层判断会把剩余时间扣成负数。 */
    if (!rec || !rec.handle) return;
    clearTimeout(rec.handle);
    rec.remaining = Math.max(0, rec.remaining - (Date.now() - rec.startedAt));
    rec.handle = null;
  },

  resumeToast(id) {
    const rec = toastTimers.get(id);
    if (!rec || rec.handle) return;
    rec.startedAt = Date.now();
    rec.handle = setTimeout(() => get().dismiss(id), rec.remaining);
  },
}));
