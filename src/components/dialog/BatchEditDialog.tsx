import { useState } from "react";
import { Pencil } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { reminderOptions } from "../../constants/reminderConfig";
import { priorityOptions } from "../../constants/taskConfig";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { TaskList, UpdateTaskInput } from "../../types/database";
import { fromDateTimeLocal, getDefaultDueAtLocal } from "../../utils/taskDates";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";
import { TaskDateTimeField } from "../task/TaskDateTimeField";

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
    patch: Partial<
      Pick<UpdateTaskInput, "listId" | "priority" | "dueAt" | "remindBefore">
    >,
  ) => Promise<void> | void;
}) {
  const [listId, setListId] = useState<string | "">("");
  const [priority, setPriority] = useState<0 | 1 | 2 | -1>(-1);
  const [dueMode, setDueMode] = useState<"keep" | "set" | "clear">("keep");
  const [dueAt, setDueAt] = useState(() => getDefaultDueAtLocal());
  const [reminderMode, setReminderMode] = useState<"keep" | "set" | "clear">(
    "keep",
  );
  const [remindBefore, setRemindBefore] = useState<number>(1440);
  const [busy, setBusy] = useState(false);

  async function handleApply() {
    const patch: Partial<
      Pick<UpdateTaskInput, "listId" | "priority" | "dueAt" | "remindBefore">
    > = {};
    if (listId !== "") patch.listId = listId;
    if (priority !== -1) patch.priority = priority;
    if (dueMode === "set") patch.dueAt = fromDateTimeLocal(dueAt);
    if (dueMode === "clear") {
      patch.dueAt = null;
      patch.remindBefore = null;
    }
    if (reminderMode === "set") patch.remindBefore = remindBefore;
    if (reminderMode === "clear") patch.remindBefore = null;
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
      subtitle={`已选 ${count} 项`}
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
        <div className="form-field">
          <span>截止时间</span>
          <SegmentedControl
            value={dueMode}
            options={[
              { value: "keep", label: "不改" },
              { value: "set", label: "设置" },
              { value: "clear", label: "清除" },
            ]}
            onChange={setDueMode}
            ariaLabel="批量修改截止时间"
          />
        </div>
        {dueMode === "set" && (
          <TaskDateTimeField
            value={dueAt}
            onChange={setDueAt}
            label="新的截止时间"
            variant="compact"
          />
        )}
        <div className="form-field">
          <span>提醒</span>
          <SegmentedControl
            value={reminderMode}
            options={[
              { value: "keep", label: "不改" },
              { value: "set", label: "设置" },
              { value: "clear", label: "清除" },
            ]}
            onChange={setReminderMode}
            ariaLabel="批量修改提醒"
          />
        </div>
        {reminderMode === "set" && (
          <div className="form-field">
            <span>新的提醒时间</span>
            <Select<number>
              value={remindBefore}
              options={reminderOptions.filter((option) => option.value >= 0)}
              onChange={setRemindBefore}
              ariaLabel="新的提醒时间"
            />
          </div>
        )}
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
