import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { formatTaskDateTime, fromDateTimeLocal } from "../../app/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import { describeReminder } from "../../constants/reminderConfig";
import { usePresence, type PresencePhase } from "../../hooks/usePresence";
import type { Task, TaskList, UpdateTaskInput } from "../../types/database";
import { createTaskDraft, type TaskDraft } from "../../utils/taskHelpers";
import { DetailBlock } from "./DetailBlock";
import { TaskFormFields } from "../task/TaskFormFields";

export function TaskDetailPanel({
  task,
  lists,
  busy,
  onClose,
  onSave,
  onToggle,
  onDelete,
}: {
  task: Task | null;
  lists: TaskList[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateTaskInput) => Promise<void> | void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const detailPresence = usePresence(task, 320);
  const presentTask = detailPresence.value;

  return (
    <aside
      className={`detail-panel ${
        detailPresence.rendered ? detailPresence.className : "hidden"
      }`}
      aria-hidden={!detailPresence.rendered}
    >
      {presentTask && (
        <TaskDetailContent
          key={presentTask.id}
          task={presentTask}
          lists={lists}
          busy={busy}
          presence={detailPresence.phase}
          onClose={onClose}
          onSave={onSave}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      )}
    </aside>
  );
}

function TaskDetailContent({
  task,
  lists,
  busy,
  presence,
  onClose,
  onSave,
  onToggle,
  onDelete,
}: {
  task: Task;
  lists: TaskList[];
  busy: boolean;
  presence: PresencePhase;
  onClose: () => void;
  onSave: (input: UpdateTaskInput) => Promise<void> | void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() =>
    createTaskDraft(task, lists),
  );

  useEffect(() => {
    if (!editing) {
      setDraft(createTaskDraft(task, lists));
    }
  }, [task, lists, editing]);

  const list = lists.find((item) => item.id === task.listId) ?? null;
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;

  function startEditing() {
    setDraft(createTaskDraft(task, lists));
    setTitleTouched(false);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(createTaskDraft(task, lists));
    setTitleTouched(false);
    setEditing(false);
  }

  async function handleSave() {
    setTitleTouched(true);
    if (!draft.title.trim()) return;
    await onSave({
      id: task.id,
      title: draft.title,
      note: draft.note.trim() || null,
      status: task.status,
      priority: draft.priority,
      listId: draft.listId,
      dueAt: fromDateTimeLocal(draft.dueAt),
      sortOrder: task.sortOrder,
      remindBefore: draft.remindBefore,
    });
    setEditing(false);
  }

  return (
    <div
      className={`detail-panel-content ${
        presence === "exit" ? "is-exiting" : "is-entering"
      }`}
      onKeyDown={(e) => {
        if (editing && e.key === "Escape") {
          e.stopPropagation();
          cancelEditing();
        }
      }}
    >
      <header className="detail-header">
        <div>
          <span>任务详情</span>
          <h2
            onClick={() => {
              if (!editing) startEditing();
            }}
            title={editing ? undefined : "点击修改任务名称"}
            style={{ cursor: editing ? "default" : "pointer" }}
          >
            {editing ? "编辑任务" : task.title}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="detail-body">
        <div
          key={editing ? "editing" : "reading"}
          className="detail-body-motion"
        >
          {editing ? (
            <TaskFormFields
              draft={draft}
              lists={lists}
              onChange={(nextDraft) => {
                setTitleTouched(true);
                setDraft(nextDraft);
              }}
              onSubmit={() => void handleSave()}
              titleInvalid={titleTouched && !draft.title.trim()}
            />
          ) : (
            <div
              onDoubleClick={startEditing}
              title="双击进入编辑模式"
              style={{ cursor: "pointer" }}
            >
              <DetailBlock label="任务名称">{task.title}</DetailBlock>
              <DetailBlock label="描述">{task.note || "暂无描述"}</DetailBlock>
              <DetailBlock label="优先级">
                <span
                  className={`priority-pill ${priorityCopy[task.priority].className}`}
                >
                  {priorityCopy[task.priority].label}
                </span>
              </DetailBlock>
              <DetailBlock label="所属清单">
                <span
                  className="list-badge"
                  style={{
                    color: listColor,
                    backgroundColor: `${listColor}24`,
                  }}
                >
                  {list?.name ?? "未分类"}
                </span>
              </DetailBlock>
              <DetailBlock label="截止日期时间">
                {formatTaskDateTime(task.dueAt)}
              </DetailBlock>
              <DetailBlock label="提醒">
                {task.dueAt ? describeReminder(task.remindBefore) : "未设置截止时间时不可用"}
              </DetailBlock>
              <DetailBlock label="状态">
                <span
                  className={`status-pill ${task.status === "done" ? "done" : ""}`}
                >
                  {task.status === "done" ? "已完成" : "进行中"}
                </span>
              </DetailBlock>
            </div>
          )}
        </div>
      </div>

      <footer className="detail-footer">
        <button
          type="button"
          className="btn-danger"
          onClick={() => onDelete(task)}
        >
          <Trash2 aria-hidden="true" className="icon-sm" />
          删除
        </button>
        <div>
          {editing ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={cancelEditing}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !draft.title.trim()}
                onClick={() => void handleSave()}
              >
                保存修改
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onToggle(task)}
              >
                {task.status === "done" ? "恢复" : "完成"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={startEditing}
              >
                编辑
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
