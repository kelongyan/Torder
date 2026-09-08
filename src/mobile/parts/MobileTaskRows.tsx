/**
 * mobile/parts/MobileTaskRows.tsx — 移动端任务行列表（M-C）
 * 行组件 MobileTaskRow（右滑完成/左滑删除/长按更多）；回收站行恢复/彻底删除。
 */
import type { JSX } from "react";
import type { Task, TaskList } from "../../types/database";
import { MobileTaskRow } from "./MobileTaskRow";

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
  onMore,
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
  onMore?: (task: Task) => void;
}): JSX.Element {
  return (
    <div className="m-task-list">
      {tasks.map((task) => (
        <MobileTaskRow
          key={task.id}
          task={task}
          listColor={
            lists.find((l) => l.id === task.listId)?.color ?? undefined
          }
          timeGutter={timeGutterFor ? timeGutterFor(task) : undefined}
          attachmentCount={attachmentCounts[task.id] ?? 0}
          deleted={deleted}
          onOpen={onOpen}
          onToggle={onToggle}
          onDelete={onDelete}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
          onMore={onMore}
        />
      ))}
    </div>
  );
}
