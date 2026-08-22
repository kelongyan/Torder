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

let browserRules: RecurringRule[] = [];

export function listRecurringRules(): Promise<RecurringRule[]> {
  if (!isTauri()) {
    return Promise.resolve(
      browserRules.filter((rule) => !rule.deletedAt).map(cloneRule),
    );
  }
  return invoke<RecurringRule[]>("list_recurring_rules");
}

export async function createRecurringRule(
  input: CreateRecurringRuleInput,
): Promise<RecurringRule> {
  if (isTauri())
    return invoke<RecurringRule>("create_recurring_rule", { input });

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
  if (input.sourceTaskId) {
    const source = findBrowserTask(input.sourceTaskId);
    if (!source) throw new Error("来源任务不存在");
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

export function setRecurringRuleEnabled(
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

export function skipNextRecurringOccurrence(
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

export function generateNextRecurringOccurrence(
  id: string,
): Promise<RecurringGenerationResult> {
  if (isTauri())
    return invoke<RecurringGenerationResult>(
      "generate_next_recurring_occurrence",
      { id },
    );
  return Promise.resolve({
    generatedCount: generateBrowserRule(findBrowserRule(id), true),
  });
}

export function deleteRecurringRule(
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
    dueAt: selected,
    completedAt: null,
    sortOrder: 0,
    remindBefore: rule.remindBefore,
    remindAt,
    remindedAt: null,
    repeatRule: null,
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

function toRfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function findBrowserRule(id: string): RecurringRule {
  const rule = browserRules.find((item) => item.id === id && !item.deletedAt);
  if (!rule) throw new Error("循环任务不存在");
  return rule;
}

function cloneRule(rule: RecurringRule): RecurringRule {
  return { ...rule, weekdays: [...rule.weekdays] };
}
