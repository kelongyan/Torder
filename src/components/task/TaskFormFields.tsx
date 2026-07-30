import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import { reminderPresets } from "../../constants/reminderConfig";
import type { TaskList } from "../../types/database";
import type { TaskDraft } from "../../utils/taskHelpers";
import { TaskDateTimeField } from "./TaskDateTimeField";

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
      <label className="form-field">
        <span>任务名称</span>
        <input
          autoFocus
          value={draft.title}
          onChange={(event) =>
            onChange({ ...draft, title: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className={titleInvalid ? "invalid" : ""}
          placeholder="输入任务名称..."
        />
        {titleInvalid && (
          <span style={{ color: "var(--danger)", fontSize: "12px", marginTop: "4px" }}>
            任务名称不能为空
          </span>
        )}
      </label>
      <label className="form-field">
        <span>描述</span>
        <textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="补充任务背景、要求或链接 (支持 Ctrl+Enter 保存)"
          rows={4}
        />
      </label>
      <div className="form-field">
        <span>优先级</span>
        <div className="pill-group">
          {([2, 1, 0] as const).map((priority) => (
            <button
              key={priority}
              type="button"
              className={`choice-pill ${draft.priority === priority ? "selected" : ""} ${priorityCopy[priority].className}`}
              onClick={() => onChange({ ...draft, priority })}
            >
              {priorityCopy[priority].label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-field">
        <span>所属清单</span>
        <div className="pill-group wrap">
          {lists.map((list) => {
            const listColor = list.color ?? DEFAULT_LIST_COLOR;
            return (
              <button
                key={list.id}
                type="button"
                className={`choice-pill ${draft.listId === list.id ? "selected" : ""}`}
                style={
                  draft.listId === list.id
                    ? { borderColor: listColor, color: listColor }
                    : undefined
                }
                onClick={() => onChange({ ...draft, listId: list.id })}
              >
                <span
                  className="list-dot"
                  style={{ backgroundColor: listColor }}
                />
                {list.name}
              </button>
            );
          })}
        </div>
      </div>
      <TaskDateTimeField
        value={draft.dueAt}
        onChange={(dueAt) => onChange({ ...draft, dueAt })}
      />
      {draft.dueAt && (
        <label className="form-field">
          <span>提醒</span>
          <select
            value={draft.remindBefore ?? -1}
            onChange={(event) => {
              const value = Number(event.target.value);
              onChange({
                ...draft,
                remindBefore: value < 0 ? null : value,
              });
            }}
          >
            <option value={-1}>不提醒</option>
            {reminderPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
