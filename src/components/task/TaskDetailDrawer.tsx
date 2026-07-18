import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
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
  const confirmingDelete = Boolean(task && confirmingDeleteId === task.id);

  useEffect(() => {
    if (!open || !task) return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
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

  async function handleDelete() {
    if (!task) return;
    await onDelete(task.id);
    setConfirmingDeleteId(null);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/20 backdrop-blur-[1px] dark:bg-black/50" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(100vw,460px)] overflow-y-auto border-l border-stone-200 bg-white p-6 shadow-2xl focus:outline-none dark:border-stone-800 dark:bg-stone-900 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Description className="text-xs font-medium tracking-[0.16em] text-stone-500 uppercase dark:text-stone-400">
                任务详情
              </Dialog.Description>
              <Dialog.Title className="mt-2 font-serif text-2xl font-semibold">
                编辑任务
              </Dialog.Title>
            </div>
            <Dialog.Close
              className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              aria-label="关闭任务详情"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
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
                rows={5}
                placeholder="补充必要信息"
                className="field-control resize-y"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
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

            <div className="space-y-2">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                标签
              </p>
              {tagsLoading ? (
                <p className="text-xs text-stone-400">正在读取标签关联</p>
              ) : tags.length === 0 ? (
                <p className="rounded-xl border border-dashed border-stone-200 px-3 py-4 text-center text-xs text-stone-400 dark:border-stone-700">
                  暂无标签，可在筛选面板中创建
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <label
                        key={tag.id}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                          selected
                            ? "border-emerald-900/30 bg-emerald-900/8 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-100"
                            : "border-stone-200 text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            if (!task) return;
                            setTagDraft({
                              taskId: task.id,
                              tagIds: selected
                                ? selectedTagIds.filter((id) => id !== tag.id)
                                : [...selectedTagIds, tag.id],
                            });
                          }}
                          className="accent-emerald-900"
                        />
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.color ?? "#78716c" }}
                        />
                        {tag.name}
                      </label>
                    );
                  })}
                </div>
              )}
              {tagError && (
                <p className="text-xs text-red-700">标签读取失败：{tagError}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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

            <p className="text-xs text-stone-400">
              创建于{" "}
              {task ? new Date(task.createdAt).toLocaleString("zh-CN") : "-"}
            </p>

            <div className="border-t border-stone-200 pt-5 dark:border-stone-800">
              {confirmingDelete ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
                  <p className="text-sm font-medium text-red-900 dark:text-red-200">
                    确认删除这条任务？
                  </p>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                    删除后不会出现在普通列表中。
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-stone-900 dark:text-red-200"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete()}
                      className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      确认删除
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => task && setConfirmingDeleteId(task.id)}
                    className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-700 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    删除任务
                  </button>
                  <button
                    type="submit"
                    disabled={busy || tagsLoading || !form.title.trim()}
                    className="rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-950 disabled:opacity-50"
                  >
                    保存并关闭
                  </button>
                </div>
              )}
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
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-stone-500 dark:text-stone-400"
      >
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
