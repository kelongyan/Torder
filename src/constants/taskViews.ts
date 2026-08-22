import type { SystemView } from "../types/database";

export const taskViewCopy: Record<
  SystemView,
  { title: string; emptyTitle: string; emptyBody: string }
> = {
  all: {
    title: "全部任务",
    emptyTitle: "还没有任务",
    emptyBody: "",
  },
  today: {
    title: "今日任务",
    emptyTitle: "今天没有任务",
    emptyBody: "",
  },
  planned: {
    title: "计划中",
    emptyTitle: "没有计划任务",
    emptyBody: "",
  },
  overdue: {
    title: "已逾期",
    emptyTitle: "没有逾期任务",
    emptyBody: "",
  },
  "no-date": {
    title: "无截止日期",
    emptyTitle: "没有无日期任务",
    emptyBody: "",
  },
  important: {
    title: "重要任务",
    emptyTitle: "没有重要任务",
    emptyBody: "",
  },
  completed: {
    title: "已完成",
    emptyTitle: "没有完成记录",
    emptyBody: "",
  },
  deleted: {
    title: "回收站",
    emptyTitle: "回收站是空的",
    emptyBody: "",
  },
};
