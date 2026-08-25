import { useMemo, useState, type DragEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarEvent, Task } from "../../types/database";
import { priorityCopy } from "../../constants/taskConfig";
import { calendarEventTypeCopy } from "../../constants/calendarEventConfig";
import {
  WEEKDAY_LABELS,
  buildEventsByDate,
  buildTasksByDate,
  buildUnscheduledTasks,
  toDateKey,
} from "../../utils/calendarGrid";
import { CalendarLegend } from "./CalendarLegend";

function startOfWeek(anchor: Date): Date {
  const date = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  const leading = (date.getDay() + 6) % 7; // 周一开头
  date.setDate(date.getDate() - leading);
  return date;
}

export function WeekCalendar({
  tasks,
  events,
  showCompleted,
  onOpenTask,
  onCreateTask,
  onCreateEvent,
  onEditEvent,
  onMoveTaskDate,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  showCompleted: boolean;
  onOpenTask: (task: Task) => void;
  onCreateTask: (date: string) => void;
  onCreateEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onMoveTaskDate: (taskId: string, date: string) => void;
}) {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  const tasksByDate = useMemo(
    () => buildTasksByDate(tasks, showCompleted),
    [showCompleted, tasks],
  );
  const unscheduledTasks = useMemo(
    () => buildUnscheduledTasks(tasks, showCompleted),
    [showCompleted, tasks],
  );

  const eventsByDate = useMemo(() => buildEventsByDate(events), [events]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    });
  }, [weekStart]);

  const todayKey = toDateKey(today);
  const weekTitle = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth && start.getFullYear() === end.getFullYear()) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getDate()}日`;
    }
    return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
  }, [weekDays]);

  const moveWeek = (delta: number) => {
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(current.getDate() + delta * 7);
      return next;
    });
  };

  const startTaskDrag = (event: DragEvent<HTMLButtonElement>, task: Task) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    setDraggingTaskId(task.id);
  };

  const dropTask = (event: DragEvent<HTMLDivElement>, dateKey: string) => {
    event.preventDefault();
    const taskId = draggingTaskId ?? event.dataTransfer.getData("text/plain");
    if (taskId) onMoveTaskDate(taskId, dateKey);
    setDraggingTaskId(null);
  };

  return (
    <div className="month-view week-view">
      <header className="month-header">
        <div className="month-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => moveWeek(-1)}
            aria-label="上一周"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <h2 className="month-title">{weekTitle}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={() => moveWeek(1)}
            aria-label="下一周"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-secondary month-today"
            onClick={() => setWeekStart(startOfWeek(today))}
          >
            今天
          </button>
        </div>
        <button
          type="button"
          className="btn-primary month-add-event"
          onClick={() => onCreateEvent(todayKey)}
        >
          <CalendarDays aria-hidden="true" className="icon-sm" />
          新建事件
        </button>
      </header>

      {unscheduledTasks.length > 0 && (
        <section className="month-unscheduled" aria-label="待安排任务">
          <header>
            <strong>待安排</strong>
            <span>{unscheduledTasks.length} 项</span>
          </header>
          <div className="month-unscheduled-list">
            {unscheduledTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className="month-task month-unscheduled-task"
                draggable
                onDragStart={(event) => startTaskDrag(event, task)}
                onDragEnd={() => setDraggingTaskId(null)}
                onClick={() => onOpenTask(task)}
                title={task.title}
              >
                <span
                  className={`month-task-dot ${priorityCopy[task.priority].className}`}
                  aria-hidden="true"
                />
                <span className="month-task-title">{task.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="month-weekdays" role="row">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="month-weekday" role="columnheader">
            周{label}
          </div>
        ))}
      </div>

      <div className="month-grid week-grid" role="grid">
        {weekDays.map((date) => {
          const key = toDateKey(date);
          const weekdayLabel = WEEKDAY_LABELS[(date.getDay() + 6) % 7];
          const dayTasks = tasksByDate.get(key) ?? [];
          const dayEvents = eventsByDate.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`month-cell week-cell ${isToday ? "is-today" : ""}`}
              role="gridcell"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropTask(event, key)}
            >
              <div className="month-cell-top week-cell-top">
                <div className="week-cell-date">
                  <span className="week-cell-date-main">
                    {date.getMonth() + 1}/{date.getDate()}
                  </span>
                  <span className="week-cell-weekday">周{weekdayLabel}</span>
                </div>
                <button
                  type="button"
                  className="month-cell-add week-cell-add"
                  onClick={() => onCreateTask(key)}
                  aria-label={`${key} 新建任务`}
                  title="新建任务"
                >
                  <Plus aria-hidden="true" />
                </button>
              </div>
              <div className="month-cell-body week-cell-body">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`month-event month-event-${event.eventType}`}
                    onClick={() => onEditEvent(event)}
                    title={`${calendarEventTypeCopy[event.eventType].label}：${event.title}`}
                  >
                    {event.title}
                  </button>
                ))}
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="month-task"
                    draggable
                    onDragStart={(event) => startTaskDrag(event, task)}
                    onDragEnd={() => setDraggingTaskId(null)}
                    onClick={() => onOpenTask(task)}
                    title={task.title}
                  >
                    <span
                      className={`month-task-dot ${priorityCopy[task.priority].className}`}
                      aria-hidden="true"
                    />
                    <span className="month-task-title">{task.title}</span>
                  </button>
                ))}
                {dayTasks.length === 0 && dayEvents.length === 0 && (
                  <span className="week-cell-empty" aria-hidden="true" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CalendarLegend />
    </div>
  );
}
