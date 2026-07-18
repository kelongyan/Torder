export interface DatabaseStatus {
  databasePath: string;
  schemaVersion: number;
  listCount: number;
  taskCount: number;
}

export type TaskView = "today" | "all" | "completed" | "overdue";
export type TaskDateFilter = "today" | "overdue" | "next7" | "none";

export interface TaskFilters {
  query: string;
  dateFilter: TaskDateFilter | null;
  priorities: number[];
  listIds: string[];
  tagIds: string[];
}

export const emptyTaskFilters: TaskFilters = {
  query: "",
  dateFilter: null,
  priorities: [],
  listIds: [],
  tagIds: [],
};

export interface Task {
  id: string;
  title: string;
  note: string | null;
  status: "todo" | "done" | "archived";
  priority: 0 | 1 | 2;
  listId: string;
  dueAt: string | null;
  remindAt: string | null;
  remindedAt: string | null;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  priority?: 0 | 1 | 2;
  listId?: string;
  dueAt?: string | null;
  remindAt?: string | null;
  sortOrder?: number;
}

export interface UpdateTaskInput {
  id: string;
  title: string;
  note: string | null;
  status: Task["status"];
  priority: Task["priority"];
  listId: string;
  dueAt: string | null;
  remindAt: string | null;
  sortOrder: number;
}

export interface TaskList {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}
