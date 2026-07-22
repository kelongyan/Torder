export interface DatabaseStatus {
  databasePath: string;
  schemaVersion: number;
  listCount: number;
  taskCount: number;
}

export type SystemView = "all" | "today" | "planned" | "important" | "completed";
export type TaskLayout = "list" | "board" | "calendar";
export type TaskSortBy = "priority" | "date" | "created";

export type TaskScope =
  | { kind: "view"; view: SystemView }
  | { kind: "list"; listId: string };

export interface Task {
  id: string;
  title: string;
  note: string | null;
  status: "todo" | "done" | "archived";
  priority: 0 | 1 | 2;
  listId: string;
  dueAt: string | null;
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

export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}
