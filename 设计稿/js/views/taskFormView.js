/**
 * taskFormView.js — 新建 / 编辑任务（全屏表单页）
 * 路由：/new?listId=xx 与 /task/:id/edit
 * 日期/时间使用原生 input（Android WebView 会调起系统滚轮，最贴近真机）。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { screenShell } from "../components/common.js";
import { openListPicker } from "../components/sheets.js";
import { openActionSheet, openConfirm } from "../core/sheet.js";
import { toast } from "../core/toast.js";
import * as store from "../core/store.js";
import { PRIORITY_ORDER, PRIORITIES, REMINDER_OPTIONS, FREQ_LABELS } from "../data/enums.js";
import { isoToKey, toLocalInput } from "../core/format.js";

export function renderTaskForm(params, query, ctx, mode) {
  const s = store.getState();
  const editing = mode === "edit" ? s.tasks.find((t) => t.id === params.id) : null;
  if (mode === "edit" && !editing) {
    return screenShell({
      bar: appbar({ back: true, onBack: () => ctx.nav.back(), title: "编辑任务" }),
      body: [h("div.empty", { html: "<p>任务不存在</p>" })],
    });
  }

  /* 表单本地状态 */
  const form = {
    title: editing?.title ?? "",
    note: editing?.note ?? "",
    priority: editing?.priority ?? 1,
    listId: editing?.listId ?? query.listId ?? s.prefs.defaultListId,
    scheduledDate: editing?.scheduledDate ?? null,
    dueAt: editing?.dueAt ?? null,
    remindBefore: editing?.remindBefore ?? null,
    frequency: editing?.repeatRule ?? null,
    tags: editing ? [...editing.tags] : [],
  };

  /* ---------- 标题 / 备注 ---------- */
  const titleInput = h("input.form-title-input", {
    placeholder: "任务标题", value: form.title, maxlength: 120,
    oninput: (e) => { form.title = e.target.value; },
  });
  const noteInput = h("textarea.textarea.form-note", {
    placeholder: "补充描述、背景或验收标准…", rows: 4,
    oninput: (e) => { form.note = e.target.value; },
  });
  noteInput.value = form.note ?? "";

  /* ---------- 优先级三选一 ---------- */
  const priWrap = h("div.pri-options", { style: { marginBottom: "16px" } });
  function renderPri() {
    priWrap.replaceChildren(...PRIORITY_ORDER.map((p) =>
      h("button.pri-opt" + (form.priority === p ? ".active" : ""), {
        onclick: () => { form.priority = p; renderPri(); },
      }, [
        icon("flag", "i-sm"),
        h("span", { text: PRIORITIES[p].label }),
      ]),
    ));
  }
  renderPri();

  /* ---------- 选择行（点击唤起选择器） ---------- */
  const listRow = h("button.pick-row", { onclick: () => openListPicker(form.listId, (l) => { form.listId = l.id; refresh(); }) });
  const dateRow = h("button.pick-row", {});
  const dueRow = h("button.pick-row", {});
  const remindRow = h("button.pick-row", {});
  const repeatRow = h("button.pick-row", {});

  /* 隐藏的原生日期/时间输入，点行时唤起 */
  const dateNative = h("input.input.hide", { type: "date", onchange: (e) => { form.scheduledDate = e.target.value || null; refresh(); } });
  const dueNative = h("input.input.hide", { type: "datetime-local", onchange: (e) => { form.dueAt = e.target.value ? new Date(e.target.value).toISOString() : null; refresh(); } });
  dateRow.addEventListener("click", () => dateNative.showPicker ? dateNative.showPicker() : dateNative.click());
  dueRow.addEventListener("click", () => dueNative.showPicker ? dueNative.showPicker() : dueNative.click());
  remindRow.addEventListener("click", () => openActionSheet({
    title: "提醒时间",
    items: REMINDER_OPTIONS.map((r) => ({
      label: r.label,
      onSelect: () => { form.remindBefore = r.value < 0 ? null : r.value; refresh(); },
    })),
  }));
  repeatRow.addEventListener("click", () => openActionSheet({
    title: "重复频率",
    items: [
      { label: "不重复", onSelect: () => { form.frequency = null; refresh(); } },
      ...Object.entries(FREQ_LABELS).map(([id, label]) => ({ label, onSelect: () => { form.frequency = id; refresh(); } })),
    ],
  }));

  /* ---------- 标签 ---------- */
  const tagWrap = h("div.row.gap-2", { style: { flexWrap: "wrap", marginBottom: "16px" } });
  const tagInput = h("input.input", {
    placeholder: "输入标签后回车", style: { flex: "1 1 140px" }, maxlength: 12,
    onkeydown: (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        e.preventDefault();
        const v = e.target.value.trim().replace(/^#/, "");
        if (!form.tags.includes(v)) form.tags.push(v);
        e.target.value = "";
        refresh();
      }
    },
  });
  function renderTags() {
    tagWrap.replaceChildren(
      ...form.tags.map((t) => h("button.tag-pill.row", {
        style: { gap: "4px" },
        onclick: () => { form.tags = form.tags.filter((x) => x !== t); refresh(); },
      }, [h("span", { text: `#${t}` }), h("span", { html: icon("x", "i-sm") })])),
      tagInput,
    );
  }

  function pickRow(el, iconName, label, valueText, setFlag = false) {
    el.replaceChildren(
      h("span.pick-icon", { html: icon(iconName, "i-sm") }),
      h("span.pick-label", { text: label }),
      h("span.pick-value" + (setFlag ? ".t-accent" : ""), { text: valueText }),
      h("span.pick-chevron", { html: icon("chevron-right", "i-sm") }),
    );
    el.classList.toggle("set", Boolean(setFlag));
  }

  function refresh() {
    const list = s.lists.find((l) => l.id === form.listId);
    pickRow(listRow, "folder", "所属清单", list?.name ?? "未分类", true);
    pickRow(dateRow, "calendar-days", "计划日期",
      form.scheduledDate ? form.scheduledDate : "选择日期", Boolean(form.scheduledDate));
    pickRow(dueRow, "calendar-clock", "截止时间",
      form.dueAt ? toLocalInput(form.dueAt).replace("T", " ") : "选择时间", Boolean(form.dueAt));
    const remind = REMINDER_OPTIONS.find((r) => r.value === form.remindBefore);
    pickRow(remindRow, "bell", "提醒", remind?.label ?? "不提醒", form.remindBefore != null);
    pickRow(repeatRow, "repeat-2", "重复", form.frequency ? FREQ_LABELS[form.frequency] : "不重复", Boolean(form.frequency));
    renderTags();
  }
  refresh();

  async function save() {
    if (!form.title.trim()) { titleInput.focus(); toast("请先填写任务标题"); return; }
    const payload = {
      title: form.title.trim(),
      note: form.note?.trim() || null,
      priority: form.priority,
      listId: form.listId,
      scheduledDate: form.scheduledDate,
      dueAt: form.dueAt,
      remindBefore: form.remindBefore,
      repeatRule: form.frequency,
      tags: form.tags,
      subtasks: editing?.subtasks ?? [],
    };
    if (editing) {
      store.updateTask(editing.id, payload);
      toast("已保存修改");
      ctx.nav.back();
    } else {
      const created = store.createTask(payload);
      toast("任务已创建");
      ctx.nav.replace(`/task/${created.id}`);
    }
  }

  const bar = appbar({
    back: true, onBack: () => ctx.nav.back(),
    title: editing ? "编辑任务" : "新建任务",
    actions: [{ icon: "check", label: "保存", accent: true, onClick: save }],
  });

  const body = [
    titleInput,
    noteInput,
    h("label.field-label", { text: "优先级" }),
    priWrap,
    h("label.field-label", { text: "安排" }),
    listRow, dateRow, dueRow, remindRow, repeatRow,
    dateNative, dueNative,
    h("label.field-label", { style: { marginTop: "16px" }, text: "标签" }),
    tagWrap,
  ];

  const shell = screenShell({ bar, body, noTab: true, cls: "form-scroll" });
  shell.append(h("div.form-footer", {}, [
    editing
      ? h("button.btn.btn-danger", {
        onclick: async () => {
          const ok = await openConfirm({ title: "删除任务？", body: "任务将移入回收站。", confirmText: "删除", danger: true });
          if (ok) { store.softDeleteTask(editing.id); ctx.nav.back(); }
        },
      }, [icon("trash-2", "i-sm")])
      : null,
    h("button.btn.btn-primary.grow", { onclick: save, text: editing ? "保存修改" : "创建任务" }),
  ]));
  setTimeout(() => titleInput.focus(), 300);
  return shell;
}
