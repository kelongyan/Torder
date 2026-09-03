import type { SystemView, TaskLayout, TaskScope, TaskSortBy } from "./database";

export type ThemePreference = "system" | "light" | "dark";
/** T-09 强调色预设（设计稿 §2.4 六色板）；blue 为默认即无 data-accent 属性。 */
export type AccentPreference =
  "blue" | "violet" | "teal" | "green" | "amber" | "rose";
/** T-10 甲组：新建事项的默认截止。 */
export type DefaultDueDate = "none" | "today" | "tomorrow" | "next_monday";
/** T-10 甲组：提示音。system=系统默认音；silent=静音通知。 */
export type NotificationSound = "system" | "silent";
/** T-10 乙组：界面密度三档（compact/relaxed 覆写控件高度与行距，见 tokens.css）。 */
export type DensityPreference = "compact" | "standard" | "relaxed";
/** T-10 乙组：字号三档（覆写 --text-* token，见 tokens.css）。 */
export type FontSizePreference = "small" | "standard" | "large";
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
  /** T-09：强调色预设，持久化为 data-accent 属性。 */
  accent: AccentPreference;
  defaultReminderMinutes: number;
  defaultListId: string;
  defaultView: SystemView;
  trashRetentionDays: number | null;
  backupRetentionCount: number;
  savedViews: SavedTaskView[];
  /** T-10 甲组：新建事项默认截止。 */
  defaultDueDate: DefaultDueDate;
  /** T-10 甲组：新建事项默认优先级；-1 = 不预设（保持中优先级现状）。 */
  defaultPriority: -1 | 0 | 1 | 2;
  /** T-10 甲组：速记文本是否解析自然语言（关闭则整句作标题）。 */
  quickAddNaturalLanguage: boolean;
  /**
   * T-10 甲组：打勾后是否立刻把事项归入「已完成」段。
   * 关闭时刚打勾的事项暂留原位（带完成样式），切视图或重载后才归位，
   * 便于连续勾选时行不在指针下跳动。
   */
  moveCompletedImmediately: boolean;
  /** T-10 甲组：系统通知总开关（门控 useTaskReminder）。 */
  notificationsEnabled: boolean;
  /** T-10 甲组：提示音（system=系统音；silent=静音通知）。 */
  notificationSound: NotificationSound;
  /** 阶段 D · T-10 乙组：每日回顾提醒（到点发系统通知，未启动不补发）。 */
  reviewReminderEnabled: boolean;
  /** 阶段 D · T-10 乙组：每日回顾提醒时刻，格式 "HH:MM"。 */
  reviewReminderTime: string;
  /** 阶段 D · T-10 乙组：逾期任务自动顺延到明天（每日首次执行一次）。 */
  autoPostponeOverdue: boolean;
  /** 阶段 D · T-10 乙组：界面密度（standard 为默认即无 data-density 属性）。 */
  density: DensityPreference;
  /** 阶段 D · T-10 乙组：字号（standard 为默认即无 data-font-size 属性）。 */
  fontSize: FontSizePreference;
}

export const defaultAppSettings: AppSettings = {
  theme: "dark",
  accent: "blue",
  defaultReminderMinutes: 1440,
  defaultListId: "work",
  defaultView: "all",
  trashRetentionDays: null,
  backupRetentionCount: 20,
  savedViews: [],
  defaultDueDate: "none",
  defaultPriority: -1,
  quickAddNaturalLanguage: true,
  moveCompletedImmediately: true,
  notificationsEnabled: true,
  reviewReminderEnabled: false,
  reviewReminderTime: "21:00",
  autoPostponeOverdue: false,
  density: "standard",
  fontSize: "standard",
  notificationSound: "system",
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
