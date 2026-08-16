import type { SystemView } from "../types/database";

export const taskViewCopy: Record<
  SystemView,
  { title: string; emptyTitle: string; emptyBody: string }
> = {
  all: {
    title: "全部任务",
    emptyTitle: "还没有任务，开始添加吧",
    emptyBody: "点击添加新任务，把下一件事放进清单。",
  },
  today: {
    title: "今日任务",
    emptyTitle: "今天没有待办任务",
    emptyBody: "今天这栏很干净，可以放心推进手头的事。",
  },
  planned: {
    title: "计划中",
    emptyTitle: "没有计划中的任务",
    emptyBody: "设置截止时间后，任务会出现在这里。",
  },
  overdue: {
    title: "已逾期",
    emptyTitle: "没有逾期的任务",
    emptyBody: "截止时间已过的未完成任务会集中在这里，建议尽快处理。",
  },
  "no-date": {
    title: "无截止日期",
    emptyTitle: "没有无截止日期的任务",
    emptyBody: "没有设置截止时间的任务会出现在这里。",
  },
  important: {
    title: "重要任务",
    emptyTitle: "没有标记为重要的任务",
    emptyBody: "高优先级任务会集中在这里。",
  },
  completed: {
    title: "已完成",
    emptyTitle: "还没有完成记录",
    emptyBody: "完成一条任务后，它会出现在这里。",
  },
  deleted: {
    title: "回收站",
    emptyTitle: "回收站是空的",
    emptyBody: "删除的任务会暂时留在这里，可以恢复或彻底清除。",
  },
};
