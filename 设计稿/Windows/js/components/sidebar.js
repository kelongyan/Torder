/**
 * sidebar.js — 左侧导航栏
 * 搜索（Enter 全库）/ 导航（8 系统视图 + 循环任务）/ 保存视图 / 我的清单 / 标签 / 同步底栏
 * 折叠态（64px）由 .app-window.sidebar-collapsed 控制，仅显图标。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { SYSTEM_VIEWS } from "../data/enums.js";
import {
  buildCounts, allTags, getState, setScope, toggleSidebar,
} from "../core/store.js";
import { go } from "../core/router.js";
import { toast } from "../core/toast.js";

function navItem({ icon: ic, label, count, active, alert = false, colorDot, onClick }) {
  return h("button.nav-item" + (active ? ".active" : "") + (alert ? ".alert" : ""), { onclick: onClick }, [
    colorDot
      ? h("span.nav-icon", {}, [h("span.nav-dot", { style: { background: colorDot } })])
      : h("span.nav-icon", { html: icon(ic, "i-sm") }),
    h("span.nav-label", { text: label }),
    count != null ? h("span.nav-count", { text: String(count) }) : null,
  ]);
}

function scopeActive(kind, value) {
  const s = getState().ui.scope;
  return s.kind === kind && s[kind === "view" ? "view" : kind === "list" ? "listId" : "tag"] === value;
}

export function renderSidebar(ctx) {
  const s = getState();
  const counts = buildCounts();
  const tags = allTags();

  const search = h("input", {
    type: "text",
    placeholder: "搜索 (Enter 全库)",
    value: s.ui.searchQuery,
    onkeydown: (e) => {
      if (e.key === "Enter") {
        go("/search");
        ctx?.onSearch?.(search.value.trim());
      }
    },
  });

  const viewItems = SYSTEM_VIEWS.map((v) =>
    navItem({
      icon: v.icon,
      label: v.label,
      count: v.id === "deleted" ? undefined : counts.views[v.id],
      alert: v.id === "overdue" && counts.views.overdue > 0,
      active: scopeActive("view", v.id),
      onClick: () => { setScope({ kind: "view", view: v.id }); go(`/view/${v.id}`); },
    }),
  );
  viewItems.push(navItem({
    icon: "repeat-2", label: "循环任务", count: s.recurringRules.length,
    active: s.ui.scope.kind === "recurring",
    onClick: () => { setScope({ kind: "recurring" }); go("/recurring"); },
  }));

  const savedItems = s.savedViews.map((sv) => navItem({
    icon: sv.icon ?? "filter", label: sv.name,
    active: false,
    onClick: () => toast(`保存视图「${sv.name}」`),
  }));

  const listItems = s.lists.map((l) => navItem({
    colorDot: l.color ?? "var(--accent)",
    label: l.name,
    count: counts.lists[l.id] ?? 0,
    active: scopeActive("list", l.id),
    onClick: () => { setScope({ kind: "list", listId: l.id }); go(`/list/${l.id}`); },
  }));

  const tagItems = tags.map((t) => navItem({
    icon: "hash", label: t.tag, count: t.count,
    active: scopeActive("tag", t.tag),
    onClick: () => { setScope({ kind: "tag", tag: t.tag }); go(`/tag/${encodeURIComponent(t.tag)}`); },
  }));

  function groupHead(label, addIcon, onAdd) {
    return h("div.nav-group-head", {}, [
      h("span", { text: label }),
      onAdd ? h("button.nav-add", { html: icon(addIcon, "i-xs"), onclick: onAdd }) : null,
    ]);
  }

  return h("aside.sidebar", {}, [
    h("div.sidebar-scroll.scroll", {}, [
      h("div.sidebar-search", {}, [
        icon("search", "i-sm"),
        search,
        h("kbd.kbd", { text: "Ctrl F" }),
      ]),
      h("nav", {}, [
        groupHead("导航"),
        ...viewItems,
        h("div.sidebar-divider"),
        groupHead("保存视图", "plus", () => toast("保存当前筛选为视图")),
        ...savedItems,
        h("div.sidebar-divider"),
        groupHead("我的清单", "plus", () => ctx?.onAddList?.()),
        ...listItems,
        tags.length ? h("div.sidebar-divider") : null,
        tags.length ? groupHead("标签", "sliders-horizontal", () => toast("标签管理")) : null,
        ...tagItems,
      ]),
    ]),
    h("div.sidebar-foot", {}, [
      h("span.sync-dot"),
      h("span.flex1.ellipsis", { text: "WebDAV · 刚刚同步" }),
      h("button.icon-btn", {
        html: icon("panel-left-close", "i-sm"),
        title: "折叠侧栏 (Ctrl B)",
        onclick: () => toggleSidebar(),
      }),
    ]),
  ]);
}
