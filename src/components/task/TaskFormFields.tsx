import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import type { TaskList } from "../../types/database";
import type { TaskDraft } from "../../utils/taskHelpers";

export function TaskFormFields({
  draft,
  lists,
  onChange,
  titleInvalid,
}: {
  draft: TaskDraft;
  lists: TaskList[];
  onChange: (draft: TaskDraft) => void;
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
          className={titleInvalid ? "invalid" : ""}
          placeholder="输入任务名称..."
        />
      </label>
      <label className="form-field">
        <span>描述</span>
        <textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="补充任务背景、要求或链接"
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
      <label className="form-field">
        <span>截止日期时间</span>
        <input
          type="datetime-local"
          value={draft.dueAt}
          onChange={(event) =>
            onChange({ ...draft, dueAt: event.target.value })
          }
        />
      </label>
    </>
  );
}
