import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getSetting, upsertSetting } from "./settingsService";

export type TasksChangedSource = "main" | "widget";

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

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

/** 变更后广播全窗口（含自身），接收方按 source 自排除；150ms 防抖合并连续变更。 */
export function notifyTasksChanged(source: TasksChangedSource): void {
  if (!isTauri()) return;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void emit("tasks-changed", { source }).catch(() => undefined);
  }, 150);
}

/** 小窗点击任务：主窗监听事件选中任务，这里同时把主窗拉到前台。 */
export function openTaskInMainWindow(taskId: string): void {
  if (!isTauri()) return;
  void emit("widget-open-task", { taskId }).catch(() => undefined);
  void invoke("show_main_window").catch(() => undefined);
}
