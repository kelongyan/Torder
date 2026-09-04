/**
 * format.js — 日期/时间格式化，语义对齐桌面 utils/taskDates.ts
 * 设计稿全部以本地时区计算，mock 数据也在运行时按“今天”生成，保证随时打开都成立。
 */

const pad = (n) => String(n).padStart(2, "0");

/** Date -> 'YYYY-MM-DD'（本地） */
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO -> 'YYYY-MM-DD'（本地），空安全 */
export function isoToKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateKey(d);
}

export function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const mdFmt = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const mdOnlyFmt = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
const longDateFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

/** 截止时间标签：今天 HH:mm / 明天 HH:mm / M月D日 HH:mm */
export function formatDue(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  const t = timeFmt.format(d);
  if (isSameDay(d, now)) return `今天 ${t}`;
  if (isSameDay(d, addDays(now, 1))) return `明天 ${t}`;
  return mdFmt.format(d);
}

/** 计划日期标签：今天 / 明天 / M月D日 */
export function formatSchedule(key, now = new Date()) {
  if (!key) return null;
  const d = parseKey(key);
  if (!d) return null;
  if (isSameDay(d, now)) return "今天";
  if (isSameDay(d, addDays(now, 1))) return "明天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatTimeOfDay(date) {
  return timeFmt.format(date);
}

/** ISO -> datetime-local 输入框值 'YYYY-MM-DDTHH:mm'（本地时区） */
export function toLocalInput(iso) {
  const d = new Date(iso);
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 完整时间标签（详情页创建/更新时间）：M月D日 HH:mm */
export function formatTaskDateTimeLabel(iso) {
  if (!iso) return "未设置";
  return mdFmt.format(new Date(iso));
}

export function formatLongDate(date) {
  return longDateFmt.format(date);
}

export function weekdayShort(date) {
  return weekdayFmt.format(date);
}

/** 'YYYY-MM-DD' -> 本地 Date（零点） */
export function parseKey(key) {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** 判断逾期（按日期粒度，镜像 taskQuery.isOverdue） */
export function isOverdue(iso, now = new Date()) {
  if (!iso) return false;
  return isoToKey(iso) < dateKey(now);
}

/** 构造相对今天偏移 n 天的日期 key */
export function relativeKey(n, now = new Date()) {
  return dateKey(addDays(now, n));
}

/** 构造相对今天某天的本地 ISO（按本地时区指定时分，toISOString 自动换算） */
export function relativeIso(n, hour, minute, now = new Date()) {
  const d = addDays(now, n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** 友好问候 */
export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 中文星期（短/长） */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
