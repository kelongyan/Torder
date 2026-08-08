import type { RecurringRule } from "../types/database";

const weekdayCopy = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function describeRecurringRule(rule: RecurringRule): string {
  const interval = rule.intervalCount > 1 ? `每 ${rule.intervalCount}` : "每";
  if (rule.frequency === "daily") return `${interval}天`;
  if (rule.frequency === "weekly") {
    const days = [...rule.weekdays]
      .sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7))
      .map((day) => weekdayCopy[day])
      .join("、");
    return `${interval}周 · ${days}`;
  }
  const day = rule.monthDay ?? new Date(rule.firstDueAt).getDate();
  if (rule.frequency === "quarterly") {
    return rule.intervalCount > 1
      ? `每 ${rule.intervalCount} 个季度 · ${day} 日`
      : `每季度 · ${day} 日`;
  }
  return `${interval}月 · ${day} 日`;
}

export function describeGenerationLead(minutes: number): string {
  if (minutes === 0) return "到期时创建";
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天创建`;
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时创建`;
  return `提前 ${minutes} 分钟创建`;
}
