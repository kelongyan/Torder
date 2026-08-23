import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent, Task } from "../../types/database";
import { priorityCopy } from "../../constants/taskConfig";
import { calendarEventTypeCopy } from "../../constants/calendarEventConfig";
import {
  WEEKDAY_LABELS,
  buildEventsByDate,
  buildTasksByDate,
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
  onCreateEvent,
  onEditEvent,
  onMoveTaskDate,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  showCompleted: boolean;
  onOpenTask: (task: Task) => void;
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
          const dayTasks = tasksByDate.get(key) ?? [];
          const dayEvents = eventsByDate.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`month-cell week-cell ${isToday ? "is-today" : ""}`}
              role="gridcell"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingTaskId) onMoveTaskDate(draggingTaskId, key);
                setDraggingTaskId(null);
              }}
            >
              <div className="month-cell-top">
                <span className="month-cell-date">
                  {date.getMonth() + 1}/{date.getDate()}
                </span>
                <button
                  type="button"
                  className="month-cell-add"
                  onClick={() => onCreateEvent(key)}
                  aria-label={`${key} 新建事件`}
                  title="新建日程事件"
                >
                  +
                </button>
              </div>
              <div className="week-cell-body">
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
                    onDragStart={() => setDraggingTaskId(task.id)}
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
