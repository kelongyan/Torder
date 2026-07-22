import type {
  SystemView,
  Task,
  TaskScope,
  TaskSortBy,
} from "../types/database";

export interface QueryTasksInput {
  scope: TaskScope;
  query: string;
  sortBy: TaskSortBy;
  showCompleted: boolean;
}

export function filterAndSortBrowserTasks(
  tasks: Task[],
  input: QueryTasksInput,
): Task[] {
  return tasks
    .filter((task) => matchesQuery(task, input))
    .sort((left, right) => compareTasks(left, right, input.sortBy))
    .map(cloneTask);
}

function matchesQuery(task: Task, input: QueryTasksInput): boolean {
  if (task.deletedAt) return false;
  if (!matchesScope(task, input.scope, input.showCompleted)) return false;

  const query = input.query.trim().toLocaleLowerCase("zh-CN");
  if (!query) return true;

  return [task.title, task.note ?? ""]
    .join("\n")
    .toLocaleLowerCase("zh-CN")
    .includes(query);
}

function matchesScope(
  task: Task,
  scope: TaskScope,
  showCompleted: boolean,
): boolean {
  if (scope.kind === "list") {
    if (task.listId !== scope.listId) return false;
    return showCompleted || task.status !== "done";
  }

  return matchesSystemView(task, scope.view, showCompleted);
}

function matchesSystemView(
  task: Task,
  view: SystemView,
  showCompleted: boolean,
): boolean {
  if (view === "completed") return task.status === "done";
  if (!showCompleted && task.status === "done") return false;
  if (view === "all") return true;
  if (task.status !== "todo") return false;
  if (view === "important") return task.priority === 2;
  if (view === "planned") return task.dueAt !== null;
  return Boolean(task.dueAt && isSameLocalDay(new Date(task.dueAt), new Date()));
}

function compareTasks(left: Task, right: Task, sortBy: TaskSortBy): number {
  if (sortBy === "priority") {
    if (left.priority !== right.priority) return right.priority - left.priority;
    return compareDueDates(left, right) || right.createdAt.localeCompare(left.createdAt);
  }

  if (sortBy === "date") {
    return compareDueDates(left, right) || right.priority - left.priority;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function compareDueDates(left: Task, right: Task): number {
  if (!left.dueAt && !right.dueAt) return 0;
  if (!left.dueAt) return 1;
  if (!right.dueAt) return -1;
  return left.dueAt.localeCompare(right.dueAt);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function cloneTask(task: Task): Task {
  return { ...task };
}
