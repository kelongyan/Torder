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

describe("逾期自动顺延 · 跨日与日期边界（真机需改系统时间，由测试锁定）", () => {
  it("仅截止（无计划日）：顺延后 dueAt 平移到明天，次日不再逾期 → 幂等", () => {
    const task = makeTask({ dueAt: at(2026, 9, 1, 18) });
    const first = overdueShiftPatches([task], "2026-09-03");
    expect(first).toHaveLength(1);
    const shifted: Task = { ...task, dueAt: first[0].patch.dueAt as string };
    // 次日（09-04）再跑：dueAt 就在当天，不算逾期
    expect(overdueShiftPatches([shifted], "2026-09-04")).toEqual([]);
    expect(overdueShiftPatches([shifted], "2026-09-04")).toEqual([]);
  });

  it("有计划日：顺延只改计划日、dueAt 不改写 → 次日仍判逾期，逐日顺延（现状快照）", () => {
    // 现状语义：overdueTodos 只看 dueAt 判定逾期，而 shiftOverdueTaskPatch
    // 优先改写 scheduledDate；两者不同步，故有计划日的逾期任务会每天 +1 天，
    // 且因 dueAt 永不变而始终处于逾期态。此用例锁定该现状，语义若调整须同步改。
    const task = makeTask({
      scheduledDate: "2026-09-01",
      dueAt: at(2026, 9, 1, 18),
    });
    const day1 = overdueShiftPatches([task], "2026-09-03");
    expect(day1[0].patch.scheduledDate).toBe("2026-09-04");

    const afterDay1: Task = { ...task, ...(day1[0].patch as Partial<Task>) };
    const day2 = overdueShiftPatches([afterDay1], "2026-09-04");
    expect(day2).toHaveLength(1);
    expect(day2[0].patch.scheduledDate).toBe("2026-09-05");

    const afterDay2: Task = {
      ...afterDay1,
      ...(day2[0].patch as Partial<Task>),
    };
    expect(
      overdueShiftPatches([afterDay2], "2026-09-05")[0].patch.scheduledDate,
    ).toBe("2026-09-06");
  });

  it("顺延目标日期进位：月末 / 跨年 / 闰年 / 平年", () => {
    const monthEnd = makeTask({
      scheduledDate: "2026-01-29",
      dueAt: at(2026, 1, 29),
    });
    expect(
      overdueShiftPatches([monthEnd], "2026-01-31")[0].patch.scheduledDate,
    ).toBe("2026-02-01");

    const yearEnd = makeTask({
      scheduledDate: "2026-12-29",
      dueAt: at(2026, 12, 29),
    });
    expect(
      overdueShiftPatches([yearEnd], "2026-12-31")[0].patch.scheduledDate,
    ).toBe("2027-01-01");

    const leapYear = makeTask({
      scheduledDate: "2028-02-26",
      dueAt: at(2028, 2, 26),
    });
    expect(
      overdueShiftPatches([leapYear], "2028-02-28")[0].patch.scheduledDate,
    ).toBe("2028-02-29");

    const commonYear = makeTask({
      scheduledDate: "2026-02-26",
      dueAt: at(2026, 2, 26),
    });
    expect(
      overdueShiftPatches([commonYear], "2026-02-28")[0].patch.scheduledDate,
    ).toBe("2026-03-01");
  });

  it("跨日边界：昨天 23 点算逾期，今天 0 点不算（按本地日期键比较）", () => {
    const lastNight = makeTask({ dueAt: at(2026, 9, 2, 23) });
    const thisMorning = makeTask({ dueAt: at(2026, 9, 3, 0) });
    const patches = overdueShiftPatches([lastNight, thisMorning], "2026-09-03");
    expect(patches).toHaveLength(1);
    expect(patches[0].taskId).toBe(lastNight.id);
  });

  it("顺延保留原截止时刻（只换日期、不改成正午）", () => {
    const task = makeTask({ dueAt: at(2026, 9, 1, 18) });
    const patch = overdueShiftPatches([task], "2026-09-03")[0];
    const shifted = new Date(patch.patch.dueAt as string);
    expect(shifted.getHours()).toBe(18);
    expect(shifted.getMinutes()).toBe(0);
  });
});
