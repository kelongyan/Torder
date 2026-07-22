import { Check, Trash2 } from "lucide-react";
import type { Task, TaskList, TaskScope } from "../../types/database";
import { EmptyState } from "../common/EmptyState";
import { SectionHeader } from "../common/SectionHeader";
import { TaskQuickAdd } from "./TaskQuickAdd";
import { TaskRow } from "./TaskRow";

export function TaskListView({
  tasks,
  lists,
  loading,
  selectedTaskId,
  batchMode,
  batchSelectedIds,
  searchQuery,
  scope,
  onQuickAdd,
  onOpen,
  onToggle,
  onDelete,
  onToggleBatchSelected,
  onBatchComplete,
  onBatchDelete,
  onExitBatch,
}: {
  tasks: Task[];
  lists: TaskList[];
  loading: boolean;
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  searchQuery: string;
  scope: TaskScope;
  onQuickAdd: () => void;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
  onBatchComplete: () => void;
  onBatchDelete: () => void;
  onExitBatch: () => void;
}) {
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const completedTasks = tasks.filter((task) => task.status === "done");

  if (loading && tasks.length === 0) {
    return (
      <div className="list-container">
        <TaskQuickAdd onClick={onQuickAdd} />
        <div className="skeleton-list" aria-label="任务加载中">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="list-container">
        <TaskQuickAdd onClick={onQuickAdd} />
        <EmptyState scope={scope} searchQuery={searchQuery} />
      </div>
    );
  }

  return (
    <div className={`list-container ${batchMode ? "batching" : ""}`}>
      {batchMode && (
        <div className="batch-bar">
          <span>已选 {batchSelectedIds.length} 项</span>
          <button type="button" onClick={onBatchComplete} disabled={batchSelectedIds.length === 0}>
            <Check aria-hidden="true" className="icon-sm" />
            完成
          </button>
          <button type="button" onClick={onBatchDelete} disabled={batchSelectedIds.length === 0}>
            <Trash2 aria-hidden="true" className="icon-sm" />
            删除
          </button>
          <button type="button" onClick={onExitBatch}>退出</button>
        </div>
      )}
      <TaskQuickAdd onClick={onQuickAdd} />
      {activeTasks.length > 0 && (
        <>
          <SectionHeader label={`进行中 · ${activeTasks.length}`} />
          {activeTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              selected={task.id === selectedTaskId}
              last={index === activeTasks.length - 1 && completedTasks.length === 0}
              batchMode={batchMode}
              batchSelected={batchSelectedIds.includes(task.id)}
              searchQuery={searchQuery}
              onOpen={onOpen}
              onToggle={onToggle}
              onDelete={onDelete}
              onToggleBatchSelected={onToggleBatchSelected}
            />
          ))}
        </>
      )}
      {completedTasks.length > 0 && (
        <>
          <SectionHeader label={`已完成 · ${completedTasks.length}`} />
          {completedTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              selected={task.id === selectedTaskId}
              last={index === completedTasks.length - 1}
              batchMode={batchMode}
              batchSelected={batchSelectedIds.includes(task.id)}
              searchQuery={searchQuery}
              onOpen={onOpen}
              onToggle={onToggle}
              onDelete={onDelete}
              onToggleBatchSelected={onToggleBatchSelected}
            />
          ))}
        </>
      )}
    </div>
  );
}
