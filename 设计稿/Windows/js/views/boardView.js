/**
 * boardView.js — 看板布局（镜像 TaskBoard 三列）
 * 待处理（非完成且非高优先）/ 进行中（非完成且高优先）/ 已完成
 * 桌面端列间拖拽为 DnD 语义，设计稿用点击“移入”演示状态流转。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { boardColumns, getList, updateTask, getState } from "../core/store.js";
import { formatDue, isOverdue } from "../core/format.js";
import { openPopover } from "../core/modal.js";
import { toast } from "../core/toast.js";

function kanbanCard(task, ctx) {
  const list = getList(task.listId);
  const done = task.status === "done";
  const due = formatDue(task.dueAt);
  const overdue = !done && task.dueAt && isOverdue(task.dueAt);
  return h("div.kanban-card" + (done ? ".done" : ""), {
    onclick: () => ctx?.openDetail(task),
  }, [
    h("div.kc-title", { text: task.title }),
    h("div.kc-meta", {}, [
      h("span.meta-chip", {}, [
        h("span.list-dot", { style: { background: list?.color ?? "var(--accent)" } }),
        document.createTextNode(list?.name ?? ""),
      ]),
      due ? h("span.meta-chip" + (overdue ? ".overdue" : ""), {}, [icon("clock", "i-xs"), document.createTextNode(due)]) : null,
      ...task.tags.slice(0, 2).map((t) => h("span.tag-chip", { text: `#${t}` })),
      h("span", { style: { marginLeft: "auto" }, html: icon("grip-vertical", "i-xs") }),
    ]),
  ]);
}

export function boardView(route, ctx) {
  const cols = boardColumns();
  const moveMenu = (anchor, task) => {
    openPopover(anchor, [
      { header: "移到列" },
      { label: "待处理", icon: "circle", onClick: () => { updateTask(task.id, { status: "todo", priority: 1 }); toast("已移到待处理"); } },
      { label: "进行中（高优先）", icon: "circle-dot", onClick: () => { updateTask(task.id, { status: "todo", priority: 2 }); toast("已移到进行中"); } },
      { label: "已完成", icon: "check-circle-2", onClick: () => { updateTask(task.id, { status: "done", completedAt: new Date().toISOString() }); toast("已完成"); } },
    ], { align: "left", width: 200 });
  };

  return h("div.board-view", {}, cols.map((col) =>
    h("div.board-column", {}, [
      h("div.board-col-head", {}, [
        h("span.board-col-bar", { style: { background: `var(${col.colorVar})` } }),
        h("h3", { text: col.title }),
        h("span.board-col-count", { text: String(col.tasks.length) }),
        h("button.board-col-add", {
          html: icon("plus", "i-sm"),
          title: "在该列新建",
          onclick: () => ctx?.openCreate?.(undefined, col.id === "doing" ? 2 : 1),
        }),
      ]),
      h("div.board-col-body.scroll", {},
        col.tasks.length
          ? col.tasks.map((t) => kanbanCard(t, ctx))
          : [h("div.empty-state", { style: { padding: "28px 12px" } }, [h("p.fs-xs", { text: "拖卡片到这里" })])],
      ),
    ]),
  ));
}
