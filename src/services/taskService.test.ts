import { afterEach, describe, expect, it } from "vitest";
import {
  addBrowserTask,
  removeBrowserTaskIncludingDeleted,
} from "./browserTaskMock";
import { queryTasksForDate } from "./taskService";
import { localDateKey, shiftDateKey } from "./taskQuery";
import type { Task } from "../types/database";

/**
 * 便签按日查询（浏览器 mock 分支）与 Rust `query_for_widget` 的同口径验证：
 * 精确单日命中 + 「计划日期 + 截止日期」齐全的未完成任务按区间逐日命中
 * （跨天任务），完成后区间内不再命中。种子预览任务落在今天 -3 ~ +9 天，
 * 测试锚点取今天 +10 ~ +16 天避开。
 */

/** 测试锚点：避开种子任务日期窗口的起点（今天 +10 天）。 */
const START = shiftDateKey(localDateKey(new Date()), 10);
const MIDDLE = shiftDateKey(START, 2);
const END = shiftDateKey(START, 6);
const AFTER_END = shiftDateKey(END, 1);

/** 本地某天正午的 ISO 串：localDateKey(dueAt) 在任何时区都还原同一天。 */
function localNoonIso(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

const createdIds: string[] = [];

function addTestTask(overrides: Partial<Task>): Task {
  const timestamp = new Date().toISOString();
  const task: Task = {
    id: `widget-span-test-${createdIds.length}`,
    title: "跨天任务测试",
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
  createdIds.push(task.id);
  addBrowserTask(task);
  return task;
}

afterEach(() => {
  while (createdIds.length > 0) {
    removeBrowserTaskIncludingDeleted(createdIds.pop()!);
  }
});

describe("queryTasksForDate · 跨天任务区间命中", () => {
  it("计划日期+截止日期齐全的未完成任务在区间内每天都命中", async () => {
    addTestTask({ scheduledDate: START, dueAt: localNoonIso(END) });

    const startDay = await queryTasksForDate(START);
    const middleDay = await queryTasksForDate(MIDDLE);
    const endDay = await queryTasksForDate(END);
    expect(startDay.map((task) => task.title)).toContain("跨天任务测试");
    expect(middleDay.map((task) => task.title)).toEqual(["跨天任务测试"]);
    expect(endDay.map((task) => task.title)).toContain("跨天任务测试");

    // 区间之外（起点前一天 / 截止后一天）不命中
    const beforeStart = await queryTasksForDate(shiftDateKey(START, -1));
    const afterEnd = await queryTasksForDate(AFTER_END);
    expect(beforeStart).not.toContainEqual(
      expect.objectContaining({ title: "跨天任务测试" }),
    );
    expect(afterEnd.map((task) => task.title)).not.toContain("跨天任务测试");
  });

  it("只填单字段的任务退化为精确单日命中（旧行为回归）", async () => {
    addTestTask({ id: "scheduled-only", scheduledDate: START, dueAt: null });
    addTestTask({
      id: "due-only",
      scheduledDate: null,
      dueAt: localNoonIso(END),
    });

    const startDay = await queryTasksForDate(START);
    expect(startDay.map((task) => task.id)).toContain("scheduled-only");
    expect(startDay.map((task) => task.id)).not.toContain("due-only");

    const middleDay = await queryTasksForDate(MIDDLE);
    expect(middleDay).toHaveLength(0);

    const endDay = await queryTasksForDate(END);
    expect(endDay.map((task) => task.id)).toContain("due-only");
    expect(endDay.map((task) => task.id)).not.toContain("scheduled-only");
  });

  it("完成后区间内不再命中，计划日仅以已完成身份显示", async () => {
    addTestTask({
      scheduledDate: START,
      dueAt: localNoonIso(END),
      status: "done",
      completedAt: new Date().toISOString(),
    });

    // 中间日：完成后从区间消失
    const middleDay = await queryTasksForDate(MIDDLE);
    expect(middleDay).toHaveLength(0);

    // 计划日：includeCompleted（默认 true）仍显示；false 时不显示
    const startDayDefault = await queryTasksForDate(START);
    expect(startDayDefault.map((task) => task.title)).toContain("跨天任务测试");
    const startDayPending = await queryTasksForDate(START, false);
    expect(startDayPending).toHaveLength(0);
  });
});
