import { create } from "zustand";
import { persist } from "zustand/middleware";
import { filterAndSortTasks } from "../services/taskQuery";
import {
  createTask,
  deleteTask,
  emptyTrash,
  permanentDeleteTask,
  queryTasks,
  restoreTask,
  setTaskCompleted,
  snoozeTaskReminder,
  updateTask,
} from "../services/taskService";
import { notifyTasksChanged } from "../services/widgetService";
import { normalizeError } from "../utils/normalizeError";
import {
  predictCompletedTask,
  predictCreatedTask,
  predictDeletedTask,
  predictRestoredTask,
  predictSnoozedTask,
  predictUpdatedTask,
} from "../utils/taskPrediction";
import type {
  CreateTaskInput,
  SystemView,
  Task,
  TaskLayout,
  TaskScope,
  TaskSortBy,
  UpdateTaskInput,
} from "../types/database";

interface TaskState {
  scope: TaskScope;
  layout: TaskLayout;
  searchQuery: string;
  sortBy: TaskSortBy;
  showCompleted: boolean;
  allTasks: Task[];
  tasks: Task[];
  trashTasks: Task[];
  trashLoaded: boolean;
  initialized: boolean;
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  loading: boolean;
  error: string | null;
  setScope: (scope: TaskScope) => Promise<void>;
  setLayout: (layout: TaskLayout) => void;
  setSearchQuery: (query: string) => Promise<void>;
  setSortBy: (sortBy: TaskSortBy) => Promise<void>;
  setShowCompleted: (showCompleted: boolean) => Promise<void>;
  applyViewState: (state: {
    scope: TaskScope;
    searchQuery: string;
    sortBy: TaskSortBy;
    showCompleted: boolean;
    layout?: TaskLayout;
  }) => Promise<void>;
  loadTasks: () => Promise<void>;
  addTask: (input: CreateTaskInput) => Promise<Task>;
  saveTask: (input: UpdateTaskInput) => Promise<Task>;
  toggleTask: (id: string, completed: boolean) => Promise<Task>;
  removeTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  permanentDeleteTask: (id: string) => Promise<void>;
  emptyTrash: () => Promise<number>;
  batchComplete: () => Promise<void>;
  batchDelete: () => Promise<void>;
  batchRestore: () => Promise<void>;
  batchPermanentDelete: () => Promise<void>;
  batchUpdate: (
    patch: Partial<
      Pick<
        UpdateTaskInput,
        "listId" | "priority" | "scheduledDate" | "dueAt" | "remindBefore"
      >
    >,
  ) => Promise<void>;
  reorderTasks: (sourceId: string, targetId: string) => Promise<void>;
  patchTask: (
    id: string,
    patch: Partial<Omit<UpdateTaskInput, "id">>,
  ) => Promise<Task>;
  snoozeTask: (id: string, remindAt: string) => Promise<Task>;
  refreshTrash: () => Promise<void>;
  rederive: () => void;
  selectTask: (id: string | null) => void;
  toggleBatchMode: () => void;
  toggleBatchSelected: (id: string) => void;
  clearBatchSelection: () => void;
  clearError: () => void;
}

let taskRequestSequence = 0;

export const defaultTaskScope: TaskScope = { kind: "view", view: "all" };

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      scope: defaultTaskScope,
      layout: "list",
      searchQuery: "",
      sortBy: "priority",
      showCompleted: true,
      allTasks: [],
      tasks: [],
      trashTasks: [],
      trashLoaded: false,
      initialized: false,
      selectedTaskId: null,
      batchMode: false,
      batchSelectedIds: [],
      loading: false,
      error: null,

      setScope: async (scope) => {
        set({ scope, selectedTaskId: null, batchSelectedIds: [] });
        if (!get().initialized) {
          await get().loadTasks();
          return;
        }
        if (isDeletedScope(scope) && !get().trashLoaded) {
          set({ loading: true });
          await get().refreshTrash();
          set({ loading: false });
          return;
        }
        get().rederive();
      },

      setLayout: (layout) => set({ layout }),

      setSearchQuery: async (searchQuery) => {
        set((state) => ({
          searchQuery,
          selectedTaskId: null,
          batchSelectedIds: [],
          tasks: deriveTasks({ ...state, searchQuery }),
        }));
      },

      setSortBy: async (sortBy) => {
        set((state) => ({ sortBy, tasks: deriveTasks({ ...state, sortBy }) }));
      },

      setShowCompleted: async (showCompleted) => {
        set((state) => ({
          showCompleted,
          selectedTaskId: null,
          batchSelectedIds: [],
          tasks: deriveTasks({ ...state, showCompleted }),
        }));
      },

      applyViewState: async (next) => {
        set((state) => ({
          scope: next.scope,
          searchQuery: next.searchQuery,
          sortBy: next.sortBy,
          showCompleted: next.showCompleted,
          layout: next.layout ?? state.layout,
          selectedTaskId: null,
          batchSelectedIds: [],
          tasks: deriveTasks({
            ...state,
            scope: next.scope,
            searchQuery: next.searchQuery,
            sortBy: next.sortBy,
            showCompleted: next.showCompleted,
          }),
        }));
        if (!get().initialized) {
          await get().loadTasks();
          return;
        }
        if (isDeletedScope(next.scope) && !get().trashLoaded) {
          set({ loading: true });
          await get().refreshTrash();
          set({ loading: false });
        }
      },

      loadTasks: async () => {
        const requestId = ++taskRequestSequence;
        set({ loading: true, error: null });
        try {
          const { scope, sortBy, trashLoaded } = get();
          const needTrash = trashLoaded || isDeletedScope(scope);
          const [allTasks, trashTasks] = await Promise.all([
            queryTasks({
              scope: defaultTaskScope,
              query: "",
              sortBy,
              showCompleted: true,
            }),
            needTrash
              ? queryTasks({
                  scope: viewScope("deleted"),
                  query: "",
                  sortBy: "created",
                  showCompleted: true,
                })
              : Promise.resolve(null),
          ]);
          if (requestId !== taskRequestSequence) return;
          set((state) => {
            const nextTrash = trashTasks ?? state.trashTasks;
            const merged = {
              ...state,
              allTasks,
              trashTasks: nextTrash,
              trashLoaded: state.trashLoaded || trashTasks !== null,
            };
            return {
              ...merged,
              initialized: true,
              loading: false,
              tasks: deriveTasks(merged),
            };
          });
        } catch (error) {
          if (requestId !== taskRequestSequence) return;
          set({ loading: false, error: normalizeError(error) });
        }
      },

      addTask: async (input) => {
        const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return runOptimistic(
          get,
          set,
          (state) => ({
            allTasks: [predictCreatedTask(input, tempId), ...state.allTasks],
          }),
          () => createTask(input),
          (created, state) => ({
            allTasks: upsertTask(removeTaskRow(state.allTasks, tempId), created),
            selectedTaskId:
              state.selectedTaskId === tempId ? created.id : state.selectedTaskId,
            batchSelectedIds: state.batchSelectedIds.map((id) =>
              id === tempId ? created.id : id,
            ),
          }),
        );
      },

      saveTask: async (input) => {
        const existing = get().allTasks.find((task) => task.id === input.id);
        if (!existing) throw new Error("任务不存在");
        return runOptimistic(
          get,
          set,
          (state) => ({
            allTasks: upsertTask(
              state.allTasks,
              predictUpdatedTask(existing, input),
            ),
          }),
          () => updateTask(input),
          (updated, state) => ({ allTasks: upsertTask(state.allTasks, updated) }),
        );
      },

      toggleTask: async (id, completed) => {
        const existing = get().allTasks.find((task) => task.id === id);
        if (!existing) throw new Error("任务不存在");
        return runOptimistic(
          get,
          set,
          (state) => ({
            allTasks: upsertTask(
              state.allTasks,
              predictCompletedTask(existing, completed),
            ),
          }),
          () => setTaskCompleted(id, completed),
          (updated, state) => ({ allTasks: upsertTask(state.allTasks, updated) }),
        );
      },

      removeTask: async (id) => {
        await runOptimistic(
          get,
          set,
          (state) => {
            const task = state.allTasks.find((item) => item.id === id);
            const nowIso = new Date().toISOString();
            return {
              allTasks: removeTaskRow(state.allTasks, id),
              trashTasks: task
                ? [predictDeletedTask(task, nowIso), ...state.trashTasks]
                : state.trashTasks,
              selectedTaskId:
                state.selectedTaskId === id ? null : state.selectedTaskId,
              batchSelectedIds: state.batchSelectedIds.filter(
                (selectedId) => selectedId !== id,
              ),
            };
          },
          () => deleteTask(id),
        );
      },

      restoreTask: async (id) => {
        await runOptimistic(
          get,
          set,
          (state) => {
            const task = state.trashTasks.find((item) => item.id === id);
            const nowIso = new Date().toISOString();
            return {
              trashTasks: removeTaskRow(state.trashTasks, id),
              allTasks: task
                ? [predictRestoredTask(task, nowIso), ...state.allTasks]
                : state.allTasks,
              selectedTaskId:
                state.selectedTaskId === id ? null : state.selectedTaskId,
              batchSelectedIds: state.batchSelectedIds.filter(
                (selectedId) => selectedId !== id,
              ),
            };
          },
          () => restoreTask(id),
          (restored, state) => ({
            allTasks: upsertTask(state.allTasks, restored),
            trashTasks: removeTaskRow(state.trashTasks, id),
          }),
        );
      },

      permanentDeleteTask: async (id) => {
        await runOptimistic(
          get,
          set,
          (state) => ({
            trashTasks: removeTaskRow(state.trashTasks, id),
            selectedTaskId:
              state.selectedTaskId === id ? null : state.selectedTaskId,
            batchSelectedIds: state.batchSelectedIds.filter(
              (selectedId) => selectedId !== id,
            ),
          }),
          () => permanentDeleteTask(id),
        );
      },

      emptyTrash: async () => {
        return runOptimistic(
          get,
          set,
          () => ({
            trashTasks: [],
            selectedTaskId: null,
            batchSelectedIds: [],
            batchMode: false,
          }),
          () => emptyTrash(),
        );
      },

      batchComplete: async () => {
        const selectedIds = get().batchSelectedIds;
        await runOptimisticBatch(
          get,
          set,
          selectedIds,
          (state) => {
            let allTasks = state.allTasks;
            for (const id of selectedIds) {
              const task = allTasks.find((item) => item.id === id);
              if (task) allTasks = upsertTask(allTasks, predictCompletedTask(task, true));
            }
            return { allTasks, batchSelectedIds: [], batchMode: false };
          },
          () => Promise.allSettled(selectedIds.map((id) => setTaskCompleted(id, true))),
          (state, fulfilled) => {
            let allTasks = state.allTasks;
            for (const task of fulfilled) allTasks = upsertTask(allTasks, task);
            return { allTasks };
          },
        );
      },

      batchDelete: async () => {
        const selectedIds = get().batchSelectedIds;
        await runOptimisticBatch(
          get,
          set,
          selectedIds,
          (state) => {
            const nowIso = new Date().toISOString();
            const moved = state.allTasks.filter((task) => selectedIds.includes(task.id));
            return {
              allTasks: state.allTasks.filter((task) => !selectedIds.includes(task.id)),
              trashTasks: [
                ...moved.map((task) => predictDeletedTask(task, nowIso)),
                ...state.trashTasks,
              ],
              selectedTaskId: null,
              batchSelectedIds: [],
              batchMode: false,
            };
          },
          () => Promise.allSettled(selectedIds.map((id) => deleteTask(id))),
          () => ({}),
        );
      },

      batchRestore: async () => {
        const selectedIds = get().batchSelectedIds;
        await runOptimisticBatch(
          get,
          set,
          selectedIds,
          (state) => {
            const nowIso = new Date().toISOString();
            const moved = state.trashTasks.filter((task) => selectedIds.includes(task.id));
            return {
              trashTasks: state.trashTasks.filter((task) => !selectedIds.includes(task.id)),
              allTasks: [
                ...moved.map((task) => predictRestoredTask(task, nowIso)),
                ...state.allTasks,
              ],
              selectedTaskId: null,
              batchSelectedIds: [],
              batchMode: false,
            };
          },
          () => Promise.allSettled(selectedIds.map((id) => restoreTask(id))),
          (state, fulfilled) => {
            let allTasks = state.allTasks;
            for (const task of fulfilled) allTasks = upsertTask(allTasks, task);
            return { allTasks };
          },
        );
      },

      batchPermanentDelete: async () => {
        const selectedIds = get().batchSelectedIds;
        await runOptimisticBatch(
          get,
          set,
          selectedIds,
          (state) => ({
            trashTasks: state.trashTasks.filter(
              (task) => !selectedIds.includes(task.id),
            ),
            selectedTaskId: null,
            batchSelectedIds: [],
            batchMode: false,
          }),
          () => Promise.allSettled(selectedIds.map((id) => permanentDeleteTask(id))),
          () => ({}),
        );
      },

      batchUpdate: async (patch) => {
        const selectedIds = get().batchSelectedIds;
        const inputs: UpdateTaskInput[] = [];
        for (const task of get().allTasks) {
          if (!selectedIds.includes(task.id)) continue;
          inputs.push(buildUpdateInput(task, patch));
        }
        await runOptimisticBatch(
          get,
          set,
          inputs.map((input) => input.id),
          (state) => {
            let allTasks = state.allTasks;
            for (const input of inputs) {
              const task = allTasks.find((item) => item.id === input.id);
              if (task) allTasks = upsertTask(allTasks, predictUpdatedTask(task, input));
            }
            return { allTasks, batchSelectedIds: [], batchMode: false };
          },
          () => Promise.allSettled(inputs.map((input) => updateTask(input))),
          (state, fulfilled) => {
            let allTasks = state.allTasks;
            for (const task of fulfilled) allTasks = upsertTask(allTasks, task);
            return { allTasks };
          },
        );
      },

      reorderTasks: async (sourceId, targetId) => {
        const current = get().tasks.filter((task) => !task.deletedAt);
        const sourceIndex = current.findIndex((task) => task.id === sourceId);
        const targetIndex = current.findIndex((task) => task.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
          return;
        const reordered = [...current];
        const [source] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, source);
        const updates: { task: Task; sortOrder: number }[] = [];
        for (const [index, task] of reordered.entries()) {
          const sortOrder = index * 1000;
          if (task.sortOrder === sortOrder) continue;
          updates.push({ task, sortOrder });
        }
        const snapshot = takeSnapshot(get());
        set((state) => {
          const patch = {
            allTasks: state.allTasks.map((task) => {
              const update = updates.find((item) => item.task.id === task.id);
              return update ? { ...task, sortOrder: update.sortOrder } : task;
            }),
            sortBy: "manual" as TaskSortBy,
          };
          return {
            ...patch,
            error: null,
            tasks: deriveTasks({ ...state, ...patch }),
          };
        });
        const results = await Promise.allSettled(
          updates.map(({ task, sortOrder }) =>
            updateTask(buildUpdateInput(task, { sortOrder })),
          ),
        );
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected) {
          // 手工排序是一个整体状态，任一失败全量回滚
          set((state) => ({
            ...snapshot,
            error: normalizeError(rejected.reason),
            tasks: deriveTasks({ ...state, ...snapshot }),
          }));
          throw rejected.reason;
        }
        set((state) => {
          let allTasks = state.allTasks;
          for (const result of results) {
            if (result.status === "fulfilled")
              allTasks = upsertTask(allTasks, result.value);
          }
          return { allTasks, tasks: deriveTasks({ ...state, allTasks }) };
        });
      },

      patchTask: async (id, patch) => {
        const existing =
          get().allTasks.find((item) => item.id === id) ??
          get().tasks.find((item) => item.id === id);
        if (!existing) throw new Error("任务不存在");
        const input = buildUpdateInput(existing, patch);
        return runOptimistic(
          get,
          set,
          (state) => ({
            allTasks: upsertTask(
              state.allTasks,
              predictUpdatedTask(existing, input),
            ),
          }),
          () => updateTask(input),
          (updated, state) => ({ allTasks: upsertTask(state.allTasks, updated) }),
        );
      },

      snoozeTask: async (id, remindAt) => {
        return runOptimistic(
          get,
          set,
          (state) => {
            const task = state.allTasks.find((item) => item.id === id);
            return task
              ? {
                  allTasks: upsertTask(
                    state.allTasks,
                    predictSnoozedTask(task, remindAt),
                  ),
                }
              : {};
          },
          () => snoozeTaskReminder(id, remindAt),
          (updated, state) => ({ allTasks: upsertTask(state.allTasks, updated) }),
        );
      },

      refreshTrash: async () => {
        try {
          const trashTasks = await queryTasks({
            scope: viewScope("deleted"),
            query: "",
            sortBy: "created",
            showCompleted: true,
          });
          set((state) => ({
            trashTasks,
            trashLoaded: true,
            tasks: isDeletedScope(state.scope)
              ? deriveTasks({ ...state, trashTasks })
              : state.tasks,
          }));
        } catch (error) {
          set({ error: normalizeError(error) });
        }
      },

      rederive: () => set((state) => ({ tasks: deriveTasks(state) })),

      selectTask: (selectedTaskId) => set({ selectedTaskId }),

      toggleBatchMode: () =>
        set((state) => ({
          batchMode: !state.batchMode,
          batchSelectedIds: [],
          selectedTaskId: state.batchMode ? state.selectedTaskId : null,
        })),

      toggleBatchSelected: (id) =>
        set((state) => ({
          batchSelectedIds: state.batchSelectedIds.includes(id)
            ? state.batchSelectedIds.filter((selectedId) => selectedId !== id)
            : [...state.batchSelectedIds, id],
        })),

      clearBatchSelection: () =>
        set({ batchSelectedIds: [], batchMode: false }),
      clearError: () => set({ error: null }),
    }),
    {
      name: "torder-ui-state",
      partialize: (state) => ({
        scope: state.scope,
        layout: state.layout,
        sortBy: state.sortBy,
        showCompleted: state.showCompleted,
      }),
    },
  ),
);

export function viewScope(view: SystemView): TaskScope {
  return { kind: "view", view };
}

export function listScope(listId: string): TaskScope {
  return { kind: "list", listId };
}

type SetState = (
  partial: Partial<TaskState> | ((state: TaskState) => Partial<TaskState>),
) => void;

function isDeletedScope(scope: TaskScope): boolean {
  return scope.kind === "view" && scope.view === "deleted";
}

function deriveTasks(view: {
  allTasks: Task[];
  trashTasks: Task[];
  scope: TaskScope;
  searchQuery: string;
  sortBy: TaskSortBy;
  showCompleted: boolean;
}): Task[] {
  const source = isDeletedScope(view.scope) ? view.trashTasks : view.allTasks;
  return filterAndSortTasks(source, {
    scope: view.scope,
    query: view.searchQuery,
    sortBy: view.sortBy,
    showCompleted: view.showCompleted,
  });
}

function buildUpdateInput(
  task: Task,
  patch: Partial<Omit<UpdateTaskInput, "id">> = {},
): UpdateTaskInput {
  return {
    id: task.id,
    title: task.title,
    note: task.note,
    status: task.status,
    priority: task.priority,
    listId: task.listId,
    scheduledDate: task.scheduledDate,
    dueAt: task.dueAt,
    sortOrder: task.sortOrder,
    remindBefore: task.remindBefore,
    repeatRule: task.repeatRule,
    subtasks: task.subtasks,
    tags: task.tags,
    ...patch,
  };
}

function upsertTask(tasks: Task[], next: Task): Task[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index < 0) return [next, ...tasks];
  return tasks.map((task, taskIndex) => (taskIndex === index ? next : task));
}

function removeTaskRow(tasks: Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id);
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

function takeSnapshot(state: TaskState): OptimisticSnapshot {
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
 * （基于当前状态按 id 替换，容忍期间的外发 loadTasks）→ 失败回滚快照。
 * 不触碰 loading（只属于 loadTasks / 首次回收站拉取）。
 */
async function runOptimistic<T>(
  get: () => TaskState,
  set: SetState,
  apply: (state: TaskState) => Partial<TaskState>,
  commit: () => Promise<T>,
  reconcile?: (result: T, state: TaskState) => Partial<TaskState>,
): Promise<T> {
  const snapshot = takeSnapshot(get());
  try {
    set((state) => {
      const patch = apply(state);
      return { ...patch, error: null, tasks: deriveTasks({ ...state, ...patch }) };
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
    set((state) => ({
      ...snapshot,
      error: normalizeError(error),
      tasks: deriveTasks({ ...state, ...snapshot }),
    }));
    throw error;
  } finally {
    notifyTasksChanged("main");
  }
}

/**
 * 批量乐观更新：一次性预测全部 → Promise.allSettled 并行 IPC →
 * 成功行按返回值对账，失败行从快照逐条还原。
 */
async function runOptimisticBatch<T>(
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
      return { ...patch, error: null, tasks: deriveTasks({ ...state, ...patch }) };
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
    notifyTasksChanged("main");
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
      .map((task) => (failed.has(task.id) ? originals.get(task.id)!.task : task));
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
