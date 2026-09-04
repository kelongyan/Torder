/**
 * taskRow.js — 桌面任务行
 * 左：拖拽手柄（手动排序视觉）+ 复选圈；中：标题 + 元信息行；右：悬停操作
 * 单击行打开右侧详情抽屉；复选圈切换完成；更多按钮弹锚点菜单。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { getList, toggleTask, getState } from "../core/store.js";
import { formatDue, isoToKey, dateKey, isOverdue } from "../core/format.js";
import { openTaskContextMenu } from "./menus.js";

export function taskRow(task, opts = {}) {
  const done = task.status === "done";
  const list = getList(task.listId);
  const dueLabel = formatDue(task.dueAt);
  const overdue = !done && task.dueAt && isOverdue(task.dueAt);
  const selected = getState().ui.selectedTaskId === task.id;
  const subTotal = task.subtasks?.length ?? 0;
  const subDone = task.subtasks?.filter((s) => s.completed).length ?? 0;

  const meta = [];
  if (list && !opts.hideList) {
    meta.push(h("span.meta-chip", {}, [
      h("span.list-dot", { style: { background: list.color ?? "var(--accent)" } }),
      document.createTextNode(list.name),
    ]));
  }
  if (dueLabel) {
    meta.push(h("span.meta-chip" + (overdue ? ".overdue" : ""), {}, [
      icon("clock", "i-xs"),
      document.createTextNode(dueLabel),
    ]));
  }
  if (subTotal) {
    meta.push(h("span.meta-chip", {}, [icon("list-checks", "i-xs"), document.createTextNode(`${subDone}/${subTotal}`)]));
  }
  if (task.attachmentCount) {
    meta.push(h("span.meta-chip", {}, [icon("paperclip", "i-xs"), document.createTextNode(String(task.attachmentCount))]));
  }
  if (task.remindBefore != null) meta.push(h("span.meta-chip", {}, [icon("bell", "i-xs")]));
  if (task.recurringRuleId) meta.push(h("span.meta-chip", {}, [icon("repeat", "i-xs")]));
  for (const tag of task.tags) meta.push(h("span.tag-chip", { text: `#${tag}` }));

  const row = h("div.task-row" + (done ? ".is-done" : "") + (selected ? ".selected" : ""), {
    dataset: { id: task.id },
    onclick: (e) => {
      if (e.target.closest(".row-check") || e.target.closest(".row-actions") || e.target.closest(".row-grip")) return;
      opts.onOpen?.(task);
    },
    oncontextmenu: (e) => {
      e.preventDefault();
      openTaskContextMenu({ x: e.clientX, y: e.clientY }, task, opts.ctx);
    },
  }, [
    h("span.row-grip", { title: "拖拽排序（手动排序）", html: icon("grip-vertical", "i-sm") }),
    h("button.row-check.check-circle" + (done ? ".done" : ""), {
      "aria-label": done ? "标记为未完成" : "标记完成",
      onclick: (e) => { e.stopPropagation(); toggleTask(task.id); },
      html: icon("check", "i-xs"),
    }),
    h("span.pri-flag.bar-" + (task.priority === 2 ? "high" : task.priority === 1 ? "medium" : "low"), {
      title: `优先级：${task.priority === 2 ? "高" : task.priority === 1 ? "中" : "低"}`,
    }),
    h("div.row-main", {}, [
      h("div.row-title-line", {}, [h("span.row-title", { text: task.title })]),
      meta.length ? h("div.row-meta-line", {}, meta) : null,
    ]),
    h("div.row-actions", {}, [
      h("button.icon-btn", {
        title: "重要标记",
        class: task.priority === 2 ? "active" : "",
        html: icon("star", "i-sm"),
        onclick: (e) => {
          e.stopPropagation();
          import("../core/store.js").then((s) => s.updateTask(task.id, { priority: task.priority === 2 ? 1 : 2 }));
        },
      }),
      h("button.icon-btn", {
        title: "更多操作",
        html: icon("more-horizontal", "i-sm"),
        onclick: (e) => {
          e.stopPropagation();
          row.classList.add("menu-open");
          openTaskContextMenu(e.currentTarget, task, opts.ctx, () => row.classList.remove("menu-open"));
        },
      }),
    ]),
  ]);
  return row;
}
