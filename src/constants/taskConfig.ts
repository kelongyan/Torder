import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flag,
  ListTodo,
  Star,
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
  { view: "important", icon: Star },
  { view: "completed", icon: CheckCircle2 },
];

export const layoutOptions: Array<{ value: TaskLayout; label: string }> = [
  { value: "list", label: "列表" },
  { value: "board", label: "看板" },
  { value: "calendar", label: "日历" },
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

export const priorityCopy: Record<0 | 1 | 2, { label: string; className: string }> = {
  2: { label: "高", className: "priority-high" },
  1: { label: "中", className: "priority-medium" },
  0: { label: "低", className: "priority-low" },
};
