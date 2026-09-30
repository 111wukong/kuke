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
}

let toastSeq = 0;

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
    set({ toasts: [...get().toasts, { id, kind, text, detail }] });
    /* 错误的停留久一点 —— 判题失败的信息里有"你少了哪几行"这种
     * 需要读的内容，2 秒就消失等于没给。 */
    const ms = kind === 'error' ? 6500 : kind === 'warn' ? 5000 : 3200;
    setTimeout(() => get().dismiss(id), ms);
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
