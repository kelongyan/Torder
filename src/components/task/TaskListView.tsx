import { useMemo, useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import type {
  CreateTaskInput,
  Task,
  TaskList,
  TaskScope,
} from "../../types/database";
import { useAnimatedTasks } from "../../hooks/useAnimatedTasks";
import { toDateKey } from "../../utils/taskDates";
import { isMobile } from "../../utils/platform";
import { EmptyState } from "../common/EmptyState";
import { SectionHeader } from "../common/SectionHeader";
import { TaskQuickComposer } from "./TaskQuickComposer";
import { TaskRow } from "./TaskRow";
import { TaskTodayAgenda } from "./TaskTodayAgenda";

export function TaskListView({
  tasks,
  completedToday = [],
  lists,
  loading,
  selectedTaskId,
  batchMode,
  batchSelectedIds,
  searchQuery,
  scope,
  defaultListId = "work",
  trashRetentionDays,
  attachmentCounts = {},
  parseNaturalLanguage = true,
  moveCompletedImmediately = true,
  onOpenCreateDialog,
  onQuickCreate,
  onOpen,
  onToggle,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggleBatchSelected,
  onBatchComplete,
  onBatchDelete,
  onBatchRestore,
  onBatchPermanentDelete,
  onBatchEdit,
  onExitBatch,
  onEmptyTrash,
  onReorder,
}: {
  tasks: Task[];
  /** D4 今日已完成段：completedAt 在今天的已完成任务（App 层从 allTasks 筛出）。 */
  completedToday?: Task[];
  lists: TaskList[];
  loading: boolean;
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  searchQuery: string;
  scope: TaskScope;
  /** T-05 composer 落位用：当前视图推导出的默认清单。 */
  defaultListId?: string;
  /** T-14 回收站保留策略提示；null 表示未开启自动清理。 */
  trashRetentionDays?: number | null;
  /** T-15：`task_id -> 附件数` 映射（App 层透传 store.attachmentCounts）。 */
  attachmentCounts?: Record<string, number>;
  /** T-10 甲组：识别自然语言速记开关。 */
  parseNaturalLanguage?: boolean;
  /** T-10 甲组：关闭时刚打勾的事项暂留原位，不立刻跳到「已完成」段。 */
  moveCompletedImmediately?: boolean;
  /** T-12：空工作区引导的主动作（打开新建事项弹窗）。 */
  onOpenCreateDialog?: () => void;
  /** 不传则不渲染 composer（回收站等场景）。 */
  onQuickCreate?: (input: CreateTaskInput) => Promise<void>;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore: (task: Task) => void;
  onPermanentDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
  onBatchComplete: () => void;
  onBatchDelete: () => void;
  onBatchRestore: () => void;
  onBatchPermanentDelete: () => void;
  onBatchEdit: () => void;
  onExitBatch: () => void;
  onEmptyTrash: () => void;
  onReorder: (sourceId: string, targetId: string) => void;
}) {
  const deletedView = scope.kind === "view" && scope.view === "deleted";
  const todayView = scope.kind === "view" && scope.view === "today";
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragEnabled = !isMobile();
  const animatedTasks = useAnimatedTasks(tasks);
  /**
   * T-10 甲组「完成后立刻归入已完成」关闭时的留位行为：记住本次浏览中刚打勾的
   * 任务，让它们继续留在「进行中」段的原位，切视图（contentKey 换 key 重挂载）
   * 或重载后才归位。
   * 生效范围是保留已完成行的视图（全部 / 单个清单 / 已完成）。今天等视图的口径
   * 本身剔除已完成（taskQuery.matchesSystemView），关掉「显示已完成」时派生结果
   * 也已剔除该行——两种情况下隐藏都是视图过滤的语义，优先级高于本开关，故用
   * present 兜一层：不在派生结果里的 id 不留位，避免行整个消失。
   */
  const [pinnedDoneIds, setPinnedDoneIds] = useState<string[]>([]);
  const pinnedDone = useMemo(() => {
    if (moveCompletedImmediately || pinnedDoneIds.length === 0)
      return new Set<string>();
    const present = new Set(animatedTasks.map((item) => item.task.id));
    return new Set(pinnedDoneIds.filter((id) => present.has(id)));
  }, [animatedTasks, moveCompletedImmediately, pinnedDoneIds]);

  function handleToggle(task: Task) {
    if (!moveCompletedImmediately) {
      setPinnedDoneIds((ids) =>
        task.status === "done"
          ? // 撤销完成：解除留位，下次打勾重新记
            ids.filter((id) => id !== task.id)
          : ids.includes(task.id)
            ? ids
            : [...ids, task.id],
      );
    }
    onToggle(task);
  }

  const activeTasks = animatedTasks.filter(
    (item) => item.task.status !== "done" || pinnedDone.has(item.task.id),
  );
  const completedTasks = animatedTasks.filter(
    (item) => item.task.status === "done" && !pinnedDone.has(item.task.id),
  );
  const activeCount = activeTasks.filter((item) => !item.leaving).length;
  const completedCount = completedTasks.filter((item) => !item.leaving).length;
  /**
   * T-14 回收站分组：按 deletedAt 落到「今天删除 / 本周删除 / 更早」三桶。
   * 只在回收站视图用；deletedAt 缺失或不可解析时归入「更早」，保证任务不会因
   * 脏数据从列表里消失。
   */
  const trashGroups = useMemo(() => {
    if (!deletedView) return [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfToday);
    // 周一为一周起点（getDay() 周日为 0）
    startOfWeek.setDate(
      startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7),
    );

    const buckets: Record<string, typeof animatedTasks> = {
      today: [],
      week: [],
      earlier: [],
    };
    for (const item of animatedTasks) {
      const raw = item.task.deletedAt;
      const time = raw ? new Date(raw).getTime() : Number.NaN;
      if (Number.isNaN(time)) buckets.earlier.push(item);
      else if (time >= startOfToday.getTime()) buckets.today.push(item);
      else if (time >= startOfWeek.getTime()) buckets.week.push(item);
      else buckets.earlier.push(item);
    }
    return [
      { key: "today", label: "今天删除", items: buckets.today },
      { key: "week", label: "本周删除", items: buckets.week },
      { key: "earlier", label: "更早删除", items: buckets.earlier },
    ].filter((group) => group.items.length > 0);
  }, [animatedTasks, deletedView]);
  // 分组头完成进度（提案 §3-A）：done/total 挂在第一个分组头上
  const progress =
    completedCount > 0 && activeCount + completedCount > 0
      ? { done: completedCount, total: activeCount + completedCount }
      : undefined;

  if (loading && tasks.length === 0) {
    return (
      <div className="list-container">
        <div className="skeleton-list" aria-label="任务加载中">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="list-container">
        <EmptyState
          scope={scope}
          searchQuery={searchQuery}
          onPrimary={onOpenCreateDialog}
        />
      </div>
    );
  }

  return (
    <div className={`list-container ${batchMode ? "batching" : ""}`}>
      {batchMode && (
        <div className="batch-bar">
          <span>已选 {batchSelectedIds.length} 项</span>
          {deletedView ? (
            <>
              <button
                type="button"
                onClick={onBatchRestore}
                disabled={batchSelectedIds.length === 0}
              >
                <Check aria-hidden="true" className="icon-sm" />
                恢复
              </button>
              <button
                type="button"
                onClick={onBatchPermanentDelete}
                disabled={batchSelectedIds.length === 0}
              >
                <Trash2 aria-hidden="true" className="icon-sm" />
                永久删除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onBatchComplete}
                disabled={batchSelectedIds.length === 0}
              >
                <Check aria-hidden="true" className="icon-sm" />
                完成
              </button>
              <button
                type="button"
                onClick={onBatchEdit}
                disabled={batchSelectedIds.length === 0}
              >
                <Pencil aria-hidden="true" className="icon-sm" />
                编辑
              </button>
              <button
                type="button"
                onClick={onBatchDelete}
                disabled={batchSelectedIds.length === 0}
              >
                <Trash2 aria-hidden="true" className="icon-sm" />
                删除
              </button>
            </>
          )}
          <button type="button" onClick={onExitBatch}>
            退出
          </button>
        </div>
      )}
      {deletedView ? (
        <>
          <div className="trash-toolbar">
            <SectionHeader label={`回收站 · ${animatedTasks.length}`} />
            {/* T-14：读 settings.trashRetentionDays，让保留策略在现场可见 */}
            <span className="trash-retention-note">
              {trashRetentionDays === null || trashRetentionDays === undefined
                ? "未开启自动清理"
                : `${trashRetentionDays} 天后自动清理`}
            </span>
            <button type="button" className="btn-danger" onClick={onEmptyTrash}>
              <Trash2 aria-hidden="true" className="icon-sm" />
              清空回收站
            </button>
          </div>
          {/* F1 · T-14：按删除时间分组（今天 / 本周 / 更早），组内保持原顺序 */}
          {trashGroups.map((group) => (
            <div key={group.key} className="trash-group">
              <SectionHeader label={`${group.label} · ${group.items.length}`} />
              {group.items.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={index}
                  searchQuery={searchQuery}
                  deleted
                  attachmentCount={attachmentCounts[item.task.id] ?? 0}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onPermanentDelete={onPermanentDelete}
                  onToggleBatchSelected={onToggleBatchSelected}
                />
              ))}
            </div>
          ))}
        </>
      ) : todayView ? (
        <TaskTodayAgenda
          items={animatedTasks}
          completedItems={completedToday}
          lists={lists}
          selectedTaskId={selectedTaskId}
          batchMode={batchMode}
          batchSelectedIds={batchSelectedIds}
          searchQuery={searchQuery}
          onOpen={onOpen}
          onToggle={onToggle}
          onDelete={onDelete}
          onToggleBatchSelected={onToggleBatchSelected}
          onReorder={onReorder}
        />
      ) : (
        <>
          {activeTasks.length > 0 && (
            <>
              <SectionHeader
                label={`进行中 · ${activeCount}`}
                progress={progress}
              />
              {activeTasks.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={index}
                  searchQuery={searchQuery}
                  attachmentCount={attachmentCounts[item.task.id] ?? 0}
                  onOpen={onOpen}
                  onToggle={handleToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onPermanentDelete={onPermanentDelete}
                  onToggleBatchSelected={onToggleBatchSelected}
                  draggable={dragEnabled && !batchMode && !item.leaving}
                  dragging={draggingId === item.task.id}
                  onDragStart={(task) => setDraggingId(task.id)}
                  onDragOver={() => undefined}
                  onDrop={(task) => {
                    if (draggingId) onReorder(draggingId, task.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
            </>
          )}
          {completedTasks.length > 0 && (
            <>
              <SectionHeader
                label={`已完成 · ${completedCount}`}
                progress={activeTasks.length === 0 ? progress : undefined}
              />
              {completedTasks.map((item, index) => (
                <TaskRow
                  key={item.task.id}
                  task={item.task}
                  lists={lists}
                  selected={item.task.id === selectedTaskId}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(item.task.id)}
                  leaving={item.leaving}
                  motionIndex={activeTasks.length + index}
                  searchQuery={searchQuery}
                  attachmentCount={attachmentCounts[item.task.id] ?? 0}
                  onOpen={onOpen}
                  onToggle={handleToggle}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onPermanentDelete={onPermanentDelete}
                  onToggleBatchSelected={onToggleBatchSelected}
                  draggable={dragEnabled && !batchMode && !item.leaving}
                  dragging={draggingId === item.task.id}
                  onDragStart={(task) => setDraggingId(task.id)}
                  onDragOver={() => undefined}
                  onDrop={(task) => {
                    if (draggingId) onReorder(draggingId, task.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
            </>
          )}
        </>
      )}
      {!deletedView && !batchMode && onQuickCreate && (
        <TaskQuickComposer
          lists={lists}
          defaultListId={defaultListId}
          parseNaturalLanguage={parseNaturalLanguage}
          overrides={
            // 今天视图里新建的事项要留在当前视图，否则建完就"消失"
            todayView ? { scheduledDate: toDateKey(new Date()) } : undefined
          }
          onCreate={onQuickCreate}
        />
      )}
    </div>
  );
}
