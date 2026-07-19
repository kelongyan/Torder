import { forwardRef, useState } from "react";
import { ArrowUp, ListPlus } from "lucide-react";
import type { TaskView } from "../../types/database";

interface QuickAddProps {
  view: TaskView;
  disabled: boolean;
  onCreate: (title: string) => Promise<void>;
  onEscape?: () => void;
}

export const QuickAdd = forwardRef<HTMLInputElement, QuickAddProps>(
  function QuickAdd({ view, disabled, onCreate, onEscape }, ref) {
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
      <form onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="quick-add-task">
          快速添加任务
        </label>
        <div className="flex min-h-14 items-center gap-2 rounded-[14px] border border-[var(--glass-border-muted)] bg-white/40 p-1.5 pl-2 shadow-[inset_0_1px_0_var(--glass-highlight)] transition focus-within:border-emerald-800/35 focus-within:bg-white/65 dark:bg-white/5 dark:focus-within:border-blue-300/25 dark:focus-within:bg-white/8">
          <span className="grid size-9 shrink-0 place-items-center text-emerald-900 dark:text-blue-300">
            <ListPlus aria-hidden="true" className="size-[18px]" />
          </span>
          <input
            ref={ref}
            id="quick-add-task"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && onEscape) {
                event.preventDefault();
                onEscape();
              }
            }}
            placeholder={view === "today" ? "今天要做什么？" : "输入事项…"}
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-[15px] leading-6 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
          />
          <button
            type="submit"
            disabled={disabled || !title.trim()}
            aria-label="添加任务"
            title="添加任务"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-900 text-white shadow-[0_6px_18px_rgba(5,95,75,.2)] transition hover:-translate-y-0.5 hover:bg-emerald-950 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-30 dark:bg-blue-500/80 dark:shadow-[0_6px_20px_rgba(74,111,220,.2)] dark:hover:bg-blue-400"
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </button>
        </div>
      </form>
    );
  },
);
