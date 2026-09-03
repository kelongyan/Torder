import { describe, expect, it } from "vitest";
import {
  groupTasksByList,
  searchAllTasks,
  getMatchingSnippet,
} from "./searchUtils";
import type { Task, TaskList } from "../../types/database";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    title: "测试事项",
    note: null,
    priority: 1,
    listId: "work",
    status: "todo",
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
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

const mockLists: TaskList[] = [
  {
    id: "work",
    name: "工作",
    color: "#6e9bff",
    isDefault: true,
    sortOrder: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
  },
  {
    id: "personal",
    name: "生活",
    color: "#43c48d",
    isDefault: false,
    sortOrder: 1,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
  },
  {
    id: "study",
    name: "学习",
    color: "#a98af5",
    isDefault: false,
    sortOrder: 2,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
  },
];

describe("searchUtils", () => {
  describe("groupTasksByList", () => {
    it("按 lists 顺序正确分组并计算完成计数", () => {
      const tasks = [
        makeTask({ id: "t1", listId: "personal", status: "todo" }),
        makeTask({ id: "t2", listId: "work", status: "todo" }),
        makeTask({ id: "t3", listId: "work", status: "done" }),
        makeTask({ id: "t4", listId: "personal", status: "done" }),
      ];

      const groups = groupTasksByList(tasks, mockLists);
      expect(groups).toHaveLength(2);

      // 顺序保持 work 然后 personal（study 没有任务被排除）
      expect(groups[0].listId).toBe("work");
      expect(groups[0].listName).toBe("工作");
      expect(groups[0].activeCount).toBe(1);
      expect(groups[0].completedCount).toBe(1);
      expect(groups[0].tasks).toHaveLength(2);

      expect(groups[1].listId).toBe("personal");
      expect(groups[1].listName).toBe("生活");
      expect(groups[1].activeCount).toBe(1);
      expect(groups[1].completedCount).toBe(1);
    });

    it("孤立/未在 lists 中的清单排在最后并回退标签", () => {
      const tasks = [
        makeTask({ id: "t1", listId: "other-list", status: "todo" }),
        makeTask({ id: "t2", listId: "inbox", status: "todo" }),
        makeTask({ id: "t3", listId: "work", status: "todo" }),
      ];

      const groups = groupTasksByList(tasks, mockLists);
      expect(groups).toHaveLength(3);
      expect(groups[0].listId).toBe("work");

      const other = groups.find((g) => g.listId === "other-list");
      expect(other).toBeDefined();
      expect(other?.listName).toBe("other-list");

      const inbox = groups.find((g) => g.listId === "inbox");
      expect(inbox).toBeDefined();
      expect(inbox?.listName).toBe("默认清单");
    });

    it("空任务列表返回空数组", () => {
      expect(groupTasksByList([], mockLists)).toEqual([]);
    });
  });

  describe("searchAllTasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "完成周报", note: "周五前发给团队" }),
      makeTask({
        id: "t2",
        title: "修 CI 流水线",
        note: "检查 GitHub Actions",
      }),
      makeTask({ id: "t3", title: "阅读论文", status: "done" }),
    ];

    it("空查询词时返回空数组", () => {
      expect(searchAllTasks(tasks, "")).toEqual([]);
      expect(searchAllTasks(tasks, "   ")).toEqual([]);
    });

    it("支持匹配标题和 note", () => {
      const r1 = searchAllTasks(tasks, "周报");
      expect(r1.map((t) => t.id)).toEqual(["t1"]);

      const r2 = searchAllTasks(tasks, "GitHub");
      expect(r2.map((t) => t.id)).toEqual(["t2"]);
    });

    it("不包含已完成任务时的过滤", () => {
      const results = searchAllTasks(tasks, "论文", undefined, false);
      expect(results).toHaveLength(0);

      const withDone = searchAllTasks(tasks, "论文", undefined, true);
      expect(withDone).toHaveLength(1);
    });
  });

  describe("getMatchingSnippet", () => {
    it("空值或不匹配时返回 null", () => {
      expect(getMatchingSnippet(null, "周报")).toBeNull();
      expect(getMatchingSnippet("今天是个好天气", "周报")).toBeNull();
      expect(getMatchingSnippet("今天是个好天气", "")).toBeNull();
    });

    it("匹配开头时提取不带前置省略号", () => {
      const text = "周报写在文档库的第二章节。";
      const snippet = getMatchingSnippet(text, "周报", 20);
      expect(snippet).toBe("周报写在文档库的第二章节。");
      expect(snippet?.startsWith("…")).toBe(false);
    });

    it("匹配在中间长文本时提取包含前后省略号的片段", () => {
      const text =
        "由于前面有很多内容很多内容很多内容很多内容周报需要在本周五下午五点前完成并提交审核还有很多后续内容很多很多很多很多";
      const snippet = getMatchingSnippet(text, "周报", 25);
      expect(snippet).toBeDefined();
      expect(snippet).toContain("周报");
      expect(snippet?.startsWith("…")).toBe(true);
      expect(snippet?.endsWith("…")).toBe(true);
    });
  });
});
