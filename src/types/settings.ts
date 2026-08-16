export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
  defaultReminderMinutes: number;
}

export const defaultAppSettings: AppSettings = {
  theme: "dark",
  defaultReminderMinutes: 1440,
};

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  notes: string | null;
  downloadUrl: string;
  sha256: string | null;
}
