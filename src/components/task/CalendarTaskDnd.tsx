import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { priorityCopy } from "../../constants/taskConfig";
import type { Task } from "../../types/database";
import { getTaskCalendarKey } from "../../utils/taskDates";

type CalendarTaskDragData = {
  kind: "task";
  task: Task;
  taskId: string;
  sourceDate: string | null;
};

type CalendarDateDropData = {
  kind: "date";
  dateKey: string;
};

type CalendarTaskDndState = {
  activeTaskId: string | null;
  hoveredDateKey: string | null;
  movingTaskId: string | null;
  pendingDateKey: string | null;
  isClickBlocked: (taskId: string) => boolean;
};

const CalendarTaskDndContext = createContext<CalendarTaskDndState | null>(null);

export function CalendarTaskDndProvider({
  children,
  onMoveTaskDate,
}: {
  children: ReactNode;
  onMoveTaskDate: (taskId: string, dateKey: string) => Promise<void>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
  );
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [pendingDateKey, setPendingDateKey] = useState<string | null>(null);
  const clickGuardTaskIdRef = useRef<string | null>(null);
  const clickGuardTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (clickGuardTimerRef.current !== null) {
        window.clearTimeout(clickGuardTimerRef.current);
      }
    };
  }, []);

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => pointerWithin(args),
    [],
  );

  const releaseClickGuard = useCallback((taskId: string | null) => {
    if (clickGuardTimerRef.current !== null) {
      window.clearTimeout(clickGuardTimerRef.current);
    }
    clickGuardTimerRef.current = window.setTimeout(() => {
      if (clickGuardTaskIdRef.current === taskId) {
        clickGuardTaskIdRef.current = null;
      }
      clickGuardTimerRef.current = null;
    }, 0);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as CalendarTaskDragData | undefined;
    if (data?.kind !== "task") return;
    clickGuardTaskIdRef.current = data.taskId;
    setActiveTask(data.task);
  }, []);

  const handleDragCancel = useCallback(() => {
    const taskId = clickGuardTaskIdRef.current;
    setActiveTask(null);
    setHoveredDateKey(null);
    releaseClickGuard(taskId);
  }, [releaseClickGuard]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const taskData = event.active.data.current as
        CalendarTaskDragData | undefined;
      const overData = event.over?.data.current as
        CalendarDateDropData | undefined;
      const taskId = taskData?.kind === "task" ? taskData.taskId : null;
      const sourceDate = taskData?.kind === "task" ? taskData.sourceDate : null;
      const dateKey = overData?.kind === "date" ? overData.dateKey : null;
      setActiveTask(null);
      setHoveredDateKey(null);
      releaseClickGuard(taskId);

      if (
        !taskId ||
        !dateKey ||
        movingTaskId !== null ||
        sourceDate === dateKey
      ) {
        return;
      }

      setMovingTaskId(taskId);
      setPendingDateKey(dateKey);
      try {
        await onMoveTaskDate(taskId, dateKey);
      } finally {
        setMovingTaskId(null);
        setPendingDateKey(null);
      }
    },
    [movingTaskId, onMoveTaskDate, releaseClickGuard],
  );

  const state = useMemo<CalendarTaskDndState>(
    () => ({
      activeTaskId: activeTask?.id ?? null,
      hoveredDateKey,
      movingTaskId,
      pendingDateKey,
      isClickBlocked: (taskId) => clickGuardTaskIdRef.current === taskId,
    }),
    [activeTask?.id, hoveredDateKey, movingTaskId, pendingDateKey],
  );

  return (
    <CalendarTaskDndContext.Provider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={(event) => void handleDragEnd(event)}
      >
        {children}
        {/* DragOverlay 的内层包裹是 position:fixed；任何带 transform 的祖先
            （如 .content-motion 入场动画，fill 后仍保留恒等矩阵）都会成为其
            包含块，使浮层按容器坐标偏移。portal 到 body 可脱离全部此类祖先。 */}
        {createPortal(
          <DragOverlay dropAnimation={null} zIndex={120}>
            {activeTask ? (
              <div className="month-task calendar-task-drag-overlay">
                <CalendarTaskContent task={activeTask} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </CalendarTaskDndContext.Provider>
  );
}

export function DraggableCalendarTask({
  task,
  className = "",
  onOpen,
}: {
  task: Task;
  className?: string;
  onOpen: (task: Task) => void;
}) {
  const state = useCalendarTaskDnd();
  const disabled = state.movingTaskId !== null;
  const { attributes, listeners, isDragging, setNodeRef } = useDraggable({
    id: `task:${task.id}`,
    data: {
      kind: "task",
      task,
      taskId: task.id,
      sourceDate: getTaskCalendarKey(task),
    } satisfies CalendarTaskDragData,
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`month-task is-draggable ${className} ${isDragging ? "is-dragging" : ""}`}
      disabled={disabled}
      title={task.title}
      data-calendar-task-id={task.id}
      data-calendar-task-date={getTaskCalendarKey(task) ?? ""}
      aria-busy={state.movingTaskId === task.id || undefined}
      onClick={(event) => {
        if (isDragging || state.isClickBlocked(task.id)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onOpen(task);
      }}
      {...attributes}
      {...listeners}
    >
      <CalendarTaskContent task={task} />
    </button>
  );
}

export function CalendarDateDropZone({
  dateKey,
  className = "",
  children,
  ...props
}: {
  dateKey: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children">) {
  const state = useCalendarTaskDnd();
  const { isOver, setNodeRef } = useDroppable({
    id: `date:${dateKey}`,
    data: {
      kind: "date",
      dateKey,
    } satisfies CalendarDateDropData,
    disabled: state.movingTaskId !== null,
  });
  const dragOver =
    state.activeTaskId !== null && (state.hoveredDateKey === dateKey || isOver);
  const pending = state.pendingDateKey === dateKey;

  return (
    <div
      {...props}
      ref={setNodeRef}
      className={`${className} ${dragOver ? "is-drag-over" : ""} ${pending ? "is-drop-pending" : ""}`}
      data-calendar-date={dateKey}
      aria-busy={pending || undefined}
    >
      {children}
    </div>
  );
}

function CalendarTaskContent({ task }: { task: Task }) {
  return (
    <>
      <span
        className={`month-task-dot ${priorityCopy[task.priority].className}`}
        aria-hidden="true"
      />
      <span className="month-task-title">{task.title}</span>
    </>
  );
}

function useCalendarTaskDnd(): CalendarTaskDndState {
  const state = useContext(CalendarTaskDndContext);
  if (!state) {
    throw new Error("Calendar task drag components require a provider");
  }
  return state;
}
