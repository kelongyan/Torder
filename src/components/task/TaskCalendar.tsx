import { useMemo } from "react";
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
}: {
  tasks: Task[];
  lists: TaskList[];
  searchQuery: string;
  selectedTaskId: string | null;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const groups = useMemo(() => groupCalendarTasks(tasks), [tasks]);

  return (
    <div className="calendar-view">
      {groups.map((group) => (
        <section key={group.key} className="calendar-group">
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
                last={index === group.tasks.length - 1}
                batchMode={false}
                batchSelected={false}
                searchQuery={searchQuery}
                onOpen={onOpen}
                onToggle={onToggle}
                onDelete={() => undefined}
                onToggleBatchSelected={() => undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
