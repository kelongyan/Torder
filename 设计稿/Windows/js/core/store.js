/**
 * store.js — 单一数据源（发布-订阅），对齐桌面 taskStore + taskQuery 的语义：
 *  - 视图匹配 matchesSystemView（all/today/planned/overdue/no-date/important/completed/deleted）
 *  - 排序 compareTasks（priority/date/created/manual）
 *  - 桌面端额外持有：当前 scope、布局 layout、侧栏折叠、详情选中、搜索词
 *  - 看板分组 / 周日程 / 统计聚合
 * 设计稿里的“乐观更新”直接改本地数据并通知重渲染。
 */
import { buildMockData } from "../data/mock.js";
import { dateKey, isoToKey, isOverdue, parseKey, addDaysSafe, WEEKDAY_LABELS } from "./format.js";

const listeners = new Set();
const now = () => new Date();

const state = {
  /* 数据 */
  lists: [],
  tasks: [],
  recurringRules: [],
  calendarEvents: [],
  savedViews: [],

  /* 偏好（对应 AppSettings 桌面全集子集） */
  prefs: {
    theme: "dark",
    accent: "violet",
    sortBy: "priority",
    sortAsc: false,
    showCompleted: false,
    defaultListId: "list-work",
    fontSize: "standard", // small | standard | large
    launchAtStartup: false,
    minimizeToTray: true,
    autoSync: true,
    naturalLanguage: true,
    moveCompletedImmediately: false,
    systemNotification: true,
    notifySound: false,
  },

  /* 导航与布局（桌面 IA） */
  ui: {
    scope: { kind: "view", view: "today" },
    layout: "list",                 // list | board | agenda | month | week
    sidebarCollapsed: false,
    selectedTaskId: null,
    searchQuery: "",
    filterTags: [],
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    selectedDateKey: dateKey(new Date()),
    weekAnchorKey: dateKey(new Date()),
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
  state.ui.selectedTaskId = null;
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
export function setFontSize(size) {
  state.prefs.fontSize = size;
  document.documentElement.dataset.fontSize = size === "standard" ? "" : size;
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
export function patchPrefs(patch) { Object.assign(state.prefs, patch); notify(); }

/* ---------------- 导航 / 布局 ---------------- */
export function setScope(scope) {
  state.ui.scope = scope;
  state.ui.selectedTaskId = null;
  notify();
}
export function setLayout(layout) {
  state.ui.layout = layout;
  notify();
}
export function toggleSidebar() {
  state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
  notify();
}
export function selectTask(id) {
  state.ui.selectedTaskId = id;
  notify();
}
export function closeDetail() {
  state.ui.selectedTaskId = null;
  notify();
}
export function setSearchQuery(q) {
  state.ui.searchQuery = q;
  notify();
}
export function toggleFilterTag(tag) {
  const arr = state.ui.filterTags;
  const i = arr.indexOf(tag);
  if (i >= 0) arr.splice(i, 1); else arr.push(tag);
  notify();
}

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
export function queryTasks(scope = state.ui.scope, opts = {}) {
  const {
    sortBy = state.prefs.sortBy,
    asc = state.prefs.sortAsc,
    showCompleted = state.prefs.showCompleted,
  } = opts;
  let rows = state.tasks.filter((t) => {
    if (scope.kind === "view") return matchesView(t, scope.view, showCompleted);
    if (scope.kind === "list") return matchesList(t, scope.listId, showCompleted);
    if (scope.kind === "tag") return t.deletedAt == null && t.tags.includes(scope.tag) && (showCompleted || t.status !== "done");
    if (scope.kind === "search") {
      if (t.deletedAt != null) return false;
      const q = scope.q.trim().toLowerCase();
      return (showCompleted || t.status !== "done") &&
        (t.title.toLowerCase().includes(q) ||
          (t.note ?? "").toLowerCase().includes(q) ||
          t.tags.some((x) => x.toLowerCase().includes(q)));
    }
    return true;
  });
  // 筛选面板：优先级标签（pri-2/pri-1/pri-0）
  const priTags = state.ui.filterTags.filter((t) => t.startsWith("pri-"));
  if (priTags.length) {
    const pris = priTags.map((t) => Number(t.slice(4)));
    rows = rows.filter((t) => pris.includes(t.priority));
  }
  rows = rows.slice().sort((a, b) => compareTasks(a, b, sortBy));
  return asc ? rows.reverse() : rows;
}

/** 全库搜索（命令面板/搜索页，忽略当前 scope） */
export function searchAll(q, limit = 8) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return state.tasks
    .filter((t) => t.deletedAt == null &&
      (t.title.toLowerCase().includes(query) ||
        t.tags.some((x) => x.toLowerCase().includes(query))))
    .slice(0, limit);
}

/** 侧栏计数（镜像 buildCounts） */
export function buildCounts() {
  const views = {};
  for (const v of ["all", "today", "planned", "overdue", "no-date", "important", "completed", "deleted"]) {
    views[v] = state.tasks.filter((t) => matchesView(t, v, v === "completed")).length;
  }
  const lists = {};
  for (const l of state.lists) lists[l.id] = state.tasks.filter((t) => matchesList(t, l.id, false)).length;
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
export function getTask(id) {
  return state.tasks.find((t) => t.id === id) ?? null;
}
export function allTags() {
  const counts = buildCounts().tags;
  return Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

/* ---------------- 列表分组（镜像 TaskListView 分组卡） ---------------- */
export function groupTasks(rows) {
  const groups = [];
  const push = (id, title, predicate, tone = "accent") => {
    const items = rows.filter(predicate);
    if (items.length) groups.push({ id, title, items, tone });
  };
  const todayKey = dateKey(now());
  push("overdue", "已逾期", (t) => t.dueAt && isOverdue(t.dueAt), "danger");
  push("timed", "今天 · 时间轴", (t) => {
    const k = planKey(t);
    if (k !== todayKey || !t.dueAt) return false;
    const d = new Date(t.dueAt);
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  });
  push("today", "今天", (t) => planKey(t) === todayKey && !groups.find((g) => g.items.includes(t)));
  push("tomorrow", "明天", (t) => planKey(t) === dateKey(addDaysSafe(now(), 1)));
  push("later", "以后", (t) => {
    const k = planKey(t);
    return k && k > dateKey(addDaysSafe(now(), 1));
  });
  push("nodate", "无日期", (t) => !planKey(t));
  const done = rows.filter((t) => t.status === "done");
  if (done.length) groups.push({ id: "done", title: "已完成", items: done, tone: "muted" });
  return groups;
}

/** 今日视图聚合：逾期 / 时间轴 / 全天 / 今日完成（today 系统视图本身不含完成项） */
export function todayAgenda() {
  const todayKey = dateKey(now());
  const live = state.tasks.filter((t) => t.deletedAt == null);
  const overdue = live.filter((t) => t.dueAt && isOverdue(t.dueAt) && t.status !== "done");
  const timed = [];
  const allday = [];
  for (const t of live) {
    if (t.status === "done") continue;
    if (planKey(t) !== todayKey) continue;
    if (t.dueAt) {
      const d = new Date(t.dueAt);
      (d.getHours() !== 0 || d.getMinutes() !== 0 ? timed : allday).push(t);
    } else allday.push(t);
  }
  timed.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const completedToday = live.filter((t) => t.status === "done" && isoToKey(t.completedAt) === todayKey);
  return { overdue, timed, allday, completedToday };
}

/* ---------------- 看板（镜像 TaskBoard 三列） ---------------- */
export function boardColumns() {
  // 在当前视图/清单的查询结果集内分列（与列表布局同一数据源）
  const live = queryTasks();
  return [
    { id: "todo", title: "待处理", colorVar: "--blue", tasks: live.filter((t) => t.status !== "done" && t.priority !== 2) },
    { id: "doing", title: "进行中", colorVar: "--red", tasks: live.filter((t) => t.status !== "done" && t.priority === 2) },
    { id: "done", title: "已完成", colorVar: "--green", tasks: live.filter((t) => t.status === "done") },
  ];
}

/* ---------------- 月历 ---------------- */
export function calendarMap() {
  const map = new Map();
  for (const t of queryTasks()) {
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
/** 生成周一起头的 6×7 月历格 */
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // 周一=0
  const start = new Date(year, month, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: d, key: dateKey(d), inMonth: d.getMonth() === month });
  }
  return cells;
}

/* ---------------- 周视图（7 天 × 24 时网格） ---------------- */
export function weekDays(anchorKey = state.ui.weekAnchorKey) {
  const anchor = parseKey(anchorKey) ?? now();
  const lead = (anchor.getDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - lead);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { date: d, key: dateKey(d), weekday: WEEKDAY_LABELS[i] };
  });
}
export function shiftWeek(delta) {
  const cur = parseKey(state.ui.weekAnchorKey) ?? now();
  state.ui.weekAnchorKey = dateKey(addDaysSafe(cur, delta * 7));
  notify();
}
export function shiftMonth(delta) {
  const d = new Date(state.ui.calendarYear, state.ui.calendarMonth + delta, 1);
  state.ui.calendarMonth = d.getMonth();
  state.ui.calendarYear = d.getFullYear();
  notify();
}
export function selectDate(key) {
  state.ui.selectedDateKey = key;
  notify();
}

/* ---------------- 统计（回顾/统计弹窗） ---------------- */
export function reviewStats() {
  const todayKey = dateKey(now());
  const tomorrowKey = dateKey(addDaysSafe(now(), 1));
  const live = state.tasks.filter((t) => t.deletedAt == null);
  const doneToday = live.filter((t) => t.status === "done" && t.completedAt && isoToKey(t.completedAt) === todayKey);
  const createdToday = live.filter((t) => isoToKey(t.createdAt) === todayKey);
  const overdue = live.filter((t) => t.dueAt && isOverdue(t.dueAt) && t.status !== "done");
  const tomorrow = live.filter((t) => planKey(t) === tomorrowKey && t.status !== "done");
  return {
    doneToday,
    createdToday,
    overdue,
    tomorrow,
    activeRules: state.recurringRules.filter((r) => r.enabled).length,
    openCount: live.filter((t) => t.status !== "done").length,
  };
}

/* ---------------- 任务变更 ---------------- */
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
  notify();
}
export function softDeleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.deletedAt = new Date().toISOString();
  t.updatedAt = t.deletedAt;
  if (state.ui.selectedTaskId === id) state.ui.selectedTaskId = null;
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
