import type { ReactNode } from "react";
import { Pencil } from "lucide-react";

export function FieldRow({
  label,
  children,
  onEdit,
  editable = true,
}: {
  label: string;
  children: ReactNode;
  onEdit?: () => void;
  editable?: boolean;
}) {
  return (
    <div className={`field-row ${editable ? "editable" : ""}`}>
      <span className="field-row-label">{label}</span>
      <div className="field-row-value" onClick={editable ? onEdit : undefined}>
        {children}
      </div>
      {editable && onEdit && (
        <button
          type="button"
          className="field-row-edit"
          onClick={onEdit}
          aria-label={`编辑${label}`}
          title={`编辑${label}`}
        >
          <Pencil aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
