import { useState } from "react";
import { Repeat2 } from "lucide-react";
import { fromDateTimeLocal } from "../../app/taskDates";
import type { PresencePhase } from "../../hooks/usePresence";
import type {
  CreateRecurringRuleInput,
  RecurrenceFrequency,
  RecurringRule,
  Task,
  TaskList,
  UpdateRecurringRuleInput,
} from "../../types/database";
import {
  createTaskDraft,
  emptyDraft,
  recurringRuleDraft,
  type TaskDraft,
} from "../../utils/taskHelpers";
import { TaskFormFields } from "../task/TaskFormFields";
import { DialogFooter } from "./DialogFooter";
import { DialogShell } from "./DialogShell";

export function RecurringRuleDialog({
  rule,
  sourceTask,
  lists,
  defaultListId,
  presence,
  onClose,
  onCreate,
  onUpdate,
}: {
  rule: RecurringRule | null;
  sourceTask: Task | null;
  lists: TaskList[];
  defaultListId: string;
  presence: PresencePhase;
  onClose: () => void;
  onCreate: (input: CreateRecurringRuleInput) => void;
  onUpdate: (input: UpdateRecurringRuleInput) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() =>
    buildInitialDraft(rule, sourceTask, lists, defaultListId),
  );
  const [touched, setTouched] = useState(false);

  function submit() {
    setTouched(true);
    const firstDueAt = fromDateTimeLocal(draft.dueAt);
    if (!draft.title.trim() || !draft.recurrenceFrequency || !firstDueAt) return;

    const common = {
      title: draft.title.trim(),
      note: draft.note.trim() || null,
      priority: draft.priority,
      listId: draft.listId,
      frequency: draft.recurrenceFrequency,
      intervalCount: draft.recurrenceInterval,
      weekdays:
        draft.recurrenceFrequency === "weekly" ? draft.recurrenceWeekdays : [],
      monthDay:
        draft.recurrenceFrequency === "monthly" ||
        draft.recurrenceFrequency === "quarterly"
          ? draft.recurrenceMonthDay
          : null,
      firstDueAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      generateAheadMinutes: draft.generateAheadMinutes,
      remindBefore: draft.remindBefore,
      endAt: fromDateTimeLocal(draft.recurrenceEndAt),
    };

    if (rule) {
      onUpdate({ id: rule.id, ...common });
    } else {
      onCreate({ sourceTaskId: sourceTask?.id ?? null, ...common });
    }
  }

  return (
    <DialogShell
      title={rule ? "编辑循环任务" : sourceTask ? "设为循环任务" : "新建循环任务"}
      subtitle="调整规则只影响未来生成的任务，已生成实例保持不变"
      icon={Repeat2}
      presence={presence}
      onClose={onClose}
      width="680px"
    >
      <form
        className="dialog-form recurring-rule-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TaskFormFields
          draft={draft}
          lists={lists}
          onChange={setDraft}
          onSubmit={submit}
          recurrenceRequired
          titleInvalid={touched && !draft.title.trim()}
        />
        <DialogFooter
          onCancel={onClose}
          submitLabel={rule ? "保存规则" : "创建循环任务"}
        />
      </form>
    </DialogShell>
  );
}

function buildInitialDraft(
  rule: RecurringRule | null,
  sourceTask: Task | null,
  lists: TaskList[],
  defaultListId: string,
): TaskDraft {
  if (rule) return recurringRuleDraft(rule);
  const draft = sourceTask ? createTaskDraft(sourceTask, lists) : emptyDraft(defaultListId);
  const legacyFrequency = sourceTask?.repeatRule;
  const recurrenceFrequency: RecurrenceFrequency =
    legacyFrequency === "daily" ||
    legacyFrequency === "weekly" ||
    legacyFrequency === "monthly"
      ? legacyFrequency
      : "weekly";
  const due = new Date(draft.dueAt || Date.now());
  return {
    ...draft,
    recurrenceFrequency,
    recurrenceWeekdays: [due.getDay()],
    recurrenceMonthDay: due.getDate(),
  };
}
