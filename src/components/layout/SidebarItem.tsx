import { Pencil, Trash2, type LucideIcon } from "lucide-react";

export function SidebarItem({
  icon: Icon,
  color,
  label,
  count,
  active,
  onClick,
  onEdit,
  onDelete,
}: {
  icon?: LucideIcon;
  color?: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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
        <span className="list-dot" style={{ backgroundColor: color }} />
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
                title="编辑清单"
                aria-label="编辑清单"
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
                title="删除清单"
                aria-label="删除清单"
              >
                <Trash2 className="icon-xs" />
              </button>
            )}
          </div>
        )}
        <span className="nav-badge">{count}</span>
      </div>
    </div>
  );
}
