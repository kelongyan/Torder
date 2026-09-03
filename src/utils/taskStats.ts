import type { Task, UpdateTaskInput } from "../types/database";
import { localDateKey, shiftDateKey } from "../services/taskQuery";

/**
 * 每日回顾 / 项目详情共享的聚合统计口径（方案书阶段 C：T-04 打样定稿）。
 * 全部纯函数 + 显式 todayKey 注入，样例表驱动可测；T-06 项目详情页与
 * T-10 乙组「逾期自动顺延到明天」必须复用本模块的同一实现，禁止另写口径。
 *
 * 日期语义与视图一致：
 * - 逾期 = todo 且 dueAt 的本地日期 < todayKey（同 overdue 视图判定）；
 * - 7 日趋势按 completedAt / createdAt 的本地日期分桶（同计划日口径）。
 */

export interface DayStat {
  completed: number;
  created: number;
}

/** 近 7 日（含今日）逐日完成/新增计数，从最旧到最新。 */
export function weekTrend(
  tasks: Task[],
  todayKey: string,
): Array<{ key: string; label: string; completed: number; created: number }> {
  const byDay = new Map<string, DayStat>();
  const keys: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const key = shiftDateKey(todayKey, -offset);
    keys.push(key);
    byDay.set(key, { completed: 0, created: 0 });
  }
  for (const task of tasks) {
    const completedKey = task.completedAt
      ? localDateKey(new Date(task.completedAt))
      : null;
    const createdKey = localDateKey(new Date(task.createdAt));
    if (completedKey && byDay.has(completedKey)) {
      byDay.get(completedKey)!.completed += 1;
    }
    if (byDay.has(createdKey)) {
      byDay.get(createdKey)!.created += 1;
    }
  }
  const labelFor = (key: string) => {
    const label = new Date(`${key}T12:00:00`);
    return key === todayKey
      ? "今天"
      : `${label.getMonth() + 1}/${label.getDate()}`;
  };
  return keys.map((key) => ({
    key,
    label: labelFor(key),
    ...byDay.get(key)!,
  }));
}

/** 今日完成（completedAt 落在今天）的任务。 */
export function completedToday(tasks: Task[], todayKey: string): Task[] {
  return tasks.filter(
    (task) =>
      task.status === "done" &&
      task.completedAt !== null &&
      localDateKey(new Date(task.completedAt)) === todayKey,
  );
}

/** 今日新增（createdAt 落在今天）的任务数。 */
export function createdTodayCount(tasks: Task[], todayKey: string): number {
  return tasks.filter(
    (task) => localDateKey(new Date(task.createdAt)) === todayKey,
  ).length;
}

/** 待处理的今日到期任务（dueAt 落在今天，状态非 done）。 */
export function dueTodayTodos(tasks: Task[], todayKey: string): Task[] {
  return tasks.filter(
    (task) =>
      task.status === "todo" &&
      task.dueAt !== null &&
      localDateKey(new Date(task.dueAt)) === todayKey,
  );
}

/** 逾期任务 = todo 且 dueAt 的本地日期早于 todayKey（同 overdue 视图语义）。 */
export function overdueTodos(tasks: Task[], todayKey: string): Task[] {
  return tasks.filter(
    (task) =>
      task.status === "todo" &&
      task.dueAt !== null &&
      localDateKey(new Date(task.dueAt)) < todayKey,
  );
}

/**
 * 顺延规则唯一实现：把逾期任务移到 tomorrowKey。
 * - 有计划日（scheduledDate）→ 计划日顺延；
 * - 只有截止 → 截止时间整体平移一天（保留时刻）；
 * - 其余不产生 patch（返回 null）。
 * T-10 乙组「逾期自动顺延到明天」开关落地时必须调用本函数，禁止另写规则。
 */
export function shiftOverdueTaskPatch(
  task: Task,
  tomorrowKey: string,
): Partial<UpdateTaskInput> | null {
  if (task.status !== "todo" || task.dueAt === null) return null;
  if (task.scheduledDate !== null) {
    return task.scheduledDate === tomorrowKey
      ? null
      : { scheduledDate: tomorrowKey };
  }
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const shifted = new Date(tomorrowKey + "T12:00:00");
  shifted.setHours(due.getHours(), due.getMinutes(), due.getSeconds(), 0);
  return { dueAt: shifted.toISOString() };
}
