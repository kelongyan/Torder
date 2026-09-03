import { describe, expect, it } from "vitest";
import { filterAndSortTasks, localDateKey, shiftDateKey } from "./taskQuery";
import type { SystemView, Task, TaskScope } from "../types/database";
import vectors from "./__fixtures__/task-query-vectors.json";

/**
 * P2-01 前端侧：消费共享查询向量（src/services/__fixtures__/task-query-vectors.json）。
 * 同一向量文件由 Rust task_repository 测试 include_str! 消费，锁定双端查询语义。
 * 新增/修改查询语义：先更新向量，再保证两端测试通过。
 *
 * 日期占位：$today/$yesterday/$tomorrow（date key）与 $todayNoon 等（本地正午）基于
 * 运行当天渲染，与 Rust 端 date('now','localtime') 同源，两端须同日运行。
 */

type VectorCase = {
  name: string;
  frontendSkip?: string;
  tasks: Array<Partial<Task> & { id: string }>;
  input: {
    scopeKind: "view" | "list";
    scopeValue: string;
    showCompleted: boolean;
    query: string | null;
    sortBy: "priority" | "date" | "created" | "manual";
  };
  expectIds: string[];
};

const today = () => localDateKey(new Date());
const noon = (dayOffset: number): string => {
  const base = new Date();
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  date.setDate(date.getDate() + dayOffset);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
};

/** 展开占位符为具体值（仅出现在 scheduledDate / dueAt）。 */
function renderDateValue(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const key = (offset: number) => shiftDateKey(today(), offset);
  switch (value) {
    case "$today":
      return key(0);
    case "$yesterday":
      return key(-1);
    case "$tomorrow":
      return key(1);
    case "$todayNoon":
      return noon(0);
    case "$yesterdayNoon":
      return noon(-1);
    case "$tomorrowNoon":
      return noon(1);
    default:
      return value;
  }
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const createdAt = overrides.createdAt ?? "2026-07-01T00:00:00Z";
  const { scheduledDate, dueAt, ...rest } = overrides;
  return {
    title: "未命名",
    note: null,
    status: "todo",
    priority: 0,
    listId: "work",
    completedAt: null,
    sortOrder: 0,
    remindBefore: null,
    remindAt: null,
    remindedAt: null,
    repeatRule: null,
    subtasks: [],
    tags: [],
    recurringRuleId: null,
    occurrenceAt: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...rest,
    scheduledDate: renderDateValue(scheduledDate),
    dueAt: renderDateValue(dueAt),
  };
}

function toScope(scopeKind: string, scopeValue: string): TaskScope {
  return scopeKind === "list"
    ? { kind: "list", listId: scopeValue }
    : { kind: "view", view: scopeValue as SystemView };
}

const cases = (vectors as { cases: VectorCase[] }).cases;

describe("共享查询向量 · 前端消费", () => {
  for (const vector of cases) {
    const run = vector.frontendSkip
      ? it.skip
      : (title: string, fn: () => void) => it(title, fn);
    run(vector.name, () => {
      const tasks = vector.tasks.map(makeTask);
      const result = filterAndSortTasks(tasks, {
        scope: toScope(vector.input.scopeKind, vector.input.scopeValue),
        query: vector.input.query ?? "",
        sortBy: vector.input.sortBy,
        showCompleted: vector.input.showCompleted,
      }).map((task) => task.id);
      expect(result).toEqual(vector.expectIds);
    });
  }
});
