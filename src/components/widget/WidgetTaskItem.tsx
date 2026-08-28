import { Check } from "lucide-react";
import type { Task } from "../../types/database";

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

/**
 * 单行事项。竖版便签里标题最多换行 2 行，所以整行（含行尾空白）都可点开主窗；
 * 两个子按钮各自 stopPropagation，避免冒泡到 article 后重复触发。
 * `data-tauri-drag-region="false"`：外层 stage 是 "deep"（整页可拖），
 * 行尾空白不是 BUTTON，不显式关掉就会被当成拖拽起手点，一动就误开主窗。
 */
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
  const className = [
    "widget-item",
    completed ? "is-done" : "",
    task.priority === 2 ? "is-high" : "",
    busy ? "is-busy" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      data-tauri-drag-region="false"
      onClick={onOpen}
    >
      <button
        type="button"
        className={`widget-item-checkbox ${completed ? "checked" : ""}`.trim()}
        aria-label={completed ? "取消完成" : "完成任务"}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {completed && <Check aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="widget-item-title"
        title={task.title}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {task.title}
      </button>
      {listColor && (
        <span className="widget-item-dot" style={{ background: listColor }} />
      )}
      {time && <span className="widget-item-time">{time}</span>}
    </article>
  );
}
