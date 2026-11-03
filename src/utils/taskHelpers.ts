import {
  Calendar,
  CheckCircle2,
  FolderOpen,
  Star,
  type LucideIcon,
} from "lucide-react";
import {
  getDefaultDueAtLocal,
  toDateKey,
  toDateTimeLocal,
  toLocalDateKey,
} from "./taskDates";
import { normalizeTags } from "./taskPrediction";
import { taskViewCopy } from "../constants/taskViews";
import { defaultTaskScope } from "../stores/taskStore";
import type { AppSettings, DefaultDueDate } from "../types/settings";
import type {
  RecurrenceFrequency,
  RecurringRule,
  SystemView,
  Task,
  TaskList,
  TaskScope,
} from "../types/database";

export interface TaskDraft {
  title: string;
  note: string;
  priority: 0 | 1 | 2;
  listId: string;
  scheduledDate: string;
  dueAt: string;
  remindBefore: number | null;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceMonthDay: number;
  generateAheadMinutes: number;
  generateAheadUnit: "hours" | "days";
  recurrenceEndAt: string;
  tagsInput: string;
}

export function getScopeTitle(scope: TaskScope, lists: TaskList[]): string {
  if (scope.kind === "view") return taskViewCopy[scope.view].title;
  return findList(lists, scope.listId)?.name ?? "我的清单";
}

export function isScopeActive(current: TaskScope, target: TaskScope): boolean {
  if (current.kind !== target.kind) return false;
  return current.kind === "view"
    ? current.view === (target as { kind: "view"; view: SystemView }).view
    : current.listId === (target as { kind: "list"; listId: string }).listId;
}

export function buildCounts(
  tasks: Task[],
  lists: TaskList[],
  showCompleted: boolean,
) {
  // 「全部任务」和清单角标必须和后端同名视图的过滤口径一致：始终排除归档，
  // 已完成只在用户打开「显示已完成」时计入。否则角标会比列表里的条数虚高。
  const inScope = (task: Task) =>
    task.status !== "archived" && (showCompleted || task.status !== "done");

  const views: Record<SystemView, number> = {
    all: tasks.filter(inScope).length,
    today: tasks.filter((task) => matchesViewCount(task, "today")).length,
    planned: tasks.filter((task) => matchesViewCount(task, "planned")).length,
    overdue: tasks.filter((task) => matchesViewCount(task, "overdue")).length,
    "no-date": tasks.filter((task) => matchesViewCount(task, "no-date")).length,
    important: tasks.filter((task) => matchesViewCount(task, "important"))
      .length,
    completed: tasks.filter((task) => task.status === "done").length,
    // allTasks 不含已软删除的任务，回收站角标恒为 0（侧栏对其隐藏角标）。
    deleted: 0,
  };
  const listCounts: Record<string, number> = {};
  for (const list of lists) {
    listCounts[list.id] = tasks.filter(
      (task) => task.listId === list.id && inScope(task),
    ).length;
  }
  return { views, lists: listCounts };
}

function matchesViewCount(task: Task, view: SystemView): boolean {
  if (task.status === "done" || task.status === "archived") return false;
  if (view === "today") {
    return taskPlanDateKey(task) === toDateKey(new Date());
  }
  if (view === "planned")
    return task.scheduledDate !== null || task.dueAt !== null;
  if (view === "overdue") {
    if (!task.dueAt) return false;
    return localDateKey(new Date(task.dueAt)) < localDateKey(new Date());
  }
  if (view === "no-date") return task.dueAt === null;
  if (view === "important") return task.priority === 2;
  return true;
}

function localDateKey(date: Date): string {
  return toDateKey(date);
}

function taskPlanDateKey(task: Task): string | null {
  return task.scheduledDate ?? toLocalDateKey(task.dueAt);
}

export function pickDefaultListId(scope: TaskScope, lists: TaskList[]): string {
  if (scope.kind === "list") return scope.listId;
  // 不偏置 "work"：该清单可能已被删除（issue #9），第一个剩余清单更可靠。
  return lists[0]?.id ?? "";
}

function findList(lists: TaskList[], id: string): TaskList | null {
  return lists.find((list) => list.id === id) ?? null;
}

export function emptyDraft(
  defaultListId: string,
  defaultReminderMinutes = 1440,
  defaultScheduledDate = "",
  /** F2 · T-10 甲组：来自设置的新建默认值。 */
  defaults?: {
    priority?: AppSettings["defaultPriority"];
    dueDate?: DefaultDueDate;
    title?: string;
  },
): TaskDraft {
  const useScheduledOnly = Boolean(defaultScheduledDate);
  // -1 表示「不预设」，回落到中优先级现状
  const presetPriority = defaults?.priority;
  const priority: 0 | 1 | 2 =
    presetPriority === 0 || presetPriority === 1 || presetPriority === 2
      ? presetPriority
      : 1;
  const fallbackDue = useScheduledOnly ? "" : getDefaultDueAtLocal();
  // 默认截止：none → 不预填；today/tomorrow/next_monday → 目标日沿用「现在+1小时」的钟点
  let dueAt = fallbackDue;
  if (!useScheduledOnly && defaults?.dueDate && defaults.dueDate !== "none") {
    const time = fallbackDue.split("T")[1] ?? "09:00";
    const due = new Date();
    if (defaults.dueDate === "tomorrow") due.setDate(due.getDate() + 1);
    if (defaults.dueDate === "next_monday") {
      due.setDate(due.getDate() + ((8 - due.getDay()) % 7 || 7));
    }
    dueAt = `${toLocalDateKey(due.toISOString()) ?? toDateKey(due)}T${time}`;
  }
  return {
    title: defaults?.title ?? "",
    note: "",
    priority,
    listId: defaultListId,
    scheduledDate: defaultScheduledDate,
    dueAt,
    remindBefore:
      useScheduledOnly || defaultReminderMinutes < 0
        ? null
        : defaultReminderMinutes,
    recurrenceFrequency: null,
    recurrenceInterval: 1,
    recurrenceWeekdays: [new Date().getDay()],
    recurrenceMonthDay: new Date().getDate(),
    generateAheadMinutes: 1440,
    generateAheadUnit: "days",
    recurrenceEndAt: "",
    tagsInput: "",
  };
}

export function createTaskDraft(
  task: Task | null,
  lists: TaskList[],
): TaskDraft {
  if (!task) return emptyDraft(pickDefaultListId(defaultTaskScope, lists));
  return {
    title: task.title,
    note: task.note ?? "",
    priority: task.priority,
    listId: task.listId,
    scheduledDate: task.scheduledDate ?? "",
    dueAt: toDateTimeLocal(task.dueAt),
    remindBefore: task.remindBefore,
    recurrenceFrequency: null,
    recurrenceInterval: 1,
    recurrenceWeekdays: [new Date(task.dueAt ?? Date.now()).getDay()],
    recurrenceMonthDay: new Date(task.dueAt ?? Date.now()).getDate(),
    generateAheadMinutes: 1440,
    generateAheadUnit: "days",
    recurrenceEndAt: "",
    tagsInput: task.tags.join(" "),
  };
}

export function recurringRuleDraft(rule: RecurringRule): TaskDraft {
  return {
    title: rule.title,
    note: rule.note ?? "",
    priority: rule.priority,
    listId: rule.listId,
    scheduledDate: toLocalDateKey(rule.firstDueAt) ?? "",
    dueAt: toDateTimeLocal(rule.firstDueAt),
    remindBefore: rule.remindBefore,
    recurrenceFrequency: rule.frequency,
    recurrenceInterval: rule.intervalCount,
    recurrenceWeekdays: rule.weekdays,
    recurrenceMonthDay: rule.monthDay ?? new Date(rule.firstDueAt).getDate(),
    generateAheadMinutes: rule.generateAheadMinutes,
    generateAheadUnit:
      rule.generateAheadMinutes % 1440 === 0 ? "days" : "hours",
    recurrenceEndAt: toDateTimeLocal(rule.endAt),
    tagsInput: "",
  };
}

export function getEmptyCopy(scope: TaskScope): {
  icon: LucideIcon;
  title: string;
  body: string;
} {
  if (scope.kind === "view") {
    const copy = taskViewCopy[scope.view];
    const icon =
      scope.view === "today"
        ? Calendar
        : scope.view === "completed"
          ? CheckCircle2
          : scope.view === "important"
            ? Star
            : FolderOpen;
    return { icon, title: copy.emptyTitle, body: copy.emptyBody };
  }
  return {
    icon: FolderOpen,
    title: "清单为空",
    body: "",
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

export interface QuickAddParsed {
  title: string;
  priority?: 0 | 1 | 2;
  listId?: string;
  tags: string[];
  dueAt: string | null;
  /**
   * dueAt 来自「到X」截止词（如「到周五」）：任务应从创建/查看日期跨天
   * 持续到 dueAt（跨天任务，便签区间逐日可见）。普通日期词（今天/周X）
   * 恒为 false——那只表达「某天要做」，不表达「持续到某天」。
   */
  dueIsDeadline: boolean;
  /**
   * 「从X到Y」或「X开始」里的起点日期键（YYYY-MM-DD）。null = 未显式写起点，
   * 由调用方按当前视图/今天决定。起点只在跨天任务里与 scheduledDate 配合。
   */
  startDateKey: string | null;
}

const weekdayNumber: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

/**
 * 自然语言快速添加解析：`#清单` `!高|!中|!低` `今天/明天/后天/周X/下周X`
 * `到周X`（截止词，跨天任务）`从X到Y` / `X开始`（显式起点）`HH:MM`。
 * 其余文本拼成标题；未识别的 token 一律保留，不打断输入。
 * 日期词与截止词占同一个槽位，先出现者生效（`到X` / `从X到Y` 生效时置
 * dueIsDeadline）。中文逗号/顿号/分号与空白都作分隔符便于口语式断句，
 * 但分隔符只在**两侧都是标题片段**时才留在标题里（中文标点原样保留，
 * 空白归一为单个空格）——`买牛奶，鸡蛋` 的逗号不会丢，`周报，今天开始`
 * 里被语法吃掉那半边的逗号才随 token 一起丢弃。
 */
export function parseQuickAddText(
  text: string,
  lists: TaskList[],
): QuickAddParsed {
  // token 与分隔符交替切出：分隔符要原样留着，供标题按上下文取舍
  const segments = text.trim().match(/[，、；\s]+|[^，、；\s]+/g) ?? [];
  let priority: 0 | 1 | 2 | undefined;
  let listId: string | undefined;
  const tags: string[] = [];
  let dateToken: string | undefined;
  let startDateKey: string | null = null;
  let dueIsDeadline = false;
  let timeToken: string | undefined;
  const titleParts: string[] = [];
  let pendingSeparator = "";

  for (const token of segments) {
    if (/^[，、；\s]+$/.test(token)) {
      pendingSeparator += token;
      continue;
    }
    // 进标题才算「用得上」：被语法消费的 token 会连同挂起的分隔符一起丢弃
    const separator = pendingSeparator;
    pendingSeparator = "";
    if (token.startsWith("#")) {
      const name = token.slice(1);
      const list = lists.find((item) => item.name === name);
      if (list) {
        listId = list.id;
        continue;
      }
      if (name.trim()) {
        tags.push(name.trim());
        continue;
      }
    }
    if (token.startsWith("!")) {
      const value = token.slice(1);
      if (value === "高") {
        priority = 2;
        continue;
      }
      if (value === "中") {
        priority = 1;
        continue;
      }
      if (value === "低") {
        priority = 0;
        continue;
      }
    }
    // 「从X到Y」：一个 token 同时给出起点与截止，是最贴近口语的跨天写法
    const spanMatch = token.match(
      /^从(今天|明天|后天|(?:下?周|星期)[一二三四五六日天])到(今天|明天|后天|(?:下?周|星期)[一二三四五六日天])$/,
    );
    if (spanMatch) {
      // 已有日期槽位时让位（首个日期词生效），但 token 仍然吞掉不进标题
      if (!dateToken && startDateKey === null) {
        startDateKey = resolveQuickAddStartDate(spanMatch[1]);
        dateToken = spanMatch[2];
        dueIsDeadline = true;
      }
      continue;
    }
    // 「X开始」只声明起点，不改变截止语义
    const startMatch = token.match(
      /^(今天|明天|后天|(?:下?周|星期)[一二三四五六日天])开始$/,
    );
    if (startMatch) {
      startDateKey ??= resolveQuickAddStartDate(startMatch[1]);
      continue;
    }
    if (
      /^(今天|明天|后天)$/.test(token) ||
      /^(下?周|星期)[一二三四五六日天]$/.test(token)
    ) {
      dateToken ??= token;
      continue;
    }
    if (/^到(今天|明天|后天|(下?周|星期)[一二三四五六日天])$/.test(token)) {
      // 「到X」截止词：吞掉不进标题；已有日期词时让位（首个日期词生效）
      const word = token.slice(1);
      if (!dateToken) {
        dateToken = word;
        dueIsDeadline = true;
      }
      continue;
    }
    if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(token)) {
      timeToken ??= token;
      continue;
    }
    if (titleParts.length > 0) {
      titleParts.push(joinTitleSeparator(separator));
    }
    titleParts.push(token);
  }

  let dueAt = resolveQuickAddDue(dateToken, timeToken);
  // 起点晚于截止（如「从下周一到周五」按当日口径解析出本周五早于下周一）：
  // 截止顺延整周（同周内的相对位置不变），而不是丢掉起点——丢起点会让
  // 「从下周一到周五」塌成「今天到本周五」，与用户说的不是一回事。
  const dueDateKey = toLocalDateKey(dueAt);
  if (startDateKey && dueAt && dueDateKey && startDateKey > dueDateKey) {
    const shifted = new Date(dueAt);
    shifted.setDate(shifted.getDate() + 7);
    dueAt = shifted.toISOString();
  }

  return {
    title: titleParts.join(""),
    priority,
    listId,
    tags: normalizeTags(tags),
    dueAt,
    dueIsDeadline,
    startDateKey,
  };
}

/** 标题片段之间的分隔符：纯空白归一为单个空格，含中文标点则原样保留。 */
function joinTitleSeparator(separator: string): string {
  const withoutPunctuation = separator.replace(/[，、；]/g, "");
  return withoutPunctuation === separator ? " " : separator.trim();
}

export function parseTagsInput(value: string): string[] {
  return normalizeTags(value.split(/[\s,，、]+/));
}

/** 日期词 → 当地 Date（保持当前时分；只解析日期，不处理时间词）。 */
function resolveQuickAddDate(dateToken: string): Date {
  const date = new Date();
  const today = new Date();
  if (dateToken === "今天") {
    // 保持当天
  } else if (dateToken === "明天") {
    date.setDate(date.getDate() + 1);
  } else if (dateToken === "后天") {
    date.setDate(date.getDate() + 2);
  } else {
    const match = dateToken.match(/^(下?周|星期)([一二三四五六日天])$/);
    if (match) {
      const target = weekdayNumber[match[2]];
      const isNextWeek = match[1] === "下周";
      let diff = target - (today.getDay() || 7);
      if (isNextWeek) diff += 7;
      else if (diff <= 0) diff += 7;
      date.setDate(today.getDate() + diff);
    }
  }
  return date;
}

/** 显式起点日期词 → YYYY-MM-DD（scheduledDate 只需要日期键，不含时刻）。 */
function resolveQuickAddStartDate(dateToken: string): string {
  return toDateKey(resolveQuickAddDate(dateToken));
}

/** 日期词 + 时间词 → ISO；无日期词时时间已过顺延到明天。 */
function resolveQuickAddDue(
  dateToken: string | undefined,
  timeToken: string | undefined,
): string | null {
  if (!dateToken && !timeToken) return null;

  const date = dateToken ? resolveQuickAddDate(dateToken) : new Date();

  if (timeToken) {
    const [hour, minute] = timeToken.split(":").map(Number);
    date.setHours(hour, minute, 0, 0);
    // 没写日期、时间已过 → 顺延到明天同一时间
    if (!dateToken && date.getTime() < Date.now()) {
      date.setDate(date.getDate() + 1);
    }
  } else {
    // 只写了日期没写时间：默认当天 9:00，已过则 23:59
    date.setHours(9, 0, 0, 0);
    if (date.getTime() < Date.now()) date.setHours(23, 59, 0, 0);
  }

  return date.toISOString();
}
