export interface DatabaseStatus {
  databasePath: string;
  schemaVersion: number;
  listCount: number;
  taskCount: number;
}

export type SystemView =
  | "all"
  | "today"
  | "planned"
  | "overdue"
  | "no-date"
  | "important"
  | "completed"
  | "deleted";
export type TaskLayout = "list" | "board" | "calendar" | "month" | "week";
export type TaskSortBy = "priority" | "date" | "created";

export type TaskScope =
  { kind: "view"; view: SystemView } | { kind: "list"; listId: string };

export interface Task {
  id: string;
  title: string;
  note: string | null;
  status: "todo" | "done" | "archived";
  priority: 0 | 1 | 2;
  listId: string;
  dueAt: string | null;
  completedAt: string | null;
  sortOrder: number;
  remindBefore: number | null;
  remindAt: string | null;
  remindedAt: string | null;
  repeatRule: string | null;
  recurringRuleId: string | null;
  occurrenceAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  priority?: 0 | 1 | 2;
  listId?: string;
  dueAt?: string | null;
  sortOrder?: number;
  remindBefore?: number | null;
  repeatRule?: string | null;
}

export interface UpdateTaskInput {
  id: string;
  title: string;
  note: string | null;
  status: Task["status"];
  priority: Task["priority"];
  listId: string;
  dueAt: string | null;
  sortOrder: number;
  remindBefore: number | null;
  repeatRule: string | null;
}

export interface TaskList {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "quarterly";

export interface RecurringRule {
  id: string;
  title: string;
  note: string | null;
  priority: 0 | 1 | 2;
  listId: string;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  weekdays: number[];
  monthDay: number | null;
  firstDueAt: string;
  nextDueAt: string | null;
  timezone: string;
  generateAheadMinutes: number;
  remindBefore: number | null;
  endAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateRecurringRuleInput {
  sourceTaskId?: string | null;
  title: string;
  note?: string | null;
  priority: 0 | 1 | 2;
  listId: string;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  weekdays: number[];
  monthDay: number | null;
  firstDueAt: string;
  timezone: string;
  generateAheadMinutes: number;
  remindBefore: number | null;
  endAt: string | null;
}

export interface UpdateRecurringRuleInput extends Omit<
  CreateRecurringRuleInput,
  "sourceTaskId"
> {
  id: string;
}

export interface RecurringGenerationResult {
  generatedCount: number;
}

export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}

export type CalendarEventType = "leave" | "trip";

export interface CalendarEvent {
  id: string;
  title: string;
  eventType: CalendarEventType;
  startDate: string;
  endDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCalendarEventInput {
  title: string;
  eventType: CalendarEventType;
  startDate: string;
  endDate: string;
  note?: string | null;
}

export interface UpdateCalendarEventInput {
  id: string;
  title: string;
  eventType: CalendarEventType;
  startDate: string;
  endDate: string;
  note: string | null;
}
