import type { CSSProperties } from "react";
import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
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
  leaving = false,
  motionIndex = 0,
  searchQuery,
  deleted = false,
  onOpen,
  onToggle,
  onDelete,
  onRestore,
  onToggleBatchSelected,
}: {
  task: Task;
  lists: TaskList[];
  selected: boolean;
  last: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  leaving?: boolean;
  motionIndex?: number;
  searchQuery: string;
  /** 回收站视图：任务已软删除，行内操作变为恢复。 */
  deleted?: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore?: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
}) {
  const completed = task.status === "done";
  const list = lists.find((item) => item.id === task.listId) ?? null;

  function handleRowClick() {
    if (batchMode) onToggleBatchSelected(task.id);
    else if (!deleted) onOpen(task);
  }

  return (
    <article
      className={`task-item ${selected ? "selected" : ""} ${completed ? "completed" : ""} ${
        leaving ? "is-leaving" : ""
      } ${deleted ? "deleted" : ""}`}
      style={{ "--item-index": motionIndex } as CSSProperties}
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
      ) : deleted ? (
        <span className="task-check deleted-check" aria-hidden="true" />
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
          {deleted ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRestore?.(task);
              }}
              aria-label="恢复任务"
              title="恢复到原清单"
            >
              <RotateCcw aria-hidden="true" />
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </article>
  );
}
