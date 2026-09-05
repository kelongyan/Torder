/**
 * mobile/pages/form.tsx — 任务新建 / 编辑全屏表单页（M-B）
 * 路由：/new（query: scheduledDate/listId 可选预填）、/task/:id/edit
 * 对齐设计稿 taskFormView：标题/备注/优先级 chips/安排行/标签。
 * 日期行点击经原生 input.showPicker() 唤起系统选择器（贴近真机）。
 * 保存走 store.addTask（新建→replace 详情）或 onSaveTask 全量（编辑→back），
 * 与桌面同一 IPC / 乐观更新通道。
 */
import { useMemo, useRef, useState, type JSX } from "react";
import { CalendarClock, CalendarDays, Flag, Folder } from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import type { Task } from "../../types/database";
import { normalizeError } from "../../utils/normalizeError";
import { priorityCopy } from "../../constants/taskConfig";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { EmptyView, ScreenShell, TopBar } from "../ui";
import { ActionSheet, type SheetActionItem } from "../parts/sheets";
import {
  buildUpdateTaskInput,
  describeReminder,
  formatDateKey,
  isoToLocalInput,
  localInputToIso,
  REMINDER_OPTIONS,
} from "../parts/taskEdits";

export function TaskFormPage({
  mode,
  taskId,
  query,
}: {
  mode: "new" | "edit";
  taskId?: string;
  query?: Record<string, string>;
}): JSX.Element {
  const { nav } = useMobilePage();
  const allTasks = useTaskStore((s) => s.allTasks);
  const existing = useMemo(() => {
    if (mode !== "edit" || !taskId) return null;
    return allTasks.find((t) => t.id === taskId) ?? null;
  }, [allTasks, mode, taskId]);

  if (mode === "edit" && !existing) {
    return (
      <ScreenShell
        topbar={<TopBar back onBack={() => nav.back()} title="编辑任务" />}
      >
        <EmptyView title="任务不存在或已删除" />
      </ScreenShell>
    );
  }
  return (
    <TaskFormContent
      key={existing?.id ?? "new"}
      mode={mode}
      existing={existing}
      query={query ?? {}}
    />
  );
}

function TaskFormContent({
  mode,
  existing,
  query,
}: {
  mode: "new" | "edit";
  existing: Task | null;
  query: Record<string, string>;
}): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const defaultListId =
    props.settings.defaultListId &&
    props.lists.some((l) => l.id === props.settings.defaultListId)
      ? props.settings.defaultListId
      : (props.lists[0]?.id ?? "");

  /* 本地表单状态 */
  const [title, setTitle] = useState(existing?.title ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [priority, setPriority] = useState(existing?.priority ?? 1);
  const [listId, setListId] = useState(
    existing?.listId ??
      (query.listId && props.lists.some((l) => l.id === query.listId)
        ? query.listId
        : defaultListId),
  );
  const [scheduledDate, setScheduledDate] = useState(
    existing?.scheduledDate ?? query.scheduledDate ?? "",
  );
  const [dueLocal, setDueLocal] = useState(
    existing?.dueAt ? isoToLocalInput(existing.dueAt).slice(0, 16) : "",
  );
  const [remindBefore, setRemindBefore] = useState<number | null>(
    existing?.remindBefore ?? null,
  );
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [listSheet, setListSheet] = useState(false);
  const [remindSheet, setRemindSheet] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const dateScheduledRef = useRef<HTMLInputElement>(null);
  const dateDueRef = useRef<HTMLInputElement>(null);

  const dueAt = dueLocal ? localInputToIso(dueLocal) : null;
  const listName = props.lists.find((l) => l.id === listId)?.name ?? "未分类";

  const listItems: SheetActionItem[] = useMemo(
    () =>
      props.lists.map((list) => ({
        label: list.name,
        icon: <Folder aria-hidden="true" />,
        onSelect: () => setListId(list.id),
      })),
    [props.lists],
  );

  function openNativePicker(input: HTMLInputElement | null) {
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // 非用户手势等异常时退回 click 兜底
    }
    input.click();
  }

  async function handleSave() {
    if (!title.trim()) {
      titleRef.current?.focus();
      props.onToast("请先填写任务标题");
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit" && existing) {
        await props.onSaveTask(
          buildUpdateTaskInput(existing, {
            title: title.trim(),
            note: note.trim() ? note.trim() : null,
            priority,
            listId,
            scheduledDate: scheduledDate || null,
            dueAt,
            remindBefore,
            tags,
          }),
        );
        props.onToast("已保存修改");
        nav.back();
      } else {
        const created = await useTaskStore.getState().addTask({
          title: title.trim(),
          note: note.trim() ? note.trim() : null,
          priority,
          listId: listId || undefined,
          scheduledDate: scheduledDate || null,
          dueAt,
          remindBefore,
          tags,
        });
        props.onToast("任务已创建");
        nav.replace(`/task/${created.id}`);
      }
    } catch (error) {
      props.onToast(`保存失败：${normalizeError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  function commitTag() {
    const value = tagDraft.trim().replace(/^#/, "");
    if (value && !tags.includes(value)) setTags((prev) => [...prev, value]);
    setTagDraft("");
  }

  return (
    <ScreenShell
      topbar={
        <TopBar
          back
          onBack={() => nav.back()}
          title={mode === "edit" ? "编辑任务" : "新建任务"}
        />
      }
      footer={
        <button
          type="button"
          className="m-primary-btn grow"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {mode === "edit" ? "保存修改" : "创建任务"}
        </button>
      }
      className="m-form-page"
    >
      <div className="m-form">
        <div className="m-form-card">
          <input
            ref={titleRef}
            className="m-form-title-input"
            placeholder="任务标题"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div className="m-form-card-divider" />
          <textarea
            className="m-form-note"
            placeholder="补充描述、背景或验收标准…"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="m-field-label">优先级</div>
        <div className="m-pri-options">
          {([2, 1, 0] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`m-pri-opt ${priority === p ? "active" : ""}`}
              onClick={() => setPriority(p)}
            >
              <Flag
                aria-hidden="true"
                style={{
                  color: priority === p ? "var(--on-accent)" : undefined,
                }}
              />
              <span>{priorityCopy[p].label}</span>
            </button>
          ))}
        </div>

        <div className="m-field-label">安排</div>
        <div className="m-field-group">
          <button
            type="button"
            className="m-field-row"
            onClick={() => setListSheet(true)}
          >
            <span className="m-field-row-icon">
              <Folder aria-hidden="true" size={18} />
            </span>
            <span className="m-field-row-label">所属清单</span>
            <span className="m-field-row-value">{listName}</span>
            <span className="m-field-row-chev" />
          </button>

          <button
            type="button"
            className="m-field-row"
            onClick={() => openNativePicker(dateScheduledRef.current)}
          >
            <span className="m-field-row-icon">
              <CalendarDays aria-hidden="true" size={18} />
            </span>
            <span className="m-field-row-label">计划日期</span>
            <span className={`m-field-row-value ${scheduledDate ? "set" : ""}`}>
              {scheduledDate ? formatDateKey(scheduledDate) : "选择日期"}
            </span>
            <span className="m-field-row-chev" />
          </button>

          <button
            type="button"
            className="m-field-row"
            onClick={() => openNativePicker(dateDueRef.current)}
          >
            <span className="m-field-row-icon">
              <CalendarClock aria-hidden="true" size={18} />
            </span>
            <span className="m-field-row-label">截止时间</span>
            <span className={`m-field-row-value ${dueLocal ? "set" : ""}`}>
              {dueLocal ? dueLocal.replace("T", " ") : "选择时间"}
            </span>
            <span className="m-field-row-chev" />
          </button>

          <button
            type="button"
            className="m-field-row"
            onClick={() => setRemindSheet(true)}
          >
            <span className="m-field-row-icon">
              <CalendarClock aria-hidden="true" size={18} />
            </span>
            <span className="m-field-row-label">提醒</span>
            <span
              className={`m-field-row-value ${remindBefore != null ? "set" : ""}`}
            >
              {describeReminder(remindBefore)}
            </span>
            <span className="m-field-row-chev" />
          </button>

          {existing?.recurringRuleId ? (
            <div className="m-field-row m-field-row-static">
              <span className="m-field-row-icon">
                <CalendarDays aria-hidden="true" size={18} />
              </span>
              <span className="m-field-row-label">循环任务</span>
              <span className="m-field-row-value">由循环规则管理</span>
            </div>
          ) : null}
        </div>

        <div className="m-field-label">标签</div>
        <div className="m-field-group m-tag-group">
          <div className="m-tag-row">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="m-tag-pill"
                onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
              >
                #{tag} <span aria-hidden="true">×</span>
              </button>
            ))}
            <input
              className="m-tag-input"
              placeholder={tags.length ? "" : "输入标签后回车"}
              maxLength={12}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTag();
                }
              }}
              onBlur={commitTag}
            />
          </div>
        </div>

        {/* 原生日期控件（点击行经 showPicker 唤起） */}
        <input
          ref={dateScheduledRef}
          type="date"
          className="m-hidden-input"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          tabIndex={-1}
        />
        <input
          ref={dateDueRef}
          type="datetime-local"
          className="m-hidden-input"
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          tabIndex={-1}
        />
      </div>

      {listSheet && (
        <ActionSheet
          title="所属清单"
          items={listItems}
          onClose={() => setListSheet(false)}
        />
      )}
      {remindSheet && (
        <ActionSheet
          title="提醒时间"
          items={REMINDER_OPTIONS.map((r) => ({
            label: r.label,
            onSelect: () => setRemindBefore(r.value < 0 ? null : r.value),
          }))}
          onClose={() => setRemindSheet(false)}
        />
      )}
    </ScreenShell>
  );
}
