/**
 * taskDialog.js — 新建/编辑任务对话框（镜像 TaskCreateDialog + TaskFormFields）
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openDialog, openPopover } from "../core/modal.js";
import { toast } from "../core/toast.js";
import {
  getState, createTask, updateTask, getList, addSubtask, removeSubtask,
} from "../core/store.js";
import { REMINDER_OPTIONS, PRIORITIES } from "../data/enums.js";
import { toLocalInput } from "../core/format.js";

export function openTaskDialog(opts = {}, ctx = {}) {
  const editing = opts.task ?? null;
  const s = getState();
  let priority = editing?.priority ?? opts.presetPriority ?? 1;
  let listId = editing?.listId ?? opts.presetListId ?? s.prefs.defaultListId;
  let remind = editing?.remindBefore ?? -1;
  const subtasks = editing ? [...editing.subtasks] : [];

  const titleInput = h("input.input", {
    type: "text", placeholder: "任务标题，例如：明天 15 点提交周报",
    value: editing?.title ?? "",
    style: { fontSize: "var(--fs-md)", height: 40 },
  });
  const noteInput = h("textarea.textarea", { placeholder: "备注（可选）", rows: 3 });
  if (editing?.note) noteInput.value = editing.note;
  const dateInput = h("input.input", { type: "date", value: editing?.scheduledDate ?? "" });
  const timeInput = h("input.input", { type: "time", value: editing?.dueAt ? toLocalInput(editing.dueAt).slice(11) : "" });

  /* 优先级三选一 */
  const priWrap = h("div.pri-picker");
  function paintPri() {
    priWrap.replaceChildren(...[2, 1, 0].map((p) =>
      h("button.pri-opt" + (priority === p ? `.sel-${p === 2 ? "high" : p === 1 ? "medium" : "low"}` : ""), {
        onclick: () => { priority = p; paintPri(); },
      }, [icon("flag", "i-sm"), document.createTextNode(PRIORITIES[p].label)]),
    ));
  }
  paintPri();

  /* 清单选择 */
  const listValue = h("span.pick-value");
  const listRow = h("button.pick-row", {
    type: "button",
    onclick: (e) => {
      const items = s.lists.map((l) => ({
        label: l.name, icon: "folder", checked: l.id === listId,
        onClick: () => { listId = l.id; paintList(); },
      }));
      openPopover(e.currentTarget, items, { align: "left", width: 180 });
    },
  }, [
    h("span.pick-label", {}, [icon("folder", "i-sm"), document.createTextNode("清单")]),
    listValue,
    h("span.pick-chevron", { html: icon("chevron-right", "i-sm") }),
  ]);
  function paintList() { listValue.textContent = getList(listId)?.name ?? ""; }
  paintList();

  /* 提醒选择 */
  const remindValue = h("span.pick-value");
  const remindRow = h("button.pick-row", {
    type: "button",
    onclick: (e) => {
      openPopover(e.currentTarget, REMINDER_OPTIONS.map((r) => ({
        label: r.label, checked: r.value === remind,
        onClick: () => { remind = r.value; paintRemind(); },
      })), { align: "left", width: 170 });
    },
  }, [
    h("span.pick-label", {}, [icon("bell-ring", "i-sm"), document.createTextNode("提醒")]),
    remindValue,
    h("span.pick-chevron", { html: icon("chevron-right", "i-sm") }),
  ]);
  function paintRemind() { remindValue.textContent = REMINDER_OPTIONS.find((r) => r.value === remind)?.label ?? ""; }
  paintRemind();

  /* 子任务编辑列表 */
  const subBox = h("div");
  const subInput = h("input.input", { type: "text", placeholder: "添加检查清单项，Enter 确认" });
  function paintSubs() {
    subBox.replaceChildren(...subtasks.map((sub, i) =>
      h("div.sub-edit-row", {}, [
        h("span", { html: icon("check-circle", "i-sm"), class: "t-muted" }),
        h("span.flex1", { text: sub.title, style: sub.completed ? { textDecoration: "line-through", color: "var(--text-3)" } : {} }),
        h("button.icon-btn", { html: icon("x", "i-sm"), onclick: () => { subtasks.splice(i, 1); paintSubs(); } }),
      ]),
    ));
  }
  subInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && subInput.value.trim()) {
      subtasks.push({ id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, title: subInput.value.trim(), completed: false });
      subInput.value = "";
      paintSubs();
    }
  });
  paintSubs();

  const body = h("div.col.gap-3", {}, [
    titleInput,
    noteInput,
    h("div", {}, [h("label.field-label", { text: "优先级" }), priWrap]),
    h("div.form-grid", {}, [
      h("div", {}, [h("label.field-label", { text: "计划日期" }), dateInput]),
      h("div", {}, [h("label.field-label", { text: "时刻" }), timeInput]),
    ]),
    listRow,
    remindRow,
    h("div", {}, [
      h("label.field-label", { text: "检查清单" }),
      subBox,
      subInput,
    ]),
  ]);

  const footer = h("div.dialog-footer-row", {}, [
    h("button.btn.btn-ghost", { text: "取消", onclick: () => ctrl.close() }),
    h("button.btn.btn-primary", {
      onclick: () => {
        const title = titleInput.value.trim();
        if (!title) { titleInput.focus(); return; }
        let dueAt = null;
        if (dateInput.value) {
          const d = new Date(`${dateInput.value}T${timeInput.value || "09:00"}`);
          dueAt = d.toISOString();
        }
        const patch = {
          title, note: noteInput.value.trim() || null, priority, listId,
          scheduledDate: dateInput.value || null, dueAt,
          remindBefore: remind >= 0 ? remind : null,
          subtasks,
        };
        if (editing) {
          updateTask(editing.id, patch);
          toast("任务已更新");
        } else {
          const t = createTask(patch);
          toast("任务已创建");
          ctx.openDetail?.(t);
        }
        ctrl.close();
      },
    }, [icon(editing ? "check" : "plus", "i-sm"), document.createTextNode(editing ? "保存修改" : "创建任务")]),
  ]);

  const ctrl = openDialog({
    title: editing ? "编辑任务" : "新建任务",
    icon: editing ? "pencil" : "plus",
    body, footer, width: 580,
  });
  requestAnimationFrame(() => titleInput.focus());
  return ctrl;
}
