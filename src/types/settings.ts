import type { TaskView } from "./database";

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
  defaultView: TaskView;
  defaultReminderMinutes: number | null;
  launchAtStartup: boolean;
}

export const defaultAppSettings: AppSettings = {
  theme: "system",
  defaultView: "today",
  defaultReminderMinutes: null,
  launchAtStartup: false,
};

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
