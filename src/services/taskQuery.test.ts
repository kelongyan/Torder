import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterAndSortTasks,
  localDateKey,
  shiftDateKey,
  taskPlanDateKey,
  type QueryTasksInput,
} from "./taskQuery";
import type { Task } from "../types/database";

/** Task 测试夹具工厂：默认为一个今天到期的普通待办。 */
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

const todayKey = () => localDateKey(new Date());
const yesterdayKey = () => shiftDateKey(todayKey(), -1);

beforeEach(() => {
  // matchesSystemView 的 today/planned 等视图依赖当前日期，保持可重复性
  // Vitest 4 的 useFakeTimers 接收配置对象；裸 Date 会被忽略导致用真实时间
  vi.useFakeTimers({ now: new Date(2026, 8, 3, 12, 0, 0) }); // 2026-09-03 12:00
});

afterEach(() => {
  vi.useRealTimers();
});

describe("filterAndSortTasks · scope", () => {
  it("all 视图排除已删除与归档任务", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", deletedAt: "2026-09-02T00:00:00Z" }),
      makeTask({ id: "c", status: "archived" }),
    ];
    const result = filterAndSortTasks(tasks, query());
    expect(result.map((task) => task.id)).toEqual(["a"]);
  });

  it("showCompleted=false 排除已完成，true 时保留", () => {
    const tasks = [
      makeTask({ id: "a", status: "todo" }),
      makeTask({
        id: "b",
        status: "done",
        completedAt: "2026-09-02T00:00:00Z",
      }),
    ];
    expect(
      filterAndSortTasks(tasks, query({ showCompleted: false })).map(
        (task) => task.id,
      ),
    ).toEqual(["a"]);
    expect(
      filterAndSortTasks(tasks, query({ showCompleted: true })).map(
        (task) => task.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("completed 视图只含已完成任务（不受 showCompleted 影响）", () => {
    const tasks = [
      makeTask({ id: "a", status: "todo" }),
      makeTask({
        id: "b",
        status: "done",
        completedAt: "2026-09-02T00:00:00Z",
      }),
    ];
    const result = filterAndSortTasks(
      tasks,
      query({ scope: { kind: "view", view: "completed" } }),
    );
    expect(result.map((task) => task.id)).toEqual(["b"]);
  });

  it("deleted 视图只含已删除任务，且其他视图永不返回它们", () => {
    const deleted = makeTask({ id: "d", deletedAt: "2026-09-02T00:00:00Z" });
    const alive = makeTask({ id: "a" });
    expect(
      filterAndSortTasks(
        [deleted, alive],
        query({ scope: { kind: "view", view: "deleted" } }),
      ).map((task) => task.id),
    ).toEqual(["d"]);
    expect(
      filterAndSortTasks([deleted, alive], query()).map((task) => task.id),
    ).toEqual(["a"]);
  });

  it("list 作用域按 listId 匹配", () => {
    const tasks = [
      makeTask({ id: "a", listId: "list-work" }),
      makeTask({ id: "b", listId: "list-life" }),
    ];
    expect(
      filterAndSortTasks(
        tasks,
        query({ scope: { kind: "list", listId: "list-life" } }),
      ).map((task) => task.id),
    ).toEqual(["b"]);
  });

  it("important 视图只含 p2，planned 视图要求有计划或截止日期", () => {
    const tasks = [
      makeTask({ id: "a", priority: 2 }),
      makeTask({ id: "b", priority: 1 }),
      makeTask({ id: "c", scheduledDate: yesterdayKey() }),
      makeTask({ id: "d" }),
    ];
    expect(
      filterAndSortTasks(
        tasks,
        query({ scope: { kind: "view", view: "important" } }),
      ).map((task) => task.id),
    ).toEqual(["a"]);
    expect(
      filterAndSortTasks(
        tasks,
        query({ scope: { kind: "view", view: "planned" } }),
      ).map((task) => task.id),
    ).toEqual(["c"]); // 仅 scheduledDate 非空的任务；a/d 无日期不命中
  });

  it("overdue 视图只含已过期且未完成任务，no-date 视图只含无截止任务", () => {
    const tasks = [
      makeTask({ id: "a", dueAt: `${yesterdayKey()}T10:00:00Z` }),
      makeTask({ id: "b", dueAt: `${todayKey()}T10:00:00Z` }),
      makeTask({ id: "c" }),
    ];
    expect(
      filterAndSortTasks(
        tasks,
        query({ scope: { kind: "view", view: "overdue" } }),
      ).map((task) => task.id),
    ).toEqual(["a"]);
    expect(
      filterAndSortTasks(
        tasks,
        query({ scope: { kind: "view", view: "no-date" } }),
      ).map((task) => task.id),
    ).toEqual(["c"]);
  });
});

describe("filterAndSortTasks · 搜索指令", () => {
  it("文本命中分字段匹配且折叠 ASCII 大小写，不允许跨字段", () => {
    const tasks = [
      makeTask({ id: "a", title: "Review PR" }),
      makeTask({ id: "b", note: "contains REVIEW later" }),
      makeTask({ id: "c", title: "x", note: "re-view" }),
    ];
    expect(
      filterAndSortTasks(tasks, query({ query: "review" })).map(
        (task) => task.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("p: 只接受 0..=2，越界值降级为普通文本", () => {
    const tasks = [
      makeTask({ id: "a", priority: 2, title: "p:2" }),
      makeTask({ id: "b", priority: 1 }),
    ];
    expect(
      filterAndSortTasks(tasks, query({ query: "p:2" })).map((task) => task.id),
    ).toEqual(["a"]);
    // p:9 非法 → 变成文本搜索，匹配 title 含 "p:9" 的任务
    expect(
      filterAndSortTasks(tasks, query({ query: "p:9" })).map((task) => task.id),
    ).toEqual([]);
  });

  it("tag: 匹配标签且折叠大小写，允许前导 #", () => {
    const tasks = [
      makeTask({ id: "a", tags: ["DeepWork"] }),
      makeTask({ id: "b", tags: ["errand"] }),
    ];
    expect(
      filterAndSortTasks(tasks, query({ query: "tag:#deepwork" })).map(
        (task) => task.id,
      ),
    ).toEqual(["a"]);
  });

  it("due:none / due:today / due:overdue 语义", () => {
    const tasks = [
      makeTask({ id: "none", dueAt: null }),
      makeTask({ id: "today", dueAt: `${todayKey()}T10:00:00Z` }),
      makeTask({ id: "overdue", dueAt: `${yesterdayKey()}T10:00:00Z` }),
    ];
    const run = (q: string) =>
      filterAndSortTasks(tasks, query({ query: q })).map((task) => task.id);
    expect(run("due:none")).toEqual(["none"]);
    expect(run("due:今天")).toEqual(["today"]);
    expect(run("due:过期")).toEqual(["overdue"]);
  });
});

describe("filterAndSortTasks · 筛选面板", () => {
  it("组间取与：清单 + 优先级 + 标签同时过滤", () => {
    const tasks = [
      makeTask({ id: "hit", listId: "list-work", priority: 2, tags: ["x"] }),
      makeTask({
        id: "wrong-list",
        listId: "list-life",
        priority: 2,
        tags: ["x"],
      }),
      makeTask({
        id: "wrong-priority",
        listId: "list-work",
        priority: 0,
        tags: ["x"],
      }),
      makeTask({
        id: "wrong-tag",
        listId: "list-work",
        priority: 2,
        tags: ["y"],
      }),
    ];
    const result = filterAndSortTasks(
      tasks,
      query({
        filter: {
          listIds: ["list-work"],
          priorities: [2],
          tags: ["x"],
          includeCompleted: false,
        },
      }),
    );
    expect(result.map((task) => task.id)).toEqual(["hit"]);
  });
});

describe("filterAndSortTasks · 排序", () => {
  const tasks = [
    makeTask({
      id: "low-priority-late",
      priority: 0,
      dueAt: "2026-09-05T00:00:00Z",
      sortOrder: 2,
      createdAt: "2026-09-03T00:00:00Z",
    }),
    makeTask({
      id: "high-priority-early",
      priority: 2,
      dueAt: "2026-09-01T00:00:00Z",
      sortOrder: 0,
      createdAt: "2026-09-01T00:00:00Z",
    }),
    makeTask({
      id: "mid",
      priority: 1,
      dueAt: null,
      sortOrder: 1,
      createdAt: "2026-09-02T00:00:00Z",
    }),
  ];

  it("priority 排序：优先级高在前，同级按截止日期早在前", () => {
    expect(
      filterAndSortTasks(tasks, query({ sortBy: "priority" })).map(
        (task) => task.id,
      ),
    ).toEqual(["high-priority-early", "mid", "low-priority-late"]);
  });

  it("date 排序：无日期任务靠后，有日期按日期升序", () => {
    expect(
      filterAndSortTasks(tasks, query({ sortBy: "date" })).map(
        (task) => task.id,
      ),
    ).toEqual(["high-priority-early", "low-priority-late", "mid"]);
  });

  it("manual 排序按 sortOrder；sortAsc=false 时整体反转", () => {
    const byManual = filterAndSortTasks(tasks, query({ sortBy: "manual" })).map(
      (task) => task.id,
    );
    expect(byManual).toEqual([
      "high-priority-early",
      "mid",
      "low-priority-late",
    ]);
    expect(
      filterAndSortTasks(
        tasks,
        query({ sortBy: "manual", sortAsc: false }),
      ).map((task) => task.id),
    ).toEqual([...byManual].reverse());
  });

  it("结果为深拷贝，修改结果不影响原数组", () => {
    const source = [makeTask({ id: "a", tags: ["t"] })];
    const [copy] = filterAndSortTasks(source, query());
    copy.tags.push("mutated");
    copy.subtasks.push({
      id: "s1",
      title: "s",
      completed: false,
      createdAt: "2026-09-01T00:00:00Z",
      completedAt: null,
      sortOrder: 0,
    });
    expect(source[0].tags).toEqual(["t"]);
    expect(source[0].subtasks).toEqual([]);
  });
});

describe("日期辅助函数", () => {
  it("taskPlanDateKey 优先 scheduledDate，其次 dueAt 的本地日期", () => {
    expect(taskPlanDateKey(makeTask({ scheduledDate: "2026-09-01" }))).toBe(
      "2026-09-01",
    );
    // 用本地构造再转 ISO，保证任何时区下本地日期都是 2026-09-03
    const dueAt = new Date(2026, 8, 3, 1, 0).toISOString();
    expect(taskPlanDateKey(makeTask({ scheduledDate: null, dueAt }))).toBe(
      "2026-09-03",
    );
    expect(taskPlanDateKey(makeTask())).toBeNull();
  });

  it("shiftDateKey 处理跨月与月末", () => {
    expect(shiftDateKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("localDateKey 补零", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
