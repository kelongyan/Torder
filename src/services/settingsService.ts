import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Setting } from "../types/database";
import {
  defaultAppSettings,
  type AppSettings,
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
  };
}

export async function saveAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await upsertSetting(key, value);
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
