/**
 * mobile/pages/taskDetail.tsx — 任务详情全屏页（M-B，对齐设计稿 taskDetailView）
 * 结构：AppBar（返回/编辑/更多）→ hero → 描述 → 属性格（点格即 Sheet/进编辑）
 *     → 检查清单（快速勾选/添加）→ 附件（展示态）→ 标签 → 底部固定完成条。
 * 所有字段变更统一经 buildUpdateTaskInput + onSaveTask（与桌面同一 IPC 通道）。
 */
import { useMemo, useState, type JSX } from "react";
import {
  Check,
  Flag,
  Folder,
  MoreHorizontal,
  Pencil,
  Repeat2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Task, TaskSubtask } from "../../types/database";
import { normalizeError } from "../../utils/normalizeError";
import { useTaskStore } from "../../stores/taskStore";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { EmptyView, ScreenShell, TopBar } from "../ui";
import { ActionSheet, ConfirmSheet } from "../parts/sheets";
import {
  buildUpdateTaskInput,
  describeReminder,
  formatDateKey,
  formatDueShort,
  REMINDER_OPTIONS,
} from "../parts/taskEdits";

const PRIORITY_META: Record<number, { label: string; color: string }> = {
  2: { label: "高", color: "var(--red)" },
  1: { label: "中", color: "var(--amber)" },
  0: { label: "低", color: "var(--p-blue)" },
};

type SheetKind = "more" | "priority" | "list" | "reminder" | null;

export function TaskDetailPage({ taskId }: { taskId: string }): JSX.Element {
  const { nav } = useMobilePage();
  const allTasks = useTaskStore((s) => s.allTasks);
  const task = useMemo(
    () => allTasks.find((t) => t.id === taskId) ?? null,
    [allTasks, taskId],
  );

  if (!task) {
    return (
      <ScreenShell
        topbar={<TopBar back onBack={() => nav.back()} title="任务详情" />}
      >
        <EmptyView title="任务不存在或已删除" />
      </ScreenShell>
    );
  }
  return <TaskDetailContent task={task} />;
}

function TaskDetailContent({ task }: { task: Task }): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const done = task.status === "done";
  const pri = PRIORITY_META[task.priority] ?? PRIORITY_META[1];
  const list = props.lists.find((l) => l.id === task.listId);
  const attachmentCount = props.attachmentCounts[task.id] ?? 0;
  const subDone = task.subtasks.filter((s) => s.completed).length;

  const listItems = useMemo(
    () =>
      props.lists.map((l) => ({
        label: l.name,
        icon: <Folder aria-hidden="true" />,
        onSelect: () =>
          void patch({
            listId: l.id,
          }).then(() => props.onToast(`已移动到「${l.name}」`)),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.lists, task.id],
  );

  async function patch(
    overrides: Parameters<typeof buildUpdateTaskInput>[1],
  ): Promise<void> {
    try {
      await props.onSaveTask(buildUpdateTaskInput(task, overrides));
    } catch (error) {
      props.onToast(`更新失败：${normalizeError(error)}`);
    }
  }

  function toggleSubtasks(subtasks: TaskSubtask[]) {
    return () => void patch({ subtasks });
  }
  function updateSubtasks(next: (subtasks: TaskSubtask[]) => TaskSubtask[]) {
    void patch({ subtasks: next(task.subtasks) });
  }
  function addSubtask() {
    const text = subtaskDraft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const item: TaskSubtask = {
      id: `sub-${Date.now().toString(36)}`,
      title: text,
      completed: false,
      createdAt: now,
      completedAt: null,
      sortOrder: task.subtasks.length,
    };
    updateSubtasks((list) => [...list, item]);
    setSubtaskDraft("");
  }

  return (
    <ScreenShell
      topbar={
        <TopBar
          back
          onBack={() => nav.back()}
          title="任务详情"
          actions={[
            {
              icon: <Pencil aria-hidden="true" />,
              label: "编辑",
              onClick: () => nav.push(`/task/${task.id}/edit`),
            },
            {
              icon: <MoreHorizontal aria-hidden="true" />,
              label: "更多",
              onClick: () => setSheet("more"),
            },
          ]}
        />
      }
      className="m-detail-page"
    >
      <div className="m-detail-body">
        <div className="m-detail-hero">
          <h2 className={`m-detail-title ${done ? "done" : ""}`}>
            {task.title}
          </h2>
          <div className="m-detail-status-row">
            <span className={`m-status-pill ${done ? "done" : ""}`}>
              {done ? "已完成" : "进行中"}
            </span>
            {task.note ? (
              <span className="m-detail-note">{task.note}</span>
            ) : null}
          </div>
        </div>

        {/* 属性格 */}
        <div className="m-attr-grid">
          <button
            type="button"
            className="m-attr-tile"
            onClick={() => setSheet("priority")}
          >
            <span className="m-attr-label">优先级</span>
            <span className="m-attr-value">
              <span className="m-color-dot" style={{ background: pri.color }} />
              {pri.label}
            </span>
          </button>
          <button
            type="button"
            className="m-attr-tile"
            onClick={() => setSheet("list")}
          >
            <span className="m-attr-label">所属清单</span>
            <span className="m-attr-value">
              <span
                className="m-color-dot"
                style={{ background: list?.color ?? "var(--text-3)" }}
              />
              <span className="m-ellipsis">{list?.name ?? "未分类"}</span>
            </span>
          </button>
          <button
            type="button"
            className="m-attr-tile"
            onClick={() => nav.push(`/task/${task.id}/edit`)}
          >
            <span className="m-attr-label">计划日期</span>
            <span
              className={`m-attr-value ${task.scheduledDate ? "" : "muted"}`}
            >
              {task.scheduledDate
                ? formatDateKey(task.scheduledDate)
                : "未安排"}
            </span>
          </button>
          <button
            type="button"
            className="m-attr-tile"
            onClick={() => nav.push(`/task/${task.id}/edit`)}
          >
            <span className="m-attr-label">截止时间</span>
            <span className={`m-attr-value ${task.dueAt ? "" : "muted"}`}>
              {task.dueAt ? formatDueShort(task.dueAt) : "未设置"}
            </span>
          </button>
          <button
            type="button"
            className="m-attr-tile"
            onClick={() => setSheet("reminder")}
          >
            <span className="m-attr-label">提醒</span>
            <span
              className={`m-attr-value ${task.remindBefore != null ? "" : "muted"}`}
            >
              {describeReminder(task.remindBefore)}
            </span>
          </button>
          <button
            type="button"
            className="m-attr-tile"
            onClick={() =>
              task.recurringRuleId ? nav.push("/recurring") : undefined
            }
          >
            <span className="m-attr-label">循环</span>
            <span
              className={`m-attr-value ${task.recurringRuleId ? "" : "muted"}`}
            >
              {task.recurringRuleId ? "查看规则" : "单次任务"}
            </span>
          </button>
        </div>

        {/* 检查清单 */}
        <section className="m-detail-section">
          <h3 className="m-detail-section-title">检查清单</h3>
          {task.subtasks.length > 0 && (
            <div className="m-subtask-progress">
              <span>
                进度 {subDone}/{task.subtasks.length}
              </span>
              <span className="m-subtask-progress-bar">
                <i
                  style={{
                    width: `${task.subtasks.length ? Math.round((subDone / task.subtasks.length) * 100) : 0}%`,
                  }}
                />
              </span>
            </div>
          )}
          <div className="m-subtask-list">
            {task.subtasks.map((st) => (
              <div
                key={st.id}
                className={`m-subtask-row ${st.completed ? "done" : ""}`}
              >
                <button
                  type="button"
                  className={`m-check ${st.completed ? "checked" : ""}`}
                  aria-label={st.completed ? "恢复子任务" : "完成子任务"}
                  onClick={toggleSubtasks(
                    task.subtasks.map((x) =>
                      x.id === st.id
                        ? {
                            ...x,
                            completed: !x.completed,
                            completedAt: !x.completed
                              ? new Date().toISOString()
                              : null,
                          }
                        : x,
                    ),
                  )}
                >
                  {st.completed ? <Check aria-hidden="true" /> : null}
                </button>
                <span className="m-subtask-title">{st.title}</span>
                <button
                  type="button"
                  className="m-subtask-del"
                  aria-label="删除子任务"
                  onClick={() =>
                    updateSubtasks((list) => list.filter((x) => x.id !== st.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="m-subtask-add">
              <input
                className="m-input-ghost"
                placeholder="添加检查项，回车确认"
                maxLength={80}
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubtask();
                  }
                }}
              />
            </div>
          </div>
        </section>

        {/* 附件（M-B 展示态；真交互批次 M-C 按场景 B/C 落地） */}
        {attachmentCount > 0 && (
          <section className="m-detail-section">
            <h3 className="m-detail-section-title">附件 · {attachmentCount}</h3>
            <div className="m-detail-static-row">在桌面端管理附件内容</div>
          </section>
        )}

        {/* 标签 */}
        {task.tags.length > 0 && (
          <section className="m-detail-section">
            <h3 className="m-detail-section-title">标签</h3>
            <div className="m-tag-row">
              {task.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="m-tag-pill"
                  onClick={() => nav.push(`/tag/${encodeURIComponent(tag)}`)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 底部固定操作条 */}
      <div className="m-detail-footer">
        <button
          type="button"
          className={`m-primary-btn ${done ? "ghost" : ""}`}
          onClick={() => {
            props.onToggleTask(task);
            if (done) props.onToast("已恢复为进行中");
          }}
        >
          {done ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          {done ? "恢复为进行中" : "标记完成"}
        </button>
        <button
          type="button"
          className="m-icon-danger-btn"
          aria-label="删除任务"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>

      {/* 浮层 */}
      {sheet === "more" && (
        <ActionSheet
          title="任务操作"
          items={[
            {
              label: done ? "恢复为进行中" : "标记完成",
              icon: done ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              ),
              onSelect: () => props.onToggleTask(task),
            },
            {
              label: "移动到其他清单",
              icon: <Folder aria-hidden="true" />,
              onSelect: () => setSheet("list"),
            },
            {
              label: "循环规则",
              icon: <Repeat2 aria-hidden="true" />,
              onSelect: () => nav.push("/recurring"),
            },
            {
              label: "删除任务",
              icon: <Trash2 aria-hidden="true" />,
              danger: true,
              onSelect: () => setConfirmDelete(true),
            },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "priority" && (
        <ActionSheet
          title="优先级"
          items={([2, 1, 0] as const).map((p) => ({
            label: `${PRIORITY_META[p].label}优先级`,
            icon: <Flag aria-hidden="true" />,
            onSelect: () => void patch({ priority: p }),
          }))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "list" && (
        <ActionSheet
          title="所属清单"
          items={listItems}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "reminder" && (
        <ActionSheet
          title="提醒时间"
          items={REMINDER_OPTIONS.map((r) => ({
            label: r.label,
            onSelect: () =>
              void patch({ remindBefore: r.value < 0 ? null : r.value }),
          }))}
          onClose={() => setSheet(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="删除任务？"
          body="任务将移入回收站。"
          confirmText="删除"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            props.onDeleteTask(task);
            nav.back();
          }}
        />
      )}
    </ScreenShell>
  );
}
