import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Trash2, X } from "lucide-react";
import { fromDateTimeLocal, toDateTimeLocal } from "../../app/taskDates";
import { listTaskTagIds } from "../../services/taskService";
import type {
  Tag,
  Task,
  TaskList,
  UpdateTaskInput,
} from "../../types/database";

interface TaskDetailDrawerProps {
  task: Task | null;
  lists: TaskList[];
  tags: Tag[];
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpdateTaskInput, tagIds: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface TaskForm {
  title: string;
  note: string;
  priority: string;
  listId: string;
  dueAt: string;
  remindAt: string;
}

const emptyForm: TaskForm = {
  title: "",
  note: "",
  priority: "0",
  listId: "inbox",
  dueAt: "",
  remindAt: "",
};

export function TaskDetailDrawer({
  task,
  lists,
  tags,
  open,
  busy,
  onOpenChange,
  onSave,
  onDelete,
}: TaskDetailDrawerProps) {
  const [draft, setDraft] = useState<{
    taskId: string;
    form: TaskForm;
  } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTimerRef = useRef<number | null>(null);
  const [tagDraft, setTagDraft] = useState<{
    taskId: string;
    tagIds: string[];
  } | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const form =
    task && draft?.taskId === task.id ? draft.form : taskToForm(task);
  const selectedTagIds =
    task && tagDraft?.taskId === task.id ? tagDraft.tagIds : [];

  useEffect(() => {
    if (!open || !task) return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      setConfirmingDelete(false);
      setTagsLoading(true);
      setTagError(null);
      try {
        const tagIds = await listTaskTagIds(task.id);
        if (!cancelled) setTagDraft({ taskId: task.id, tagIds });
      } catch (error) {
        if (!cancelled) {
          setTagError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setTagsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, task]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    };
  }, []);

  function updateForm(update: (current: TaskForm) => TaskForm) {
    if (!task) return;
    setDraft({ taskId: task.id, form: update(form) });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || !form.title.trim()) return;
    await onSave(
      {
        id: task.id,
        title: form.title.trim(),
        note: form.note.trim() || null,
        status: task.status,
        priority: Number(form.priority) as Task["priority"],
        listId: form.listId,
        dueAt: fromDateTimeLocal(form.dueAt),
        remindAt: fromDateTimeLocal(form.remindAt),
        sortOrder: task.sortOrder,
      },
      selectedTagIds,
    );
  }

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      deleteTimerRef.current = window.setTimeout(
        () => setConfirmingDelete(false),
        3000,
      );
      return;
    }
    if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    if (task) void onDelete(task.id);
    setConfirmingDelete(false);
  }

  function toggleTag(tagId: string) {
    if (!task) return;
    setTagDraft({
      taskId: task.id,
      tagIds: selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId],
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-overlay overlay-enter fixed inset-0 z-[var(--z-drawer-overlay)] data-[state=closed]:overlay-exit" />
        <Dialog.Content className="glass-floating drawer-enter fixed inset-y-2 right-2 z-[var(--z-drawer)] flex w-[min(calc(100vw-1rem),440px)] flex-col overflow-hidden rounded-[var(--radius-xl)] focus:outline-none data-[state=closed]:drawer-exit sm:inset-y-3 sm:right-3">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
            <div>
              <Dialog.Description className="eyebrow">
                任务详情
              </Dialog.Description>
              <Dialog.Title className="dialog-title mt-1">
                编辑任务
              </Dialog.Title>
            </div>
            <Dialog.Close
              className="glass-button rounded-[var(--radius-md)] p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="关闭任务详情"
            >
              <X aria-hidden="true" className="size-4.5" />
            </Dialog.Close>
          </div>

          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={handleSubmit}
          >
            {/* Scrollable body */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5 sm:px-6">
              {/* Section: basic info */}
              <div className="glass-surface space-y-3 rounded-[var(--radius-lg)] p-4">
                <Field label="标题" htmlFor="task-title">
                  <input
                    id="task-title"
                    value={form.title}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    className="field-control"
                  />
                </Field>

                <Field label="备注" htmlFor="task-note">
                  <textarea
                    id="task-note"
                    value={form.note}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="补充必要信息"
                    className="field-control resize-y"
                  />
                </Field>
              </div>

              {/* Section: classification */}
              <div className="glass-surface space-y-3 rounded-[var(--radius-lg)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="清单" htmlFor="task-list">
                    <select
                      id="task-list"
                      value={form.listId}
                      onChange={(event) =>
                        updateForm((current) => ({
                          ...current,
                          listId: event.target.value,
                        }))
                      }
                      className="field-control"
                    >
                      {lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="优先级" htmlFor="task-priority">
                    <select
                      id="task-priority"
                      value={form.priority}
                      onChange={(event) =>
                        updateForm((current) => ({
                          ...current,
                          priority: event.target.value,
                        }))
                      }
                      className="field-control"
                    >
                      <option value="0">普通</option>
                      <option value="1">重要</option>
                      <option value="2">紧急</option>
                    </select>
                  </Field>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <p className="field-label">标签</p>
                  {tagsLoading ? (
                    <p className="meta-copy">正在读取标签关联</p>
                  ) : tags.length === 0 ? (
                    <p className="meta-copy rounded-[var(--radius-sm)] border border-dashed border-[var(--glass-border-muted)] px-3 py-3 text-center">
                      暂无标签，可在筛选面板中创建
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => {
                        const selected = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            aria-pressed={selected}
                            className={`chip ${selected ? "chip-active" : ""}`}
                          >
                            {selected && (
                              <Check aria-hidden="true" className="size-3" />
                            )}
                            <span
                              aria-hidden="true"
                              className="size-2 rounded-full"
                              style={{
                                backgroundColor: tag.color ?? "#78716c",
                              }}
                            />
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {tagError && (
                    <p className="meta-copy text-[var(--status-danger)]">
                      标签读取失败：{tagError}
                    </p>
                  )}
                </div>
              </div>

              {/* Section: time */}
              <div className="glass-surface rounded-[var(--radius-lg)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="截止时间" htmlFor="task-due-at">
                    <input
                      id="task-due-at"
                      type="datetime-local"
                      value={form.dueAt}
                      onChange={(event) =>
                        updateForm((current) => ({
                          ...current,
                          dueAt: event.target.value,
                        }))
                      }
                      className="field-control"
                    />
                  </Field>

                  <Field label="提醒时间" htmlFor="task-remind-at">
                    <input
                      id="task-remind-at"
                      type="datetime-local"
                      value={form.remindAt}
                      onChange={(event) =>
                        updateForm((current) => ({
                          ...current,
                          remindAt: event.target.value,
                        }))
                      }
                      className="field-control"
                    />
                  </Field>
                </div>
              </div>

              <p className="meta-copy tabular-nums px-1">
                创建于{" "}
                {task ? new Date(task.createdAt).toLocaleString("zh-CN") : "-"}
              </p>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-[var(--glass-border-muted)] bg-[var(--glass-panel-strong)] px-5 py-3.5 backdrop-blur-xl sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={busy}
                  className={`btn-danger transition-colors ${
                    confirmingDelete
                      ? "bg-[var(--status-danger)] text-white hover:bg-[var(--status-danger)]"
                      : ""
                  }`}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  {confirmingDelete ? "确认删除？" : "删除任务"}
                </button>
                <button
                  type="submit"
                  disabled={busy || tagsLoading || !form.title.trim()}
                  className="btn-primary"
                >
                  保存并关闭
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
    </div>
  );
}

function taskToForm(task: Task | null): TaskForm {
  if (!task) return emptyForm;
  return {
    title: task.title,
    note: task.note ?? "",
    priority: String(task.priority),
    listId: task.listId,
    dueAt: toDateTimeLocal(task.dueAt),
    remindAt: toDateTimeLocal(task.remindAt),
  };
}
