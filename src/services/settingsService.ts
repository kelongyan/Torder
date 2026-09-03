import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Setting } from "../types/database";
import {
  defaultAppSettings,
  type AccentPreference,
  type AppSettings,
  type DefaultDueDate,
  type DensityPreference,
  type FontSizePreference,
  type NotificationSound,
  type SavedTaskView,
  type ThemePreference,
} from "../types/settings";
import type {
  SystemView,
  TaskLayout,
  TaskScope,
  TaskSortBy,
} from "../types/database";

let browserSettings = createBrowserSettings();

export function listSettings(): Promise<Setting[]> {
  if (!isTauri()) {
    return Promise.resolve(getBrowserSettingsSnapshot());
  }
  return invoke<Setting[]>("list_settings");
}

export function getSetting(key: string): Promise<Setting | null> {
  if (!isTauri()) {
    const setting = browserSettings.find((item) => item.key === key);
    return Promise.resolve(setting ? { ...setting } : null);
  }
  return invoke<Setting | null>("get_setting", { key });
}

export function upsertSetting(key: string, value: unknown): Promise<Setting> {
  if (!isTauri()) {
    const timestamp = new Date().toISOString();
    const setting: Setting = {
      key: key.trim(),
      value: JSON.stringify(value),
      updatedAt: timestamp,
    };
    browserSettings = [
      ...browserSettings.filter((item) => item.key !== setting.key),
      setting,
    ].sort((left, right) => left.key.localeCompare(right.key));
    return Promise.resolve({ ...setting });
  }
  return invoke<Setting>("upsert_setting", {
    input: { key, value: JSON.stringify(value) },
  });
}

export async function loadAppSettings(): Promise<AppSettings> {
  const settings = new Map(
    (await listSettings()).map((setting) => [setting.key, setting.value]),
  );
  return {
    theme: parseTheme(settings.get("theme")),
    accent: parseAccent(settings.get("accent")),
    defaultReminderMinutes: parseNumber(
      settings.get("defaultReminderMinutes"),
      1440,
    ),
    defaultListId: parseString(
      settings.get("defaultListId"),
      defaultAppSettings.defaultListId,
    ),
    defaultView: parseSystemView(settings.get("defaultView")),
    trashRetentionDays: parseNullableNumber(settings.get("trashRetentionDays")),
    backupRetentionCount: parseNumber(
      settings.get("backupRetentionCount"),
      defaultAppSettings.backupRetentionCount,
    ),
    savedViews: parseSavedViews(settings.get("savedViews")),
    defaultDueDate: parseDefaultDueDate(settings.get("defaultDueDate")),
    defaultPriority: parseDefaultPriority(settings.get("defaultPriority")),
    quickAddNaturalLanguage: parseBoolean(
      settings.get("quickAddNaturalLanguage"),
      defaultAppSettings.quickAddNaturalLanguage,
    ),
    moveCompletedImmediately: parseBoolean(
      settings.get("moveCompletedImmediately"),
      defaultAppSettings.moveCompletedImmediately,
    ),
    notificationsEnabled: parseBoolean(
      settings.get("notificationsEnabled"),
      defaultAppSettings.notificationsEnabled,
    ),
    notificationSound: parseNotificationSound(
      settings.get("notificationSound"),
    ),
    reviewReminderEnabled: parseBoolean(
      settings.get("reviewReminderEnabled"),
      defaultAppSettings.reviewReminderEnabled,
    ),
    reviewReminderTime: parseString(
      settings.get("reviewReminderTime"),
      defaultAppSettings.reviewReminderTime,
    ),
    autoPostponeOverdue: parseBoolean(
      settings.get("autoPostponeOverdue"),
      defaultAppSettings.autoPostponeOverdue,
    ),
    density: parseDensity(settings.get("density")),
    fontSize: parseFontSize(settings.get("fontSize")),
  };
}

export async function saveAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await upsertSetting(key, value);
}

/**
 * F2 · T-11：恢复默认设置。只重置 AppSettings 覆盖的键（主题/默认值/通知/
 * 视图偏好等），不触碰任务数据与同步、备份等独立配置。
 */
export async function resetAppSettings(): Promise<AppSettings> {
  await Promise.all(
    Object.entries(defaultAppSettings).map(([key, value]) =>
      upsertSetting(key, value),
    ),
  );
  return { ...defaultAppSettings, savedViews: [] };
}

function getBrowserSettingsSnapshot(): Setting[] {
  return browserSettings.map((setting) => ({ ...setting }));
}

function createBrowserSettings(): Setting[] {
  const timestamp = new Date().toISOString();
  return Object.entries(defaultAppSettings).map(([key, value]) => ({
    key,
    value: JSON.stringify(value),
    updatedAt: timestamp,
  }));
}

function parseTheme(value: string | undefined): ThemePreference {
  const parsed = parseJson(value);
  return parsed === "light" || parsed === "dark" || parsed === "system"
    ? parsed
    : defaultAppSettings.theme;
}

const ACCENT_VALUES: AccentPreference[] = [
  "blue",
  "violet",
  "teal",
  "green",
  "amber",
  "rose",
];

function parseAccent(value: string | undefined): AccentPreference {
  const parsed = parseJson(value);
  return ACCENT_VALUES.includes(parsed as AccentPreference)
    ? (parsed as AccentPreference)
    : defaultAppSettings.accent;
}

const DEFAULT_DUE_VALUES: DefaultDueDate[] = [
  "none",
  "today",
  "tomorrow",
  "next_monday",
];

function parseDefaultDueDate(value: string | undefined): DefaultDueDate {
  const parsed = parseJson(value);
  return DEFAULT_DUE_VALUES.includes(parsed as DefaultDueDate)
    ? (parsed as DefaultDueDate)
    : defaultAppSettings.defaultDueDate;
}

function parseDefaultPriority(
  value: string | undefined,
): AppSettings["defaultPriority"] {
  const parsed = parseJson(value);
  return parsed === -1 || parsed === 0 || parsed === 1 || parsed === 2
    ? parsed
    : defaultAppSettings.defaultPriority;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseJson(value);
  return typeof parsed === "boolean" ? parsed : fallback;
}

function parseNotificationSound(value: string | undefined): NotificationSound {
  const parsed = parseJson(value);
  return parsed === "silent" || parsed === "system"
    ? parsed
    : defaultAppSettings.notificationSound;
}

const DENSITY_VALUES: DensityPreference[] = ["compact", "standard", "relaxed"];

function parseDensity(value: string | undefined): DensityPreference {
  const parsed = parseJson(value);
  return DENSITY_VALUES.includes(parsed as DensityPreference)
    ? (parsed as DensityPreference)
    : defaultAppSettings.density;
}

const FONT_SIZE_VALUES: FontSizePreference[] = ["small", "standard", "large"];

function parseFontSize(value: string | undefined): FontSizePreference {
  const parsed = parseJson(value);
  return FONT_SIZE_VALUES.includes(parsed as FontSizePreference)
    ? (parsed as FontSizePreference)
    : defaultAppSettings.fontSize;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = parseJson(value);
  return typeof parsed === "number" ? parsed : fallback;
}

function parseNullableNumber(value: string | undefined): number | null {
  const parsed = parseJson(value);
  return typeof parsed === "number" ? parsed : null;
}

function parseString(value: string | undefined, fallback: string): string {
  const parsed = parseJson(value);
  return typeof parsed === "string" && parsed.trim() ? parsed : fallback;
}

function parseSystemView(value: string | undefined): SystemView {
  const parsed = parseJson(value);
  return isSystemView(parsed) ? parsed : defaultAppSettings.defaultView;
}

function parseSavedViews(value: string | undefined): SavedTaskView[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return defaultAppSettings.savedViews;
  return parsed.filter(isSavedTaskView);
}

function isSavedTaskView(value: unknown): value is SavedTaskView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<SavedTaskView>;
  return (
    typeof view.id === "string" &&
    view.id.trim().length > 0 &&
    typeof view.name === "string" &&
    view.name.trim().length > 0 &&
    isSavedViewIcon(view.icon) &&
    isTaskScope(view.scope) &&
    typeof view.query === "string" &&
    isTaskSortBy(view.sortBy) &&
    typeof view.showCompleted === "boolean" &&
    isTaskLayout(view.layout)
  );
}

function isSavedViewIcon(value: unknown): value is SavedTaskView["icon"] {
  return (
    value === "filter" ||
    value === "star" ||
    value === "calendar" ||
    value === "tag"
  );
}

function isTaskScope(value: unknown): value is TaskScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<TaskScope>;
  if (scope.kind === "view") return isSystemView(scope.view);
  return scope.kind === "list" && typeof scope.listId === "string";
}

function isTaskSortBy(value: unknown): value is TaskSortBy {
  return (
    value === "priority" ||
    value === "date" ||
    value === "created" ||
    value === "manual"
  );
}

function isTaskLayout(value: unknown): value is TaskLayout {
  return (
    value === "list" ||
    value === "board" ||
    value === "calendar" ||
    value === "month" ||
    value === "week"
  );
}

function isSystemView(value: unknown): value is SystemView {
  return (
    value === "all" ||
    value === "today" ||
    value === "planned" ||
    value === "overdue" ||
    value === "no-date" ||
    value === "important" ||
    value === "completed" ||
    value === "deleted"
  );
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
