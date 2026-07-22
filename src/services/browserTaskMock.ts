import type { Task } from "../types/database";

let browserTasks = createBrowserTasks();

export function getBrowserTasksSnapshot(): Task[] {
  return browserTasks.map(cloneTask);
}

export function setBrowserTasks(tasks: Task[]): void {
  browserTasks = tasks;
}

export function addBrowserTask(task: Task): void {
  browserTasks = [task, ...browserTasks];
}

export function updateBrowserTask(id: string, updater: (task: Task) => Task): boolean {
  const index = browserTasks.findIndex((task) => task.id === id && !task.deletedAt);
  if (index < 0) return false;
  browserTasks = browserTasks.map((task, taskIndex) =>
    taskIndex === index ? updater(task) : task,
  );
  return true;
}

export function findBrowserTask(id: string): Task | undefined {
  return browserTasks.find((item) => item.id === id && !item.deletedAt);
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

function cloneTask(task: Task): Task {
  return { ...task };
}
