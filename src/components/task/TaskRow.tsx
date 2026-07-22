import { Check, Pencil, Trash2 } from "lucide-react";
import { priorityCopy } from "../../constants/taskConfig";
import type { Task, TaskList } from "../../types/database";
import { HighlightedText } from "../common/HighlightedText";
import { TaskMeta } from "./TaskMeta";

export function TaskRow({
  task,
  lists,
  selected,
  last,
  batchMode,
  batchSelected,
  searchQuery,
  onOpen,
  onToggle,
  onDelete,
  onToggleBatchSelected,
}: {
  task: Task;
  lists: TaskList[];
  selected: boolean;
  last: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  searchQuery: string;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
}) {
  const completed = task.status === "done";
  const list = lists.find((item) => item.id === task.listId) ?? null;

  function handleRowClick() {
    if (batchMode) onToggleBatchSelected(task.id);
    else onOpen(task);
  }

  return (
    <article
      className={`task-item ${selected ? "selected" : ""} ${completed ? "completed" : ""}`}
      onClick={handleRowClick}
    >
      {!batchMode && (
        <div className="timeline-node" aria-hidden="true">
          <span
            className={`timeline-dot ${completed ? "completed-dot" : priorityCopy[task.priority].className}`}
          />
          {!last && <span className="timeline-line" />}
        </div>
      )}

      {batchMode ? (
        <button
          type="button"
          className={`batch-check ${batchSelected ? "checked" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleBatchSelected(task.id);
          }}
          aria-label={batchSelected ? "取消选择任务" : "选择任务"}
        >
          {batchSelected && <Check aria-hidden="true" />}
        </button>
      ) : (
        <button
          type="button"
          className={`task-check ${completed ? "checked" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(task);
          }}
          aria-label={completed ? "恢复任务" : "完成任务"}
        >
          {completed && <Check aria-hidden="true" />}
        </button>
      )}

      <div className="task-content">
        <h3>
          <HighlightedText text={task.title} query={searchQuery} />
        </h3>
        {task.note && (
          <p>
            <HighlightedText text={task.note} query={searchQuery} />
          </p>
        )}
        <TaskMeta task={task} list={list} />
      </div>

      {!batchMode && (
        <div className="task-actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(task);
            }}
            aria-label="编辑任务"
          >
            <Pencil aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(task);
            }}
            aria-label="删除任务"
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}
