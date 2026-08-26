import type { CreateTaskInput, Task, UpdateTaskInput } from "../types/database";

/**
 * 乐观更新的本地预测函数，语义镜像 task_repository.rs
 * （create/update/set_completed/soft_delete/restore/snooze）。
 * 预测值仅用于即时渲染，IPC 成功后会被服务端返回的完整行替换。
 */

export function computeRemindAt(
  dueAt: string | null | undefined,
  remindBefore: number | null | undefined,
): string | null {
  if (!dueAt || remindBefore === null || remindBefore === undefined) {
    return null;
  }
  if (remindBefore <= 0) return dueAt;

  const dueTime = new Date(dueAt).getTime();
  if (Number.isNaN(dueTime)) return null;

  const remindTime = dueTime - remindBefore * 60_000;
  if (remindTime <= Date.now()) return null;
  return toRfc3339Seconds(new Date(remindTime));
}

export function toRfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cloneSubtasks(tasks: Task["subtasks"]): Task["subtasks"] {
  return tasks.map((subtask, index) => ({
    ...subtask,
    id: subtask.id || `subtask-${Date.now()}-${index}`,
    title: subtask.title.trim(),
    sortOrder: index,
  }));
}

export function normalizeTags(tags: string[]): string[] {
  const next: string[] = [];
  for (const tag of tags) {
    const value = tag.trim().replace(/^#/, "");
    if (!value || value.length > 40) continue;
    if (
      next.some(
        (item) =>
          item.toLocaleLowerCase("zh-CN") === value.toLocaleLowerCase("zh-CN"),
      )
    ) {
      continue;
    }
    next.push(value);
    if (next.length >= 30) break;
  }
  return next;
}

export function predictCreatedTask(input: CreateTaskInput, tempId: string): Task {
  const now = new Date().toISOString();
  const dueAt = input.dueAt ?? null;
  const remindBefore = input.remindBefore ?? null;
  return {
    id: tempId,
    title: input.title.trim(),
    note: input.note?.trim() || null,
    status: "todo",
    priority: input.priority ?? 1,
    listId: input.listId ?? "work",
    scheduledDate: input.scheduledDate ?? null,
    dueAt,
    completedAt: null,
    sortOrder: input.sortOrder ?? 0,
    remindBefore,
    remindAt: computeRemindAt(dueAt, remindBefore),
    remindedAt: null,
    repeatRule: input.repeatRule ?? null,
    subtasks: cloneSubtasks(input.subtasks ?? []),
    tags: normalizeTags(input.tags ?? []),
    recurringRuleId: null,
    occurrenceAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function predictUpdatedTask(existing: Task, input: UpdateTaskInput): Task {
  const reminderScheduleChanged =
    input.dueAt !== existing.dueAt ||
    input.remindBefore !== existing.remindBefore;
  return {
    ...existing,
    ...input,
    title: input.title.trim(),
    note: input.note?.trim() || null,
    // update 语义：完成时保留已有 completedAt，仅在为空时取当前时间
    completedAt:
      input.status === "done"
        ? (existing.completedAt ?? new Date().toISOString())
        : null,
    remindAt: computeRemindAt(input.dueAt, input.remindBefore),
    remindedAt: reminderScheduleChanged ? null : existing.remindedAt,
    subtasks: cloneSubtasks(input.subtasks),
    tags: normalizeTags(input.tags),
    updatedAt: new Date().toISOString(),
  };
}

// set_completed 语义：完成时总是覆盖为新的时间戳
export function predictCompletedTask(existing: Task, completed: boolean): Task {
  return {
    ...existing,
    status: completed ? "done" : "todo",
    completedAt: completed ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
}

export function predictDeletedTask(task: Task, nowIso: string): Task {
  return { ...task, deletedAt: nowIso, updatedAt: nowIso };
}

export function predictRestoredTask(task: Task, nowIso: string): Task {
  return { ...task, deletedAt: null, updatedAt: nowIso };
}

export function predictSnoozedTask(task: Task, remindAt: string): Task {
  return {
    ...task,
    remindAt,
    remindedAt: null,
    updatedAt: new Date().toISOString(),
  };
}
