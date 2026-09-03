import { describe, expect, it } from "vitest";
import type { Task } from "../types/database";
import {
  completedToday,
  createdTodayCount,
  dueTodayTodos,
  listProgress,
  overdueShiftPatches,
  overdueTodos,
  shiftOverdueTaskPatch,
  weekTrend,
} from "./taskStats";

/** 本地某日某时的 ISO 时间戳（避免时区脆弱：任何时区本地日期=给定 y/m/d）。 */
function at(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

const TODAY = "2026-09-03";
const TOMORROW = "2026-09-04";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    title: "任务",
    note: null,
    status: "todo",
    priority: 0,
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
    createdAt: at(2026, 9, 1),
    updatedAt: at(2026, 9, 1),
    deletedAt: null,
    ...overrides,
  };
}

describe("weekTrend 近 7 日趋势", () => {
  it("按 completedAt / createdAt 本地日分桶，含今日共 7 日从旧到新", () => {
    const tasks = [
      makeTask({ status: "done", completedAt: at(2026, 9, 3) }),
      makeTask({ status: "done", completedAt: at(2026, 9, 2) }),
      makeTask({ status: "done", completedAt: at(2026, 9, 2) }),
      makeTask({ status: "done", completedAt: at(2026, 8, 20) }), // 窗口外不计
      makeTask({ createdAt: at(2026, 9, 3) }),
      makeTask({ createdAt: at(2026, 9, 1) }),
    ];
    const trend = weekTrend(tasks, TODAY);
    expect(trend).toHaveLength(7);
    expect(trend[6]).toMatchObject({
      key: TODAY,
      label: "今天",
      completed: 1,
      created: 1,
    });
    expect(trend[5]).toMatchObject({ completed: 2, created: 0 });
    expect(trend[0].key).toBe("2026-08-28");
    const createdSum = trend.reduce((sum, day) => sum + day.created, 0);
    expect(createdSum).toBe(6);
  });
});

describe("completedToday / createdTodayCount / dueTodayTodos / overdueTodos", () => {
  const tasks = [
    makeTask({ status: "done", completedAt: at(2026, 9, 3, 9) }),
    makeTask({ status: "done", completedAt: at(2026, 9, 2) }),
    makeTask({ createdAt: at(2026, 9, 3) }),
    makeTask({ createdAt: at(2026, 9, 1) }),
    makeTask({ dueAt: at(2026, 9, 3, 18) }),
    makeTask({ dueAt: at(2026, 9, 2, 18) }),
    makeTask({
      status: "done",
      dueAt: at(2026, 9, 2),
      completedAt: at(2026, 9, 3),
    }),
    makeTask({ dueAt: at(2026, 9, 4, 18) }),
    makeTask({ dueAt: null }),
  ];

  it("今日完成只看 completedAt 落在今天（含今日完成的逾期任务）", () => {
    const done = completedToday(tasks, TODAY);
    expect(done).toHaveLength(2);
    expect(done.every((task) => task.status === "done")).toBe(true);
  });

  it("今日新增按 createdAt 计数", () => {
    expect(createdTodayCount(tasks, TODAY)).toBe(1);
  });

  it("今日到期待办（todo + dueAt 今天）", () => {
    const due = dueTodayTodos(tasks, TODAY);
    expect(due.map((task) => task.title)).toEqual(["任务"]);
    expect(due).toHaveLength(1);
  });

  it("逾期 = todo 且 dueAt 本地日期早于今天", () => {
    const overdue = overdueTodos(tasks, TODAY);
    expect(overdue).toHaveLength(1);
  });
});

describe("shiftOverdueTaskPatch 顺延唯一规则", () => {
  it("有计划日 → 计划日顺延到明天", () => {
    const task = makeTask({
      status: "todo",
      scheduledDate: "2026-09-02",
      dueAt: at(2026, 9, 2, 18),
    });
    expect(shiftOverdueTaskPatch(task, TOMORROW)).toEqual({
      scheduledDate: TOMORROW,
    });
  });

  it("只有截止 → 截止整体平移一天且保留时刻", () => {
    const task = makeTask({
      status: "todo",
      dueAt: at(2026, 9, 2, 18),
    });
    const patch = shiftOverdueTaskPatch(task, TOMORROW);
    expect(patch).not.toBeNull();
    expect(new Date(patch!.dueAt as string).getHours()).toBe(18);
    expect(new Date(patch!.dueAt as string).toISOString()).not.toBeNull();
    // 平移后本地日期应为 2026-09-04
    const key = new Date(patch!.dueAt as string).toISOString();
    expect(new Date(key).getDate()).toBe(4);
  });

  it("已完成/无截止/已在明天 → 不产生 patch", () => {
    expect(
      shiftOverdueTaskPatch(
        makeTask({ status: "done", dueAt: at(2026, 9, 2) }),
        TOMORROW,
      ),
    ).toBeNull();
    expect(
      shiftOverdueTaskPatch(
        makeTask({ status: "todo", dueAt: null }),
        TOMORROW,
      ),
    ).toBeNull();
    expect(
      shiftOverdueTaskPatch(
        makeTask({ scheduledDate: TOMORROW, dueAt: at(2026, 9, 4) }),
        TOMORROW,
      ),
    ).toBeNull();
  });
});

describe("overdueShiftPatches 逾期自动顺延批量汇总（T-10 乙组 D-5）", () => {
  it("只汇总可顺延的逾期任务，逐条走 shiftOverdueTaskPatch 唯一规则", () => {
    const tasks = [
      // 逾期 + 计划日 → 计划日 patch
      makeTask({
        title: "逾期有计划",
        scheduledDate: "2026-09-01",
        dueAt: at(2026, 9, 1, 18),
      }),
      // 逾期 + 仅截止 → 截止平移 patch（保留 18 点时刻）
      makeTask({ title: "逾期仅截止", dueAt: at(2026, 9, 2, 18) }),
      // 已完成 → 跳过
      makeTask({
        title: "已完成",
        status: "done",
        dueAt: at(2026, 9, 1),
        completedAt: at(2026, 9, 2),
      }),
      // 今日到期（未逾期）→ 跳过
      makeTask({ title: "今日到期", dueAt: at(2026, 9, 3, 18) }),
      // 计划日已是明天 → 无 patch，跳过
      makeTask({
        title: "已在明天",
        scheduledDate: TOMORROW,
        dueAt: at(2026, 9, 4, 9),
      }),
    ];
    const patches = overdueShiftPatches(tasks, TODAY);
    expect(patches).toHaveLength(2);
    expect(patches[0]).toEqual({
      taskId: tasks[0].id,
      patch: { scheduledDate: TOMORROW },
    });
    expect(patches[1].taskId).toBe(tasks[1].id);
    expect(new Date(patches[1].patch.dueAt as string).getHours()).toBe(18);
  });

  it("无逾期 → 空 patch 列表", () => {
    const tasks = [
      makeTask({ dueAt: at(2026, 9, 3, 18) }),
      makeTask({ status: "done", dueAt: at(2026, 9, 1) }),
    ];
    expect(overdueShiftPatches(tasks, TODAY)).toEqual([]);
    expect(overdueShiftPatches([], TODAY)).toEqual([]);
  });
});

describe("listProgress 清单进度口径", () => {
  it("混状态任务计数与比例正确", () => {
    const tasks = [
      makeTask({ status: "done" }),
      makeTask({ status: "done" }),
      makeTask({ status: "todo" }),
      makeTask({ status: "todo" }),
    ];
    expect(listProgress(tasks)).toEqual({
      total: 4,
      done: 2,
      todo: 2,
      ratio: 0.5,
    });
  });

  it("空清单 → 0/0/0", () => {
    expect(listProgress([])).toEqual({ total: 0, done: 0, todo: 0, ratio: 0 });
  });

  it("全部完成 → ratio 1", () => {
    expect(listProgress([makeTask({ status: "done" })])).toEqual({
      total: 1,
      done: 1,
      todo: 0,
      ratio: 1,
    });
  });
});
