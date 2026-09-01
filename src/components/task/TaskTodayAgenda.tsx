import { Fragment, useEffect, useState } from "react";
import {
  formatTimeOfDay,
  isOverdue,
  toLocalDateKey,
} from "../../utils/taskDates";
import type { Task, TaskList } from "../../types/database";
import type { AnimatedTask } from "../../hooks/useAnimatedTasks";
import { SectionHeader } from "../common/SectionHeader";
import { TaskRow } from "./TaskRow";

/**
 * 「今天」视图的时间轴议程（提案 D 试点，方案 §3-D）：
 * 逾期区（计划今天但到期日已过）→ 日程区（今天有时刻，按时间排列 +
 * now 指示线）→ 全天区（无时刻：仅计划 / 00:00 截止）。
 * 视图口径不变（today = 计划日期在今天且未完成），时间轴只重排展示。
 */
export function TaskTodayAgenda({
  items,
  lists,
  selectedTaskId,
  batchMode,
  batchSelectedIds,
  searchQuery,
  onOpen,
  onToggle,
  onDelete,
  onToggleBatchSelected,
  onReorder,
}: {
  items: AnimatedTask[];
  lists: TaskList[];
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  searchQuery: string;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
}) {
  const now = useNowMinute();
  const todayKey = toLocalDateKey(now.toISOString());
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const overdueItems = items
    .filter(({ task }) => isOverdue(task.dueAt, task.status))
    .sort((left, right) => compareDue(left.task, right.task));
  const agendaItems = items
    .filter(({ task }) => isTimedToday(task, todayKey))
    .sort((left, right) => compareDue(left.task, right.task));
  const alldayItems = items.filter(
    ({ task }) =>
      !isOverdue(task.dueAt, task.status) && !isTimedToday(task, todayKey),
  );

  const liveCount = (list: AnimatedTask[]) =>
    list.filter(({ leaving }) => !leaving).length;

  // now 线插入第一个「开始时间晚于当前时刻」的槽位前，全部已过点则贴在日程末尾
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const insertAt = agendaItems.findIndex(
    ({ task }) => task.dueAt && minuteOfDay(task.dueAt) > nowMinutes,
  );
  const liveItems = items.filter(({ leaving }) => !leaving);
  const completedCount = liveItems.filter(
    ({ task }) => task.status === "done",
  ).length;
  const overdueCount = overdueItems.filter(({ leaving }) => !leaving).length;
  const totalCount = liveItems.length;
  const remainingCount = Math.max(0, totalCount - completedCount);

  function renderRow(
    { task, leaving }: AnimatedTask,
    motionIndex: number,
    options: { timeGutter?: string; draggable?: boolean } = {},
  ) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        lists={lists}
        selected={task.id === selectedTaskId}
        batchMode={batchMode}
        batchSelected={batchSelectedIds.includes(task.id)}
        leaving={leaving}
        motionIndex={motionIndex}
        searchQuery={searchQuery}
        timeGutter={options.timeGutter}
        onOpen={onOpen}
        onToggle={onToggle}
        onDelete={onDelete}
        onToggleBatchSelected={onToggleBatchSelected}
        draggable={Boolean(options.draggable) && !batchMode && !leaving}
        dragging={draggingId === task.id}
        onDragStart={(dragTask) => setDraggingId(dragTask.id)}
        onDragOver={() => undefined}
        onDrop={(dragTask) => {
          if (draggingId) onReorder(draggingId, dragTask.id);
          setDraggingId(null);
        }}
        onDragEnd={() => setDraggingId(null)}
      />
    );
  }

  return (
    <>
      <div className="task-pace" aria-label="今日节奏">
        <span className="task-pace-bar" aria-hidden="true">
          <i
            style={{
              width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
            }}
          />
        </span>
        <span className="task-pace-text">
          <strong>{completedCount}</strong>/{totalCount} 项已完成
        </span>
        {overdueCount > 0 && (
          <span className="task-pace-overdue">逾期 {overdueCount}</span>
        )}
        <span className="task-pace-left">还有 {remainingCount} 项待推进</span>
      </div>
      {overdueItems.length > 0 && (
        <Fragment key="overdue">
          <SectionHeader label={`逾期 · ${liveCount(overdueItems)}`} />
          {overdueItems.map((item, index) => renderRow(item, index))}
        </Fragment>
      )}
      {agendaItems.length > 0 && (
        <Fragment key="agenda">
          <SectionHeader label={`日程 · ${liveCount(agendaItems)}`} />
          {agendaItems.flatMap(({ task, leaving }, index) => {
            const row = renderRow({ task, leaving }, index, {
              timeGutter: formatTimeOfDay(new Date(task.dueAt!)),
            });
            return index === insertAt
              ? [<TaskNowLine key={`now-${task.id}`} now={now} />, row]
              : [row];
          })}
          {insertAt < 0 && <TaskNowLine now={now} />}
        </Fragment>
      )}
      {alldayItems.length > 0 && (
        <Fragment key="allday">
          <SectionHeader label={`全天 · ${liveCount(alldayItems)}`} />
          {alldayItems.map((item, index) =>
            renderRow(item, index, { draggable: true }),
          )}
        </Fragment>
      )}
    </>
  );
}

/** 今天有具体时刻（dueAt 是今天且非 00:00）→ 进入日程时间轴。 */
function isTimedToday(task: Task, todayKey: string | null): boolean {
  if (!task.dueAt || !todayKey) return false;
  if (toLocalDateKey(task.dueAt) !== todayKey) return false;
  const time = new Date(task.dueAt);
  return time.getHours() !== 0 || time.getMinutes() !== 0;
}

function compareDue(left: Task, right: Task): number {
  if (!left.dueAt && !right.dueAt) return 0;
  if (!left.dueAt) return 1;
  if (!right.dueAt) return -1;
  return left.dueAt.localeCompare(right.dueAt);
}

function minuteOfDay(iso: string): number {
  const time = new Date(iso);
  return time.getHours() * 60 + time.getMinutes();
}

/** 当前时刻，30s 粒度足够驱动 now 指示线移动。 */
function useNowMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function TaskNowLine({ now }: { now: Date }) {
  return (
    <div
      className="task-now-line"
      role="separator"
      aria-label={`现在 ${formatTimeOfDay(now)}`}
    >
      <span className="task-now-min">{formatTimeOfDay(now)}</span>
      <span className="task-now-track" />
    </div>
  );
}
