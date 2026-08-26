import { useState } from "react";
import { Plus } from "lucide-react";
import { fromDateTimeLocal } from "../../utils/taskDates";
import type { PresencePhase } from "../../hooks/usePresence";
import type {
  CreateRecurringRuleInput,
  CreateTaskInput,
  TaskList,
} from "../../types/database";
import type { ToastKind } from "../../types/ui";
import {
  emptyDraft,
  parseTagsInput,
  type TaskDraft,
} from "../../utils/taskHelpers";
import { DialogFooter } from "./DialogFooter";
import { DialogShell } from "./DialogShell";
import { TaskFormFields } from "../task/TaskFormFields";
import { PendingAttachmentSection } from "../detail/TaskAttachmentSection";
import type { PendingTaskAttachment } from "../../services/pendingAttachmentService";

export function TaskCreateDialog({
  lists,
  defaultListId,
  defaultScheduledDate = "",
  defaultReminderMinutes,
  presence,
  onClose,
  onSubmit,
  onSubmitRecurring,
  onToast,
}: {
  lists: TaskList[];
  defaultListId: string;
  defaultScheduledDate?: string;
  defaultReminderMinutes: number;
  presence: PresencePhase;
  onClose: () => void;
  onSubmit: (
    input: CreateTaskInput,
    attachments: PendingTaskAttachment[],
  ) => Promise<void>;
  onSubmitRecurring: (input: CreateRecurringRuleInput) => Promise<void>;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() =>
    emptyDraft(defaultListId, defaultReminderMinutes, defaultScheduledDate),
  );
  const [attachments, setAttachments] = useState<PendingTaskAttachment[]>([]);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    setTouched(true);
    if (!draft.title.trim()) return;
    const dueAt = fromDateTimeLocal(draft.dueAt);
    if (draft.recurrenceFrequency) {
      if (!dueAt) return;
      setSubmitting(true);
      try {
        await onSubmitRecurring({
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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          generateAheadMinutes: draft.generateAheadMinutes,
          remindBefore: draft.remindBefore,
          endAt: fromDateTimeLocal(draft.recurrenceEndAt),
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(
        {
          title: draft.title,
          note: draft.note.trim() || null,
          priority: draft.priority,
          listId: draft.listId,
          scheduledDate: draft.scheduledDate || null,
          dueAt,
          remindBefore: draft.remindBefore,
          repeatRule: null,
          tags: parseTagsInput(draft.tagsInput),
        },
        attachments,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      title="新建任务"
      icon={Plus}
      presence={presence}
      onClose={onClose}
      width="500px"
      overlayClassName="task-create-dialog"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if (
            !event.defaultPrevented &&
            (event.ctrlKey || event.metaKey) &&
            event.key === "Enter"
          ) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <TaskFormFields
          draft={draft}
          lists={lists}
          onChange={setDraft}
          onSubmit={() => void submit()}
          titleInvalid={touched && !draft.title.trim()}
          compactDateTime
        />
        {!draft.recurrenceFrequency && (
          <PendingAttachmentSection
            value={attachments}
            onChange={setAttachments}
            disabled={submitting}
            onToast={onToast}
          />
        )}
        <DialogFooter
          onCancel={onClose}
          submitLabel={draft.recurrenceFrequency ? "创建循环任务" : "创建任务"}
          submitting={submitting}
        />
      </form>
    </DialogShell>
  );
}
