import type { SystemView, TaskLayout, TaskScope, TaskSortBy } from "./database";

export type ThemePreference = "system" | "light" | "dark";
export type SavedViewIcon = "filter" | "star" | "calendar" | "tag";

export interface SavedTaskView {
  id: string;
  name: string;
  icon: SavedViewIcon;
  scope: TaskScope;
  query: string;
  sortBy: TaskSortBy;
  showCompleted: boolean;
  layout: TaskLayout;
}

export interface AppSettings {
  theme: ThemePreference;
  defaultReminderMinutes: number;
  defaultListId: string;
  defaultView: SystemView;
  trashRetentionDays: number | null;
  backupRetentionCount: number;
  savedViews: SavedTaskView[];
}

export const defaultAppSettings: AppSettings = {
  theme: "dark",
  defaultReminderMinutes: 1440,
  defaultListId: "work",
  defaultView: "all",
  trashRetentionDays: null,
  backupRetentionCount: 20,
  savedViews: [],
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
