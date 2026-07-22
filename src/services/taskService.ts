import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CreateTaskInput,
  SystemView,
  Task,
  TaskScope,
  TaskSortBy,
  UpdateTaskInput,
} from "../types/database";

interface QueryTasksInput {
  scope: TaskScope;
  query: string;
  sortBy: TaskSortBy;
  showCompleted: boolean;
}

let browserTasks = createBrowserTasks();

export function createTask(input: CreateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    const task: Task = {
      id: `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      status: "todo",
      priority: input.priority ?? 1,
      listId: input.listId ?? "work",
      dueAt: input.dueAt ?? null,
      completedAt: null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    browserTasks = [task, ...browserTasks];
    return Promise.resolve(cloneTask(task));
  }

  return invoke<Task>("create_task", { input });
}

export function getTask(id: string): Promise<Task> {
  if (!isTauri()) {
    const task = browserTasks.find((item) => item.id === id && !item.deletedAt);
    return task
      ? Promise.resolve(cloneTask(task))
      : Promise.reject(new Error("任务不存在"));
  }

  return invoke<Task>("get_task", { id });
}

export function queryTasks(input: QueryTasksInput): Promise<Task[]> {
  if (!isTauri()) {
    return Promise.resolve(
      browserTasks
        .filter((task) => matchesQuery(task, input))
        .sort((left, right) => compareTasks(left, right, input.sortBy))
        .map(cloneTask),
    );
  }

  return invoke<Task[]>("query_tasks", {
    input: {
      scopeKind: input.scope.kind,
      scopeValue:
        input.scope.kind === "view" ? input.scope.view : input.scope.listId,
      query: input.query.trim() || null,
      sortBy: input.sortBy,
      showCompleted: input.showCompleted,
    },
  });
}

export function updateTask(input: UpdateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const index = browserTasks.findIndex(
      (task) => task.id === input.id && !task.deletedAt,
    );
    if (index < 0) return Promise.reject(new Error("任务不存在"));

    const existing = browserTasks[index];
    const next: Task = {
      ...existing,
      ...input,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      completedAt:
        input.status === "done"
          ? (existing.completedAt ?? new Date().toISOString())
          : null,
      updatedAt: new Date().toISOString(),
    };
    browserTasks = browserTasks.map((task, taskIndex) =>
      taskIndex === index ? next : task,
    );
    return Promise.resolve(cloneTask(next));
  }

  return invoke<Task>("update_task", { input });
}

export function deleteTask(id: string): Promise<void> {
  if (!isTauri()) {
    const index = browserTasks.findIndex(
      (task) => task.id === id && !task.deletedAt,
    );
    if (index < 0) return Promise.reject(new Error("任务不存在"));
    browserTasks = browserTasks.map((task, taskIndex) =>
      taskIndex === index
        ? { ...task, deletedAt: new Date().toISOString() }
        : task,
    );
    return Promise.resolve();
  }

  return invoke<void>("delete_task", { id });
}

export function setTaskCompleted(
  id: string,
  completed: boolean,
): Promise<Task> {
  if (!isTauri()) {
    const task = browserTasks.find((item) => item.id === id && !item.deletedAt);
    if (!task) return Promise.reject(new Error("任务不存在"));
    return updateTask({
      id: task.id,
      title: task.title,
      note: task.note,
      status: completed ? "done" : "todo",
      priority: task.priority,
      listId: task.listId,
      dueAt: task.dueAt,
      sortOrder: task.sortOrder,
    });
  }

  return invoke<Task>("set_task_completed", { id, completed });
}

export function getBrowserTasksSnapshot(): Task[] {
  return browserTasks.map(cloneTask);
}

function createBrowserTasks(): Task[] {
  const today = new Date();
  const makeDate = (offset: number, hour = 18, minute = 0) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };

  return [
    browserTask("preview-roadmap", "完成 Q3 产品路线图", {
      note: "与产品团队对齐，输出最终版路线图文档",
      priority: 2,
      listId: "work",
      dueAt: makeDate(1, 17, 30),
    }),
    browserTask("preview-pr", "Review PR #142 — 用户认证模块", {
      note: "auth/service.go 需要重构 token 刷新逻辑",
      priority: 2,
      listId: "work",
      dueAt: makeDate(0, 16, 0),
    }),
    browserTask("preview-docs", "更新技术方案文档", {
      note: "补充数据库迁移策略与回滚方案的详细说明",
      status: "done",
      priority: 1,
      listId: "work",
      dueAt: makeDate(-1, 14, 0),
      completedAt: makeDate(0, 9, 20),
    }),
    browserTask("preview-gym", "健身房续费", {
      note: "年卡即将到期，对比一下续费 vs 新办方案",
      priority: 0,
      listId: "personal",
      dueAt: makeDate(4, 20, 0),
    }),
    browserTask("preview-dental", "预约牙科检查", {
      note: "半年一次的常规洗牙和检查",
      priority: 1,
      listId: "personal",
      dueAt: makeDate(7, 10, 0),
    }),
    browserTask("preview-ddia", "读《Designing Data-Intensive Applications》第5章", {
      note: "Replication 章节，做笔记",
      priority: 0,
      listId: "study",
      dueAt: makeDate(9, 21, 0),
    }),
    browserTask("preview-ci", "配置 CI/CD 流水线", {
      note: "GitHub Actions + Docker 多阶段构建",
      priority: 2,
      listId: "work",
      dueAt: makeDate(0, 15, 0),
    }),
    browserTask("preview-books", "整理书架 & 捐赠旧书", {
      note: "清理不再需要的技术书籍，拍照挂闲鱼",
      priority: 0,
      listId: "personal",
      dueAt: null,
    }),
    browserTask("preview-share", "准备周五的团队分享 — Tauri 2 实战", {
      note: "PPT + Demo 项目，预计 30 分钟",
      priority: 1,
      listId: "work",
      dueAt: makeDate(3, 11, 30),
    }),
    browserTask("preview-rustlings", "Rustlings 练习 30-35", {
      note: "完成迭代器与智能指针章节",
      priority: 1,
      listId: "study",
      dueAt: makeDate(5, 19, 0),
    }),
    browserTask("preview-camping", "购买周末露营装备", {
      note: "帐篷、睡袋、防潮垫，预算 1500",
      priority: 0,
      listId: "personal",
      dueAt: makeDate(6, 13, 0),
    }),
    browserTask("preview-perf", "性能优化 — 首页加载从 3.2s 降到 1s 内", {
      note: "Code splitting + 图片懒加载 + 预加载关键资源",
      status: "done",
      priority: 2,
      listId: "work",
      dueAt: makeDate(-3, 18, 0),
      completedAt: makeDate(-2, 18, 0),
    }),
  ];
}

function browserTask(
  id: string,
  title: string,
  overrides: Partial<Task>,
): Task {
  const timestamp = new Date().toISOString();
  return {
    id,
    title,
    note: null,
    status: "todo",
    priority: 1,
    listId: "work",
    dueAt: null,
    completedAt: null,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function matchesQuery(task: Task, input: QueryTasksInput): boolean {
  if (task.deletedAt) return false;
  if (!matchesScope(task, input.scope, input.showCompleted)) return false;

  const query = input.query.trim().toLocaleLowerCase("zh-CN");
  if (!query) return true;

  return [task.title, task.note ?? ""]
    .join("\n")
    .toLocaleLowerCase("zh-CN")
    .includes(query);
}

function matchesScope(
  task: Task,
  scope: TaskScope,
  showCompleted: boolean,
): boolean {
  if (scope.kind === "list") {
    if (task.listId !== scope.listId) return false;
    return showCompleted || task.status !== "done";
  }

  return matchesSystemView(task, scope.view, showCompleted);
}

function matchesSystemView(
  task: Task,
  view: SystemView,
  showCompleted: boolean,
): boolean {
  if (view === "completed") return task.status === "done";
  if (!showCompleted && task.status === "done") return false;
  if (view === "all") return true;
  if (task.status !== "todo") return false;
  if (view === "important") return task.priority === 2;
  if (view === "planned") return task.dueAt !== null;
  return Boolean(task.dueAt && isSameLocalDay(new Date(task.dueAt), new Date()));
}

function compareTasks(left: Task, right: Task, sortBy: TaskSortBy): number {
  if (sortBy === "priority") {
    if (left.priority !== right.priority) return right.priority - left.priority;
    return compareDueDates(left, right) || right.createdAt.localeCompare(left.createdAt);
  }

  if (sortBy === "date") {
    return compareDueDates(left, right) || right.priority - left.priority;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function compareDueDates(left: Task, right: Task): number {
  if (!left.dueAt && !right.dueAt) return 0;
  if (!left.dueAt) return 1;
  if (!right.dueAt) return -1;
  return left.dueAt.localeCompare(right.dueAt);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function cloneTask(task: Task): Task {
  return { ...task };
}
