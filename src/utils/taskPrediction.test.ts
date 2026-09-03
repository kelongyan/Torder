import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cloneSubtasks,
  computeRemindAt,
  normalizeTags,
  predictCompletedTask,
  predictCreatedTask,
  predictDeletedTask,
  predictRestoredTask,
  predictSnoozedTask,
  predictUpdatedTask,
} from "./taskPrediction";
import type {
  CreateTaskInput,
  Task,
  TaskSubtask,
  UpdateTaskInput,
} from "../types/database";

beforeAll(() => {
  // Vitest 4 的 useFakeTimers 接收配置对象；裸 Date 会被忽略导致用真实时间
  vi.useFakeTimers({ now: new Date("2026-09-03T12:00:00Z") });
});

afterAll(() => {
  vi.useRealTimers();
});

function subtask(overrides: Partial<TaskSubtask> = {}): TaskSubtask {
  return {
    id: "sub-1",
    title: "子任务",
    completed: false,
    createdAt: "2026-09-01T00:00:00Z",
    completedAt: null,
    sortOrder: 0,
    ...overrides,
  };
}

const createInput: CreateTaskInput = {
  title: "  新任务  ",
  note: "  备注  ",
  priority: 2,
  listId: "list-a",
  scheduledDate: "2026-09-04",
  dueAt: "2026-09-04T10:00:00Z",
  sortOrder: 3,
  remindBefore: 30,
  repeatRule: null,
  subtasks: [subtask({ title: "  子任务 " })],
  tags: ["#工作", "工作", "  会议  ", "", "x".repeat(41)],
};

describe("computeRemindAt", () => {
  it("按提前分钟计算且早于当前时间的提醒为 null", () => {
    // due 2026-09-04T10:00Z，当前 2026-09-03T12:00Z，提前 30 分钟 → 有效
    const remindAt = computeRemindAt("2026-09-04T10:00:00Z", 30);
    expect(remindAt).toBe("2026-09-04T09:30:00Z");
    // 提醒时间已过 → null
    expect(computeRemindAt("2026-09-03T12:10:00Z", 30)).toBeNull();
  });

  it("缺截止时间/缺提前量返回 null；remindBefore<=0 提醒即截止时间", () => {
    expect(computeRemindAt(null, 30)).toBeNull();
    expect(computeRemindAt("2026-09-04T10:00:00Z", null)).toBeNull();
    expect(computeRemindAt("2026-09-04T10:00:00Z", 0)).toBe(
      "2026-09-04T10:00:00Z",
    );
  });

  it("非法日期字符串返回 null", () => {
    expect(computeRemindAt("not-a-date", 30)).toBeNull();
  });
});

describe("normalizeTags", () => {
  it("去 # 与空白、去重（中文 locale 不区分大小写）、丢弃空与超长，上限 30", () => {
    expect(
      normalizeTags(["#工作", "工作", "  会议  ", "", "x".repeat(41)]),
    ).toEqual(["工作", "会议"]);
    const thirty = Array.from({ length: 35 }, (_, i) => `t${i}`);
    expect(normalizeTags(thirty)).toHaveLength(30);
  });
});

describe("cloneSubtasks", () => {
  it("重排 sortOrder、补 id、裁剪标题，且为新对象", () => {
    const source = [
      subtask({ sortOrder: 5 }),
      subtask({ id: "", sortOrder: 9 }),
    ];
    const result = cloneSubtasks(source);
    expect(result.map((item) => item.sortOrder)).toEqual([0, 1]);
    expect(result[1].id).not.toBe("");
    expect(result[0].title).toBe("子任务");
    expect(result[0]).not.toBe(source[0]);
  });
});

describe("predictCreatedTask", () => {
  it("裁剪字段、生成默认值并计算 remindAt", () => {
    const task = predictCreatedTask(createInput, "temp-1");
    expect(task.id).toBe("temp-1");
    expect(task.title).toBe("新任务");
    expect(task.note).toBe("备注");
    expect(task.priority).toBe(2);
    expect(task.listId).toBe("list-a");
    expect(task.status).toBe("todo");
    expect(task.remindAt).toBe("2026-09-04T09:30:00Z");
    expect(task.tags).toEqual(["工作", "会议"]);
    expect(task.createdAt).toBe(task.updatedAt);
  });

  it("缺省字段落到默认值", () => {
    const task = predictCreatedTask({ title: "t" }, "temp-2");
    expect(task.priority).toBe(1);
    expect(task.listId).toBe("work");
    expect(task.dueAt).toBeNull();
    expect(task.remindAt).toBeNull();
  });
});

describe("predictUpdatedTask", () => {
  const existing: Task = {
    ...predictCreatedTask(createInput, "task-1"),
    id: "task-1",
    remindedAt: "2026-09-04T09:30:00Z",
  };
  const updateInput: UpdateTaskInput = {
    id: "task-1",
    title: "改标题",
    note: null,
    status: "todo",
    priority: 0,
    listId: "list-b",
    scheduledDate: null,
    dueAt: "2026-09-05T10:00:00Z",
    sortOrder: 0,
    remindBefore: 15,
    repeatRule: null,
    subtasks: [],
    tags: ["新"],
  };

  it("更新字段并重算提醒；提醒计划变化时清除已提醒标记", () => {
    const task = predictUpdatedTask(existing, updateInput);
    expect(task.title).toBe("改标题");
    expect(task.remindAt).toBe("2026-09-05T09:45:00Z");
    expect(task.remindedAt).toBeNull();
  });

  it("提醒计划未变化时保留已提醒标记", () => {
    const task = predictUpdatedTask(existing, {
      ...updateInput,
      dueAt: existing.dueAt,
      remindBefore: existing.remindBefore,
    });
    expect(task.remindedAt).toBe(existing.remindedAt);
  });

  it("status=done 时补 completedAt；todo 时清空", () => {
    expect(
      predictUpdatedTask(existing, { ...updateInput, status: "done" })
        .completedAt,
    ).toBe("2026-09-03T12:00:00.000Z");
    expect(predictUpdatedTask(existing, updateInput).completedAt).toBeNull();
  });
});

describe("状态机预测", () => {
  const task = predictCreatedTask(createInput, "task-1");

  it("完成/恢复补写与清空 completedAt", () => {
    const done = predictCompletedTask(task, true);
    expect(done.status).toBe("done");
    expect(done.completedAt).toBe("2026-09-03T12:00:00.000Z");
    const undone = predictCompletedTask(done, false);
    expect(undone.status).toBe("todo");
    expect(undone.completedAt).toBeNull();
  });

  it("软删除与恢复互为镜像", () => {
    const deleted = predictDeletedTask(task, "2026-09-03T13:00:00Z");
    expect(deleted.deletedAt).toBe("2026-09-03T13:00:00Z");
    expect(predictRestoredTask(deleted, "2026-09-03T14:00:00Z").deletedAt).toBe(
      null,
    );
  });

  it("贪睡更新 remindAt 并清除已提醒标记", () => {
    const snoozed = predictSnoozedTask(task, "2026-09-04T08:00:00Z");
    expect(snoozed.remindAt).toBe("2026-09-04T08:00:00Z");
    expect(snoozed.remindedAt).toBeNull();
  });
});
