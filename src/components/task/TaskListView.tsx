import { useEffect, useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import type { Task, TaskList, TaskScope } from "../../types/database";
import { EmptyState } from "../common/EmptyState";
import { SectionHeader } from "../common/SectionHeader";
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
  onOpen,
  onToggle,
  onDelete,
  onRestore,
  onToggleBatchSelected,
  onBatchComplete,
  onBatchDelete,
  onBatchEdit,
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
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
  onBatchComplete: () => void;
  onBatchDelete: () => void;
  onBatchEdit: () => void;
  onExitBatch: () => void;
}) {
  const deletedView = scope.kind === "view" && scope.view === "deleted";
  const animatedTasks = useAnimatedTasks(tasks);
  const activeTasks = animatedTasks.filter(
    (item) => item.task.status !== "done",
  );
  const completedTasks = animatedTasks.filter(
    (item) => item.task.status === "done",
  );
  const activeCount = activeTasks.filter((item) => !item.leaving).length;
  const completedCount = completedTasks.filter((item) => !item.leaving).length;

  if (loading && tasks.length === 0) {
    return (
      <div className="list-container">
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
        <EmptyState scope={scope} searchQuery={searchQuery} />
      </div>
    );
  }

  return (
    <div className={`list-container ${batchMode ? "batching" : ""}`}>
      {batchMode && !deletedView && (
        <div className="batch-bar">
          <span>已选 {batchSelectedIds.length} 项</span>
          <button
            type="button"
            onClick={onBatchComplete}
            disabled={batchSelectedIds.length === 0}
          >
            <Check aria-hidden="true" className="icon-sm" />
            完成
          </button>
          <button
            type="button"
            onClick={onBatchEdit}
            disabled={batchSelectedIds.length === 0}
          >
            <Pencil aria-hidden="true" className="icon-sm" />
            编辑
          </button>
          <button
            type="button"
            onClick={onBatchDelete}
            disabled={batchSelectedIds.length === 0}
          >
            <Trash2 aria-hidden="true" className="icon-sm" />
            删除
          </button>
          <button type="button" onClick={onExitBatch}>
            退出
          </button>
        </div>
      )}
      {deletedView ? (
        <>
          <SectionHeader label={`回收站 · ${animatedTasks.length}`} />
          {animatedTasks.map((item, index) => (
            <TaskRow
              key={item.task.id}
              task={item.task}
              lists={lists}
              selected={false}
              last={index === animatedTasks.length - 1}
              batchMode={false}
              batchSelected={false}
              leaving={item.leaving}
              motionIndex={index}
              searchQuery={searchQuery}
              deleted
              onOpen={onOpen}
              onToggle={onToggle}
              onDelete={onDelete}
              onRestore={onRestore}
              onToggleBatchSelected={onToggleBatchSelected}
            />
          ))}
        </>
      ) : (
        <>
          {activeTasks.length > 0 && (
            <>
              <SectionHeader label={`进行中 · ${activeCount}`} />
              {activeTasks.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  last={
                    index === activeTasks.length - 1 &&
                    completedTasks.length === 0
                  }
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={index}
                  searchQuery={searchQuery}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onToggleBatchSelected={onToggleBatchSelected}
                />
              ))}
            </>
          )}
          {completedTasks.length > 0 && (
            <>
              <SectionHeader label={`已完成 · ${completedCount}`} />
              {completedTasks.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  last={index === completedTasks.length - 1}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={activeTasks.length + index}
                  searchQuery={searchQuery}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onToggleBatchSelected={onToggleBatchSelected}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

interface AnimatedTask {
  task: Task;
  leaving: boolean;
}

function useAnimatedTasks(tasks: Task[]): AnimatedTask[] {
  const [items, setItems] = useState<AnimatedTask[]>(
    tasks.map((task) => ({ task, leaving: false })),
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextIds = new Set(tasks.map((task) => task.id));
      setItems((current) => [
        ...tasks.map((task) => ({ task, leaving: false })),
        ...current
          .filter((item) => !nextIds.has(item.task.id) && !item.leaving)
          .map((item) => ({ ...item, leaving: true })),
      ]);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [tasks]);

  useEffect(() => {
    if (!items.some((item) => item.leaving)) return;

    const timeoutId = window.setTimeout(() => {
      setItems((current) => current.filter((item) => !item.leaving));
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [items]);

  return items;
}
