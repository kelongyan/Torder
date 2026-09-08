/**
 * taskDetailView.js — 任务详情全屏页（桌面端是右侧抽屉，移动端改为独立页面）
 * 标题/描述/属性网格/检查清单/附件/标签 + 底部固定完成条。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { screenShell } from "../components/common.js";
import { openTaskActions, openListPicker } from "../components/sheets.js";
import { openActionSheet, openConfirm } from "../core/sheet.js";
import { toast } from "../core/toast.js";
import * as store from "../core/store.js";
import {
  PRIORITIES, PRIORITY_ORDER,
  REMINDER_OPTIONS, DEFAULT_LIST_COLOR,
} from "../data/enums.js";
import { formatDue, formatSchedule, formatTaskDateTimeLabel } from "../core/format.js";

export function renderTaskDetail(params, _q, ctx) {
  const task = store.getState().tasks.find((t) => t.id === params.id);
  if (!task) return renderMissing(ctx);
  const s = store.getState();
  const listsMap = new Map(s.lists.map((l) => [l.id, l]));
  const list = listsMap.get(task.listId);
  const done = task.status === "done";
  const pri = PRIORITIES[task.priority];
  const subDone = task.subtasks.filter((x) => x.completed).length;

  const bar = appbar({
    back: true, onBack: () => ctx.nav.back(),
    title: "任务详情",
    actions: [{
      icon: "pencil", label: "编辑",
      onClick: () => ctx.nav.push(`/task/${task.id}/edit`),
    }, {
      icon: "more-horizontal", label: "更多",
      onClick: () => openTaskActions(task, {
        onToggle: () => store.toggleTask(task.id),
        onEdit: () => ctx.nav.push(`/task/${task.id}/edit`),
        onMoveList: () => openListPicker(task.listId, (l) => {
          store.updateTask(task.id, { listId: l.id });
          toast(`已移动到「${l.name}」`);
        }),
        onDelete: async () => {
          const ok = await openConfirm({ title: "删除任务？", body: "任务将移入回收站。", confirmText: "删除", danger: true });
          if (ok) { store.softDeleteTask(task.id); ctx.nav.back(); }
        },
      }),
    }],
  });

  /* 属性格 */
  const attrTile = (label, valueNode, onClick) =>
    h("button.attr-tile", { onclick: onClick }, [
      h("span.attr-label", { text: label }),
      h("span.attr-value", {}, Array.isArray(valueNode) ? valueNode : [valueNode]),
    ]);

  const attrGrid = h("div.attr-grid", {}, [
    attrTile("优先级", [
      h("span.color-dot", { style: { background: `var(${pri.colorVar})` } }),
      h("span", { text: pri.label }),
    ], () => pickPriority(task)),
    attrTile("所属清单", [
      h("span.color-dot", { style: { background: list?.color ?? DEFAULT_LIST_COLOR } }),
      h("span.ellipsis", { text: list?.name ?? "未分类" }),
    ], () => openListPicker(task.listId, (l) => {
      store.updateTask(task.id, { listId: l.id });
      toast(`已移动到「${l.name}」`);
    })),
    attrTile("计划日期", task.scheduledDate
      ? h("span", { text: formatSchedule(task.scheduledDate) })
      : h("span.t-muted", { text: "未安排" }), () => ctx.nav.push(`/task/${task.id}/edit`)),
    attrTile("截止时间", task.dueAt
      ? h("span", { text: formatDue(task.dueAt) ?? "未设置" })
      : h("span.t-muted", { text: "未设置" }), () => ctx.nav.push(`/task/${task.id}/edit`)),
    attrTile("提醒", h("span", {
      className: task.remindBefore != null ? "" : "t-muted",
      text: describeRemind(task),
    }), () => pickReminder(task)),
    attrTile("循环", task.recurringRuleId
      ? [icon("repeat-2", "i-sm"), h("span", { text: "查看规则" })]
      : h("span.t-muted", { text: "单次任务" }), () => ctx.nav.push("/recurring")),
  ]);

  /* 检查清单 */
  const subtaskSection = h("section.detail-section", {}, [
    h("h3", { text: "检查清单" }),
    task.subtasks.length ? h("div.group", { style: { marginBottom: "8px" } }, [
      h("div", { style: { padding: "10px 12px" } }, [
        h("div.row-between.fs-xs.t-muted", { style: { display: "flex", justifyContent: "space-between", marginBottom: "8px" } }, [
          h("span", { text: `进度 ${subDone}/${task.subtasks.length}` }),
          h("span", { text: `${task.subtasks.length ? Math.round((subDone / task.subtasks.length) * 100) : 0}%` }),
        ]),
        h("div.progress", {}, [h("i", { style: { width: `${task.subtasks.length ? (subDone / task.subtasks.length) * 100 : 0}%` } })]),
      ]),
      ...task.subtasks.map((st) =>
        h("div.subtask-row" + (st.completed ? ".done" : ""), {}, [
          h("button.check" + (st.completed ? ".checked" : ""), {
            onclick: () => store.toggleSubtask(task.id, st.id), html: st.completed ? icon("check") : "",
          }),
          h("span.st-title.grow", { text: st.title }),
          h("button.mini-icon", { "aria-label": "删除子任务", html: icon("x", "i-sm"), onclick: () => store.removeSubtask(task.id, st.id) }),
        ]),
      ),
    ]) : null,
    subtaskAdder(task),
  ]);

  /* 附件（设计稿展示态） */
  const attachSection = task.attachmentCount ? h("section.detail-section", {}, [
    h("h3", { text: `附件 · ${task.attachmentCount}` }),
    h("div.attach-row", {}, [
      h("div.att-thumb", { html: icon("paperclip", "i-lg") }),
      h("div.att-meta", {}, [
        h("div.att-name", { text: "设计稿批注.pdf" }),
        h("div.att-sub", { text: "2.4 MB · 已同步" }),
      ]),
      icon("chevron-right", "i-sm"),
    ]),
  ]) : null;

  /* 标签 */
  const tagSection = h("section.detail-section", {}, [
    h("h3", { text: "标签" }),
    task.tags.length
      ? h("div.row.gap-2", { style: { flexWrap: "wrap" } }, task.tags.map((t) => h("span.tag-pill", { text: `#${t}` })))
      : h("span.t-muted.fs-sm", { text: "无标签，编辑任务时可添加" }),
  ]);

  const body = [
    h("div.detail-hero", {}, [
      h("h2", {
        text: task.title,
        style: { fontSize: "var(--fs-xl)", lineHeight: 1.4, fontWeight: 700 },
      }),
      h("div.detail-status-row", {}, [
        h("span.status-pill" + (done ? ".done" : ""), { text: done ? "已完成" : "进行中" }),
        h("span.fs-xs.t-muted", { text: `创建于 ${formatTaskDateTimeLabel(task.createdAt)}` }),
      ]),
    ]),
    h("section.detail-section", {}, [
      h("h3", { text: "描述" }),
      h("div.detail-note", {}, task.note
        ? [h("span", { text: task.note })]
        : [h("span.ph", { text: "无描述，点击编辑补充背景与验收标准" })]),
    ]),
    h("section.detail-section", {}, [h("h3", { text: "属性" }), attrGrid]),
    subtaskSection,
    attachSection,
    tagSection,
  ];

  const shell = screenShell({ bar, body, noTab: true });
  shell.append(h("div.detail-footer", {}, [
    h("button.btn" + (done ? ".btn-ghost" : ".btn-primary"), {
      style: { flex: 1 },
      onclick: () => { store.toggleTask(task.id); toast(done ? "已恢复为进行中" : "已完成，干得漂亮"); },
    }, [
      icon(done ? "rotate-ccw" : "check", "i-sm"),
      h("span", { text: done ? "恢复为进行中" : "标记完成" }),
    ]),
    h("button.btn.btn-ghost", {
      "aria-label": "删除",
      onclick: async () => {
        const ok = await openConfirm({ title: "删除任务？", body: "任务将移入回收站。", confirmText: "删除", danger: true });
        if (ok) { store.softDeleteTask(task.id); ctx.nav.back(); }
      },
    }, [icon("trash-2")]),
  ]));
  return shell;
}

function subtaskAdder(task) {
  const input = h("input.input", { placeholder: "添加检查项，回车确认", maxlength: 80 });
  return h("div.subtask-add", {}, [
    input,
    h("button.icon-btn.accent", {
      html: icon("plus"),
      onclick: () => {
        if (!input.value.trim()) return;
        store.addSubtask(task.id, input.value);
      },
    }),
  ]);
}

function pickPriority(task) {
  openActionSheet({
    title: "优先级",
    items: PRIORITY_ORDER.map((p) => ({
      label: `${PRIORITIES[p].label}优先级`,
      icon: "flag",
      onSelect: () => { store.updateTask(task.id, { priority: p }); toast("优先级已更新"); },
    })),
  });
}
function pickReminder(task) {
  openActionSheet({
    title: "提醒时间",
    items: REMINDER_OPTIONS.map((r) => ({
      label: r.label,
      onSelect: () => {
        store.updateTask(task.id, { remindBefore: r.value < 0 ? null : r.value });
        toast("提醒已更新");
      },
    })),
  });
}
function describeRemind(task) {
  if (task.remindBefore == null) return "未设置";
  const hit = REMINDER_OPTIONS.find((r) => r.value === task.remindBefore);
  return hit?.label ?? `提前 ${task.remindBefore} 分钟`;
}

function renderMissing(ctx) {
  const bar = appbar({ back: true, onBack: () => ctx.nav.back(), title: "任务详情" });
  return screenShell({
    bar, noTab: true,
    body: [h("div.empty", {}, [
      h("div.empty-icon", { html: icon("alert-circle", "i-xl") }),
      h("h3", { text: "任务不存在或已删除" }),
    ])],
  });
}
