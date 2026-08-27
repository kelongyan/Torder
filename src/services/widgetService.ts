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
  /** null = 跟随今天；"YYYY-MM-DD" = 锚定日期 */
  anchorDate: string | null;
}

const WIDGET_SETTING_KEY = "widget";

const defaultWidgetSettings: WidgetSettings = {
  enabled: false,
  x: null,
  y: null,
  anchorDate: null,
};

export async function getWidgetSettings(): Promise<WidgetSettings> {
  const setting = await getSetting(WIDGET_SETTING_KEY);
  if (!setting) return { ...defaultWidgetSettings };
  try {
    const parsed = JSON.parse(setting.value) as Partial<WidgetSettings>;
    return {
      enabled: parsed.enabled === true,
      x: typeof parsed.x === "number" ? parsed.x : null,
      y: typeof parsed.y === "number" ? parsed.y : null,
      anchorDate: typeof parsed.anchorDate === "string" ? parsed.anchorDate : null,
    };
  } catch {
    return { ...defaultWidgetSettings };
  }
}

export async function saveWidgetSettings(
  patch: Partial<WidgetSettings>,
): Promise<WidgetSettings> {
  const current = await getWidgetSettings();
  const next: WidgetSettings = { ...current, ...patch };
  await upsertSetting(WIDGET_SETTING_KEY, next);
  return next;
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

/**
 * 变更后广播全窗口（含自身），接收方按 source 自排除；150ms 防抖合并连续变更。
 * 携带 `affectedDateKeys` 让 widget 可以只对显示日期做精准重拉。
 * - 主窗调用：传 `previousTasks`（apply 前快照）和 `currentTasks`（apply 后状态），
 *   diff 两侧日期，包括"被删任务的旧日期"。
 * - widget 调用：无需 diff，传 undefined 即可，widget 自身按 source 自排除。
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
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    const payload: TasksChangedPayload = { source, affectedDateKeys };
    void emit("tasks-changed", payload).catch(() => undefined);
  }, 150);
}

/** 小窗点击任务：主窗监听事件选中任务，这里同时把主窗拉到前台。 */
export function openTaskInMainWindow(taskId: string): void {
  if (!isTauri()) return;
  void emit("widget-open-task", { taskId }).catch(() => undefined);
  void invoke("show_main_window").catch(() => undefined);
}
