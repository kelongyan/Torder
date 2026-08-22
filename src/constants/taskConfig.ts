import {
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX2,
  CheckCircle2,
  Clock,
  Flag,
  Inbox,
  Kanban,
  List,
  ListTodo,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { SystemView, TaskLayout, TaskSortBy } from "../types/database";

export const systemNav: Array<{
  view: SystemView;
  icon: LucideIcon;
}> = [
  { view: "all", icon: ListTodo },
  { view: "today", icon: Calendar },
  { view: "planned", icon: CalendarDays },
  { view: "overdue", icon: CalendarClock },
  { view: "no-date", icon: Inbox },
  { view: "important", icon: Star },
  { view: "completed", icon: CheckCircle2 },
  { view: "deleted", icon: Trash2 },
];

export const layoutOptions: Array<{
  value: TaskLayout;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "list", label: "列表", icon: List },
  { value: "board", label: "看板", icon: Kanban },
  { value: "calendar", label: "日历", icon: Calendar },
  { value: "month", label: "月历", icon: CalendarRange },
  { value: "week", label: "周视图", icon: CalendarX2 },
];

export const sortOptions: Array<{
  value: TaskSortBy;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "priority", label: "按优先级", icon: Flag },
  { value: "date", label: "按截止日期", icon: Calendar },
  { value: "created", label: "按创建时间", icon: Clock },
];

export const priorityCopy: Record<
  0 | 1 | 2,
  { label: string; className: string }
> = {
  2: { label: "高", className: "priority-high" },
  1: { label: "中", className: "priority-medium" },
  0: { label: "低", className: "priority-low" },
};

export const priorityOptions = [
  { value: 2 as const, label: priorityCopy[2].label, color: "var(--red)" },
  { value: 1 as const, label: priorityCopy[1].label, color: "var(--amber)" },
  { value: 0 as const, label: priorityCopy[0].label, color: "var(--blue)" },
];
