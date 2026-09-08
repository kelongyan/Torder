/**
 * mobile/parts/taskEdits.ts — 移动端任务字段编辑辅助（M-B）
 * 统一走 store 的 saveTask（UpdateTaskInput 全量），与桌面同一条 IPC 路径，
 * 避免在移动端复制一份「部分更新」逻辑；重写由 store 乐观更新兜底。
 */
import type { Task, UpdateTaskInput } from "../../types/database";

/** 由现有任务构造完整 UpdateTaskInput（override 只覆盖指定字段） */
export function buildUpdateTaskInput(
  task: Task,
  overrides: Partial<
    Pick<
      UpdateTaskInput,
      | "title"
      | "note"
      | "priority"
      | "listId"
      | "scheduledDate"
      | "dueAt"
      | "remindBefore"
      | "repeatRule"
      | "subtasks"
      | "tags"
    >
  >,
): UpdateTaskInput {
  return {
    id: task.id,
    title: overrides.title ?? task.title,
    note: overrides.note !== undefined ? overrides.note : task.note,
    status: task.status,
    priority: overrides.priority ?? task.priority,
    listId: overrides.listId ?? task.listId,
    scheduledDate:
      overrides.scheduledDate !== undefined
        ? overrides.scheduledDate
        : task.scheduledDate,
    dueAt: overrides.dueAt !== undefined ? overrides.dueAt : task.dueAt,
    sortOrder: task.sortOrder,
    remindBefore:
      overrides.remindBefore !== undefined
        ? overrides.remindBefore
        : task.remindBefore,
    repeatRule: overrides.repeatRule ?? task.repeatRule,
    subtasks: overrides.subtasks ?? task.subtasks,
    tags: overrides.tags ?? task.tags,
  };
}

/* ---------------- 提醒预设（镜像 reminderConfig / 设计稿 enums） ---------------- */
export const REMINDER_OPTIONS: Array<{ value: number; label: string }> = [
  { value: -1, label: "不提醒" },
  { value: 0, label: "到期当天" },
  { value: 60, label: "提前 1 小时" },
  { value: 120, label: "提前 2 小时" },
  { value: 1440, label: "提前 1 天" },
  { value: 2880, label: "提前 2 天" },
  { value: 10080, label: "提前 1 周" },
];

export function describeReminder(remindBefore: number | null): string {
  if (remindBefore == null) return "不提醒";
  return (
    REMINDER_OPTIONS.find((r) => r.value === remindBefore)?.label ??
    `提前 ${remindBefore} 分钟`
  );
}

/* ---------------- 日期换算（与桌面 taskDates 同语义：本地时间） ---------------- */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

/** 详情/表单展示截止时刻：MM-DD HH:mm 或 今天 HH:mm */
export function formatDueShort(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `今天 ${hhmm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`;
}

export function formatDateKey(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 任务行截止标签（本地时间口径）：今天 HH:mm / 已逾期 / MM-DD HH:mm */
export function formatDueLabel(iso: string): { text: string; danger: boolean } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const past = d.getTime() < now.getTime();
  if (sameDay) {
    return {
      text: `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      danger: false,
    };
  }
  if (past) return { text: "已逾期", danger: true };
  return {
    text: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    danger: false,
  };
}
