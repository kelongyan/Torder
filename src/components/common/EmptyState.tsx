import { Plus, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TaskScope } from "../../types/database";
import { getEmptyCopy } from "../../utils/taskHelpers";

/**
 * F2 · T-12：空工作区引导（缩减版）。
 * 在无任务的列表/今日视图给出「新建第一个事项」入口；搜索无结果等
 * 场景不提供该动作（onPrimary 不传时保持原样）。
 */
export function EmptyState({
  scope,
  searchQuery,
  onPrimary,
}: {
  scope: TaskScope;
  searchQuery: string;
  /** 主引导动作（如打开新建事项弹窗）；仅非搜索空态展示。 */
  onPrimary?: () => void;
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
  // 搜索态与回收站等只读视图不引导新建
  const isDeletedScope = scope.kind === "view" && scope.view === "deleted";
  const showPrimary =
    Boolean(onPrimary) && searchQuery.trim().length === 0 && !isDeletedScope;

  return (
    <div className="empty-state">
      {/* R5 对齐设计稿 empty.css：76px 圆底 + 两条列表线示意 */}
      <div className="empty-art" aria-hidden="true">
        <span className="empty-art-lines" />
        <Icon />
      </div>
      <h2>{copy.title}</h2>
      {copy.body && <p>{copy.body}</p>}
      {showPrimary && (
        <button type="button" className="empty-primary-action" onClick={onPrimary}>
          <Plus aria-hidden="true" className="icon-sm" />
          新建第一个事项
        </button>
      )}
      {/* M2.4 移动端操作提示（仅空态引导场景；CSS 默认隐藏，mobile 显示） */}
      {showPrimary && (
        <p className="empty-hint" aria-hidden="true">
          左滑完成任务 · 右滑查看详情
        </p>
      )}
    </div>
  );
}
