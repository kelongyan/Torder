import { forwardRef, useState } from "react";
import { ArrowUp } from "lucide-react";
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
      <form className="relative" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="quick-add-task">
          快速添加任务
        </label>
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
          placeholder={
            view === "today"
              ? "添加今天要做的事，按 Enter 创建"
              : "添加一条任务，按 Enter 创建"
          }
          className="field-control pr-12 pl-4"
        />
        <button
          type="submit"
          disabled={disabled || !title.trim()}
          aria-label="添加任务"
          title="添加任务"
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg border border-white/20 bg-emerald-900/90 text-white shadow-sm transition hover:-translate-y-[54%] hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-blue-500/75 dark:hover:bg-blue-400"
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </button>
      </form>
    );
  },
);
