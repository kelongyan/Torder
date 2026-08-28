import { useEffect, useRef, useState } from "react";
import {
  Check,
  CalendarDays,
  CalendarClock,
  MoreHorizontal,
  Plus,
  Repeat2,
  RotateCcw,
  SkipForward,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  formatTaskDateTime,
  formatTaskScheduleDate,
  fromDateTimeLocal,
  toDateTimeLocal,
  toLocalDateKey,
} from "../../utils/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy, priorityOptions } from "../../constants/taskConfig";
import {
  describeReminder,
  reminderOptions,
} from "../../constants/reminderConfig";
import { usePresence, type PresencePhase } from "../../hooks/usePresence";
import type {
  Task,
  TaskList,
  TaskSubtask,
  UpdateTaskInput,
} from "../../types/database";
import type { ToastKind } from "../../types/ui";
import { parseTagsInput } from "../../utils/taskHelpers";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";
import { TaskDateField } from "../task/TaskDateField";
import { TaskDateTimeField } from "../task/TaskDateTimeField";
import { TaskAttachmentSection } from "./TaskAttachmentSection";
import { TaskLinkSection } from "./TaskLinkSection";

type EditingField =
  | "title"
  | "note"
  | "listId"
  | "priority"
  | "scheduledDate"
  | "dueAt"
  | "remindBefore";

export function TaskDetailPanel({
  task,
  lists,
  busy,
  onClose,
  onSave,
  onToggle,
  onDelete,
  onOpenRecurring,
  onOpenTask,
  onToast,
}: {
  task: Task | null;
  lists: TaskList[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateTaskInput) => Promise<void> | void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onOpenRecurring: (task: Task) => void;
  onOpenTask: (taskId: string) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const detailPresence = usePresence(task, 320);
  const presentTask = detailPresence.value;

  return (
    <div
      className={`dialog-overlay detail-overlay ${
        detailPresence.rendered ? detailPresence.className : "hidden"
      }`}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {presentTask && (
        <TaskDetailContent
          key={presentTask.id}
          task={presentTask}
          lists={lists}
          busy={busy}
          presence={detailPresence.phase}
          onClose={onClose}
          onSave={onSave}
          onToggle={onToggle}
          onDelete={onDelete}
          onOpenRecurring={onOpenRecurring}
          onOpenTask={onOpenTask}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function TaskDetailContent({
  task,
  lists,
  busy,
  presence,
  onClose,
  onSave,
  onToggle,
  onDelete,
  onOpenRecurring,
  onOpenTask,
  onToast,
}: {
  task: Task;
  lists: TaskList[];
  busy: boolean;
  presence: PresencePhase;
  onClose: () => void;
  onSave: (input: UpdateTaskInput) => Promise<void> | void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onOpenRecurring: (task: Task) => void;
  onOpenTask: (taskId: string) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [editing, setEditing] = useState<EditingField | null>(null);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftNote, setDraftNote] = useState(task.note ?? "");
  const [draftTagInput, setDraftTagInput] = useState(task.tags.join(" "));
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const morePresence = usePresence(moreOpen, 180);

  function startEdit(field: EditingField) {
    setDraftTitle(task.title);
    setDraftNote(task.note ?? "");
    setEditing(field);
  }

  useEffect(() => {
    if (editing === "title") titleInputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!moreOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [moreOpen]);

  const list = lists.find((item) => item.id === task.listId) ?? null;
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;
  const priorityColor =
    priorityOptions.find((option) => option.value === task.priority)?.color ??
    "var(--blue)";

  function patchAndSave(patch: Partial<Omit<UpdateTaskInput, "id">>) {
    return onSave({
      id: task.id,
      title: task.title,
      note: task.note,
      status: task.status,
      priority: task.priority,
      listId: task.listId,
      scheduledDate: task.scheduledDate,
      dueAt: task.dueAt,
      sortOrder: task.sortOrder,
      remindBefore: task.remindBefore,
      repeatRule: task.repeatRule,
      subtasks: task.subtasks,
      tags: task.tags,
      ...patch,
    });
  }

  function saveTitle() {
    if (!draftTitle.trim()) {
      setDraftTitle(task.title);
      setEditing(null);
      return;
    }
    if (draftTitle.trim() !== task.title) {
      void patchAndSave({ title: draftTitle.trim() });
    }
    setEditing(null);
  }

  function saveTags() {
    const tags = parseTagsInput(draftTagInput);
    if (tags.join("\n") !== task.tags.join("\n")) {
      void patchAndSave({ tags });
    }
  }

  function addSubtask() {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const next: TaskSubtask = {
      id: `subtask-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      completed: false,
      createdAt: now,
      completedAt: null,
      sortOrder: task.subtasks.length,
    };
    setNewSubtaskTitle("");
    void patchAndSave({ subtasks: [...task.subtasks, next] });
  }

  function toggleSubtask(subtask: TaskSubtask) {
    const completed = !subtask.completed;
    const subtasks = task.subtasks.map((item) =>
      item.id === subtask.id
        ? {
            ...item,
            completed,
            completedAt: completed ? new Date().toISOString() : null,
          }
        : item,
    );
    void patchAndSave({ subtasks });
  }

  function removeSubtask(subtask: TaskSubtask) {
    void patchAndSave({
      subtasks: task.subtasks
        .filter((item) => item.id !== subtask.id)
        .map((item, index) => ({ ...item, sortOrder: index })),
    });
  }

  function postponeOccurrence(days: number) {
    const dueAt = shiftDueAt(task.dueAt, days);
    void patchAndSave({ dueAt, scheduledDate: toLocalDateKey(dueAt) });
  }

  function postponeOccurrenceToWorkday() {
    const dueAt = nextWorkdayDueAt(task.dueAt);
    void patchAndSave({ dueAt, scheduledDate: toLocalDateKey(dueAt) });
  }

  const completedSubtasks = task.subtasks.filter(
    (subtask) => subtask.completed,
  ).length;
  const subtaskProgress =
    task.subtasks.length === 0
      ? 0
      : Math.round((completedSubtasks / task.subtasks.length) * 100);

  function saveNote() {
    const next = draftNote.trim() || null;
    if (next !== task.note) {
      void patchAndSave({ note: next });
    }
    setEditing(null);
  }

  return (
    <section
      className={`detail-dialog ${
        presence === "exit" ? "is-exiting" : "is-entering"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="任务详情"
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) {
          e.stopPropagation();
          setEditing(null);
          setDraftTitle(task.title);
          setDraftNote(task.note ?? "");
        }
      }}
    >
      <header className="detail-topbar">
        <span>任务详情</span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="detail-dialog-body">
        {editing === "title" ? (
          <div className="detail-title-editing">
            <span className="detail-field-editing-label">任务名称</span>
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveTitle();
                }
              }}
              onBlur={saveTitle}
            />
          </div>
        ) : (
          <button
            type="button"
            className="detail-title"
            onClick={() => startEdit("title")}
          >
            <span>{task.title}</span>
          </button>
        )}

        {editing === "note" ? (
          <div className="detail-note-editing">
            <span className="detail-field-editing-label">描述</span>
            <textarea
              autoFocus
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  saveNote();
                }
              }}
              onBlur={saveNote}
              rows={3}
            />
          </div>
        ) : (
          <button
            type="button"
            className="detail-note"
            onClick={() => startEdit("note")}
          >
            {task.note || <span className="detail-empty">无描述</span>}
          </button>
        )}

        <div className="detail-attr-grid">
          {editing === "priority" ? (
            <div className="detail-attr-cell detail-attr-editing">
              <span className="detail-attr-label">优先级</span>
              <SegmentedControl
                value={task.priority}
                options={priorityOptions}
                onChange={(priority) => {
                  if (priority !== task.priority) {
                    void patchAndSave({ priority });
                  }
                  setEditing(null);
                }}
                ariaLabel="优先级"
              />
            </div>
          ) : (
            <button
              type="button"
              className="detail-attr-cell"
              onClick={() => startEdit("priority")}
            >
              <span className="detail-attr-label">优先级</span>
              <span className="detail-attr-value">
                <span
                  className="detail-attr-dot"
                  style={{ background: priorityColor }}
                />
                {priorityCopy[task.priority].label}
              </span>
            </button>
          )}

          {editing === "listId" ? (
            <div className="detail-attr-cell detail-attr-editing">
              <span className="detail-attr-label">所属清单</span>
              <Select<string>
                value={task.listId}
                options={lists.map((item) => ({
                  value: item.id,
                  label: item.name,
                  dotColor: item.color ?? DEFAULT_LIST_COLOR,
                }))}
                onChange={(listId) => {
                  if (listId !== task.listId) {
                    void patchAndSave({ listId });
                  }
                  setEditing(null);
                }}
                ariaLabel="所属清单"
              />
            </div>
          ) : (
            <button
              type="button"
              className="detail-attr-cell"
              onClick={() => startEdit("listId")}
            >
              <span className="detail-attr-label">所属清单</span>
              <span className="detail-attr-value">
                <span
                  className="detail-attr-dot"
                  style={{ background: listColor }}
                />
                {list?.name ?? "未分类"}
              </span>
            </button>
          )}

          {editing === "scheduledDate" ? (
            <div className="detail-attr-cell detail-attr-editing">
              <span className="detail-attr-label">计划日期</span>
              <TaskDateField
                value={task.scheduledDate ?? ""}
                onChange={(scheduledDate) => {
                  void patchAndSave({
                    scheduledDate: scheduledDate || null,
                  });
                  setEditing(null);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="detail-attr-cell"
              onClick={() => startEdit("scheduledDate")}
            >
              <span className="detail-attr-label">计划日期</span>
              <span className="detail-attr-value">
                <CalendarDays aria-hidden="true" className="icon-sm" />
                {task.scheduledDate ? (
                  formatTaskScheduleDate(task.scheduledDate)
                ) : (
                  <span className="detail-empty">未安排</span>
                )}
              </span>
            </button>
          )}

          {editing === "dueAt" ? (
            <div className="detail-attr-cell detail-attr-editing">
              <span className="detail-attr-label">截止时间</span>
              <TaskDateTimeField
                value={task.dueAt ? toDateTimeLocal(task.dueAt) : ""}
                onChange={(dueAt) => {
                  void patchAndSave({ dueAt: fromDateTimeLocal(dueAt) });
                  setEditing(null);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="detail-attr-cell"
              onClick={() => startEdit("dueAt")}
            >
              <span className="detail-attr-label">截止时间</span>
              <span className="detail-attr-value">
                {task.dueAt ? (
                  formatTaskDateTime(task.dueAt)
                ) : (
                  <span className="detail-empty">未设置</span>
                )}
              </span>
            </button>
          )}

          {editing === "remindBefore" ? (
            <div className="detail-attr-cell detail-attr-editing">
              <span className="detail-attr-label">提醒</span>
              <Select<number>
                value={task.remindBefore ?? -1}
                options={reminderOptions}
                onChange={(value) => {
                  const remindBefore = value < 0 ? null : value;
                  if (remindBefore !== task.remindBefore) {
                    void patchAndSave({ remindBefore });
                  }
                  setEditing(null);
                }}
                ariaLabel="提醒时间"
              />
            </div>
          ) : (
            <button
              type="button"
              className="detail-attr-cell"
              onClick={() => startEdit("remindBefore")}
            >
              <span className="detail-attr-label">提醒</span>
              <span className="detail-attr-value">
                {task.dueAt ? (
                  describeReminder(task.remindBefore)
                ) : (
                  <span className="detail-empty">未设置</span>
                )}
              </span>
            </button>
          )}

          <button
            type="button"
            className="detail-attr-cell"
            onClick={() => onOpenRecurring(task)}
          >
            <span className="detail-attr-label">循环</span>
            <span className="detail-attr-value">
              <Repeat2 aria-hidden="true" className="icon-sm" />
              {task.recurringRuleId ? "查看循环规则" : "设为循环任务"}
            </span>
          </button>
        </div>

        <section className="detail-section">
          <div className="detail-section-header">
            <strong>检查清单</strong>
            {task.subtasks.length > 0 && (
              <span>
                {completedSubtasks}/{task.subtasks.length} · {subtaskProgress}%
              </span>
            )}
          </div>
          {task.subtasks.length > 0 && (
            <div className="subtask-progress" aria-hidden="true">
              <span style={{ width: `${subtaskProgress}%` }} />
            </div>
          )}
          <div className="subtask-list">
            {task.subtasks.map((subtask) => (
              <div
                key={subtask.id}
                className={`subtask-row ${subtask.completed ? "completed" : ""}`}
              >
                <button
                  type="button"
                  className={`task-check compact ${subtask.completed ? "checked" : ""}`}
                  onClick={() => toggleSubtask(subtask)}
                  aria-label={subtask.completed ? "恢复子任务" : "完成子任务"}
                >
                  {subtask.completed && <Check aria-hidden="true" />}
                </button>
                <span>{subtask.title}</span>
                <button
                  type="button"
                  className="icon-button compact"
                  onClick={() => removeSubtask(subtask)}
                  aria-label="删除子任务"
                  title="删除子任务"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <form
            className="subtask-add-row"
            onSubmit={(event) => {
              event.preventDefault();
              addSubtask();
            }}
          >
            <input
              value={newSubtaskTitle}
              onChange={(event) => setNewSubtaskTitle(event.target.value)}
            />
            <button
              type="submit"
              className="icon-button"
              aria-label="添加子任务"
            >
              <Plus aria-hidden="true" />
            </button>
          </form>
        </section>

        <TaskAttachmentSection taskId={task.id} onToast={onToast} />

        <TaskLinkSection
          task={task}
          lists={lists}
          onOpenTask={onOpenTask}
          onToast={onToast}
        />

        <section className="detail-section">
          <div className="detail-section-header">
            <strong>标签</strong>
            <Tag aria-hidden="true" className="icon-sm" />
          </div>
          <input
            className="detail-tags-input"
            value={draftTagInput}
            onChange={(event) => setDraftTagInput(event.target.value)}
            onBlur={saveTags}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveTags();
              }
            }}
          />
          {task.tags.length > 0 && (
            <div className="task-tags">
              {task.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
          )}
        </section>

        <div className="detail-meta-row">
          <span
            className={`status-pill ${task.status === "done" ? "done" : ""}`}
          >
            {task.status === "done" ? "已完成" : "进行中"}
          </span>
          <span className="detail-meta">
            创建于 {formatTaskDateTime(task.createdAt)} · 更新于{" "}
            {formatTaskDateTime(task.updatedAt)}
          </span>
        </div>
      </div>

      <footer className="detail-dialog-footer">
        <button
          type="button"
          className={`btn-complete ${task.status === "done" ? "done" : ""}`}
          disabled={busy}
          onClick={() => onToggle(task)}
        >
          {task.status === "done" ? (
            <RotateCcw aria-hidden="true" className="icon-sm" />
          ) : (
            <Check aria-hidden="true" className="icon-sm" />
          )}
          {task.status === "done" ? "恢复" : "标记完成"}
        </button>
        <div className="detail-more" ref={moreRef}>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="更多操作"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {morePresence.rendered && (
            <div
              className={`detail-more-menu ${
                morePresence.phase === "exit" ? "is-exiting" : "is-entering"
              }`}
              role="menu"
            >
              {task.recurringRuleId && (
                <>
                  <button type="button" onClick={() => postponeOccurrence(1)}>
                    <CalendarClock aria-hidden="true" className="icon-sm" />
                    本次顺延到明天
                  </button>
                  <button type="button" onClick={postponeOccurrenceToWorkday}>
                    <CalendarClock aria-hidden="true" className="icon-sm" />
                    本次顺延到工作日
                  </button>
                  <button type="button" onClick={() => onDelete(task)}>
                    <SkipForward aria-hidden="true" className="icon-sm" />
                    跳过本次循环
                  </button>
                </>
              )}
              <button type="button" onClick={() => onDelete(task)}>
                <Trash2 aria-hidden="true" className="icon-sm" />
                删除任务
              </button>
            </div>
          )}
        </div>
      </footer>
    </section>
  );
}

function shiftDueAt(dueAt: string | null, days: number): string {
  const date = dueAt ? new Date(dueAt) : new Date();
  if (!dueAt) date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function nextWorkdayDueAt(dueAt: string | null): string {
  const date = dueAt ? new Date(dueAt) : new Date();
  if (!dueAt) date.setHours(9, 0, 0, 0);
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return date.toISOString();
}
