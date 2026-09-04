/**
 * enums.js — 枚举与常量，镜像桌面端 constants/*.ts 与 types/database.ts
 * 安卓重构时这些值必须与 Rust/TS 端保持一致，此处集中维护。
 */

/** 系统视图（8 个，顺序即浏览页展示顺序） */
export const SYSTEM_VIEWS = [
  { id: "all", label: "全部任务", icon: "list-todo" },
  { id: "today", label: "今日任务", icon: "calendar" },
  { id: "planned", label: "计划中", icon: "calendar-days" },
  { id: "overdue", label: "已逾期", icon: "calendar-clock", danger: true },
  { id: "no-date", label: "无截止日期", icon: "inbox" },
  { id: "important", label: "重要任务", icon: "star" },
  { id: "completed", label: "已完成", icon: "check-circle-2" },
  { id: "deleted", label: "回收站", icon: "trash-2" },
];

export const VIEW_LABEL = Object.fromEntries(SYSTEM_VIEWS.map((v) => [v.id, v.label]));

/** 优先级：2 高 / 1 中 / 0 低（镜像 priorityCopy） */
export const PRIORITIES = {
  2: { label: "高", cls: "priority-high", colorVar: "--red" },
  1: { label: "中", cls: "priority-medium", colorVar: "--amber" },
  0: { label: "低", cls: "priority-low", colorVar: "--blue" },
};
export const PRIORITY_ORDER = [2, 1, 0];

/** 排序（4 种；manual 手动排序是桌面拖拽序，移动端保留枚举但默认隐藏入口） */
export const SORT_OPTIONS = [
  { id: "priority", label: "按优先级" },
  { id: "date", label: "按截止日期" },
  { id: "created", label: "按创建时间" },
  { id: "manual", label: "手动排序" },
];

/** 提醒预设（镜像 reminderConfig.ts，单位：分钟） */
export const REMINDER_OPTIONS = [
  { value: -1, label: "不提醒" },
  { value: 0, label: "到期当天" },
  { value: 60, label: "提前 1 小时" },
  { value: 120, label: "提前 2 小时" },
  { value: 1440, label: "提前 1 天" },
  { value: 2880, label: "提前 2 天" },
  { value: 10080, label: "提前 1 周" },
];

/** 清单调色板（镜像 listConfig.ts presetListColors） */
export const LIST_COLORS = [
  "#6366f1", "#10b981", "#06b6d4", "#f59e0b",
  "#ef4444", "#a855f7", "#ec4899", "#64748b",
];
export const DEFAULT_LIST_COLOR = "#6366f1";

/** 循环频率（RecurrenceFrequency） */
export const FREQ_LABELS = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  quarterly: "每季度",
};

/** 日历事件类型（calendarEventConfig） */
export const EVENT_TYPES = {
  leave: { label: "休假", icon: "palmtree", colorVar: "--green" },
  trip: { label: "出差", icon: "plane", colorVar: "--blue" },
  other: { label: "其他", icon: "circle-dot", colorVar: "--amber" },
};

/** 强调色预设（settings AccentPreference，6 色） */
export const ACCENTS = [
  { id: "violet", label: "紫罗兰", color: "#a98af5" },
  { id: "blue", label: "海蓝", color: "#6aa6ff" },
  { id: "teal", label: "青碧", color: "#4bc0c8" },
  { id: "green", label: "森绿", color: "#43c48d" },
  { id: "amber", label: "琥珀", color: "#e8b04b" },
  { id: "rose", label: "玫粉", color: "#f0819e" },
];

/** 主题（ThemePreference） */
export const THEMES = [
  { id: "light", label: "浅色", preview: "light" },
  { id: "dark", label: "深色", preview: "dark" },
  { id: "system", label: "跟随系统", preview: "auto" },
];

/** 新建任务默认截止策略（DefaultDueDate） */
export const DEFAULT_DUE_OPTIONS = [
  { id: "none", label: "不设置" },
  { id: "today", label: "今天" },
  { id: "tomorrow", label: "明天" },
  { id: "next_monday", label: "下周一" },
];
