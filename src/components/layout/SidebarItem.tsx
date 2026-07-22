import type { LucideIcon } from "lucide-react";

export function SidebarItem({
  icon: Icon,
  color,
  label,
  count,
  active,
  onClick,
}: {
  icon?: LucideIcon;
  color?: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="icon-sm" />
      ) : (
        <span className="list-dot" style={{ backgroundColor: color }} />
      )}
      <span>{label}</span>
      <span className="nav-badge">{count}</span>
    </button>
  );
}
