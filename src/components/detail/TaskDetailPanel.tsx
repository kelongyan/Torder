import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal, RotateCcw, Trash2, X } from "lucide-react";
import { formatTaskDateTime, fromDateTimeLocal } from "../../app/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import {
  describeReminder,
  reminderPresets,
} from "../../constants/reminderConfig";
import { usePresence, type PresencePhase } from "../../hooks/usePresence";
import type { Task, TaskList, UpdateTaskInput } from "../../types/database";
import { FieldRow } from "../common/FieldRow";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";
import { TaskDateTimeField } from "../task/TaskDateTimeField";

type EditingField =
  "title" | "note" | "listId" | "priority" | "dueAt" | "remindBefore";

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
  const [editing, setEditing] = useState<EditingField | null>(null);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftNote, setDraftNote] = useState(task.note ?? "");
  const [moreOpen, setMoreOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const morePresence = usePresence(moreOpen, 180);

  function startEdit(field: EditingField) {
    setDraftTitle(task.title);
    setDraftNote(task.note ?? "");
    setEditing(field);
  }

  useEffect(() => {
    if (editing === "title") titleInputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!moreOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [moreOpen]);

  const list = lists.find((item) => item.id === task.listId) ?? null;
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;

  function patchAndSave(patch: Partial<Omit<UpdateTaskInput, "id">>) {
    return onSave({
      id: task.id,
      title: draftTitle.trim() || task.title,
      note: draftNote.trim() || null,
      status: task.status,
      priority: task.priority,
      listId: task.listId,
      dueAt: task.dueAt,
      sortOrder: task.sortOrder,
      remindBefore: task.remindBefore,
      ...patch,
    });
  }

  function saveTitle() {
    if (!draftTitle.trim()) {
      setDraftTitle(task.title);
      setEditing(null);
      return;
    }
    if (draftTitle.trim() !== task.title) {
      void patchAndSave({ title: draftTitle.trim() });
    }
    setEditing(null);
  }

  function saveNote() {
    const next = draftNote.trim() || null;
    if (next !== task.note) {
      void patchAndSave({ note: next });
    }
    setEditing(null);
  }

  return (
    <div
      className={`detail-panel-content ${
        presence === "exit" ? "is-exiting" : "is-entering"
      }`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) {
          e.stopPropagation();
          setEditing(null);
          setDraftTitle(task.title);
          setDraftNote(task.note ?? "");
        }
      }}
    >
      <header className="detail-header">
        <div>
          <span>任务详情</span>
          <h2>{task.title}</h2>
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
        {editing === "title" ? (
          <div className="detail-field-editing">
            <span className="detail-field-editing-label">任务名称</span>
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveTitle();
                }
              }}
              onBlur={saveTitle}
              placeholder="输入任务名称..."
            />
          </div>
        ) : (
          <FieldRow label="任务名称" onEdit={() => startEdit("title")}>
            {task.title}
          </FieldRow>
        )}

        {editing === "note" ? (
          <div className="detail-field-editing">
            <span className="detail-field-editing-label">描述</span>
            <textarea
              autoFocus
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  saveNote();
                }
              }}
              onBlur={saveNote}
              placeholder="补充任务背景、要求或链接..."
              rows={4}
            />
          </div>
        ) : (
          <FieldRow label="描述" onEdit={() => startEdit("note")}>
            {task.note || <span className="detail-empty">暂无描述</span>}
          </FieldRow>
        )}

        {editing === "priority" ? (
          <div className="detail-field-editing">
            <span className="detail-field-editing-label">优先级</span>
            <SegmentedControl
              value={task.priority}
              options={priorityOptions}
              onChange={(priority) => {
                if (priority !== task.priority) {
                  void patchAndSave({ priority });
                }
                setEditing(null);
              }}
              ariaLabel="优先级"
            />
          </div>
        ) : (
          <FieldRow label="优先级" onEdit={() => startEdit("priority")}>
            <span
              className={`priority-pill ${priorityCopy[task.priority].className}`}
            >
              {priorityCopy[task.priority].label}
            </span>
          </FieldRow>
        )}

        {editing === "listId" ? (
          <div className="detail-field-editing">
            <span className="detail-field-editing-label">所属清单</span>
            <Select<string>
              value={task.listId}
              options={lists.map((item) => ({
                value: item.id,
                label: item.name,
                dotColor: item.color ?? DEFAULT_LIST_COLOR,
              }))}
              onChange={(listId) => {
                if (listId !== task.listId) {
                  void patchAndSave({ listId });
                }
                setEditing(null);
              }}
              ariaLabel="所属清单"
            />
          </div>
        ) : (
          <FieldRow label="所属清单" onEdit={() => startEdit("listId")}>
            <span
              className="list-badge"
              style={{ color: listColor, backgroundColor: `${listColor}24` }}
            >
              {list?.name ?? "未分类"}
            </span>
          </FieldRow>
        )}

        {editing === "dueAt" ? (
          <div className="detail-field-editing">
            <span className="detail-field-editing-label">截止日期时间</span>
            <TaskDateTimeField
              value={task.dueAt ? toLocal(task.dueAt) : ""}
              onChange={(dueAt) => {
                void patchAndSave({ dueAt: fromDateTimeLocal(dueAt) });
              }}
            />
          </div>
        ) : (
          <FieldRow label="截止日期时间" onEdit={() => startEdit("dueAt")}>
            {task.dueAt ? (
              formatTaskDateTime(task.dueAt)
            ) : (
              <span className="detail-empty">未设置</span>
            )}
          </FieldRow>
        )}

        {editing === "remindBefore" ? (
          <div className="detail-field-editing">
            <span className="detail-field-editing-label">提醒</span>
            <Select<number>
              value={task.remindBefore ?? -1}
              options={reminderOptions}
              onChange={(value) => {
                const remindBefore = value < 0 ? null : value;
                if (remindBefore !== task.remindBefore) {
                  void patchAndSave({ remindBefore });
                }
                setEditing(null);
              }}
              ariaLabel="提醒时间"
            />
          </div>
        ) : (
          <FieldRow label="提醒" onEdit={() => startEdit("remindBefore")}>
            {task.dueAt ? (
              describeReminder(task.remindBefore)
            ) : (
              <span className="detail-empty">未设置截止时间时不可用</span>
            )}
          </FieldRow>
        )}

        <FieldRow label="状态" editable={false}>
          <span
            className={`status-pill ${task.status === "done" ? "done" : ""}`}
          >
            {task.status === "done" ? "已完成" : "进行中"}
          </span>
        </FieldRow>
      </div>

      <footer className="detail-footer">
        <button
          type="button"
          className={`btn-complete ${task.status === "done" ? "done" : ""}`}
          disabled={busy}
          onClick={() => onToggle(task)}
        >
          {task.status === "done" ? (
            <RotateCcw aria-hidden="true" className="icon-sm" />
          ) : (
            <Check aria-hidden="true" className="icon-sm" />
          )}
          {task.status === "done" ? "恢复" : "标记完成"}
        </button>
        <div className="detail-more" ref={moreRef}>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="更多操作"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {morePresence.rendered && (
            <div
              className={`detail-more-menu ${
                morePresence.phase === "exit" ? "is-exiting" : "is-entering"
              }`}
              role="menu"
            >
              <button type="button" onClick={() => onDelete(task)}>
                <Trash2 aria-hidden="true" className="icon-sm" />
                删除任务
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function toLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
