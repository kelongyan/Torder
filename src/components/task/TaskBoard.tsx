import { useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import type { CreateTaskInput, Task, TaskList } from "../../types/database";
import { TaskCard } from "./TaskCard";
import { TaskQuickComposer } from "./TaskQuickComposer";

export function TaskBoard({
  tasks,
  lists,
  searchQuery,
  selectedTaskId,
  defaultListId = "work",
  onQuickCreate,
  parseNaturalLanguage = true,
  onOpen,
  onToggle,
  onMove,
}: {
  tasks: Task[];
  lists: TaskList[];
  searchQuery: string;
  selectedTaskId: string | null;
  /** T-13 内联新建落位用。 */
  defaultListId?: string;
  /** 不传则不渲染列头新建入口。 */
  onQuickCreate?: (input: CreateTaskInput) => Promise<void>;
  /** T-10 甲组：识别自然语言速记开关。 */
  parseNaturalLanguage?: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onMove: (task: Task, columnId: "todo" | "doing" | "done") => void;
}) {
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [composerColumn, setComposerColumn] = useState<string | null>(null);
  const columns = [
    {
      id: "todo",
      title: "待处理",
      color: "var(--blue)",
      tasks: tasks.filter(
        (task) => task.status !== "done" && task.priority !== 2,
      ),
    },
    {
      id: "doing",
      title: "进行中",
      color: "var(--red)",
      tasks: tasks.filter(
        (task) => task.status !== "done" && task.priority === 2,
      ),
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
      {columns.map((column, columnIndex) => (
        <section
          key={column.id}
          className="board-column"
          style={{ "--item-index": columnIndex } as CSSProperties}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!draggingTask) return;
            onMove(draggingTask, column.id as "todo" | "doing" | "done");
            setDraggingTask(null);
          }}
        >
          <header>
            <span
              className="board-dot"
              style={{ backgroundColor: column.color }}
            />
            <h2>{column.title}</h2>
            <span>{column.tasks.length}</span>
            {/* F1 · T-13 在此列新建：done 列不给入口（新建一条「已完成」无工作流意义） */}
            {onQuickCreate && column.id !== "done" && (
              <button
                type="button"
                className={`board-column-add${
                  composerColumn === column.id ? " is-open" : ""
                }`}
                aria-label={`在${column.title}列新建`}
                onClick={() =>
                  setComposerColumn(
                    composerColumn === column.id ? null : column.id,
                  )
                }
              >
                <Plus aria-hidden="true" />
              </button>
            )}
          </header>
          <div className="board-cards">
            {onQuickCreate && composerColumn === column.id && (
              <TaskQuickComposer
                lists={lists}
                defaultListId={defaultListId}
                variant="board"
                inputPlaceholder="事项标题，Enter 创建"
                defaultOpen
                parseNaturalLanguage={parseNaturalLanguage}
                // 列语义与 handleBoardMove 保持一致：doing 列＝高优先级
                overrides={column.id === "doing" ? { priority: 2 } : undefined}
                onCreate={async (input) => {
                  await onQuickCreate(input);
                  setComposerColumn(null);
                }}
              />
            )}
            {column.tasks.map((task, taskIndex) => (
              <TaskCard
                key={task.id}
                task={task}
                list={lists.find((item) => item.id === task.listId) ?? null}
                searchQuery={searchQuery}
                selected={selectedTaskId === task.id}
                motionIndex={taskIndex}
                onOpen={onOpen}
                onToggle={onToggle}
                draggable
                onDragStart={setDraggingTask}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
