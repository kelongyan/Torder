import { create } from "zustand";
import {
  createTask,
  deleteTask,
  queryTasks,
  setTaskCompleted,
  setTaskTags,
  updateTask,
} from "../services/taskService";
import type {
  CreateTaskInput,
  Task,
  TaskFilters,
  TaskView,
  UpdateTaskInput,
} from "../types/database";
import { emptyTaskFilters } from "../types/database";

interface TaskState {
  view: TaskView;
  filters: TaskFilters;
  tasks: Task[];
  selectedTaskId: string | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  setView: (view: TaskView) => Promise<void>;
  setFilters: (filters: Partial<TaskFilters>) => Promise<void>;
  clearFilters: () => Promise<void>;
  loadTasks: () => Promise<void>;
  addTask: (input: CreateTaskInput) => Promise<Task>;
  saveTask: (input: UpdateTaskInput, tagIds?: string[]) => Promise<Task>;
  toggleTask: (id: string, completed: boolean) => Promise<Task>;
  removeTask: (id: string) => Promise<void>;
  selectTask: (id: string | null) => void;
}

let taskRequestSequence = 0;

export const useTaskStore = create<TaskState>((set, get) => ({
  view: "today",
  filters: cloneEmptyFilters(),
  tasks: [],
  selectedTaskId: null,
  loading: false,
  error: null,

  setView: async (view) => {
    set({ view, selectedTaskId: null });
    await get().loadTasks();
  },

  setFilters: async (filters) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
      selectedTaskId: null,
    }));
    await get().loadTasks();
  },

  clearFilters: async () => {
    set({ filters: cloneEmptyFilters(), selectedTaskId: null });
    await get().loadTasks();
  },

  loadTasks: async () => {
    const requestId = ++taskRequestSequence;
    set({ loading: true, error: null });
    try {
      const tasks = await queryTasks(get().view, get().filters);
      if (requestId !== taskRequestSequence) return;
      set({ tasks, loading: false });
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

  saveTask: async (input, tagIds) => {
    return runMutation(set, async () => {
      const task = await updateTask(input);
      if (tagIds) {
        await setTaskTags(task.id, tagIds);
      }
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
      }));
      await get().loadTasks();
    });
  },

  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  clearError: () => set({ error: null }),
}));

function cloneEmptyFilters(): TaskFilters {
  return {
    ...emptyTaskFilters,
    priorities: [],
    listIds: [],
    tagIds: [],
  };
}

async function runMutation<T>(
  set: (partial: Partial<TaskState>) => void,
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
