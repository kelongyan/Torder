import type {
  Task,
  TaskFilter,
  TaskScope,
  TaskSortBy,
} from "../types/database";
import type { TaskState } from "./taskStore";
import { filterAndSortTasks } from "../services/taskQuery";
import { notifyTasksChanged } from "../services/widgetService";
import { normalizeError } from "../utils/normalizeError";

/**
 * P1-05b：taskStore 的乐观更新事务管线与派生视图逻辑（从 taskStore.ts 拆出）。
 * taskStore 只声明 state/action 并委托本模块的 runOptimistic / runOptimisticBatch；
 * 失败回滚、快照、跨窗口通知与视图派生集中在此，单一职责、无循环依赖
 * （TaskState 仅作 type-only 引用，编译期擦除）。
 */

type SetState = (
  partial: Partial<TaskState> | ((state: TaskState) => Partial<TaskState>),
) => void;

export function isDeletedScope(scope: TaskScope): boolean {
  return scope.kind === "view" && scope.view === "deleted";
}

export function deriveTasks(view: {
  allTasks: Task[];
  trashTasks: Task[];
  scope: TaskScope;
  searchQuery: string;
  sortBy: TaskSortBy;
  sortAsc: boolean;
  filter: TaskFilter;
  showCompleted: boolean;
}): Task[] {
  const source = isDeletedScope(view.scope) ? view.trashTasks : view.allTasks;
  return filterAndSortTasks(source, {
    scope: view.scope,
    query: view.searchQuery,
    sortBy: view.sortBy,
    sortAsc: view.sortAsc,
    filter: view.filter,
    showCompleted: view.showCompleted,
  });
}

interface OptimisticSnapshot {
  allTasks: Task[];
  trashTasks: Task[];
  trashLoaded: boolean;
  sortBy: TaskSortBy;
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
}

/** 状态快照：reorderTasks 等自制回滚语义的 action 也需要。 */
export function takeSnapshot(state: TaskState): OptimisticSnapshot {
  return {
    allTasks: state.allTasks,
    trashTasks: state.trashTasks,
    trashLoaded: state.trashLoaded,
    sortBy: state.sortBy,
    selectedTaskId: state.selectedTaskId,
    batchMode: state.batchMode,
    batchSelectedIds: state.batchSelectedIds,
  };
}

/**
 * 单行乐观更新管线：预测 apply → IPC commit → 服务端返回值对账
 * （基于当前状态按 id 替换，容忍期间的外发 loadTasks）→ 失败时按受影响 id
 * 还原（与 runOptimisticBatch 同一做法），不覆盖期间并发成功的其它变更。
 * 不触碰 loading（只属于 loadTasks / 首次回收站拉取）。
 */
export async function runOptimistic<T>(
  get: () => TaskState,
  set: SetState,
  ids: string[],
  apply: (state: TaskState) => Partial<TaskState>,
  commit: () => Promise<T>,
  reconcile?: (result: T, state: TaskState) => Partial<TaskState>,
): Promise<T> {
  const snapshot = takeSnapshot(get());
  try {
    set((state) => {
      const patch = apply(state);
      return {
        ...patch,
        error: null,
        tasks: deriveTasks({ ...state, ...patch }),
      };
    });
    const result = await commit();
    if (reconcile) {
      set((state) => {
        const patch = reconcile(result, state);
        return { ...patch, tasks: deriveTasks({ ...state, ...patch }) };
      });
    }
    return result;
  } catch (error) {
    set((state) => {
      const restorePatch = restoreFailedRows(state, snapshot, ids);
      const merged = { ...state, ...restorePatch };
      return {
        ...restorePatch,
        error: normalizeError(error),
        tasks: deriveTasks(merged),
      };
    });
    throw error;
  } finally {
    // 通知所有窗口（含自身）任务变更；附带受影响日期，widget 仅在命中显示日期时重拉
    notifyTasksChanged("main", {
      previousTasks: snapshot.allTasks,
      currentTasks: get().allTasks,
    });
  }
}

/**
 * 批量乐观更新：一次性预测全部 → Promise.allSettled 并行 IPC →
 * 成功行按返回值对账，失败行从快照逐条还原。
 */
export async function runOptimisticBatch<T>(
  get: () => TaskState,
  set: SetState,
  ids: string[],
  apply: (state: TaskState) => Partial<TaskState>,
  commit: () => Promise<PromiseSettledResult<T>[]>,
  reconcile: (state: TaskState, fulfilled: T[]) => Partial<TaskState>,
): Promise<void> {
  const snapshot = takeSnapshot(get());
  try {
    set((state) => {
      const patch = apply(state);
      return {
        ...patch,
        error: null,
        tasks: deriveTasks({ ...state, ...patch }),
      };
    });
    const results = await commit();
    const failedIds = ids.filter(
      (_, index) => results[index].status === "rejected",
    );
    const firstRejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const fulfilled = results
      .filter(
        (result): result is PromiseFulfilledResult<T> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    set((state) => {
      const reconcilePatch = reconcile(state, fulfilled);
      const reconciled = { ...state, ...reconcilePatch };
      const restorePatch =
        failedIds.length > 0
          ? restoreFailedRows(reconciled, snapshot, failedIds)
          : {};
      const merged = { ...reconciled, ...restorePatch };
      return {
        ...reconcilePatch,
        ...restorePatch,
        error:
          firstRejected !== undefined
            ? normalizeError(firstRejected.reason)
            : null,
        tasks: deriveTasks(merged),
      };
    });
    if (firstRejected) throw firstRejected.reason;
  } catch (error) {
    if (get().error === null) {
      set((state) => ({
        ...snapshot,
        error: normalizeError(error),
        tasks: deriveTasks({ ...state, ...snapshot }),
      }));
    }
    throw error;
  } finally {
    // 通知所有窗口（含自身）任务变更；附带受影响日期，widget 仅在命中显示日期时重拉
    notifyTasksChanged("main", {
      previousTasks: snapshot.allTasks,
      currentTasks: get().allTasks,
    });
  }
}

/** 把失败 id 的行恢复为快照原值，并放回它原本所在的数组。 */
function restoreFailedRows(
  state: Pick<TaskState, "allTasks" | "trashTasks">,
  snapshot: OptimisticSnapshot,
  failedIds: string[],
): { allTasks: Task[]; trashTasks: Task[] } {
  const failed = new Set(failedIds);
  const originals = new Map<string, { task: Task; inTrash: boolean }>();
  for (const task of snapshot.trashTasks) {
    originals.set(task.id, { task, inTrash: true });
  }
  for (const task of snapshot.allTasks) {
    originals.set(task.id, { task, inTrash: false });
  }

  const rebuild = (current: Task[], wantTrash: boolean): Task[] => {
    const kept = current
      .filter((task) => {
        if (!failed.has(task.id)) return true;
        return originals.get(task.id)?.inTrash === wantTrash;
      })
      .map((task) =>
        failed.has(task.id) ? originals.get(task.id)!.task : task,
      );
    for (const id of failedIds) {
      const original = originals.get(id);
      if (!original || original.inTrash !== wantTrash) continue;
      if (!kept.some((task) => task.id === id)) kept.push(original.task);
    }
    return kept;
  };

  return {
    allTasks: rebuild(state.allTasks, false),
    trashTasks: rebuild(state.trashTasks, true),
  };
}
