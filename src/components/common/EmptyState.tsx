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
          title: `无匹配结果`,
          body: "",
        }
      : getEmptyCopy(scope);
  const Icon = copy.icon;

  return (
    <div className="empty-state">
      {/* R5 对齐设计稿 empty.css：76px 圆底 + 两条列表线示意 */}
      <div className="empty-art" aria-hidden="true">
        <span className="empty-art-lines" />
        <Icon />
      </div>
      <h2>{copy.title}</h2>
      {copy.body && <p>{copy.body}</p>}
    </div>
  );
}
