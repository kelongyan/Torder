/**
 * store.js — 单一数据源（发布-订阅），对齐桌面 taskStore + taskQuery 的语义：
 *  - 视图匹配 matchesSystemView（all/today/planned/overdue/no-date/important/completed/deleted）
 *  - 排序 compareTasks（priority/date/created/manual）
 *  - 软删除两级：deletedAt（回收站）/ 此处不模拟 purgedAt 同步墓碑
 * 设计稿里的所有“乐观更新”直接改本地数据并通知重渲染。
 */
import { buildMockData } from "../data/mock.js";
import { dateKey, isoToKey, isOverdue } from "./format.js";

/** @typedef {import('../data/enums.js').SystemView} SystemView */

const listeners = new Set();
const now = () => new Date();

const state = {
  /* 数据 */
  lists: [],
  tasks: [],
  recurringRules: [],
  calendarEvents: [],
  savedViews: [],

  /* 界面持久偏好（对应 AppSettings 的移动端子集） */
  prefs: {
    theme: "dark",       // system | light | dark
    accent: "violet",    // 6 色预设
    sortBy: "priority",  // priority | date | created | manual
    sortAsc: false,
    showCompleted: false,
    defaultListId: "list-work",
  },

  /* 临时 UI 状态（不持久） */
  ui: {
    selectedTaskId: null,
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    selectedDateKey: dateKey(new Date()),
  },
};

/* ---------------- 订阅 ---------------- */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => fn(state));
}
export function getState() {
  return state;
}

/* ---------------- 初始化 / 重置 ---------------- */
export function initStore() {
  const data = buildMockData();
  Object.assign(state, data);
  applyTheme(state.prefs.theme, state.prefs.accent);
  notify();
}

export function resetDemo() {
  const data = buildMockData();
  Object.assign(state, data);
  notify();
}

/* ---------------- 主题 / 偏好 ---------------- */
export function setTheme(theme) {
  state.prefs.theme = theme;
  applyTheme(theme, state.prefs.accent);
  notify();
}
export function setAccent(accent) {
  state.prefs.accent = accent;
  applyTheme(state.prefs.theme, accent);
  notify();
}
function resolveTheme(theme) {
  if (theme === "system") {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}
export function applyTheme(theme, accent) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(theme);
  if (accent) root.dataset.accent = accent;
}
export function setSort(sortBy) { state.prefs.sortBy = sortBy; notify(); }
export function toggleSortDir() { state.prefs.sortAsc = !state.prefs.sortAsc; notify(); }
export function toggleShowCompleted() { state.prefs.showCompleted = !state.prefs.showCompleted; notify(); }

/* ---------------- 查询语义（镜像 taskQuery.ts） ---------------- */
function planKey(task) {
  return task.scheduledDate ?? isoToKey(task.dueAt);
}

export function matchesView(task, view, showCompleted) {
  if (view === "deleted") return task.deletedAt != null;
  if (task.deletedAt != null) return false;
  if (view === "completed") return task.status === "done";
  if (!showCompleted && task.status === "done") return false;
  switch (view) {
    case "all": return true;
    case "important": return task.priority === 2;
    case "planned": return task.scheduledDate !== null || task.dueAt !== null;
    case "overdue": return Boolean(task.dueAt && isOverdue(task.dueAt));
    case "no-date": return task.dueAt === null;
    case "today": return planKey(task) === dateKey(now());
    default: return true;
  }
}

function matchesList(task, listId, showCompleted) {
  if (task.deletedAt != null) return false;
  if (task.listId !== listId) return false;
  return showCompleted || task.status !== "done";
}

function compareTasks(a, b, sortBy) {
  if (sortBy === "priority") {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return cmpDue(a, b) || b.createdAt.localeCompare(a.createdAt);
  }
  if (sortBy === "date") return cmpDue(a, b) || b.priority - a.priority || b.createdAt.localeCompare(a.createdAt);
  if (sortBy === "manual") return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
  return b.createdAt.localeCompare(a.createdAt);
}
function cmpDue(a, b) {
  if (!a.dueAt && !b.dueAt) return 0;
  if (!a.dueAt) return 1;
  if (!b.dueAt) return -1;
  return a.dueAt.localeCompare(b.dueAt);
}

/** 主查询：scope = {kind:'view',view} | {kind:'list',listId} | {kind:'tag',tag} | {kind:'search',q} */
export function queryTasks(scope, opts = {}) {
  const { sortBy = state.prefs.sortBy, asc = state.prefs.sortAsc, showCompleted = state.prefs.showCompleted } = opts;
  let rows = state.tasks.filter((t) => {
    if (scope.kind === "view") return matchesView(t, scope.view, showCompleted);
    if (scope.kind === "list") return matchesList(t, scope.listId, showCompleted);
    if (scope.kind === "tag") return t.deletedAt == null && t.tags.includes(scope.tag) && (showCompleted || t.status !== "done");
    if (scope.kind === "search") {
      if (t.deletedAt != null) return false;
      const q = scope.q.trim().toLowerCase();
      return (showCompleted || t.status !== "done") &&
        (t.title.toLowerCase().includes(q) || (t.note ?? "").toLowerCase().includes(q) || t.tags.some((x) => x.toLowerCase().includes(q)));
    }
    return true;
  });
  rows = rows.slice().sort((a, b) => compareTasks(a, b, sortBy));
  return asc ? rows.reverse() : rows;
}

/** 侧栏计数（镜像 buildCounts） */
export function buildCounts() {
  const views = {};
  for (const v of ["all", "today", "planned", "overdue", "no-date", "important", "completed", "deleted"]) {
    views[v] = state.tasks.filter((t) => matchesView(t, v, v === "completed")).length;
  }
  const lists = {};
  for (const l of state.lists) {
    lists[l.id] = state.tasks.filter((t) => matchesList(t, l.id, false)).length;
  }
  const tags = {};
  for (const t of state.tasks) {
    if (t.deletedAt != null || t.status === "done") continue;
    for (const tag of t.tags) tags[tag] = (tags[tag] ?? 0) + 1;
  }
  return { views, lists, tags };
}

export function getList(id) {
  return state.lists.find((l) => l.id === id) ?? null;
}
export function allTags() {
  const counts = buildCounts().tags;
  return Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

/* ---------------- 今日议程分组（镜像 TaskTodayAgenda） ---------------- */
export function todayAgenda() {
  const rows = queryTasks({ kind: "view", view: "today" });
  const todayKey = dateKey(now());
  const overdue = rows.filter((t) => t.dueAt && isOverdue(t.dueAt));
  const timed = rows
    .filter((t) => {
      if (!t.dueAt || isoToKey(t.dueAt) !== todayKey) return false;
      const d = new Date(t.dueAt);
      return d.getHours() !== 0 || d.getMinutes() !== 0;
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const allday = rows.filter((t) => !overdue.includes(t) && !timed.includes(t));
  const completedToday = state.tasks.filter(
    (t) => t.status === "done" && t.completedAt && isoToKey(t.completedAt) === todayKey,
  );
  return { overdue, timed, allday, completedToday };
}

/** 月历：dateKey -> tasks（取计划日或截止日，镜像 getTaskCalendarKey） */
export function calendarMap() {
  const map = new Map();
  for (const t of state.tasks) {
    if (t.deletedAt != null) continue;
    const key = t.scheduledDate ?? isoToKey(t.dueAt);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}
export function eventsOn(key) {
  return state.calendarEvents.filter((e) => e.startDate <= key && key <= e.endDate);
}

/* ---------------- 任务变更（本地乐观更新） ---------------- */
export function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.status === "done") {
    t.status = "todo";
    t.completedAt = null;
  } else {
    t.status = "done";
    t.completedAt = new Date().toISOString();
  }
  t.updatedAt = new Date().toISOString();
  navigator.vibrate?.(8);
  notify();
}

export function softDeleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.deletedAt = new Date().toISOString();
  t.updatedAt = t.deletedAt;
  notify();
}
export function restoreTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.deletedAt = null;
  notify();
}
export function purgeTask(id) {
  state.tasks = state.tasks.filter((x) => x.id !== id);
  notify();
}
export function emptyTrash() {
  state.tasks = state.tasks.filter((t) => t.deletedAt == null);
  notify();
}

export function createTask(input) {
  const id = `task_new_${Date.now().toString(36)}`;
  const ts = new Date().toISOString();
  const t = {
    id,
    title: input.title?.trim() || "未命名任务",
    note: input.note ?? null,
    status: "todo",
    priority: input.priority ?? 1,
    listId: input.listId ?? state.prefs.defaultListId,
    scheduledDate: input.scheduledDate ?? null,
    dueAt: input.dueAt ?? null,
    completedAt: null,
    sortOrder: state.tasks.length,
    remindBefore: input.remindBefore ?? null,
    remindAt: null, remindedAt: null,
    repeatRule: null,
    subtasks: input.subtasks ?? [],
    tags: input.tags ?? [],
    recurringRuleId: null, occurrenceAt: null,
    createdAt: ts, updatedAt: ts, deletedAt: null, attachmentCount: 0,
  };
  state.tasks.push(t);
  notify();
  return t;
}

export function updateTask(id, patch) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  notify();
}

export function toggleSubtask(taskId, subId) {
  const t = state.tasks.find((x) => x.id === taskId);
  const s = t?.subtasks.find((x) => x.id === subId);
  if (!s) return;
  s.completed = !s.completed;
  s.completedAt = s.completed ? new Date().toISOString() : null;
  notify();
}
export function addSubtask(taskId, title) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t || !title.trim()) return;
  t.subtasks.push({
    id: `sub_${Date.now().toString(36)}`,
    title: title.trim(), completed: false,
    createdAt: new Date().toISOString(), completedAt: null, sortOrder: t.subtasks.length,
  });
  notify();
}
export function removeSubtask(taskId, subId) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  t.subtasks = t.subtasks.filter((s) => s.id !== subId);
  notify();
}

/* ---------------- 清单变更 ---------------- */
export function createList({ name, color }) {
  const ts = new Date().toISOString();
  const l = {
    id: `list_new_${Date.now().toString(36)}`,
    name: name.trim() || "新清单",
    color: color ?? "#6366f1",
    sortOrder: state.lists.length, isDefault: false,
    createdAt: ts, updatedAt: ts, deletedAt: null,
  };
  state.lists.push(l);
  notify();
  return l;
}
export function updateList(id, patch) {
  const l = state.lists.find((x) => x.id === id);
  if (!l) return;
  Object.assign(l, patch, { updatedAt: new Date().toISOString() });
  notify();
}
export function deleteList(id) {
  const l = state.lists.find((x) => x.id === id);
  if (!l || l.isDefault) return;
  l.deletedAt = new Date().toISOString();
  // 清单内任务回归默认清单
  for (const t of state.tasks) if (t.listId === id) t.listId = state.prefs.defaultListId;
  state.lists = state.lists.filter((x) => x.id !== id);
  notify();
}

/* ---------------- 月历 UI ---------------- */
export function setCalendarCursor(month, year) {
  state.ui.calendarMonth = month;
  state.ui.calendarYear = year;
  notify();
}
export function selectDate(key) {
  state.ui.selectedDateKey = key;
  notify();
}
