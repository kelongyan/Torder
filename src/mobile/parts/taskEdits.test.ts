/**
 * taskEdits.test.ts — 移动任务编辑纯函数（M-E）
 * 覆盖：提醒描述 / 日期本地换算往返 / 截止标签 / 全量 UpdateTaskInput 构造。
 */
import { describe, expect, it } from "vitest";
import type { Task } from "../../types/database";
import {
  buildUpdateTaskInput,
  describeReminder,
  formatDueLabel,
  formatDateKey,
  isoToLocalInput,
  localInputToIso,
  REMINDER_OPTIONS,
} from "./taskEdits";

describe("describeReminder / REMINDER_OPTIONS", () => {
  it("预设有 7 档（不提醒…提前 1 周）", () => {
    expect(REMINDER_OPTIONS).toHaveLength(7);
    expect(REMINDER_OPTIONS[0]).toEqual({ value: -1, label: "不提醒" });
    expect(REMINDER_OPTIONS[6]).toEqual({ value: 10080, label: "提前 1 周" });
  });
  it("null / -1 均显示不提醒；未知值回退文本", () => {
    expect(describeReminder(null)).toBe("不提醒");
    expect(describeReminder(-1)).toBe("不提醒");
    expect(describeReminder(30)).toBe("提前 30 分钟");
  });
});

describe("日期换算", () => {
  it("秒与毫秒为 0 的 ISO 经本地换算后往返不变（时区无关）", () => {
    const iso = "2026-09-05T08:30:00.000Z";
    const local = isoToLocalInput(iso);
    expect(localInputToIso(local)).toBe(iso);
  });
  it("toLocalInput 输出 shape 为 YYYY-MM-DDTHH:MM", () => {
    expect(isoToLocalInput("2026-09-05T08:30:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });
});

describe("formatDateKey / formatDueLabel", () => {
  it("formatDateKey 转成 M月D日", () => {
    expect(formatDateKey("2026-09-05")).toBe("9月5日");
  });
  it("formatDueLabel：历史时间标记已逾期", () => {
    const label = formatDueLabel("2000-01-01T00:00:00.000Z");
    expect(label).toEqual({ text: "已逾期", danger: true });
  });
  it("formatDueLabel：未来时间输出 MM-DD HH:mm 非危险", () => {
    const label = formatDueLabel("2099-12-31T12:00:00.000Z");
    expect(label.danger).toBe(false);
    expect(label.text).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("buildUpdateTaskInput", () => {
  const base = {
    id: "t1",
    title: "原标题",
    note: "备注",
    status: "todo",
    priority: 1,
    listId: "list-work",
    scheduledDate: "2026-09-05",
    dueAt: "2026-09-05T08:30:00.000Z",
    sortOrder: 0,
    remindBefore: 60,
    repeatRule: null,
    subtasks: [],
    tags: ["a"],
  } as unknown as Task;

  it("未覆盖字段原样保留、覆盖字段生效", () => {
    const out = buildUpdateTaskInput(base, { priority: 2, remindBefore: null });
    expect(out.id).toBe("t1");
    expect(out.title).toBe("原标题");
    expect(out.priority).toBe(2);
    expect(out.remindBefore).toBeNull();
    expect(out.subtasks).toEqual([]);
  });
  it("clearable 字段可显式置 null/空串", () => {
    const out = buildUpdateTaskInput(base, {
      dueAt: null,
      scheduledDate: null,
    });
    expect(out.dueAt).toBeNull();
    expect(out.scheduledDate).toBeNull();
  });
});
