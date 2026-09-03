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
export type TaskSortBy = "priority" | "date" | "created" | "manual";
export type SortDirection = "asc" | "desc";
export type TaskPriority = 0 | 1 | 2;

export type TaskScope =
  { kind: "view"; view: SystemView } | { kind: "list"; listId: string };

/**
 * R04 筛选面板的多选模型。
 * 组内取「或」、组间取「与」：listIds 命中其一即可，同时还要满足 tags 与
 * priorities 各自（非空时）的条件。includeCompleted 与既有 showCompleted
 * 取「或」——任一侧为真就显示已完成任务。
 */
export interface TaskFilter {
  listIds: string[];
  tags: string[];
  priorities: TaskPriority[];
  includeCompleted: boolean;
}

export const emptyTaskFilter: TaskFilter = {
  listIds: [],
  tags: [],
  priorities: [],
  includeCompleted: false,
};

/** 底栏回显用的条件数（与设计稿「N 个条件」一致）。 */
export function countTaskFilter(filter: TaskFilter): number {
  return (
    filter.listIds.length +
    filter.tags.length +
    filter.priorities.length +
    (filter.includeCompleted ? 1 : 0)
  );
}

export interface TaskSubtask {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  sortOrder: number;
}

export interface Task {
  id: string;
  title: string;
  note: string | null;
  status: "todo" | "done" | "archived";
  priority: TaskPriority;
  listId: string;
  scheduledDate: string | null;
  dueAt: string | null;
  completedAt: string | null;
  sortOrder: number;
  remindBefore: number | null;
  remindAt: string | null;
  remindedAt: string | null;
  repeatRule: string | null;
  subtasks: TaskSubtask[];
  tags: string[];
  recurringRuleId: string | null;
  occurrenceAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  priority?: TaskPriority;
  listId?: string;
  scheduledDate?: string | null;
  dueAt?: string | null;
  sortOrder?: number;
  remindBefore?: number | null;
  repeatRule?: string | null;
  subtasks?: TaskSubtask[];
  tags?: string[];
}

export interface UpdateTaskInput {
  id: string;
  title: string;
  note: string | null;
  status: Task["status"];
  priority: TaskPriority;
  listId: string;
  scheduledDate: string | null;
  dueAt: string | null;
  sortOrder: number;
  remindBefore: number | null;
  repeatRule: string | null;
  subtasks: TaskSubtask[];
  tags: string[];
}

export interface TaskLink {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: "reference";
  sortOrder: number;
  targetTitle: string | null;
  targetStatus: Task["status"] | null;
  targetListId: string | null;
  targetScheduledDate: string | null;
  targetDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTaskLinkInput {
  sourceTaskId: string;
  targetTaskId: string;
}

export type AttachmentKind = "managed" | "localReference" | "webLink";

export type AttachmentSyncState =
  | "pendingUpload"
  | "uploaded"
  | "pendingDownload"
  | "downloaded"
  | "missing"
  | "failed";

export interface AttachmentBlob {
  id: string;
  contentSha256: string;
  sizeBytes: number;
  mimeType: string | null;
  localRelativePath: string;
  remotePath: string | null;
  encryptionKeyId: string | null;
  syncState: AttachmentSyncState;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Attachment {
  id: string;
  taskId: string;
  kind: AttachmentKind;
  blobId: string | null;
  displayName: string;
  originalName: string | null;
  externalUrl: string | null;
  contentSha256: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  localRelativePath: string | null;
  remotePath: string | null;
  encryptionKeyId: string | null;
  syncState: AttachmentSyncState | null;
  lastError: string | null;
  localPath: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateAttachmentInput {
  taskId: string;
  sourcePath: string;
  displayName?: string | null;
}

export interface CreateWebLinkAttachmentInput {
  taskId: string;
  url: string;
  displayName: string;
}

export interface AttachmentTransferStatus {
  pendingUpload: number;
  pendingDownload: number;
  failed: number;
  missing: number;
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
  priority: TaskPriority;
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
  priority: TaskPriority;
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

export type CalendarEventType = "leave" | "trip" | "other";

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
