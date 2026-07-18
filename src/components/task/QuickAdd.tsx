import { forwardRef, useState } from "react";
import { Plus } from "lucide-react";
import type { TaskView } from "../../types/database";

interface QuickAddProps {
  view: TaskView;
  disabled: boolean;
  onCreate: (title: string) => Promise<void>;
}

export const QuickAdd = forwardRef<HTMLInputElement, QuickAddProps>(
  function QuickAdd({ view, disabled, onCreate }, ref) {
    const [title, setTitle] = useState("");
    const available = view === "today" || view === "all";

    if (!available) return null;

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const nextTitle = title.trim();
      if (!nextTitle || disabled) return;
      await onCreate(nextTitle);
      setTitle("");
    }

    return (
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="quick-add-task">
          快速添加任务
        </label>
        <input
          ref={ref}
          id="quick-add-task"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={
            view === "today"
              ? "添加今天要做的事，按 Enter 创建"
              : "添加一条任务，按 Enter 创建"
          }
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-4 text-sm shadow-sm outline-none transition focus:border-emerald-800 focus:ring-3 focus:ring-emerald-900/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={disabled || !title.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-emerald-700 dark:hover:bg-emerald-600"
        >
          <Plus aria-hidden="true" className="size-4" />
          添加任务
        </button>
      </form>
    );
  },
);
