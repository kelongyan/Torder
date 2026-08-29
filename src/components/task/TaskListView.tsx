import { useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import type { Task, TaskList, TaskScope } from "../../types/database";
import { useAnimatedTasks } from "../../hooks/useAnimatedTasks";
import { EmptyState } from "../common/EmptyState";
import { SectionHeader } from "../common/SectionHeader";
import { TaskRow } from "./TaskRow";
import { TaskTodayAgenda } from "./TaskTodayAgenda";

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
  onPermanentDelete,
  onToggleBatchSelected,
  onBatchComplete,
  onBatchDelete,
  onBatchRestore,
  onBatchPermanentDelete,
  onBatchEdit,
  onExitBatch,
  onEmptyTrash,
  onReorder,
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
  onPermanentDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
  onBatchComplete: () => void;
  onBatchDelete: () => void;
  onBatchRestore: () => void;
  onBatchPermanentDelete: () => void;
  onBatchEdit: () => void;
  onExitBatch: () => void;
  onEmptyTrash: () => void;
  onReorder: (sourceId: string, targetId: string) => void;
}) {
  const deletedView = scope.kind === "view" && scope.view === "deleted";
  const todayView = scope.kind === "view" && scope.view === "today";
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const animatedTasks = useAnimatedTasks(tasks);
  const activeTasks = animatedTasks.filter(
    (item) => item.task.status !== "done",
  );
  const completedTasks = animatedTasks.filter(
    (item) => item.task.status === "done",
  );
  const activeCount = activeTasks.filter((item) => !item.leaving).length;
  const completedCount = completedTasks.filter((item) => !item.leaving).length;
  // 分组头完成进度（提案 §3-A）：done/total 挂在第一个分组头上
  const progress =
    completedCount > 0 && activeCount + completedCount > 0
      ? { done: completedCount, total: activeCount + completedCount }
      : undefined;

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
      {batchMode && (
        <div className="batch-bar">
          <span>已选 {batchSelectedIds.length} 项</span>
          {deletedView ? (
            <>
              <button
                type="button"
                onClick={onBatchRestore}
                disabled={batchSelectedIds.length === 0}
              >
                <Check aria-hidden="true" className="icon-sm" />
                恢复
              </button>
              <button
                type="button"
                onClick={onBatchPermanentDelete}
                disabled={batchSelectedIds.length === 0}
              >
                <Trash2 aria-hidden="true" className="icon-sm" />
                永久删除
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
          <button type="button" onClick={onExitBatch}>
            退出
          </button>
        </div>
      )}
      {deletedView ? (
        <>
          <div className="trash-toolbar">
            <SectionHeader label={`回收站 · ${animatedTasks.length}`} />
            <button type="button" className="btn-danger" onClick={onEmptyTrash}>
              <Trash2 aria-hidden="true" className="icon-sm" />
              清空回收站
            </button>
          </div>
          {animatedTasks.map((item, index) => (
            <TaskRow
              key={item.task.id}
              task={item.task}
              lists={lists}
              selected={item.task.id === selectedTaskId}
              batchMode={batchMode}
              batchSelected={batchSelectedIds.includes(item.task.id)}
              leaving={item.leaving}
              motionIndex={index}
              searchQuery={searchQuery}
              deleted
              onOpen={onOpen}
              onToggle={onToggle}
              onDelete={onDelete}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onToggleBatchSelected={onToggleBatchSelected}
            />
          ))}
        </>
      ) : todayView ? (
        <TaskTodayAgenda
          items={animatedTasks}
          lists={lists}
          selectedTaskId={selectedTaskId}
          batchMode={batchMode}
          batchSelectedIds={batchSelectedIds}
          searchQuery={searchQuery}
          onOpen={onOpen}
          onToggle={onToggle}
          onDelete={onDelete}
          onToggleBatchSelected={onToggleBatchSelected}
          onReorder={onReorder}
        />
      ) : (
        <>
          {activeTasks.length > 0 && (
            <>
              <SectionHeader
                label={`进行中 · ${activeCount}`}
                progress={progress}
              />
              {activeTasks.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={index}
                  searchQuery={searchQuery}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onPermanentDelete={onPermanentDelete}
                  onToggleBatchSelected={onToggleBatchSelected}
                  draggable={!batchMode && !item.leaving}
                  dragging={draggingId === item.task.id}
                  onDragStart={(task) => setDraggingId(task.id)}
                  onDragOver={() => undefined}
                  onDrop={(task) => {
                    if (draggingId) onReorder(draggingId, task.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
            </>
          )}
          {completedTasks.length > 0 && (
            <>
              <SectionHeader
                label={`已完成 · ${completedCount}`}
                progress={activeTasks.length === 0 ? progress : undefined}
              />
              {completedTasks.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={activeTasks.length + index}
                  searchQuery={searchQuery}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onPermanentDelete={onPermanentDelete}
                  onToggleBatchSelected={onToggleBatchSelected}
                  draggable={!batchMode && !item.leaving}
                  dragging={draggingId === item.task.id}
                  onDragStart={(task) => setDraggingId(task.id)}
                  onDragOver={() => undefined}
                  onDrop={(task) => {
                    if (draggingId) onReorder(draggingId, task.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
