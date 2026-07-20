import { forwardRef, useState } from "react";
import { ArrowUp, Check, Sparkles } from "lucide-react";
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
    const [justAdded, setJustAdded] = useState(false);
    const available = view === "today" || view === "all";

    if (!available) return null;

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const nextTitle = title.trim();
      if (!nextTitle || disabled) return;
      await onCreate(nextTitle);
      setTitle("");
      setJustAdded(true);
      window.setTimeout(() => setJustAdded(false), 800);
    }

    return (
      <form onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="quick-add-task">
          快速添加任务
        </label>
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--glass-border)] bg-[var(--glass-panel-strong)] shadow-[var(--glass-shadow-float)] backdrop-blur-xl">
          {/* Top accent line */}
          <div
            aria-hidden="true"
            className="h-[2px] w-full bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-50"
          />

          <div className="flex items-center gap-2.5 px-3.5 py-2">
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-full transition-all duration-[var(--duration-normal)] ${
                title.trim()
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "bg-[var(--glass-control)] text-[var(--text-muted)]"
              }`}
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
            </span>
            <input
              ref={ref}
              id="quick-add-task"
              value={title}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && onEscape) {
                  event.preventDefault();
                  onEscape();
                }
              }}
              placeholder={
                view === "today" ? "今天要做什么？" : "输入新事项…"
              }
              className="h-9 min-w-0 flex-1 bg-transparent text-sm leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <button
              type="submit"
              disabled={disabled || !title.trim()}
              aria-label="添加任务"
              title="添加任务（Enter）"
              className={`grid size-9 shrink-0 place-items-center rounded-full text-[var(--accent-fg)] transition-all duration-[var(--duration-fast)] hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:scale-100 ${
                justAdded
                  ? "bg-[var(--status-success)] shadow-[0_4px_16px_color-mix(in_srgb,var(--status-success)_30%,transparent)]"
                  : "bg-[var(--accent)] shadow-[var(--shadow-btn)] hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-btn-hover)]"
              }`}
            >
              {justAdded ? (
                <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
              ) : (
                <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.5} />
              )}
            </button>
          </div>

          {/* Bottom hint bar */}
          <div className="flex items-center justify-between border-t border-[var(--glass-border-muted)] bg-[var(--glass-control)] px-3.5 py-1">
            <span className="meta-copy">
              {view === "today"
                ? "新任务将添加到「今日」"
                : "新任务将添加到「全部任务」"}
            </span>
            <span className="meta-copy flex items-center gap-2">
              <kbd className="rounded-[4px] border border-[var(--glass-border-muted)] bg-[var(--glass-panel)] px-1.5 py-0.5 font-sans text-[10px] leading-none">
                Enter
              </kbd>
              添加
              <kbd className="rounded-[4px] border border-[var(--glass-border-muted)] bg-[var(--glass-panel)] px-1.5 py-0.5 font-sans text-[10px] leading-none">
                Esc
              </kbd>
              关闭
            </span>
          </div>
        </div>
      </form>
    );
  },
);
