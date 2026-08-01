import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import { reminderPresets } from "../../constants/reminderConfig";
import type { TaskList } from "../../types/database";
import type { TaskDraft } from "../../utils/taskHelpers";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";
import { TaskDateTimeField } from "./TaskDateTimeField";

const priorityOptions = [
  { value: 2 as const, label: priorityCopy[2].label, color: "var(--red)" },
  { value: 1 as const, label: priorityCopy[1].label, color: "var(--amber)" },
  { value: 0 as const, label: priorityCopy[0].label, color: "var(--blue)" },
];

const reminderOptions = [
  { value: -1, label: "不提醒" },
  ...reminderPresets.map((preset) => ({
    value: preset.value,
    label: preset.label,
  })),
];

export function TaskFormFields({
  draft,
  lists,
  onChange,
  onSubmit,
  titleInvalid,
}: {
  draft: TaskDraft;
  lists: TaskList[];
  onChange: (draft: TaskDraft) => void;
  onSubmit?: () => void;
  titleInvalid?: boolean;
}) {
  return (
    <>
      <div className="form-title-field">
        <input
          autoFocus
          value={draft.title}
          onChange={(event) =>
            onChange({ ...draft, title: event.target.value })
          }
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              onSubmit
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className={titleInvalid ? "invalid" : ""}
          placeholder="输入任务名称..."
        />
        {titleInvalid && (
          <span className="form-title-error">任务名称不能为空</span>
        )}
      </div>
      <div className="form-field">
        <span>描述</span>
        <textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === "Enter" &&
              onSubmit
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="补充任务背景、要求或链接 (支持 Ctrl+Enter 保存)"
          rows={4}
        />
      </div>
      <div className="form-grid">
        <TaskDateTimeField
          value={draft.dueAt}
          onChange={(dueAt) => onChange({ ...draft, dueAt })}
        />
        {draft.dueAt && (
          <div className="form-field">
            <span>提醒</span>
            <Select<number>
              value={draft.remindBefore ?? -1}
              options={reminderOptions}
              onChange={(value) =>
                onChange({
                  ...draft,
                  remindBefore: value < 0 ? null : value,
                })
              }
              ariaLabel="提醒时间"
            />
          </div>
        )}
        <div className="form-field">
          <span>优先级</span>
          <SegmentedControl
            value={draft.priority}
            options={priorityOptions}
            onChange={(priority) => onChange({ ...draft, priority })}
            ariaLabel="优先级"
          />
        </div>
        <div className="form-field">
          <span>所属清单</span>
          <Select<string>
            value={draft.listId}
            options={lists.map((list) => ({
              value: list.id,
              label: list.name,
              dotColor: list.color ?? DEFAULT_LIST_COLOR,
            }))}
            onChange={(listId) => onChange({ ...draft, listId })}
            ariaLabel="所属清单"
          />
        </div>
      </div>
    </>
  );
}
