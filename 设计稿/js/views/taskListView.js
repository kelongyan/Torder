/**
 * taskListView.js — 通用任务列表屏幕
 * 同时服务三条路由：/view/:view（系统视图）、/list/:listId（清单）、/tag/:tag
 * 回收站（deleted）行内动作为 恢复 / 彻底删除，并提供清空回收站。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { taskRow } from "../components/taskRow.js";
import { groupCard, emptyState, screenShell } from "../components/common.js";
import { openSortSheet, openTaskActionsFor, openTrashActionsFor, openListEditSheet } from "../components/sheets.js";
import { openConfirm } from "../core/sheet.js";
import { toast } from "../core/toast.js";
import * as store from "../core/store.js";
import { VIEW_LABEL, DEFAULT_LIST_COLOR } from "../data/enums.js";

const EMPTY_COPY = {
  all: ["还没有任务", "点击下方 ＋ 创建第一项"],
  planned: ["没有计划任务", "给任务设置日期后会出现在这里"],
  overdue: ["没有逾期任务", "保持得很好"],
  "no-date": ["没有无日期任务", "所有任务都有时间安排"],
  important: ["没有重要任务", "高优先级任务会出现在这里"],
  completed: ["没有完成记录", "完成的任务会归档到这里"],
  deleted: ["回收站是空的", "删除的任务会在回收站保留 30 天"],
};

export function renderTaskList(params, _query, ctx, scopeKind) {
  const s = store.getState();
  const listsMap = new Map(s.lists.map((l) => [l.id, l]));

  let scope, title, tint, listEntity = null;
  if (scopeKind === "list") {
    listEntity = listsMap.get(params.listId);
    scope = { kind: "list", listId: params.listId };
    title = listEntity?.name ?? "清单";
    tint = listEntity?.color ?? DEFAULT_LIST_COLOR;
  } else if (scopeKind === "tag") {
    scope = { kind: "tag", tag: decodeURIComponent(params.tag) };
    title = `#${scope.tag}`;
    tint = "var(--teal)";
  } else {
    scope = { kind: "view", view: params.view };
    title = VIEW_LABEL[params.view] ?? "任务";
    tint = params.view === "overdue"
      ? "var(--red)"
      : params.view === "completed" ? "var(--text-3)" : "var(--accent)";
  }
  const isTrash = scopeKind === "view" && params.view === "deleted";

  const rows = store.queryTasks(scope);
  const prefs = s.prefs;

  const bar = appbar({
    back: true,
    onBack: () => ctx.nav.back(),
    title,
    sub: `${rows.length} 项`,
    actions: [
      {
        icon: "arrow-down-up", label: "排序",
        onClick: () => openSortSheet(prefs.sortBy, {
          asc: prefs.sortAsc,
          onPick: (id) => store.setSort(id),
          onToggleDir: () => store.toggleSortDir(),
        }),
      },
      listEntity && !listEntity.isDefault
        ? { icon: "pencil", label: "编辑清单", onClick: () => openListEditSheet(listEntity) }
        : null,
    ].filter(Boolean),
  });

  const body = [];

  /* 清单头部色卡 */
  if (listEntity) {
    body.push(h("div.pace-card", { style: { padding: "16px", marginBottom: "16px" } }, [
      h("div.row.gap-3", {}, [
        h("span", { style: { width: "40px", height: "40px", borderRadius: "13px", background: listEntity.color ?? DEFAULT_LIST_COLOR, flex: "none" } }),
        h("div.grow", {}, [
          h("strong.fs-md", { text: listEntity.name, style: { display: "block" } }),
          h("span.fs-xs.t-muted", { text: `${rows.length} 项任务` }),
        ]),
        h("button.btn.btn-ghost", {
          onclick: () => ctx.nav.push(`/new?listId=${listEntity.id}`),
        }, [icon("plus", "i-sm"), h("span", { text: "新建" })]),
      ]),
    ]));
  }

  if (!rows.length) {
    const [et, eb] = EMPTY_COPY[params.view] ?? ["这里是空的", "切换视图或新建任务"];
    body.push(emptyState({
      icon: isTrash ? "trash-2" : "list-todo", title: et, body: eb,
      action: h("button.btn.btn-primary", { style: { marginTop: "8px" }, onclick: () => ctx.nav.push(listEntity ? `/new?listId=${listEntity.id}` : "/new") }, [
        icon("plus", "i-sm"), h("span", { text: "新建任务" }),
      ]),
    }));
  } else if (isTrash) {
    body.push(h("button.btn.btn-danger.btn-block", {
      style: { marginBottom: "16px" },
      text: "清空回收站",
      onclick: async () => {
        const ok = await openConfirm({ title: "清空回收站？", body: "将永久删除回收站中的全部任务，无法恢复。", confirmText: "全部删除", danger: true });
        if (ok) { store.emptyTrash(); toast("回收站已清空"); }
      },
    }));
    body.push(groupCard("回收站", "var(--red)", rows.map((t) => taskRow(t, rowCtx(t, true))), { count: rows.length }));
  } else {
    body.push(groupCard(title, tint, rows.map((t) => taskRow(t, rowCtx(t, false))), { count: rows.length }));
  }

  function rowCtx(t, deleted) {
    return {
      lists: listsMap,
      deleted,
      onOpen: (task) => ctx.nav.push(`/task/${task.id}`),
      onToggle: (task) => store.toggleTask(task.id),
      onDelete: async (task) => {
        const ok = await openConfirm({ title: "删除任务？", body: "任务将移入回收站，可在回收站恢复。", confirmText: "删除", danger: true });
        if (ok) { store.softDeleteTask(task.id); toast("已移入回收站"); }
      },
      onRestore: (task) => { store.restoreTask(task.id); toast("已恢复"); },
      onPurge: async (task) => {
        const ok = await openConfirm({ title: "彻底删除？", body: "删除后无法恢复。", confirmText: "彻底删除", danger: true });
        if (ok) { store.purgeTask(task.id); toast("已彻底删除"); }
      },
      onMore: (task) => deleted ? openTrashActionsFor(task) : openTaskActionsFor(task, ctx.nav),
    };
  }

  return screenShell({ bar, body });
}
