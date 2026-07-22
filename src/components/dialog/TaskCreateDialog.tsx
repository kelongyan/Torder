import { useState } from "react";
import { Plus } from "lucide-react";
import { fromDateTimeLocal } from "../../app/taskDates";
import type { CreateTaskInput, TaskList } from "../../types/database";
import { emptyDraft, type TaskDraft } from "../../utils/taskHelpers";
import { DialogFooter } from "./DialogFooter";
import { DialogShell } from "./DialogShell";
import { TaskFormFields } from "../task/TaskFormFields";

export function TaskCreateDialog({
  lists,
  defaultListId,
  onClose,
  onSubmit,
}: {
  lists: TaskList[];
  defaultListId: string;
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaultListId));
  const [touched, setTouched] = useState(false);

  function submit() {
    setTouched(true);
    if (!draft.title.trim()) return;
    onSubmit({
      title: draft.title,
      note: draft.note.trim() || null,
      priority: draft.priority,
      listId: draft.listId,
      dueAt: fromDateTimeLocal(draft.dueAt),
    });
  }

  return (
    <DialogShell
      title="新建任务"
      subtitle="把下一件事放进合适的清单"
      icon={Plus}
      onClose={onClose}
      width="580px"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key === "Enter") submit();
        }}
      >
        <TaskFormFields
          draft={draft}
          lists={lists}
          onChange={setDraft}
          titleInvalid={touched && !draft.title.trim()}
        />
        <DialogFooter onCancel={onClose} submitLabel="创建任务" />
      </form>
    </DialogShell>
  );
}
