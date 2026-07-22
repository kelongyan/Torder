import { create } from "zustand";
import {
  createTask,
  deleteTask,
  queryTasks,
  setTaskCompleted,
  updateTask,
} from "../services/taskService";
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
  loadTasks: () => Promise<void>;
  addTask: (input: CreateTaskInput) => Promise<Task>;
  saveTask: (input: UpdateTaskInput) => Promise<Task>;
  toggleTask: (id: string, completed: boolean) => Promise<Task>;
  removeTask: (id: string) => Promise<void>;
  batchComplete: () => Promise<void>;
  batchDelete: () => Promise<void>;
  selectTask: (id: string | null) => void;
  toggleBatchMode: () => void;
  toggleBatchSelected: (id: string) => void;
  clearBatchSelection: () => void;
  clearError: () => void;
}

let taskRequestSequence = 0;

export const defaultTaskScope: TaskScope = { kind: "view", view: "all" };

export const useTaskStore = create<TaskState>((set, get) => ({
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

  clearBatchSelection: () => set({ batchSelectedIds: [], batchMode: false }),
  clearError: () => set({ error: null }),
}));

export function viewScope(view: SystemView): TaskScope {
  return { kind: "view", view };
}

export function listScope(listId: string): TaskScope {
  return { kind: "list", listId };
}

async function runMutation<T>(
  set: (
    partial:
      | Partial<TaskState>
      | ((state: TaskState) => Partial<TaskState>),
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

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
