import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { listColorOptions } from "../../constants/listConfig";
import { DialogFooter } from "./DialogFooter";
import { DialogShell } from "./DialogShell";

export function ListCreateDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(listColorOptions[0]);
  const [touched, setTouched] = useState(false);

  function submit() {
    setTouched(true);
    if (!name.trim()) return;
    onSubmit(name, color);
  }

  return (
    <DialogShell
      title="新建清单"
      subtitle="为任务建立一个新的分类"
      icon={FolderPlus}
      onClose={onClose}
      width="420px"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="form-field">
          <span>清单名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={touched && !name.trim() ? "invalid" : ""}
            placeholder="例如：项目、旅行、灵感"
          />
        </label>
        <div className="form-field">
          <span>颜色</span>
          <div className="color-row">
            {listColorOptions.map((item) => (
              <button
                key={item}
                type="button"
                className={color === item ? "selected" : ""}
                style={{ backgroundColor: item }}
                onClick={() => setColor(item)}
                aria-label={`选择颜色 ${item}`}
              />
            ))}
          </div>
        </div>
        <DialogFooter onCancel={onClose} submitLabel="创建清单" />
      </form>
    </DialogShell>
  );
}
