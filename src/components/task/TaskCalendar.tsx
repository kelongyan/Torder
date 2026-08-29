import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { Task, TaskList } from "../../types/database";
import { groupCalendarTasks } from "../../utils/calendarHelpers";
import { TaskRow } from "./TaskRow";

export function TaskCalendar({
  tasks,
  lists,
  searchQuery,
  selectedTaskId,
  onOpen,
  onToggle,
  onDelete,
}: {
  tasks: Task[];
  lists: TaskList[];
  searchQuery: string;
  selectedTaskId: string | null;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const groups = useMemo(() => groupCalendarTasks(tasks), [tasks]);

  return (
    <div className="calendar-view">
      {groups.map((group, groupIndex) => (
        <section
          key={group.key}
          className="calendar-group"
          style={{ "--item-index": groupIndex } as CSSProperties}
        >
          <header>
            <div>
              <h2>{group.title}</h2>
              {group.weekday && <span>{group.weekday}</span>}
            </div>
            {group.isToday && <span className="today-badge">今天</span>}
            <strong>{group.tasks.length} 项</strong>
          </header>
          <div className="calendar-items">
            {group.tasks.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                lists={lists}
                selected={selectedTaskId === task.id}
                batchMode={false}
                batchSelected={false}
                motionIndex={index}
                searchQuery={searchQuery}
                onOpen={onOpen}
                onToggle={onToggle}
                onDelete={onDelete}
                onToggleBatchSelected={() => undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
