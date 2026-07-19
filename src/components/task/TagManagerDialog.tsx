import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import {
  createTag,
  deleteTag,
  listTags,
  updateTag,
} from "../../services/tagService";
import type { Tag } from "../../types/database";

interface TagManagerDialogProps {
  open: boolean;
  tags: Tag[];
  onOpenChange: (open: boolean) => void;
  onTagsChange: (tags: Tag[]) => Promise<void>;
}

interface TagForm {
  id: string | null;
  name: string;
  color: string;
}

const emptyForm: TagForm = {
  id: null,
  name: "",
  color: "#047857",
};

export function TagManagerDialog({
  open,
  tags,
  onOpenChange,
  onTagsChange,
}: TagManagerDialogProps) {
  const [form, setForm] = useState<TagForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setForm(emptyForm);
      setError(null);
      setConfirmingDeleteId(null);
    }
    onOpenChange(nextOpen);
  }

  async function refreshTags() {
    await onTagsChange(await listTags());
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (form.id) {
        await updateTag({
          id: form.id,
          name: form.name,
          color: form.color,
        });
      } else {
        await createTag({ name: form.name, color: form.color });
      }
      await refreshTags();
      setForm(emptyForm);
    } catch (nextError) {
      setError(normalizeError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteTag(id);
      await refreshTags();
      if (form.id === id) setForm(emptyForm);
      setConfirmingDeleteId(null);
    } catch (nextError) {
      setError(normalizeError(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-overlay fixed inset-0 z-60 dark:bg-black/40" />
        <Dialog.Content className="glass-floating fixed top-1/2 left-1/2 z-70 max-h-[min(720px,calc(100vh-2rem))] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl p-5 focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="dialog-title">管理标签</Dialog.Title>
              <Dialog.Description className="body-copy mt-1">
                创建标签后，可在任务详情中进行关联。
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="关闭标签管理"
              className="glass-button rounded-lg p-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>

          <form
            onSubmit={handleSubmit}
            className="glass-surface mt-5 rounded-2xl p-4"
          >
            <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
              {form.id ? "编辑标签" : "新建标签"}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <label>
                <span className="sr-only">标签名称</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：开发"
                  className="field-control"
                  autoFocus
                />
              </label>
              <label className="glass-surface field-label flex min-h-11 items-center justify-center gap-2 rounded-xl px-3">
                <span>颜色</span>
                <input
                  type="color"
                  value={form.color}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                  aria-label="标签颜色"
                  className="size-6 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !form.name.trim()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-950 disabled:opacity-50 dark:bg-blue-500/75 dark:hover:bg-blue-400"
              >
                {form.id ? (
                  <Pencil aria-hidden="true" className="size-4" />
                ) : (
                  <Plus aria-hidden="true" className="size-4" />
                )}
                {form.id ? "保存" : "添加"}
              </button>
            </div>
            {form.id && (
              <button
                type="button"
                onClick={() => setForm(emptyForm)}
                className="meta-copy mt-2 hover:text-stone-900 dark:hover:text-stone-100"
              >
                取消编辑
              </button>
            )}
          </form>

          {error && (
            <div
              role="alert"
              className="glass-surface mt-4 rounded-2xl border-red-200/70 bg-red-50/55 px-4 py-3 text-sm text-red-800 dark:border-red-700/35 dark:bg-red-950/30 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <div className="mt-5 space-y-2" aria-label="标签列表">
            {tags.length === 0 ? (
              <div className="glass-surface body-copy flex min-h-32 flex-col items-center justify-center rounded-2xl border-dashed text-center">
                <Tags aria-hidden="true" className="mb-2 size-5" />
                还没有标签
              </div>
            ) : (
              tags.map((tag) => {
                const confirmingDelete = confirmingDeleteId === tag.id;
                return (
                  <div
                    key={tag.id}
                    className="glass-row flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full"
                      style={{ backgroundColor: tag.color ?? "#78716c" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[15px] leading-[22px] font-medium">
                      {tag.name}
                    </span>
                    {confirmingDelete ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-700">确认删除？</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDelete(tag.id)}
                          className="rounded-lg bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="rounded-lg px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setForm({
                              id: tag.id,
                              name: tag.name,
                              color: tag.color ?? "#047857",
                            });
                            setError(null);
                          }}
                          aria-label={`编辑标签 ${tag.name}`}
                          className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(tag.id)}
                          aria-label={`删除标签 ${tag.name}`}
                          className="rounded-lg p-2 text-stone-500 hover:bg-red-50 hover:text-red-700 dark:text-stone-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
