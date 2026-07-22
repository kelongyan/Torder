import type { Task, TaskList } from "../../types/database";
import { TaskCard } from "./TaskCard";

export function TaskBoard({
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
  const columns = [
    {
      id: "todo",
      title: "待处理",
      color: "var(--blue)",
      tasks: tasks.filter((task) => task.status !== "done" && task.priority !== 2),
    },
    {
      id: "doing",
      title: "进行中",
      color: "var(--red)",
      tasks: tasks.filter((task) => task.status !== "done" && task.priority === 2),
    },
    {
      id: "done",
      title: "已完成",
      color: "var(--green)",
      tasks: tasks.filter((task) => task.status === "done"),
    },
  ];

  return (
    <div className="board-view">
      {columns.map((column) => (
        <section key={column.id} className="board-column">
          <header>
            <span className="board-dot" style={{ backgroundColor: column.color }} />
            <h2>{column.title}</h2>
            <span>{column.tasks.length}</span>
          </header>
          <div className="board-cards">
            {column.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                list={lists.find((item) => item.id === task.listId) ?? null}
                searchQuery={searchQuery}
                selected={selectedTaskId === task.id}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
