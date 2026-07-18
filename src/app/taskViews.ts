import type { TaskView } from "../types/database";

export const taskViewCopy: Record<
  TaskView,
  { title: string; subtitle: string; emptyTitle: string; emptyBody: string }
> = {
  today: {
    title: "今日",
    subtitle: "先处理过期事项，再安排今天。",
    emptyTitle: "今天已经清空",
    emptyBody: "没有过期或今天到期的任务。",
  },
  all: {
    title: "全部任务",
    subtitle: "查看所有尚未完成的事项。",
    emptyTitle: "还没有待办任务",
    emptyBody: "从上方快速输入框创建第一条任务。",
  },
  completed: {
    title: "已完成",
    subtitle: "这里保留已经处理完的事项。",
    emptyTitle: "还没有完成记录",
    emptyBody: "完成一条任务后，它会出现在这里。",
  },
  overdue: {
    title: "过期任务",
    subtitle: "这些事项已经超过截止时间。",
    emptyTitle: "没有过期任务",
    emptyBody: "目前没有需要补救的逾期事项。",
  },
};
