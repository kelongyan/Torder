import { useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { createPortal } from "react-dom";
import type { CreateTaskInput, Task, TaskList } from "../../types/database";
import { isMobile } from "../../utils/platform";
import { TaskCard } from "./TaskCard";
import { TaskQuickComposer } from "./TaskQuickComposer";

export type BoardColumnId = "todo" | "doing" | "done";

type BoardCardDragData = {
  kind: "card";
  task: Task;
};

type BoardColumnDropData = {
  kind: "column";
  columnId: BoardColumnId;
};

/**
 * 指针拖拽要求落点在列内（pointerWithin）；键盘拖拽没有 pointer 坐标，
 * pointerWithin 会恒返回空数组，导致键盘永远找不到落点。
 * 键盘走 closestCenter，按卡片中心与列中心的距离选列。
 */
const boardCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

/**
 * 看板视图。
 *
 * 拖拽用 dnd-kit 的指针传感器，**不用** HTML5 `draggable`：主窗口开着
 * `dragDropEnabled`（附件拖入依赖 `onDragDropEvent`），此时 WebView2 的拖放
 * 处理被 Tauri 接管，HTML5 drag 事件的 drop 阶段收不到，卡片就“拖不动”
 * （issue #10）。指针拖拽走 pointer 事件，和原生文件拖放互不干扰。
 *
 * 日历（CalendarTaskDnd）已经是同一套做法，这里保持一致。
 */
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
  onMove: (task: Task, columnId: BoardColumnId) => Promise<void>;
}) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [composerColumn, setComposerColumn] = useState<string | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const dragEnabled = !isMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 5px 起手阈值：低于它仍算点击，卡片照常打开详情
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );
  const columns: Array<{
    id: BoardColumnId;
    title: string;
    color: string;
    tasks: Task[];
  }> = [
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

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as BoardCardDragData | undefined;
    if (data?.kind !== "card") return;
    setActiveTask(data.task);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const cardData = event.active.data.current as BoardCardDragData | undefined;
    const columnData = event.over?.data.current as
      | BoardColumnDropData
      | undefined;
    const task = cardData?.kind === "card" ? cardData.task : null;
    const columnId =
      columnData?.kind === "column" ? columnData.columnId : undefined;
    setActiveTask(null);
    if (!task || !columnId || movingTaskId !== null) return;
    // 落在自己所属列 → 无变化，不必写库
    const currentColumn: BoardColumnId =
      task.status === "done" ? "done" : task.priority === 2 ? "doing" : "todo";
    if (currentColumn === columnId) return;
    setMovingTaskId(task.id);
    try {
      await onMove(task, columnId);
    } finally {
      setMovingTaskId(null);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveTask(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <div className="board-view">
        {columns.map((column, columnIndex) => (
          <BoardColumn
            key={column.id}
            id={column.id}
            title={column.title}
            color={column.color}
            index={columnIndex}
            tasks={column.tasks}
            lists={lists}
            searchQuery={searchQuery}
            selectedTaskId={selectedTaskId}
            defaultListId={defaultListId}
            dragEnabled={dragEnabled}
            movingTaskId={movingTaskId}
            composerColumn={composerColumn}
            setComposerColumn={setComposerColumn}
            onQuickCreate={onQuickCreate}
            parseNaturalLanguage={parseNaturalLanguage}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
      {/* 与日历一致：portal 到 body，避免带 transform 的入场动画祖先成为
          DragOverlay（position:fixed）的包含块导致浮层错位。 */}
      {createPortal(
        <DragOverlay dropAnimation={null} zIndex={120}>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              list={
                lists.find((item) => item.id === activeTask.listId) ?? null
              }
              searchQuery={searchQuery}
              selected={false}
              onOpen={() => undefined}
              onToggle={() => undefined}
              overlay
            />
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

function BoardColumn({
  id,
  title,
  color,
  index,
  tasks,
  lists,
  searchQuery,
  selectedTaskId,
  defaultListId,
  dragEnabled,
  movingTaskId,
  composerColumn,
  setComposerColumn,
  onQuickCreate,
  parseNaturalLanguage,
  onOpen,
  onToggle,
}: {
  id: BoardColumnId;
  title: string;
  color: string;
  index: number;
  tasks: Task[];
  lists: TaskList[];
  searchQuery: string;
  selectedTaskId: string | null;
  defaultListId: string;
  dragEnabled: boolean;
  movingTaskId: string | null;
  composerColumn: string | null;
  setComposerColumn: (column: string | null) => void;
  onQuickCreate?: (input: CreateTaskInput) => Promise<void>;
  parseNaturalLanguage: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `board-column:${id}`,
    data: { kind: "column", columnId: id } satisfies BoardColumnDropData,
    disabled: movingTaskId !== null,
  });

  return (
    <section
      ref={setNodeRef}
      className={`board-column${isOver ? " is-drag-over" : ""}`}
      style={{ "--item-index": index } as CSSProperties}
      aria-busy={movingTaskId !== null || undefined}
    >
      <header>
        <span className="board-dot" style={{ backgroundColor: color }} />
        <h2>{title}</h2>
        <span>{tasks.length}</span>
        {/* F1 · T-13 在此列新建：done 列不给入口（新建一条「已完成」无工作流意义） */}
        {onQuickCreate && id !== "done" && (
          <button
            type="button"
            className={`board-column-add${
              composerColumn === id ? " is-open" : ""
            }`}
            aria-label={`在${title}列新建`}
            onClick={() => setComposerColumn(composerColumn === id ? null : id)}
          >
            <Plus aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="board-cards">
        {onQuickCreate && composerColumn === id && (
          <TaskQuickComposer
            lists={lists}
            defaultListId={defaultListId}
            variant="board"
            inputPlaceholder="事项标题，Enter 创建"
            defaultOpen
            parseNaturalLanguage={parseNaturalLanguage}
            // 列语义与 handleBoardMove 保持一致：doing 列＝高优先级
            overrides={id === "doing" ? { priority: 2 } : undefined}
            onCreate={async (input) => {
              await onQuickCreate(input);
              setComposerColumn(null);
            }}
          />
        )}
        {tasks.map((task, taskIndex) => (
          <DraggableBoardCard
            key={task.id}
            task={task}
            list={lists.find((item) => item.id === task.listId) ?? null}
            searchQuery={searchQuery}
            selected={selectedTaskId === task.id}
            motionIndex={taskIndex}
            draggable={dragEnabled && movingTaskId === null}
            moving={movingTaskId === task.id}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

function DraggableBoardCard({
  task,
  list,
  searchQuery,
  selected,
  motionIndex,
  draggable,
  moving,
  onOpen,
  onToggle,
}: {
  task: Task;
  list: TaskList | null;
  searchQuery: string;
  selected: boolean;
  motionIndex: number;
  draggable: boolean;
  moving: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-card:${task.id}`,
    data: { kind: "card", task } satisfies BoardCardDragData,
    disabled: !draggable,
    // dnd-kit 默认给拖拽节点挂 role="button"，而卡片里本来就有一个真实的
    // 「完成任务」按钮——role=button 套 button 是无效的嵌套交互结构，读屏器
    // 会报错且焦点语义混乱。用 group 保留键盘拖拽（KeyboardSensor 走 listeners
    // 的 onKeyDown，不依赖 role），同时把 roleDescription 说明白。
    attributes: { role: "group", roleDescription: "可拖动任务卡片" },
  });

  return (
    <div
      ref={setNodeRef}
      className={`board-card-drag${isDragging ? " is-dragging" : ""}${
        moving ? " is-moving" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        list={list}
        searchQuery={searchQuery}
        selected={selected}
        motionIndex={motionIndex}
        onOpen={onOpen}
        onToggle={onToggle}
      />
    </div>
  );
}
