import { describe, expect, it, vi } from "vitest";
import { filterAndSortTasks, type QueryTasksInput } from "./taskQuery";
import type { Task } from "../types/database";

/**
 * l: 指令按清单名称解析为 ID 比较（与 Rust 侧 name 子查询语义一致），
 * 依赖 listService.getListsSnapshot 的快照。
 *
 * 注意：l: 测试独立成文件。实测 Vitest 4 中，vi.mock 与大量其他用例同文件
 * 共存时（模块 mock 懒求值 + 同文件模块图共享）会出现 mock 偶发失效、
 * 回落到真实快照的边界行为；独立文件可保证该文件的模块图只含本组用例，
 * mock 稳定生效。
 */
vi.mock("./listService", () => ({
  getListsSnapshot: () => [
    { id: "list-work", name: "工作" },
    { id: "list-life", name: "生活" },
  ],
}));

/** 与 taskQuery.test.ts 相同的夹具工厂（该文件不依赖 listService）。 */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "写周报",
    note: null,
    status: "todo",
    priority: 0,
    listId: "list-work",
    scheduledDate: null,
    dueAt: null,
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
    createdAt: "2026-09-01T08:00:00Z",
    updatedAt: "2026-09-01T08:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function query(overrides: Partial<QueryTasksInput> = {}): QueryTasksInput {
  return {
    scope: { kind: "view", view: "all" },
    query: "",
    sortBy: "created",
    showCompleted: false,
    ...overrides,
  };
}

describe("filterAndSortTasks · l: 指令", () => {
  it("按清单名解析为 ID 比较", () => {
    const tasks = [
      makeTask({ id: "a", listId: "list-work" }),
      makeTask({ id: "b", listId: "list-life" }),
    ];
    const result = filterAndSortTasks(tasks, query({ query: "l:工作" })).map(
      (task) => task.id,
    );
    expect(result).toEqual(["a"]);
  });

  it("匹配清单名时折叠 ASCII 大小写", () => {
    const tasks = [
      makeTask({ id: "a", listId: "list-work" }),
      makeTask({ id: "b", listId: "list-life" }),
    ];
    // 与 SQLite COLLATE NOCASE 一致：仅折叠 A-Z；中文名不受影响。
    expect(
      filterAndSortTasks(tasks, query({ query: "l:Work" })).map(
        (task) => task.id,
      ),
    ).toEqual([]);
    expect(
      filterAndSortTasks(tasks, query({ query: "l:工作" })).map(
        (task) => task.id,
      ),
    ).toEqual(["a"]);
  });

  it("未知清单名不命中任何任务", () => {
    const tasks = [makeTask({ id: "a", listId: "list-work" })];
    const result = filterAndSortTasks(tasks, query({ query: "l:不存在" })).map(
      (task) => task.id,
    );
    expect(result).toEqual([]);
  });

  it("l: 与其他搜索条件组合时取交集", () => {
    const tasks = [
      makeTask({ id: "a", listId: "list-work", priority: 2 }),
      makeTask({ id: "b", listId: "list-work", priority: 0 }),
      makeTask({ id: "c", listId: "list-life", priority: 2 }),
    ];
    const result = filterAndSortTasks(
      tasks,
      query({ query: "l:工作 p:2" }),
    ).map((task) => task.id);
    expect(result).toEqual(["a"]);
  });

  it("作为文本词匹配标题时不触发清单解析（l 不在开头）", () => {
    const tasks = [
      makeTask({ id: "a", title: "工作清单", listId: "list-work" }),
      makeTask({ id: "b", listId: "list-life" }),
    ];
    // 普通文本搜索，非 l: 指令：命中标题含「工作」的任务（不限定清单）。
    expect(
      filterAndSortTasks(tasks, query({ query: "工作" })).map(
        (task) => task.id,
      ),
    ).toEqual(["a"]);
  });
});
