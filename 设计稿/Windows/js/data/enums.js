/**
 * enums.js — 枚举与常量，镜像主项目 constants/*.ts 与 types/database.ts
 * Windows 端为全集：5 种布局、4 种排序、8 个系统视图、8 个设置 Tab 均保留。
 */

/** 系统视图（8 个，顺序即侧栏导航顺序，镜像 systemNav） */
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

/** 5 种布局（镜像 layoutOptions，桌面端全部可用） */
export const LAYOUTS = [
  { id: "list", label: "列表", icon: "list" },
  { id: "board", label: "看板", icon: "kanban" },
  { id: "agenda", label: "日历", icon: "calendar" },
  { id: "month", label: "月历", icon: "calendar-range" },
  { id: "week", label: "周视图", icon: "calendar-x-2" },
];

/** 优先级：2 高 / 1 中 / 0 低（镜像 priorityCopy） */
export const PRIORITIES = {
  2: { label: "高", cls: "priority-high", colorVar: "--red" },
  1: { label: "中", cls: "priority-medium", colorVar: "--amber" },
  0: { label: "低", cls: "priority-low", colorVar: "--blue" },
};
export const PRIORITY_ORDER = [2, 1, 0];

/** 排序（4 种；manual 为桌面拖拽序，Windows 端保留入口） */
export const SORT_OPTIONS = [
  { id: "priority", label: "按优先级", icon: "flag" },
  { id: "date", label: "按截止日期", icon: "calendar" },
  { id: "created", label: "按创建时间", icon: "clock" },
  { id: "manual", label: "手动排序", icon: "grip-vertical" },
];

/** 看板三列（镜像 TaskBoard.columns：非完成且非高优先=待处理，非完成且高优先=进行中） */
export const BOARD_COLUMNS = [
  { id: "todo", title: "待处理", colorVar: "--blue" },
  { id: "doing", title: "进行中", colorVar: "--red" },
  { id: "done", title: "已完成", colorVar: "--green" },
];

/** 提醒预设（镜像 reminderConfig.ts，单位：分钟） */
export const REMINDER_OPTIONS = [
  { value: -1, label: "不提醒" },
  { value: 0, label: "到期时" },
  { value: 10, label: "提前 10 分钟" },
  { value: 60, label: "提前 1 小时" },
  { value: 120, label: "提前 2 小时" },
  { value: 1440, label: "提前 1 天" },
  { value: 2880, label: "提前 2 天" },
  { value: 10080, label: "提前 1 周" },
];

/** 清单调色板（镜像 listConfig.ts，8 色） */
export const LIST_COLORS = [
  "#6366f1", "#10b981", "#06b6d4", "#f59e0b",
  "#ef4444", "#a855f7", "#ec4899", "#64748b",
];
export const DEFAULT_LIST_COLOR = "#6366f1";

/** 循环频率 */
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

/** 强调色预设（6 色） */
export const ACCENTS = [
  { id: "violet", label: "紫罗兰", color: "#a98af5" },
  { id: "blue", label: "海蓝", color: "#6aa6ff" },
  { id: "teal", label: "青碧", color: "#4bc0c8" },
  { id: "green", label: "森绿", color: "#43c48d" },
  { id: "amber", label: "琥珀", color: "#e8b04b" },
  { id: "rose", label: "玫粉", color: "#f0819e" },
];

/** 主题 */
export const THEMES = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
];

/** 设置对话框 8 个 Tab（镜像 SettingsDialog.tabs） */
export const SETTINGS_TABS = [
  { id: "general", label: "常规", icon: "sliders-horizontal" },
  { id: "appearance", label: "外观", icon: "palette" },
  { id: "defaults", label: "事项默认值", icon: "list-checks" },
  { id: "notifications", label: "提醒与通知", icon: "bell-ring" },
  { id: "sync", label: "WebDAV 同步", icon: "cloud" },
  { id: "data", label: "数据与备份", icon: "database" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于", icon: "info" },
];

/** 新建任务默认截止策略 */
export const DEFAULT_DUE_OPTIONS = [
  { id: "none", label: "不设置" },
  { id: "today", label: "今天" },
  { id: "tomorrow", label: "明天" },
  { id: "next_monday", label: "下周一" },
];

/** 专注时长预设（镜像 FocusDialog） */
export const FOCUS_PRESETS = [15, 25, 45, 60];
