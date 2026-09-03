import { Pencil, Trash2, type LucideIcon } from "lucide-react";

export function SidebarItem({
  icon: Icon,
  color,
  label,
  count,
  alert,
  active,
  onClick,
  onEdit,
  onDelete,
  editLabel = "编辑清单",
  deleteLabel = "删除清单",
}: {
  icon?: LucideIcon;
  color?: string;
  label: string;
  /** 传 undefined 时隐藏角标（如回收站视图，列表数据不含已删任务）。 */
  count?: number;
  /** R2：逾期等警示计数用红色弱底（设计稿 nav-badge is-alert）。 */
  alert?: boolean;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
}) {
  const hasActions = Boolean(onEdit || onDelete);

  return (
    <div
      className={`nav-item ${active ? "active" : ""} ${hasActions ? "has-actions" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={label}
      title={label}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="icon-sm" />
      ) : (
        <span
          className="list-dot"
          style={{ backgroundColor: color, color: color }}
        />
      )}
      <span className="nav-item-title">{label}</span>

      <div className="nav-item-end">
        {hasActions && (
          <div className="sidebar-item-actions">
            {onEdit && (
              <button
                type="button"
                className="sidebar-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                title={editLabel}
                aria-label={editLabel}
              >
                <Pencil className="icon-xs" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="sidebar-action-btn danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title={deleteLabel}
                aria-label={deleteLabel}
              >
                <Trash2 className="icon-xs" />
              </button>
            )}
          </div>
        )}
        {count !== undefined && (
          <span className={`nav-badge ${alert ? "alert" : ""}`}>{count}</span>
        )}
      </div>
    </div>
  );
}
