export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return toLocalDateTimeValue(date);
}

export function fromDateTimeLocal(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

export function toLocalDateKey(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return toDateKey(date);
}

export function toLocalDateTimeValue(date: Date): string {
  return (
    toDateKey(date) + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function getDefaultDueAtLocal(now = new Date()): string {
  const due = new Date(now);
  due.setSeconds(0, 0);

  if (due.getHours() >= 23) {
    due.setHours(23, 59, 0, 0);
  } else {
    due.setHours(due.getHours() + 1, 0, 0, 0);
  }

  return toLocalDateTimeValue(due);
}

export function formatTaskDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const now = new Date();
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  if (isSameDay(date, now)) return `今天 ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(date, tomorrow)) return `明天 ${time}`;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTaskScheduleDate(dateKey: string | null): string | null {  if (!dateKey) return null;
  const date = parseDateKey(dateKey);
  if (!date) return null;
  const now = new Date();
  if (isSameDay(date, now)) return "今天";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "明天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** HH:mm（与 formatTaskDate 的时间段同格式），用于今天视图时间槽 / now 指示线。 */
export function formatTimeOfDay(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTaskDateTime(iso: string | null): string {
  return formatTaskDate(iso) ?? "未设置";
}

export function getTaskCalendarKey(task: {
  scheduledDate: string | null;
  dueAt: string | null;
}): string | null {
  return task.scheduledDate ?? toLocalDateKey(task.dueAt);
}

export function formatCalendarDate(dateKey: string | null): {
  key: string;
  title: string;
  weekday: string;
  isToday: boolean;
} {
  if (!dateKey) {
    return { key: "unscheduled", title: "未安排", weekday: "", isToday: false };
  }

  const date = parseDateKey(dateKey);
  if (!date) {
    return { key: "unscheduled", title: "未安排", weekday: "", isToday: false };
  }
  const today = new Date();
  return {
    key: dateKey,
    title: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(
      date,
    ),
    isToday: isSameDay(date, today),
  };
}

export function isOverdue(iso: string | null, status: string): boolean {
  // 与逾期视图 / 侧栏计数同口径：按「本地日期」判断（到期日早于今天即逾期），
  // 不用精确时间戳，避免"行上标红但不在逾期视图"的口径漂移。
  if (status !== "todo" || !iso) return false;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return false;
  return toDateKey(due) < toDateKey(new Date());
}

export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}
