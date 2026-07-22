import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Setting } from "../types/database";
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
  };
}

export async function saveAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await upsertSetting(key, value);
}

export function getBrowserSettingsSnapshot(): Setting[] {
  return browserSettings.map((setting) => ({ ...setting }));
}

export function replaceBrowserSettings(settings: Setting[]): void {
  browserSettings = settings.map((setting) => ({ ...setting }));
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

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
