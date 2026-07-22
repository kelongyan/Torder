import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TaskScope } from "../../types/database";
import { getEmptyCopy } from "../../utils/taskHelpers";

export function EmptyState({
  scope,
  searchQuery,
}: {
  scope: TaskScope;
  searchQuery: string;
}) {
  const copy =
    searchQuery.trim().length > 0
      ? {
          icon: Search as LucideIcon,
          title: `没有匹配"${searchQuery.trim()}"的任务`,
          body: "换个关键词试试，或者直接创建一条新任务。",
        }
      : getEmptyCopy(scope);
  const Icon = copy.icon;

  return (
    <div className="empty-state">
      <Icon aria-hidden="true" />
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
    </div>
  );
}
