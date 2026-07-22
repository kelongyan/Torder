export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
}

export const defaultAppSettings: AppSettings = {
  theme: "dark",
};

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
