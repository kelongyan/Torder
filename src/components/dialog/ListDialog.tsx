import { useState, type FormEvent } from "react";
import { Check, FolderPlus, Palette } from "lucide-react";
import {
  DEFAULT_LIST_COLOR,
  presetListColors,
} from "../../constants/listConfig";
import type { PresencePhase } from "../../hooks/usePresence";
import type { TaskList } from "../../types/database";
import { DialogShell } from "./DialogShell";
import { DialogFooter } from "./DialogFooter";

export function ListDialog({
  initialList,
  presence,
  onClose,
  onSubmit,
}: {
  initialList?: TaskList | null;
  presence: PresencePhase;
  onClose: () => void;
  onSubmit: (data: {
    id?: string;
    name: string;
    color: string;
  }) => Promise<void> | void;
}) {
  const [prevInitial, setPrevInitial] = useState(initialList);
  const [name, setName] = useState(initialList?.name ?? "");
  const [color, setColor] = useState(initialList?.color ?? DEFAULT_LIST_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (prevInitial !== initialList) {
    setPrevInitial(initialList);
    setName(initialList?.name ?? "");
    setColor(initialList?.color ?? DEFAULT_LIST_COLOR);
    setError(null);
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("清单名称不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        id: initialList?.id,
        name: trimmed,
        color,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isEditing = Boolean(initialList);

  return (
    <DialogShell
      title={isEditing ? "编辑清单" : "新建清单"}
      icon={FolderPlus}
      presence={presence}
      onClose={onClose}
      width="440px"
    >
      <form onSubmit={handleSubmit} className="dialog-form">
        {error && <div className="dialog-error-msg">{error}</div>}

        <div className="form-field">
          <label htmlFor="list-name-input">清单名称</label>
          <input
            id="list-name-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="清单名称"
            autoFocus
            maxLength={24}
          />
        </div>

        <div className="form-field">
          <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Palette className="icon-sm" />
            <span>颜色</span>
          </label>
          <div className="color-picker-grid">
            {presetListColors.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-picker-dot ${color === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={`选择颜色 ${c}`}
              >
                {color === c && <Check className="color-check-icon" />}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter
          onCancel={onClose}
          submitLabel={
            submitting ? "保存中..." : isEditing ? "完成修改" : "创建清单"
          }
        />
      </form>
    </DialogShell>
  );
}
