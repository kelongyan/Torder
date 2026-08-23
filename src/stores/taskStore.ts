import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createTask,
  deleteTask,
  emptyTrash,
  permanentDeleteTask,
  queryTasks,
  restoreTask,
  setTaskCompleted,
  updateTask,
} from "../services/taskService";
import { normalizeError } from "../utils/normalizeError";
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
      Pick<UpdateTaskInput, "listId" | "priority" | "dueAt" | "remindBefore">
    >,
  ) => Promise<void>;
  reorderTasks: (sourceId: string, targetId: string) => Promise<void>;
  patchTask: (
    id: string,
    patch: Partial<Omit<UpdateTaskInput, "id">>,
  ) => Promise<Task>;
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
      selectedTaskId: null,
      batchMode: false,
      batchSelectedIds: [],
      loading: false,
      error: null,

      setScope: async (scope) => {
        set({ scope, selectedTaskId: null, batchSelectedIds: [] });
        await get().loadTasks();
      },

      setLayout: (layout) => set({ layout }),

      setSearchQuery: async (searchQuery) => {
        set({ searchQuery, selectedTaskId: null, batchSelectedIds: [] });
        await get().loadTasks();
      },

      setSortBy: async (sortBy) => {
        set({ sortBy });
        await get().loadTasks();
      },

      setShowCompleted: async (showCompleted) => {
        set({ showCompleted, selectedTaskId: null, batchSelectedIds: [] });
        await get().loadTasks();
      },

      applyViewState: async (next) => {
        set({
          scope: next.scope,
          searchQuery: next.searchQuery,
          sortBy: next.sortBy,
          showCompleted: next.showCompleted,
          layout: next.layout ?? get().layout,
          selectedTaskId: null,
          batchSelectedIds: [],
        });
        await get().loadTasks();
      },

      loadTasks: async () => {
        const requestId = ++taskRequestSequence;
        set({ loading: true, error: null });
        try {
          const { scope, searchQuery, sortBy, showCompleted } = get();
          const [allTasks, tasks] = await Promise.all([
            queryTasks({
              scope: defaultTaskScope,
              query: "",
              sortBy,
              showCompleted: true,
            }),
            queryTasks({
              scope,
              query: searchQuery,
              sortBy,
              showCompleted,
            }),
          ]);
          if (requestId !== taskRequestSequence) return;
          set({ allTasks, tasks, loading: false });
        } catch (error) {
          if (requestId !== taskRequestSequence) return;
          set({ loading: false, error: normalizeError(error) });
        }
      },

      addTask: async (input) => {
        return runMutation(set, async () => {
          const task = await createTask(input);
          await get().loadTasks();
          return task;
        });
      },

      saveTask: async (input) => {
        return runMutation(set, async () => {
          const task = await updateTask(input);
          await get().loadTasks();
          return task;
        });
      },

      toggleTask: async (id, completed) => {
        return runMutation(set, async () => {
          const task = await setTaskCompleted(id, completed);
          await get().loadTasks();
          return task;
        });
      },

      removeTask: async (id) => {
        await runMutation(set, async () => {
          await deleteTask(id);
          set((state) => ({
            selectedTaskId:
              state.selectedTaskId === id ? null : state.selectedTaskId,
            batchSelectedIds: state.batchSelectedIds.filter(
              (selectedId) => selectedId !== id,
            ),
          }));
          await get().loadTasks();
        });
      },

      restoreTask: async (id) => {
        await runMutation(set, async () => {
          await restoreTask(id);
          set((state) => ({
            selectedTaskId:
              state.selectedTaskId === id ? null : state.selectedTaskId,
            batchSelectedIds: state.batchSelectedIds.filter(
              (selectedId) => selectedId !== id,
            ),
          }));
          await get().loadTasks();
        });
      },

      permanentDeleteTask: async (id) => {
        await runMutation(set, async () => {
          await permanentDeleteTask(id);
          set((state) => ({
            selectedTaskId:
              state.selectedTaskId === id ? null : state.selectedTaskId,
            batchSelectedIds: state.batchSelectedIds.filter(
              (selectedId) => selectedId !== id,
            ),
          }));
          await get().loadTasks();
        });
      },

      emptyTrash: async () => {
        return runMutation(set, async () => {
          const count = await emptyTrash();
          set({ selectedTaskId: null, batchSelectedIds: [], batchMode: false });
          await get().loadTasks();
          return count;
        });
      },

      batchComplete: async () => {
        await runMutation(set, async () => {
          const selectedIds = get().batchSelectedIds;
          for (const id of selectedIds) {
            await setTaskCompleted(id, true);
          }
          set({ batchSelectedIds: [], batchMode: false });
          await get().loadTasks();
        });
      },

      batchDelete: async () => {
        await runMutation(set, async () => {
          const selectedIds = get().batchSelectedIds;
          for (const id of selectedIds) {
            await deleteTask(id);
          }
          set({ selectedTaskId: null, batchSelectedIds: [], batchMode: false });
          await get().loadTasks();
        });
      },

      batchRestore: async () => {
        await runMutation(set, async () => {
          const selectedIds = get().batchSelectedIds;
          for (const id of selectedIds) {
            await restoreTask(id);
          }
          set({ selectedTaskId: null, batchSelectedIds: [], batchMode: false });
          await get().loadTasks();
        });
      },

      batchPermanentDelete: async () => {
        await runMutation(set, async () => {
          const selectedIds = get().batchSelectedIds;
          for (const id of selectedIds) {
            await permanentDeleteTask(id);
          }
          set({ selectedTaskId: null, batchSelectedIds: [], batchMode: false });
          await get().loadTasks();
        });
      },

      batchUpdate: async (patch) => {
        await runMutation(set, async () => {
          const selectedIds = get().batchSelectedIds;
          const source = new Map(
            get().allTasks.map((task) => [task.id, task] as const),
          );
          for (const id of selectedIds) {
            const task = source.get(id);
            if (!task) continue;
            await updateTask({
              id: task.id,
              title: task.title,
              note: task.note,
              status: task.status,
              priority: task.priority,
              listId: task.listId,
              dueAt: task.dueAt,
              sortOrder: task.sortOrder,
              remindBefore: task.remindBefore,
              repeatRule: task.repeatRule,
              subtasks: task.subtasks,
              tags: task.tags,
              ...patch,
            });
          }
          set({ batchSelectedIds: [], batchMode: false });
          await get().loadTasks();
        });
      },

      reorderTasks: async (sourceId, targetId) => {
        await runMutation(set, async () => {
          const current = get().tasks.filter((task) => !task.deletedAt);
          const sourceIndex = current.findIndex((task) => task.id === sourceId);
          const targetIndex = current.findIndex((task) => task.id === targetId);
          if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
            return;
          const reordered = [...current];
          const [source] = reordered.splice(sourceIndex, 1);
          reordered.splice(targetIndex, 0, source);
          for (const [index, task] of reordered.entries()) {
            const sortOrder = index * 1000;
            if (task.sortOrder === sortOrder) continue;
            await updateTask({
              id: task.id,
              title: task.title,
              note: task.note,
              status: task.status,
              priority: task.priority,
              listId: task.listId,
              dueAt: task.dueAt,
              sortOrder,
              remindBefore: task.remindBefore,
              repeatRule: task.repeatRule,
              subtasks: task.subtasks,
              tags: task.tags,
            });
          }
          set({ sortBy: "manual" });
          await get().loadTasks();
        });
      },

      patchTask: async (id, patch) => {
        return runMutation(set, async () => {
          const task =
            get().allTasks.find((item) => item.id === id) ??
            get().tasks.find((item) => item.id === id);
          if (!task) throw new Error("任务不存在");
          const updated = await updateTask({
            id: task.id,
            title: task.title,
            note: task.note,
            status: task.status,
            priority: task.priority,
            listId: task.listId,
            dueAt: task.dueAt,
            sortOrder: task.sortOrder,
            remindBefore: task.remindBefore,
            repeatRule: task.repeatRule,
            subtasks: task.subtasks,
            tags: task.tags,
            ...patch,
          });
          await get().loadTasks();
          return updated;
        });
      },

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

async function runMutation<T>(
  set: (
    partial: Partial<TaskState> | ((state: TaskState) => Partial<TaskState>),
  ) => void,
  mutation: () => Promise<T>,
): Promise<T> {
  set({ loading: true, error: null });
  try {
    const result = await mutation();
    set({ loading: false });
    return result;
  } catch (error) {
    set({ loading: false, error: normalizeError(error) });
    throw error;
  }
}
