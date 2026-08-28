import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getSetting, upsertSetting } from "./settingsService";
import { taskPlanDateKey } from "./taskQuery";
import type { Task } from "../types/database";

export type TasksChangedSource = "main" | "widget";

export interface TasksChangedPayload {
  source: TasksChangedSource;
  /**
   * 受影响日期键（YYYY-MM-DD）。主窗推送时算好；widget 收到后，
   * 若自己当前显示日期命中此列表再重拉，避免主窗的任意写操作都触发小窗全量刷新。
   * 空数组意味着"可能影响任意日期"，接收方按需保守处理。
   */
  affectedDateKeys: string[];
}

export interface WidgetSettings {
  enabled: boolean;
  x: number | null;
  y: number | null;
  /**
   * 窗口逻辑宽高。**只在用户手动拉伸过之后才有值**，跟随内容自适应期间恒为 null。
   * 因此「有 h 就是用户定过尺寸」，尺寸模式由此派生，不再单独存一个字段
   * （两个字段各存一份状态迟早会不一致）。
   */
  w: number | null;
  h: number | null;
  /** null = 跟随今天；"YYYY-MM-DD" = 锚定日期 */
  anchorDate: string | null;
}

const WIDGET_SETTING_KEY = "widget";

const defaultWidgetSettings: WidgetSettings = {
  enabled: false,
  x: null,
  y: null,
  w: null,
  h: null,
  anchorDate: null,
};

export async function getWidgetSettings(): Promise<WidgetSettings> {
  const setting = await getSetting(WIDGET_SETTING_KEY);
  if (!setting) return { ...defaultWidgetSettings };
  try {
    return normalizeWidgetSettings(
      JSON.parse(setting.value) as Partial<WidgetSettings>,
    );
  } catch {
    return { ...defaultWidgetSettings };
  }
}

function normalizeWidgetSettings(
  parsed: Partial<WidgetSettings>,
): WidgetSettings {
  return {
    enabled: parsed.enabled === true,
    x: typeof parsed.x === "number" ? parsed.x : null,
    y: typeof parsed.y === "number" ? parsed.y : null,
    w: typeof parsed.w === "number" ? parsed.w : null,
    h: typeof parsed.h === "number" ? parsed.h : null,
    anchorDate: typeof parsed.anchorDate === "string" ? parsed.anchorDate : null,
  };
}

/**
 * 对 `widget` 设置键做字段级 patch，替代旧的整键读-改-写。
 * Tauri 模式：合并由 Rust 命令 `patch_widget_settings` 在单条事务内完成——
 * 主窗开关与 widget 窗几何防抖写分属两个窗口，各自 get→merge→upsert 会
 * 互相吞字段；Rust 单点串行合并后不再竞态，且 `anchorDate` 等 Rust
 * `WidgetSettings` 未声明的前端字段原样保留。
 * 浏览器 mock：单窗环境无跨窗竞态，本地 get→merge→upsert 即可。
 */
export async function patchWidgetSettings(
  patch: Partial<WidgetSettings>,
): Promise<WidgetSettings> {
  if (!isTauri()) {
    const current = await getWidgetSettings();
    const next: WidgetSettings = { ...current, ...patch };
    await upsertSetting(WIDGET_SETTING_KEY, next);
    return next;
  }
  const merged = await invoke<Partial<WidgetSettings>>("patch_widget_settings", {
    patch,
  });
  return normalizeWidgetSettings(merged);
}

/** 收集 tasks 中所有非空 `taskPlanDateKey`，去重返回。 */
function collectDateKeys(tasks: ReadonlyArray<Task>): string[] {
  const set = new Set<string>();
  for (const task of tasks) {
    const key = taskPlanDateKey(task);
    if (key) set.add(key);
  }
  return [...set];
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
/** 防抖窗口内累积的受影响日期键（并集）。 */
let pendingDateKeys: Set<string> | null = null;
/**
 * 防抖窗口内是否出现过空数组调用。空数组意为"任意日期都可能受影响"，
 * 只要出现过一次，最终发出的就是空数组（保守语义不能被后续精准键稀释）。
 */
let pendingAnyDate = false;

/**
 * 变更后广播全窗口（含自身），接收方按 source 自排除；150ms 防抖合并连续变更。
 * 携带 `affectedDateKeys` 让 widget 可以只对显示日期做精准重拉。
 * - 主窗调用：传 `previousTasks`（apply 前快照）和 `currentTasks`（apply 后状态），
 *   diff 两侧日期，包括"被删任务的旧日期"。
 * - widget 调用：无需 diff，传 undefined 即可，widget 自身按 source 自排除。
 *
 * 防抖窗口内多次调用按**并集**累积日期键（只保留最后一次会丢掉前面的键）；
 * 任一次为空数组则最终发出空数组。
 */
export function notifyTasksChanged(
  source: TasksChangedSource,
  context?: {
    previousTasks?: ReadonlyArray<Task>;
    currentTasks?: ReadonlyArray<Task>;
  },
): void {
  if (!isTauri()) return;
  let affectedDateKeys: string[] = [];
  if (source === "main" && context) {
    const prev = context.previousTasks ?? [];
    const curr = context.currentTasks ?? [];
    const merged = new Set<string>([
      ...collectDateKeys(curr),
      ...collectDateKeys(prev),
    ]);
    affectedDateKeys = [...merged];
  }
  if (affectedDateKeys.length === 0) {
    pendingAnyDate = true;
  } else {
    if (!pendingDateKeys) pendingDateKeys = new Set<string>();
    for (const key of affectedDateKeys) pendingDateKeys.add(key);
  }
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    const mergedKeys = pendingAnyDate ? [] : [...(pendingDateKeys ?? [])];
    pendingAnyDate = false;
    pendingDateKeys = null;
    const payload: TasksChangedPayload = { source, affectedDateKeys: mergedKeys };
    void emit("tasks-changed", payload).catch(() => undefined);
  }, 150);
}

/** 小窗点击任务：主窗监听事件选中任务，这里同时把主窗拉到前台。 */
export function openTaskInMainWindow(taskId: string): void {
  if (!isTauri()) return;
  void emit("widget-open-task", { taskId }).catch(() => undefined);
  void invoke("show_main_window").catch(() => undefined);
}
