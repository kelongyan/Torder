import type { TaskView } from "../types/database";

export const taskViewCopy: Record<
  TaskView,
  { title: string; emptyTitle: string; emptyBody: string }
> = {
  today: {
    title: "今日",
    emptyTitle: "今天已经清空",
    emptyBody: "没有过期或今天到期的任务。",
  },
  all: {
    title: "全部任务",
    emptyTitle: "还没有待办任务",
    emptyBody: "从上方快速输入框创建第一条任务。",
  },
  completed: {
    title: "已完成",
    emptyTitle: "还没有完成记录",
    emptyBody: "完成一条任务后，它会出现在这里。",
  },
  overdue: {
    title: "过期任务",
    emptyTitle: "没有过期任务",
    emptyBody: "目前没有需要补救的逾期事项。",
  },
};
