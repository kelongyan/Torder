/**
 * detailDrawer.js — 右侧任务详情抽屉（镜像 TaskDetailPanel）
 * 宽度由 .detail-drawer.open 控制；无选中任务时收起。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { PRIORITIES } from "../data/enums.js";
import {
  getState, getList, getTask, closeDetail, toggleTask, softDeleteTask,
  toggleSubtask, addSubtask,
} from "../core/store.js";
import { formatDue, formatSchedule, formatTaskDateTimeLabel } from "../core/format.js";
import { openTaskContextMenu } from "./menus.js";

function attrCell(k, v) {
  return h("div.attr-cell", {}, [h("span.attr-k", { text: k }), h("span.attr-v", { text: v })]);
}

export function renderDetailDrawer(ctx) {
  const s = getState();
  const task = s.ui.selectedTaskId ? getTask(s.ui.selectedTaskId) : null;
  const drawer = h("aside.detail-drawer" + (task ? ".open" : ""));
  if (!task) return drawer;

  const list = getList(task.listId);
  const done = task.status === "done";
  const subs = task.subtasks ?? [];
  const subDone = subs.filter((x) => x.completed).length;

  const subInput = h("input.input", { type: "text", placeholder: "添加子任务，Enter 确认" });
  subInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && subInput.value.trim()) {
      addSubtask(task.id, subInput.value);
      subInput.value = "";
    }
  });

  const inner = h("div.detail-inner", {}, [
    h("div.detail-topbar", {}, [
      h("button.icon-btn", { html: icon("x", "i-sm"), title: "关闭详情", onclick: () => closeDetail() }),
      h("span.flex1"),
      h("button.icon-btn", {
        html: icon("pencil", "i-sm"), title: "编辑",
        onclick: () => ctx?.openEditor?.(task),
      }),
      h("button.icon-btn", {
        html: icon("more-horizontal", "i-sm"), title: "更多",
        onclick: (e) => openTaskContextMenu(e.currentTarget, task, ctx),
      }),
    ]),
    h("div.detail-body.scroll", {}, [
      h("div.row.gap-3", { style: { marginBottom: 10 } }, [
        h("button.check-circle" + (done ? ".done" : ""), {
          html: icon("check", "i-sm"),
          onclick: () => toggleTask(task.id),
        }),
        h("div.detail-title", { class: done ? "" : "", text: task.title }),
      ]),
      task.tags.length ? h("div.row.gap-2", { style: { marginBottom: 6, flexWrap: "wrap" } },
        task.tags.map((t) => h("span.tag-chip", { text: `#${t}` }))) : null,
      task.note ? h("p.detail-note", { style: { marginTop: 8 }, text: task.note }) : null,

      h("div.detail-section", {}, [
        h("div.detail-section-title", {}, [icon("sliders-horizontal", "i-sm"), document.createTextNode("属性")]),
        h("div.attr-grid", {}, [
          attrCell("所属清单", list?.name ?? "—"),
          attrCell("优先级", PRIORITIES[task.priority]?.label ?? "中"),
          attrCell("截止时间", formatDue(task.dueAt) ?? "未设置"),
          attrCell("计划日期", formatSchedule(task.scheduledDate) ?? "未设置"),
          attrCell("提醒", task.remindBefore != null ? "提前 " + (task.remindBefore >= 60 ? `${task.remindBefore / 60} 小时` : `${task.remindBefore} 分钟`) : "不提醒"),
          attrCell("创建时间", formatTaskDateTimeLabel(task.createdAt)),
        ]),
      ]),

      h("div.detail-section", {}, [
        h("div.detail-section-title", {}, [
          icon("list-checks", "i-sm"),
          document.createTextNode(`检查清单`),
          h("span.sub-progress", { text: subs.length ? `${subDone}/${subs} · ${Math.round((subDone / subs.length) * 100)}%` : "" }),
        ]),
        h("div", {}, subs.map((sub) =>
          h("div.sub-row" + (sub.completed ? ".done" : ""), { onclick: () => toggleSubtask(task.id, sub.id) }, [
            h("button.check-circle" + (sub.completed ? ".done" : ""), { style: { width: 15, height: 15 }, html: icon("check", "i-xs") }),
            h("span.sub-title.flex1", { text: sub.title }),
          ]),
        )),
        h("div", { style: { marginTop: 8 } }, [subInput]),
      ]),

      h("div.detail-section", {}, [
        h("div.detail-section-title", {}, [icon("paperclip", "i-sm"), document.createTextNode("附件与关联")]),
        task.attachmentCount
          ? h("div.row.gap-2", {}, [h("span.chip", {}, [icon("paperclip", "i-xs"), document.createTextNode(`${task.attachmentCount} 个附件`)])])
          : h("p.t-muted.fs-sm", { text: "暂无附件；桌面端支持托管文件、本地引用与网页链接。" }),
      ]),
    ]),
    h("div.detail-actions", {}, [
      h("button.btn.btn-ghost.grow", {
        onclick: () => { softDeleteTask(task.id); },
      }, [icon("trash-2", "i-sm"), document.createTextNode("移入回收站")]),
      h("button.btn.btn-primary.grow", {
        onclick: () => toggleTask(task.id),
      }, [icon(done ? "rotate-ccw" : "check", "i-sm"), document.createTextNode(done ? "标记未完成" : "标记完成")]),
    ]),
  ]);
  drawer.append(inner);
  return drawer;
}
