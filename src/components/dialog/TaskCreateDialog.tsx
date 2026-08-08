import { useState } from "react";
import { Plus } from "lucide-react";
import { fromDateTimeLocal } from "../../app/taskDates";
import type { PresencePhase } from "../../hooks/usePresence";
import type {
  CreateRecurringRuleInput,
  CreateTaskInput,
  TaskList,
} from "../../types/database";
import { emptyDraft, type TaskDraft } from "../../utils/taskHelpers";
import { DialogFooter } from "./DialogFooter";
import { DialogShell } from "./DialogShell";
import { TaskFormFields } from "../task/TaskFormFields";

export function TaskCreateDialog({
  lists,
  defaultListId,
  presence,
  onClose,
  onSubmit,
  onSubmitRecurring,
}: {
  lists: TaskList[];
  defaultListId: string;
  presence: PresencePhase;
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
  onSubmitRecurring: (input: CreateRecurringRuleInput) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaultListId));
  const [touched, setTouched] = useState(false);

  function submit() {
    setTouched(true);
    if (!draft.title.trim()) return;
    const dueAt = fromDateTimeLocal(draft.dueAt);
    if (draft.recurrenceFrequency) {
      if (!dueAt) return;
      onSubmitRecurring({
        title: draft.title,
        note: draft.note.trim() || null,
        priority: draft.priority,
        listId: draft.listId,
        frequency: draft.recurrenceFrequency,
        intervalCount: draft.recurrenceInterval,
        weekdays:
          draft.recurrenceFrequency === "weekly"
            ? draft.recurrenceWeekdays
            : [],
        monthDay:
          draft.recurrenceFrequency === "monthly" ||
          draft.recurrenceFrequency === "quarterly"
            ? draft.recurrenceMonthDay
            : null,
        firstDueAt: dueAt,
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        generateAheadMinutes: draft.generateAheadMinutes,
        remindBefore: draft.remindBefore,
        endAt: fromDateTimeLocal(draft.recurrenceEndAt),
      });
      return;
    }
    onSubmit({
      title: draft.title,
      note: draft.note.trim() || null,
      priority: draft.priority,
      listId: draft.listId,
      dueAt,
      remindBefore: draft.remindBefore,
      repeatRule: null,
    });
  }

  return (
    <DialogShell
      title="新建任务"
      subtitle={
        draft.recurrenceFrequency
          ? "设置周期后，任务会在合适的时间自动出现"
          : "把下一件事放进合适的清单"
      }
      icon={Plus}
      presence={presence}
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
          onSubmit={submit}
          titleInvalid={touched && !draft.title.trim()}
        />
        <DialogFooter
          onCancel={onClose}
          submitLabel={draft.recurrenceFrequency ? "创建循环任务" : "创建任务"}
        />
      </form>
    </DialogShell>
  );
}
