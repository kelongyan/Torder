/**
 * mobile/pages/rows.tsx — 移动端任务行列表（复用桌面 TaskRow，M-A）
 * 分组/编辑等排版细节 M-B 再按设计稿打磨；此处保证点击进详情、
 * 勾选完成、回收站恢复/删除等主操作立即可用。
 */
import type { JSX } from "react";
import type { Task, TaskList } from "../../types/database";
import { TaskRow } from "../../components/task/TaskRow";

export function MobileTaskRows({
  tasks,
  lists,
  attachmentCounts,
  deleted = false,
  timeGutterFor,
  onOpen,
  onToggle,
  onDelete,
  onRestore,
  onPermanentDelete,
}: {
  tasks: Task[];
  lists: TaskList[];
  attachmentCounts: Record<string, number>;
  deleted?: boolean;
  timeGutterFor?: (task: Task) => string | undefined;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore?: (task: Task) => void;
  onPermanentDelete?: (task: Task) => void;
}): JSX.Element {
  return (
    <div className="m-task-list">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          lists={lists}
          selected={false}
          batchMode={false}
          batchSelected={false}
          searchQuery=""
          deleted={deleted}
          timeGutter={timeGutterFor ? timeGutterFor(task) : undefined}
          attachmentCount={attachmentCounts[task.id] ?? 0}
          onOpen={onOpen}
          onToggle={onToggle}
          onDelete={onDelete}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
          onToggleBatchSelected={() => undefined}
        />
      ))}
    </div>
  );
}
