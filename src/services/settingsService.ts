import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  disable as disableAutostart,
  enable as enableAutostart,
} from "@tauri-apps/plugin-autostart";
import type { Setting, TaskView } from "../types/database";
import {
  defaultAppSettings,
  type AppSettings,
  type ThemePreference,
} from "../types/settings";

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
    defaultView: parseDefaultView(settings.get("defaultView")),
    defaultReminderMinutes: parseReminderMinutes(
      settings.get("defaultReminderMinutes"),
    ),
    launchAtStartup: parseBoolean(settings.get("launchAtStartup"), false),
  };
}

export async function saveAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  if (key === "launchAtStartup") {
    await setLaunchAtStartup(Boolean(value));
    return;
  }
  await upsertSetting(key, value);
}

export async function synchronizeLaunchAtStartup(enabled: boolean) {
  if (!isTauri()) return;
  if (enabled) {
    await enableAutostart();
  } else {
    await disableAutostart();
  }
}

export function getBrowserSettingsSnapshot(): Setting[] {
  return browserSettings.map((setting) => ({ ...setting }));
}

export function replaceBrowserSettings(settings: Setting[]): void {
  browserSettings = settings.map((setting) => ({ ...setting }));
}

async function setLaunchAtStartup(enabled: boolean) {
  await synchronizeLaunchAtStartup(enabled);
  await upsertSetting("launchAtStartup", enabled);
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

function parseDefaultView(value: string | undefined): TaskView {
  const parsed = parseJson(value);
  return parsed === "today" ||
    parsed === "all" ||
    parsed === "completed" ||
    parsed === "overdue"
    ? parsed
    : defaultAppSettings.defaultView;
}

function parseReminderMinutes(value: string | undefined): number | null {
  const parsed = parseJson(value);
  return parsed === null ||
    parsed === 0 ||
    parsed === 15 ||
    parsed === 30 ||
    parsed === 60
    ? parsed
    : defaultAppSettings.defaultReminderMinutes;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseJson(value);
  return typeof parsed === "boolean" ? parsed : fallback;
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
