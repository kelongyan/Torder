import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CreateRecurringRuleInput,
  RecurringGenerationResult,
  RecurringRule,
  Task,
  UpdateRecurringRuleInput,
} from "../types/database";
import {
  addBrowserTask,
  findBrowserTask,
  getBrowserTasksSnapshot,
  updateBrowserTask,
} from "./browserTaskMock";
import { toLocalDateKey } from "../utils/taskDates";
import { toRfc3339Seconds } from "../utils/taskPrediction";

let browserRules: RecurringRule[] = [];

export function listRecurringRules(): Promise<RecurringRule[]> {
  if (!isTauri()) {
    // 与 Rust 侧 list 的 ORDER BY enabled DESC, next_due_at, created_at DESC 对齐。
    return Promise.resolve(
      browserRules
        .filter((rule) => !rule.deletedAt)
        .sort(compareRules)
        .map(cloneRule),
    );
  }
  return invoke<RecurringRule[]>("list_recurring_rules");
}

export async function createRecurringRule(
  input: CreateRecurringRuleInput,
): Promise<RecurringRule> {
  if (isTauri())
    return invoke<RecurringRule>("create_recurring_rule", { input });

  // 镜像 Rust validate_input + validate_schedule，先校验再入库。
  validateBrowserRuleInput(input);
  // 先校验来源任务，避免规则先入数组、校验失败后泄漏（Rust 侧会回滚）。
  const source = input.sourceTaskId
    ? findBrowserTask(input.sourceTaskId)
    : undefined;
  if (input.sourceTaskId && !source) throw new Error("来源任务不存在");

  const now = new Date().toISOString();
  const rule: RecurringRule = {
    id: `browser-rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: input.title.trim(),
    note: input.note?.trim() || null,
    priority: input.priority,
    listId: input.listId,
    frequency: input.frequency,
    intervalCount: input.intervalCount,
    weekdays: normalizeWeekdays(input.weekdays),
    monthDay: input.monthDay,
    firstDueAt: input.firstDueAt,
    nextDueAt: input.firstDueAt,
    timezone: input.timezone,
    generateAheadMinutes: input.generateAheadMinutes,
    remindBefore: input.remindBefore,
    endAt: input.endAt,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  browserRules = [rule, ...browserRules];
  if (source) {
    updateBrowserTask(source.id, (task) => ({
      ...task,
      repeatRule: null,
      recurringRuleId: rule.id,
      occurrenceAt: input.firstDueAt,
      updatedAt: now,
    }));
  }
  generateBrowserRule(rule, false);
  return cloneRule(rule);
}

export async function updateRecurringRule(
  input: UpdateRecurringRuleInput,
): Promise<RecurringRule> {
  if (isTauri())
    return invoke<RecurringRule>("update_recurring_rule", { input });
  // 与 Rust update 一致：先校验排期合法性，失败不变更规则状态。
  validateBrowserRuleInput(input);
  const rule = findBrowserRule(input.id);
  const weekdays = normalizeWeekdays(input.weekdays);
  const scheduleChanged =
    rule.frequency !== input.frequency ||
    rule.intervalCount !== input.intervalCount ||
    !sameNumberArray(rule.weekdays, weekdays) ||
    rule.monthDay !== input.monthDay ||
    rule.firstDueAt !== input.firstDueAt ||
    rule.timezone !== input.timezone;
  const nextDueAt = boundNextDueAt(
    scheduleChanged ? input.firstDueAt : rule.nextDueAt,
    input.endAt,
  );
  Object.assign(rule, {
    ...input,
    title: input.title.trim(),
    note: input.note?.trim() || null,
    weekdays,
    nextDueAt,
    enabled: nextDueAt === null ? false : rule.enabled,
    updatedAt: new Date().toISOString(),
  });
  generateBrowserRule(rule, false);
  return cloneRule(rule);
}

export async function setRecurringRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<RecurringRule> {
  if (isTauri())
    return invoke<RecurringRule>("set_recurring_rule_enabled", { id, enabled });
  const rule = findBrowserRule(id);
  rule.enabled = enabled;
  rule.updatedAt = new Date().toISOString();
  return Promise.resolve(cloneRule(rule));
}

export async function skipNextRecurringOccurrence(
  id: string,
): Promise<RecurringRule> {
  if (isTauri())
    return invoke<RecurringRule>("skip_next_recurring_occurrence", { id });
  const rule = findBrowserRule(id);
  if (!rule.nextDueAt) return Promise.reject(new Error("循环任务已经结束"));
  const next = nextOccurrence(rule, rule.nextDueAt);
  rule.nextDueAt = rule.endAt && next > rule.endAt ? null : next;
  rule.enabled = rule.nextDueAt !== null && rule.enabled;
  rule.updatedAt = new Date().toISOString();
  return Promise.resolve(cloneRule(rule));
}

export async function generateNextRecurringOccurrence(
  id: string,
): Promise<RecurringGenerationResult> {
  if (isTauri())
    return invoke<RecurringGenerationResult>(
      "generate_next_recurring_occurrence",
      { id },
    );
  const rule = findBrowserRule(id);
  // 与 Rust generate_next_now 对齐：规则已结束时报错，且不变更规则状态。
  if (!rule.nextDueAt || (rule.endAt && rule.nextDueAt > rule.endAt)) {
    return Promise.reject(new Error("循环任务已经结束"));
  }
  return Promise.resolve({
    generatedCount: generateBrowserRule(rule, true),
  });
}

export async function deleteRecurringRule(
  id: string,
  deleteFutureTasks: boolean,
): Promise<void> {
  if (isTauri())
    return invoke<void>("delete_recurring_rule", { id, deleteFutureTasks });
  const rule = findBrowserRule(id);
  const now = new Date().toISOString();
  rule.enabled = false;
  rule.deletedAt = now;
  rule.updatedAt = now;
  if (deleteFutureTasks) {
    for (const task of getBrowserTasksSnapshot()) {
      if (
        task.recurringRuleId === id &&
        task.status === "todo" &&
        task.dueAt &&
        task.dueAt >= now
      ) {
        updateBrowserTask(task.id, (current) => ({
          ...current,
          deletedAt: now,
          updatedAt: now,
        }));
      }
    }
  }
  return Promise.resolve();
}

function generateBrowserRule(rule: RecurringRule, force: boolean): number {
  if (!rule.enabled || !rule.nextDueAt) return 0;
  const now = new Date();
  let occurrence = rule.nextDueAt;
  let selected: string | null = null;

  for (let index = 0; index < 10_000; index += 1) {
    if (rule.endAt && occurrence > rule.endAt) {
      rule.nextDueAt = null;
      rule.enabled = false;
      break;
    }
    const creationTime =
      new Date(occurrence).getTime() - rule.generateAheadMinutes * 60_000;
    if (!force && creationTime > now.getTime()) break;
    selected = occurrence;
    occurrence = nextOccurrence(rule, occurrence);
    if (force) break;
  }

  if (!selected) return 0;
  rule.nextDueAt = rule.endAt && occurrence > rule.endAt ? null : occurrence;
  if (!rule.nextDueAt) rule.enabled = false;
  rule.updatedAt = now.toISOString();
  const exists = getBrowserTasksSnapshot().some(
    (task) =>
      task.recurringRuleId === rule.id &&
      task.occurrenceAt === selected &&
      !task.deletedAt,
  );
  if (exists) return 0;

  const remindAt = computeOccurrenceRemindAt(
    selected,
    rule.remindBefore,
    now.getTime(),
  );
  const task: Task = {
    id: `browser-recurring-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: rule.title,
    note: rule.note,
    status: "todo",
    priority: rule.priority,
    listId: rule.listId,
    scheduledDate: toLocalDateKey(selected),
    dueAt: selected,
    completedAt: null,
    sortOrder: 0,
    remindBefore: rule.remindBefore,
    remindAt,
    remindedAt: null,
    repeatRule: null,
    subtasks: [],
    tags: [],
    recurringRuleId: rule.id,
    occurrenceAt: selected,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deletedAt: null,
  };
  addBrowserTask(task);
  return 1;
}

function nextOccurrence(rule: RecurringRule, currentIso: string): string {
  const current = new Date(currentIso);
  const first = new Date(rule.firstDueAt);
  if (rule.frequency === "daily") {
    current.setDate(current.getDate() + rule.intervalCount);
    return current.toISOString();
  }
  if (rule.frequency === "weekly") {
    const anchorMonday = startOfWeek(first).getTime();
    const candidate = new Date(current);
    for (let index = 0; index < rule.intervalCount * 7 + 7; index += 1) {
      candidate.setDate(candidate.getDate() + 1);
      const weekDelta = Math.floor(
        (startOfWeek(candidate).getTime() - anchorMonday) / 604_800_000,
      );
      if (
        weekDelta >= 0 &&
        weekDelta % rule.intervalCount === 0 &&
        rule.weekdays.includes(candidate.getDay())
      ) {
        return candidate.toISOString();
      }
    }
    // 与 Rust next_occurrence 对齐：未命中时报错，而不是落进月度计算。
    throw new Error("无法计算每周循环的下一次发生时间");
  }

  const months = rule.intervalCount * (rule.frequency === "quarterly" ? 3 : 1);
  const day = rule.monthDay ?? first.getDate();
  const target = new Date(current);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.toISOString();
}

function startOfWeek(date: Date): Date {
  const value = new Date(date);
  const offset = (value.getDay() + 6) % 7;
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - offset);
  return value;
}

function normalizeWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays)].sort((left, right) => left - right);
}

/**
 * 镜像 Rust recurring_repository::validate_input + recurrence::validate_schedule。
 * 时区/日期解析在前端做近似校验（Rust 用 chrono-tz 与 RFC3339 严格解析）。
 */
function validateBrowserRuleInput(
  input: CreateRecurringRuleInput | UpdateRecurringRuleInput,
): void {
  if (!input.title.trim()) throw new Error("循环任务标题不能为空");
  if (input.priority < 0 || input.priority > 2)
    throw new Error("优先级必须在 0 到 2 之间");
  if (
    input.frequency !== "daily" &&
    input.frequency !== "weekly" &&
    input.frequency !== "monthly" &&
    input.frequency !== "quarterly"
  ) {
    throw new Error("无效的循环频率");
  }
  if (
    !Number.isInteger(input.intervalCount) ||
    input.intervalCount < 1 ||
    input.intervalCount > 365
  ) {
    throw new Error("循环间隔必须在 1 到 365 之间");
  }
  if (
    input.frequency === "weekly" &&
    (input.weekdays.length === 0 ||
      input.weekdays.some((day) => day < 0 || day > 6))
  ) {
    throw new Error("每周循环必须包含有效的星期");
  }
  if (
    (input.frequency === "monthly" || input.frequency === "quarterly") &&
    (input.monthDay === null || input.monthDay < 1 || input.monthDay > 31)
  ) {
    throw new Error("每月/每季度循环必须指定 1 到 31 的日期");
  }
  if (
    input.generateAheadMinutes < 0 ||
    (input.remindBefore !== null && input.remindBefore < 0)
  ) {
    throw new Error("循环偏移量不能为负数");
  }
  const firstDueAt = Date.parse(input.firstDueAt);
  if (Number.isNaN(firstDueAt)) throw new Error("首次到期时间无效");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    throw new Error("无效的循环时区");
  }
  if (input.endAt !== null) {
    const endAt = Date.parse(input.endAt);
    if (Number.isNaN(endAt)) throw new Error("结束时间无效");
    if (endAt < firstDueAt) throw new Error("结束时间不能早于首次到期时间");
  }
}

/** 与 Rust 侧 ORDER BY enabled DESC, next_due_at, created_at DESC 对齐。 */
function compareRules(left: RecurringRule, right: RecurringRule): number {
  if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
  const dueOrder = compareNullableTextAsc(left.nextDueAt, right.nextDueAt);
  if (dueOrder !== 0) return dueOrder;
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1;
  }
  return 0;
}

/** SQLite 的升序默认 NULL 排最前，这里保持一致。 */
function compareNullableTextAsc(
  left: string | null,
  right: string | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameNumberArray(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function boundNextDueAt(
  nextDueAt: string | null,
  endAt: string | null,
): string | null {
  if (!nextDueAt || !endAt) return nextDueAt;
  return new Date(nextDueAt).getTime() <= new Date(endAt).getTime()
    ? nextDueAt
    : null;
}

function computeOccurrenceRemindAt(
  occurrenceAt: string,
  remindBefore: number | null,
  nowTime: number,
): string | null {
  if (remindBefore === null) return null;
  const occurrenceTime = new Date(occurrenceAt).getTime();
  if (Number.isNaN(occurrenceTime)) return null;
  const remindTime = occurrenceTime - remindBefore * 60_000;
  return remindTime > nowTime ? toRfc3339Seconds(new Date(remindTime)) : null;
}

function findBrowserRule(id: string): RecurringRule {
  const rule = browserRules.find((item) => item.id === id && !item.deletedAt);
  if (!rule) throw new Error("循环任务不存在");
  return rule;
}

function cloneRule(rule: RecurringRule): RecurringRule {
  return { ...rule, weekdays: [...rule.weekdays] };
}
