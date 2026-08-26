import { Check } from "lucide-react";
import type { Task } from "../../types/database";

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

export function WidgetTaskItem({
  task,
  listColor,
  busy,
  onToggle,
  onOpen,
}: {
  task: Task;
  listColor: string | null;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const completed = task.status === "done";
  const time = formatTime(task.dueAt);
  return (
    <article className={`widget-item ${completed ? "is-done" : ""}`.trim()}>
      <button
        type="button"
        className={`widget-item-checkbox ${completed ? "checked" : ""}`.trim()}
        aria-label={completed ? "取消完成" : "完成任务"}
        disabled={busy}
        onClick={onToggle}
      >
        {completed && <Check aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="widget-item-title"
        title={task.title}
        onClick={onOpen}
      >
        {task.title}
      </button>
      <span className="widget-item-meta">
        {listColor && (
          <span className="widget-item-dot" style={{ background: listColor }} />
        )}
        {time && <span className="widget-item-time">{time}</span>}
      </span>
    </article>
  );
}
