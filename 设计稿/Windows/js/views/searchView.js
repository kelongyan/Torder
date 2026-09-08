/**
 * searchView.js — 全库搜索结果页（镜像 SearchResultView）
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { queryTasks, allTags, getState, setSearchQuery } from "../core/store.js";
import { taskRow } from "../components/taskRow.js";
import { emptyState } from "../components/common.js";

export function searchView(route, ctx, initialQuery) {
  const q = initialQuery ?? getState().ui.searchQuery;
  const input = h("input", { type: "text", value: q, placeholder: "搜索标题、备注、#标签…" });
  const resultBox = h("div.flex1");

  function paint(query) {
    const rows = queryTasks({ kind: "search", q: query }, { showCompleted: true });
    resultBox.replaceChildren();
    if (!query.trim()) {
      const tags = allTags();
      resultBox.append(
        h("div.search-section-title", { text: "常用标签" }),
        h("div.row.gap-2", { style: { flexWrap: "wrap" } }, tags.map((t) =>
          h("button.chip", { text: `#${t.tag} · ${t.count}`, onclick: () => { input.value = t.tag; paint(t.tag); } }))),
      );
      return;
    }
    if (!rows.length) {
      resultBox.append(emptyState({ icon: "search-x", title: `没有找到与“${query}”相关的任务`, desc: "试试更短的关键词，或从标签筛选。" }));
      return;
    }
    resultBox.append(
      h("div.search-section-title", { text: `共找到 ${rows.length} 项` }),
      h("div.group-card", {}, rows.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) }))),
    );
  }

  input.addEventListener("input", () => { setSearchQuery(input.value); paint(input.value); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") input.blur(); });

  const wrap = h("div.search-wrap", { style: { maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column" } }, [
    h("div.search-hero", {}, [
      h("div.big-input", {}, [icon("search", "i-md"), input, h("kbd.kbd", { text: "Esc" })]),
    ]),
    h("div.flex1.scroll", {}, [resultBox]),
  ]);
  requestAnimationFrame(() => paint(q));
  return wrap;
}
