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

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function monthTitle(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

export function MonthCalendar({
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
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });
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

  const cells = useMemo(() => {
    const first = startOfMonth(cursor.year, cursor.month);
    const gridStart = new Date(first);
    const leading = (first.getDay() + 6) % 7; // 周一开头
    gridStart.setDate(first.getDate() - leading);
    const result: Date[] = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      result.push(date);
    }
    return result;
  }, [cursor]);

  const todayKey = toDateKey(today);

  const moveMonth = (delta: number) => {
    setCursor((current) => {
      const total = current.year * 12 + current.month + delta;
      return { year: Math.floor(total / 12), month: total % 12 };
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
    <div className="month-view">
      <header className="month-header">
        <div className="month-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => moveMonth(-1)}
            aria-label="上个月"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <h2 className="month-title">
            {monthTitle(cursor.year, cursor.month)}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={() => moveMonth(1)}
            aria-label="下个月"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-secondary month-today"
            onClick={() =>
              setCursor({ year: today.getFullYear(), month: today.getMonth() })
            }
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

      <div className="month-grid" role="grid">
        {cells.map((date) => {
          const key = toDateKey(date);
          const inMonth = date.getMonth() === cursor.month;
          const dayTasks = tasksByDate.get(key) ?? [];
          const dayEvents = eventsByDate.get(key) ?? [];
          return (
            <div
              key={key}
              className={`month-cell ${inMonth ? "" : "is-outside"} ${key === todayKey ? "is-today" : ""}`}
              role="gridcell"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropTask(event, key)}
            >
              <div className="month-cell-top">
                <span className="month-cell-date">{date.getDate()}</span>
                <button
                  type="button"
                  className="month-cell-add"
                  onClick={() => onCreateTask(key)}
                  aria-label={`${key} 新建任务`}
                  title="新建任务"
                >
                  <Plus aria-hidden="true" />
                </button>
              </div>
              <div className="month-cell-body">
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
              </div>
            </div>
          );
        })}
      </div>

      <CalendarLegend />
    </div>
  );
}
