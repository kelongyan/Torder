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
