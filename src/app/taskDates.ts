export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
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

export function formatTaskDateTime(iso: string | null): string {
  return formatTaskDate(iso) ?? "未设置";
}

export function formatCalendarDate(iso: string | null): {
  key: string;
  title: string;
  weekday: string;
  isToday: boolean;
} {
  if (!iso) {
    return { key: "unscheduled", title: "未安排", weekday: "", isToday: false };
  }

  const date = new Date(iso);
  const today = new Date();
  const key = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
  return {
    key,
    title: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date),
    isToday: isSameDay(date, today),
  };
}

export function isOverdue(iso: string | null, status: string): boolean {
  return status === "todo" && Boolean(iso && new Date(iso) < new Date());
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
