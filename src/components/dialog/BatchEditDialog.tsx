import { useState } from "react";
import { Pencil } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { priorityCopy } from "../../constants/taskConfig";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { TaskList, UpdateTaskInput } from "../../types/database";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";

const priorityOptions = [
  { value: 2 as const, label: priorityCopy[2].label, color: "var(--red)" },
  { value: 1 as const, label: priorityCopy[1].label, color: "var(--amber)" },
  { value: 0 as const, label: priorityCopy[0].label, color: "var(--blue)" },
];

export function BatchEditDialog({
  lists,
  count,
  presence,
  onClose,
  onSubmit,
}: {
  lists: TaskList[];
  count: number;
  presence: PresencePhase;
  onClose: () => void;
  onSubmit: (
    patch: Partial<Pick<UpdateTaskInput, "listId" | "priority">>,
  ) => Promise<void> | void;
}) {
  const [listId, setListId] = useState<string | "">("");
  const [priority, setPriority] = useState<0 | 1 | 2 | -1>(-1);
  const [busy, setBusy] = useState(false);

  async function handleApply() {
    const patch: Partial<Pick<UpdateTaskInput, "listId" | "priority">> = {};
    if (listId !== "") patch.listId = listId;
    if (priority !== -1) patch.priority = priority;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSubmit(patch);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="批量编辑"
      subtitle={`将应用到已选的 ${count} 项任务`}
      icon={Pencil}
      width="460px"
      presence={presence}
      onClose={onClose}
    >
      <div className="dialog-form">
        <div className="form-field">
          <span>移动到清单</span>
          <Select<string | "">
            value={listId}
            options={[
              { value: "", label: "不修改清单" },
              ...lists.map((list) => ({
                value: list.id,
                label: list.name,
                dotColor: list.color ?? DEFAULT_LIST_COLOR,
              })),
            ]}
            onChange={setListId}
            ariaLabel="批量修改清单"
          />
        </div>
        <div className="form-field">
          <span>优先级</span>
          <SegmentedControl
            value={priority === -1 ? -1 : priority}
            options={[{ value: -1, label: "不改" }, ...priorityOptions]}
            onChange={(value) => setPriority(value as 0 | 1 | 2 | -1)}
            ariaLabel="批量修改优先级"
          />
        </div>
      </div>

      <footer className="dialog-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void handleApply()}
        >
          应用修改
        </button>
      </footer>
    </DialogShell>
  );
}
