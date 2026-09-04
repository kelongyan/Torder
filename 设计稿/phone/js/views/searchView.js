/**
 * searchView.js — 全库搜索页（桌面端命令面板的移动端形态）
 * 空态展示标签建议；输入即搜，匹配标题/描述/标签并高亮。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { taskRow } from "../components/taskRow.js";
import { screenShell, emptyState } from "../components/common.js";
import { openTaskActionsFor } from "../components/sheets.js";
import * as store from "../core/store.js";

export function renderSearch(_p, _q, ctx) {
  const s = store.getState();
  const listsMap = new Map(s.lists.map((l) => [l.id, l]));
  const tags = store.allTags();

  const input = h("input", {
    placeholder: "搜索任务、描述或 #标签",
    oninput: (e) => run(e.target.value),
  });
  const bar = h("header.appbar", {}, [
    h("button.icon-btn", { "aria-label": "返回", onclick: () => ctx.nav.back(), html: icon("arrow-left") }),
    h("div.search-bar.grow", { style: { marginBottom: "0" } }, [
      icon("search", "i-sm"),
      input,
      h("button.icon-btn", { "aria-label": "清空", html: icon("x", "i-sm"), onclick: () => { input.value = ""; run(""); } }),
    ]),
  ]);

  const resultHost = h("div");

  function suggestions() {
    resultHost.replaceChildren(
      h("div.group-title", { text: "按标签快速筛选" }),
      h("div.row.gap-2", { style: { flexWrap: "wrap" } },
        tags.map(({ tag }) =>
          h("button.chip", { onclick: () => { input.value = tag; run(tag); } }, [
            icon("hash", "i-sm"), h("span", { text: tag }),
          ])),
      ),
      h("div.group-title", { style: { marginTop: "20px" }, text: "小提示" }),
      h("div.group", {}, [
        h("div.menu-row", { html: `${icon("search","i-sm")}<span class="grow menu-label" style="margin-left:12px">支持标题、描述、标签的全文匹配</span>` }),
      ]),
    );
  }

  function run(q) {
    const query = q.trim();
    if (!query) return suggestions();
    const rows = store.queryTasks({ kind: "search", q: query });
    if (!rows.length) {
      resultHost.replaceChildren(emptyState({
        icon: "search", title: `没有找到与「${query}」相关的任务`,
        body: "换个关键词，或到浏览页按清单/标签查看",
      }));
      return;
    }
    resultHost.replaceChildren(
      h("div.group-title", { text: `${rows.length} 条结果` }),
      ...rows.map((t) => taskRow(t, {
        lists: listsMap, query,
        onOpen: (task) => ctx.nav.push(`/task/${task.id}`),
        onToggle: (task) => store.toggleTask(task.id),
        onDelete: (task) => store.softDeleteTask(task.id),
        onMore: (task) => openTaskActionsFor(task, ctx.nav),
      })),
    );
  }
  suggestions();

  const shell = screenShell({ bar, body: [resultHost], noTab: true });
  setTimeout(() => input.focus(), 300);
  return shell;
}
