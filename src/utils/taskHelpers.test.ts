import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseQuickAddText } from "./taskHelpers";
import type { TaskList } from "../types/database";

/**
 * 快速添加解析器纯函数测试。
 * 「到周X」截止词是跨天任务的创建入口（便签区间逐日可见，见
 * docx/widget-spanning-task-2026-09-08.md），这里锁定它的解析与占位规则，
 * 并回归普通日期词（今天/明天/周X）不被波及。
 * 用假时钟固定到 2026-09-08（周二）10:00，断言与时区/运行时刻无关。
 */

const lists: TaskList[] = [
  {
    id: "work",
    name: "工作",
    color: "#bd93f9",
    sortOrder: 0,
    isDefault: true,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
  },
];

/** 固定「现在」：2026-09-08 周二 10:00 本地时间。 */
function freezeNow() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, 10, 0, 0, 0));
}

beforeEach(freezeNow);
afterEach(() => vi.useRealTimers());

describe("parseQuickAddText · 到X 截止词", () => {
  it("到周五：截止日默认 9:00，吞掉 token 且置截止标记", () => {
    const parsed = parseQuickAddText("到周五 交周报", lists);
    expect(parsed.title).toBe("交周报");
    expect(parsed.dueIsDeadline).toBe(true);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 11, 9, 0).toISOString());
  });

  it("到下周一 18:00：带时刻的截止 + 其余 token 照常解析", () => {
    const parsed = parseQuickAddText("到下周一 18:00 写报告 #工作 !高", lists);
    expect(parsed.title).toBe("写报告");
    expect(parsed.dueIsDeadline).toBe(true);
    expect(parsed.listId).toBe("work");
    expect(parsed.priority).toBe(2);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 14, 18, 0).toISOString());
  });

  it("到今天：当天 9:00 已过顺延为 23:59（与普通日期词同一时刻规则）", () => {
    const parsed = parseQuickAddText("到今天 收尾", lists);
    expect(parsed.dueIsDeadline).toBe(true);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 8, 23, 59).toISOString());
  });

  it("到明天：跨到明天 9:00", () => {
    const parsed = parseQuickAddText("到明天 提交", lists);
    expect(parsed.dueIsDeadline).toBe(true);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 9, 9, 0).toISOString());
  });

  it("两个截止词：先出现者生效，后者吞掉不进标题", () => {
    const parsed = parseQuickAddText("到周五 到周日 双截止占位", lists);
    expect(parsed.title).toBe("双截止占位");
    expect(parsed.dueIsDeadline).toBe(true);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 11, 9, 0).toISOString());
  });

  it("普通日期词在前时截止词让位，标记保持 false", () => {
    const parsed = parseQuickAddText("周五 到周日 团建", lists);
    expect(parsed.title).toBe("团建");
    expect(parsed.dueIsDeadline).toBe(false);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 11, 9, 0).toISOString());
  });

  it("不完整的「到」用法不识别，保留在标题", () => {
    const parsed = parseQuickAddText("到期汇报整理", lists);
    expect(parsed.title).toBe("到期汇报整理");
    expect(parsed.dueIsDeadline).toBe(false);
    expect(parsed.dueAt).toBeNull();
  });
});

describe("parseQuickAddText · 普通日期词回归", () => {
  it("今天 15:00：只设截止，不置截止标记", () => {
    const parsed = parseQuickAddText("今天 15:00 开会", lists);
    expect(parsed.title).toBe("开会");
    expect(parsed.dueIsDeadline).toBe(false);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 8, 15, 0).toISOString());
  });

  it("周五：flag 恒为 false", () => {
    const parsed = parseQuickAddText("周五 团建", lists);
    expect(parsed.dueIsDeadline).toBe(false);
    expect(parsed.dueAt).toBe(new Date(2026, 8, 11, 9, 0).toISOString());
  });
});
