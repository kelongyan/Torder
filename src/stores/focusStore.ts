import { create } from "zustand";
import { upsertSetting } from "../services/settingsService";

/**
 * 专注模式（T-02 一期）状态机 —— 独立 store，不塞 taskStore：
 * 计时是高频变更，与任务查询耦合会导致无关重渲染。
 *
 * 计时不依赖 setInterval 计数，而是记录 endAt 真实时间戳、读取时现算：
 * 后台节流/窗口隐藏/切标签都不会漂移。paused 时冻结 remainingSec。
 *
 * 持久化（localStorage "torder-focus"）：关窗到托盘后窗口重新可见、
 * 或应用重启后按时间差续算；running 且已过期 → 归 idle（一期不跨进程
 * 补发系统通知，见实现方案书 §3）。
 *
 * 专注免打扰（阶段 D · T-10 乙组）：开关开启时，状态切换把本轮结束时刻
 * 写入 settings KV `focusDndUntil`（RFC3339），Rust notifier 轮询读取并在
 * 窗口内抑制任务提醒（暂停语义：不标记 reminded_at，结束后下轮补发）。
 */

export type FocusMode = "idle" | "running" | "paused";

export interface FocusState {
  mode: FocusMode;
  /** 一轮专注总时长（分钟），运行中修改仅对下一轮生效。 */
  durationMin: number;
  /** running 时的目标结束时刻（epoch ms）；paused/idle 为 null。 */
  endAt: number | null;
  /** paused 时冻结的剩余秒数；running 时由 endAt 现算。 */
  remainingSec: number;
  /** 本轮专注绑定的任务（高亮用），可为 null（无绑定计时）。 */
  focusTaskId: string | null;
  /** 本轮开始时刻（epoch ms），供展示。 */
  startedAt: number | null;
  /** 最近一轮自然结束的时刻；消费方据此触发「结束」动作一次。 */
  lastCompletedAt: number | null;
  /** 当前时间戳——由 UI 层以 1s 间隔调用 tick() 推进，驱动倒计时渲染。 */
  now: number;

  setDuration: (minutes: number) => void;
  setFocusTask: (taskId: string | null) => void;
  start: (taskId?: string | null) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  /** UI 每秒调用：推进 now，并在 running 到期时幂等完成本轮。 */
  tick: () => void;
  /** 当前剩余秒数（running 由 endAt 现算，其余读冻结值）。 */
  remaining: () => number;
}

const STORAGE_KEY = "torder-focus";
const DEFAULT_MINUTES = 25;
const MIN_MINUTES = 5;
const MAX_MINUTES = 120;

interface PersistedFocus {
  mode: "running" | "paused";
  endAt: number | null;
  remainingSec: number;
  durationMin: number;
  focusTaskId: string | null;
  startedAt: number | null;
}

export type { PersistedFocus };

function readPersisted(): Partial<PersistedFocus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedFocus;
    return {
      mode: parsed.mode,
      endAt: parsed.endAt,
      remainingSec: parsed.remainingSec,
      durationMin: parsed.durationMin,
      focusTaskId: parsed.focusTaskId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return {};
  }
}

function persist(state: PersistedFocus) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: state.mode,
        endAt: state.endAt,
        remainingSec: state.remainingSec,
        durationMin: state.durationMin,
        focusTaskId: state.focusTaskId,
        startedAt: state.startedAt,
      } satisfies PersistedFocus),
    );
  } catch {
    // localStorage 不可用（隐私模式等）时专注照常，仅不跨重启续时。
  }
}

function clampMinutes(minutes: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/** 免打扰用户开关（App 按设置注入）；默认关闭时不写任何 KV。 */
let dndEnabled = false;

function writeDndUntil(until: Date): void {
  void upsertSetting("focusDndUntil", until.toISOString()).catch(() => {
    // 设置 KV 写失败只影响本轮免打扰生效，不影响计时与提醒主链路。
  });
}

/**
 * 免打扰标记唯一写入点：running 写本轮结束时刻，其余状态写当前时刻
 * （立即失效）。时间戳形式可自愈——应用崩溃后标记自然过期，Rust 侧
 * 解析失败/过期一律视为不在免打扰（fail-open）。
 */
function syncDnd(mode: FocusMode, endAt: number | null): void {
  if (!dndEnabled) return;
  writeDndUntil(
    mode === "running" && endAt !== null ? new Date(endAt) : new Date(),
  );
}

/**
 * App 按设置注入开关（阶段 D · T-10 乙组）。专注运行中切换开关立即生效：
 * 开启 → 以当前 endAt 生效；关闭 → 立即解除抑制（此时开关位已为 false，
 * 须绕过 syncDnd 的开关门直写）。
 */
export function setFocusDndEnabled(enabled: boolean): void {
  dndEnabled = enabled;
  const state = useFocusStore.getState();
  if (state.mode !== "running" || state.endAt === null) return;
  writeDndUntil(enabled ? new Date(state.endAt) : new Date());
}

/** 启动续算：running 且已过期 → 归 idle（一期不跨进程补发通知）。 */
export function hydrateFocus(
  saved: Partial<PersistedFocus>,
  now: number,
): Partial<FocusState> {
  if (saved.mode === "running" && typeof saved.endAt === "number") {
    if (saved.endAt <= now) {
      return { mode: "idle", endAt: null, remainingSec: 0 };
    }
    return {
      mode: "running",
      endAt: saved.endAt,
      durationMin: saved.durationMin ?? DEFAULT_MINUTES,
      focusTaskId: saved.focusTaskId ?? null,
      startedAt: saved.startedAt ?? null,
    };
  }
  if (saved.mode === "paused" && typeof saved.remainingSec === "number") {
    return {
      mode: "paused",
      remainingSec: Math.max(0, Math.round(saved.remainingSec)),
      durationMin: saved.durationMin ?? DEFAULT_MINUTES,
      focusTaskId: saved.focusTaskId ?? null,
      startedAt: saved.startedAt ?? null,
    };
  }
  return {};
}

function hydrate(): Partial<FocusState> {
  return hydrateFocus(readPersisted(), Date.now());
}

export const useFocusStore = create<FocusState>()((set, get) => ({
  mode: "idle",
  durationMin: DEFAULT_MINUTES,
  endAt: null,
  remainingSec: 0,
  focusTaskId: null,
  startedAt: null,
  lastCompletedAt: null,
  now: Date.now(),

  ...hydrate(),

  setDuration: (minutes) => {
    const durationMin = clampMinutes(minutes);
    const state = get();
    if (state.mode === "idle") set({ durationMin });
    // running/paused 中不改本轮时长：写入仅对下一轮生效（UI 已置灰）。
  },

  setFocusTask: (taskId) => {
    const state = get();
    if (state.mode === "idle") set({ focusTaskId: taskId });
  },

  start: (taskId) => {
    const state = get();
    const durationMin = clampMinutes(state.durationMin || DEFAULT_MINUTES);
    const now = Date.now();
    set((current) => {
      const next = {
        mode: "running" as const,
        durationMin,
        endAt: now + durationMin * 60_000,
        remainingSec: 0,
        focusTaskId: taskId === undefined ? current.focusTaskId : taskId,
        startedAt: now,
        lastCompletedAt: null,
        now,
      };
      persist(next);
      syncDnd(next.mode, next.endAt);
      return next;
    });
  },

  pause: () => {
    const state = get();
    if (state.mode !== "running" || state.endAt === null) return;
    const remainingSec = Math.max(
      0,
      Math.ceil((state.endAt - Date.now()) / 1000),
    );
    set((current) => {
      const next = {
        mode: "paused" as const,
        endAt: null,
        remainingSec,
        durationMin: current.durationMin,
        focusTaskId: current.focusTaskId,
        startedAt: current.startedAt,
        now: current.now,
      };
      persist(next);
      syncDnd(next.mode, null);
      return next;
    });
  },

  resume: () => {
    const state = get();
    if (state.mode !== "paused" || state.remainingSec <= 0) return;
    const now = Date.now();
    set((current) => {
      const next = {
        mode: "running" as const,
        endAt: now + current.remainingSec * 1000,
        remainingSec: 0,
        durationMin: current.durationMin,
        focusTaskId: current.focusTaskId,
        startedAt: current.startedAt,
        now,
      };
      persist(next);
      syncDnd(next.mode, next.endAt);
      return next;
    });
  },

  reset: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
    set({
      mode: "idle",
      endAt: null,
      remainingSec: 0,
      focusTaskId: null,
      startedAt: null,
      now: Date.now(),
    });
    syncDnd("idle", null);
  },

  remaining: () => {
    const state = get();
    if (state.mode === "running" && state.endAt !== null) {
      return Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
    }
    return state.remainingSec;
  },

  tick: () => {
    const state = get();
    const now = Date.now();
    if (
      state.mode === "running" &&
      state.endAt !== null &&
      state.endAt <= now
    ) {
      // 到期：幂等完成本轮（tick 每秒一次，仅首次命中完成）。
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // 忽略
      }
      set({
        mode: "idle",
        endAt: null,
        remainingSec: 0,
        startedAt: null,
        lastCompletedAt: now,
        now,
      });
      syncDnd("idle", null);
      return;
    }
    if (state.now !== now) set({ now });
  },
}));
