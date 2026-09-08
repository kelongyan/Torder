import { describe, expect, it } from "vitest";
import { widgetSpanBadge } from "./widgetService";
import type { Task } from "../types/database";

/**
 * 便签条目跨天截止标识（「至 MM-DD」）纯函数测试。
 * 判定与 Rust `query_for_widget` 的区间子句同源：计划日期与截止日期
 * 齐全且不同天才算跨天。dueAt 用 12:00Z 构造，任何常规时区下本地日期
 * 都还原同一天。
 */

function task(overrides: Partial<Task>): Task {
  const timestamp = "2026-09-08T02:00:00.000Z";
  return {
    id: "span-badge-test",
    title: "跨天任务",
    note: null,
    status: "todo",
    priority: 1,
    listId: "work",
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
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

describe("widgetSpanBadge", () => {
  it("跨天任务返回「至 MM-DD」", () => {
    expect(
      widgetSpanBadge(
        task({ scheduledDate: "2026-09-08", dueAt: "2026-09-15T12:00:00Z" }),
      ),
    ).toBe("至 09-15");
  });

  it("已完成任务照常显示标识", () => {
    expect(
      widgetSpanBadge(
        task({
          status: "done",
          completedAt: "2026-09-09T01:00:00Z",
          scheduledDate: "2026-09-08",
          dueAt: "2026-09-15T12:00:00Z",
        }),
      ),
    ).toBe("至 09-15");
  });

  it("计划日期与截止日期同天：非跨天，返回 null", () => {
    expect(
      widgetSpanBadge(
        task({ scheduledDate: "2026-09-15", dueAt: "2026-09-15T12:00:00Z" }),
      ),
    ).toBeNull();
  });

  it("只填单字段：返回 null", () => {
    expect(widgetSpanBadge(task({ scheduledDate: "2026-09-08" }))).toBeNull();
    expect(widgetSpanBadge(task({ dueAt: "2026-09-15T12:00:00Z" }))).toBeNull();
  });

  it("dueAt 无法解析：返回 null", () => {
    expect(
      widgetSpanBadge(task({ scheduledDate: "2026-09-08", dueAt: "不合法" })),
    ).toBeNull();
  });
});
