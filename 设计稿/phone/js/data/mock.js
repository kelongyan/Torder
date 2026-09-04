/**
 * mock.js — 设计稿演示数据
 * 字段结构与 types/database.ts 的 Task / TaskList / RecurringRule / CalendarEvent
 * 保持同构（camelCase）。所有日期在加载时按“今天”相对生成（relativeIso/relativeKey），
 * 因此逾期、今日时间轴、明天等状态永远成立，不写死绝对日期。
 */
import { relativeIso, relativeKey } from "../core/format.js";

let seq = 0;
const nextId = (prefix) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36).slice(-3)}`;

function list(partial) {
  const now = new Date().toISOString();
  return {
    id: nextId("list"),
    name: "",
    color: null,
    sortOrder: 0,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial,
  };
}

function task(partial) {
  // 默认 3 天前创建，让「今日新增」等统计真实；个别任务在调用处覆盖为今天
  const fallbackCreated = relativeIso(-3, 9, 0);
  return {
    id: nextId("task"),
    title: "",
    note: null,
    status: "todo", // todo | done | archived
    priority: 1, // 2 高 / 1 中 / 0 低
    listId: null,
    scheduledDate: null, // 'YYYY-MM-DD' 计划日期
    dueAt: null,          // ISO 截止（含时刻）
    completedAt: null,
    sortOrder: seq,
    remindBefore: null,
    remindAt: null,
    remindedAt: null,
    repeatRule: null,
    subtasks: [],
    tags: [],
    recurringRuleId: null,
    occurrenceAt: null,
    createdAt: fallbackCreated,
    updatedAt: fallbackCreated,
    deletedAt: null,
    // —— 以下为设计稿展示用的非持久字段 ——
    attachmentCount: 0,
    ...partial,
  };
}

function subtask(title, completed = false) {
  return {
    id: nextId("sub"),
    title,
    completed,
    createdAt: new Date().toISOString(),
    completedAt: completed ? new Date().toISOString() : null,
    sortOrder: seq,
  };
}

/** 生成整套演示数据（每次调用全新 id，便于“重置演示”） */
export function buildMockData() {
  seq = 0;

  /* ---------------- 清单 ---------------- */
  const lWork = list({ id: "list-work", name: "工作", color: "#6366f1", isDefault: true, sortOrder: 0 });
  const lLife = list({ id: "list-life", name: "个人", color: "#10b981", sortOrder: 1 });
  const lStudy = list({ id: "list-study", name: "学习", color: "#06b6d4", sortOrder: 2 });
  const lHome = list({ id: "list-home", name: "生活", color: "#f59e0b", sortOrder: 3 });
  const lists = [lWork, lLife, lStudy, lHome];

  /* ---------------- 任务 ---------------- */
  const tasks = [];
  const T = (p) => tasks.push(task(p));

  // 今日 · 有时刻（时间轴）
  T({ title: "晨会：同步迭代进度与阻塞", priority: 2, listId: lWork.id, scheduledDate: relativeKey(0), dueAt: relativeIso(0, 9, 30), tags: ["项目A"], remindBefore: 10 });
  T({ title: "评审安卓端重构设计稿", priority: 2, listId: lWork.id, scheduledDate: relativeKey(0), dueAt: relativeIso(0, 11, 0), tags: ["项目A"], attachmentCount: 2, createdAt: relativeIso(0, 8, 40), updatedAt: relativeIso(0, 8, 40), note: "重点看信息架构、底部导航与手势返回是否符合单手操作。" });
  T({ title: "和设计师过交互细节", priority: 1, listId: lWork.id, scheduledDate: relativeKey(0), dueAt: relativeIso(0, 14, 0), tags: ["项目A"] });
  T({ title: "修复同步冲突的边界情况", priority: 1, listId: lWork.id, scheduledDate: relativeKey(0), dueAt: relativeIso(0, 15, 30), tags: ["线上"], subtasks: [subtask("复现冲突场景", true), subtask("补充单测"), subtask("走查 WebDAV 引擎")] });
  T({ title: "健身：上肢力量训练", priority: 0, listId: lLife.id, scheduledDate: relativeKey(0), dueAt: relativeIso(0, 18, 30), tags: ["健康"] });
  T({ title: "阅读《设计心理学》第 4 章", priority: 0, listId: lStudy.id, scheduledDate: relativeKey(0), dueAt: relativeIso(0, 21, 0), tags: ["读书"] });

  // 今日 · 全天（无时刻）
  T({ title: "回复客户邮件并确认需求边界", priority: 2, listId: lWork.id, scheduledDate: relativeKey(0), tags: ["项目A"] });
  T({ title: "整理本周工作周报", priority: 1, listId: lWork.id, scheduledDate: relativeKey(0), subtasks: [subtask("汇总完成事项", true), subtask("列出下周计划", true), subtask("标注风险项")] });
  T({ title: "买牛奶和鸡蛋", priority: 0, listId: lHome.id, scheduledDate: relativeKey(0), tags: ["采购"], createdAt: relativeIso(0, 9, 5), updatedAt: relativeIso(0, 9, 5) });

  // 逾期
  T({ title: "提交差旅报销单", priority: 2, listId: lWork.id, scheduledDate: relativeKey(-1), dueAt: relativeIso(-1, 18, 0), tags: ["财务"], attachmentCount: 1 });
  T({ title: "续期服务器域名", priority: 1, listId: lWork.id, scheduledDate: relativeKey(-2), dueAt: relativeIso(-2, 12, 0) });

  // 明天
  T({ title: "牙医复诊", priority: 1, listId: lLife.id, scheduledDate: relativeKey(1), dueAt: relativeIso(1, 10, 0), remindBefore: 120 });
  T({ title: "准备季度复盘材料", priority: 2, listId: lWork.id, scheduledDate: relativeKey(1), tags: ["项目A"], subtasks: [subtask("拉取数据看板"), subtask("整理关键指标")] });

  // 更远的计划
  T({ title: "产品发版 Checklist 走查", priority: 1, listId: lWork.id, scheduledDate: relativeKey(3), dueAt: relativeIso(3, 16, 0), tags: ["项目A", "线上"] });
  T({ title: "朋友生日：准备礼物", priority: 1, listId: lLife.id, scheduledDate: relativeKey(6) });
  T({ title: "季度 OKR 复盘", priority: 2, listId: lWork.id, scheduledDate: relativeKey(12), dueAt: relativeIso(12, 14, 0) });
  T({ title: "预约车辆保养", priority: 0, listId: lHome.id, scheduledDate: relativeKey(5) });

  // 无日期
  T({ title: "学习 Rust 生命周期与借用检查", priority: 1, listId: lStudy.id, tags: ["读书"] });
  T({ title: "整理书桌与线材", priority: 0, listId: lHome.id });
  T({ title: "调研：竞品移动端导航模式", priority: 1, listId: lWork.id, tags: ["项目A"] });

  // 今日已完成
  T({ title: "晨跑 5 公里", priority: 0, listId: lLife.id, status: "done", scheduledDate: relativeKey(0), dueAt: relativeIso(0, 8, 10), completedAt: relativeIso(0, 8, 5), tags: ["健康"] });
  T({ title: "提交昨日代码并发起评审", priority: 1, listId: lWork.id, status: "done", scheduledDate: relativeKey(0), completedAt: relativeIso(0, 9, 12) });

  // 更早完成（已完成视图）
  T({ title: "搭建 WebDAV 同步原型", priority: 2, listId: lWork.id, status: "done", completedAt: relativeIso(-3, 17, 20), tags: ["项目A"] });
  T({ title: "备份本地数据库", priority: 0, listId: lWork.id, status: "done", completedAt: relativeIso(-4, 22, 0) });

  // 回收站（软删除）
  T({ title: "废弃的旧版登录流程草稿", priority: 0, listId: lWork.id, status: "todo", deletedAt: relativeIso(-1, 15, 0), scheduledDate: relativeKey(-1) });
  T({ title: "写错的购物清单", priority: 0, listId: lHome.id, status: "todo", deletedAt: relativeIso(-2, 9, 30) });

  /* ---------------- 循环规则 ---------------- */
  const recurringRules = [
    {
      id: "rule-daily-standup", title: "每日晨会同步", priority: 2, listId: lWork.id,
      frequency: "daily", intervalCount: 1, weekdays: [], monthDay: null,
      nextDueAt: relativeIso(1, 9, 30), remindBefore: 10, enabled: true,
    },
    {
      id: "rule-weekly-review", title: "每周回顾与计划", priority: 1, listId: lWork.id,
      frequency: "weekly", intervalCount: 1, weekdays: [5], monthDay: null,
      nextDueAt: relativeIso(1, 17, 0), remindBefore: 60, enabled: true,
    },
    {
      id: "rule-monthly-rent", title: "缴纳房租", priority: 1, listId: lHome.id,
      frequency: "monthly", intervalCount: 1, weekdays: [], monthDay: 1,
      nextDueAt: relativeKey(7), remindBefore: 1440, enabled: true,
    },
  ];

  /* ---------------- 日历事件（背景色带） ---------------- */
  const calendarEvents = [
    { id: "evt-trip", title: "上海出差 · 客户现场", eventType: "trip", startDate: relativeKey(4), endDate: relativeKey(5), note: "虹桥往返，带演示机" },
    { id: "evt-leave", title: "年假", eventType: "leave", startDate: relativeKey(10), endDate: relativeKey(11) },
    { id: "evt-other", title: "团队建设 · 密室逃脱", eventType: "other", startDate: relativeKey(2), endDate: relativeKey(2) },
  ];

  /* ---------------- 保存视图（前端概念） ---------------- */
  const savedViews = [
    { id: "sv-1", name: "项目A 本周", icon: "filter", tags: ["项目A"] },
    { id: "sv-2", name: "高优先未完成", icon: "star" },
  ];

  return { lists, tasks, recurringRules, calendarEvents, savedViews };
}
