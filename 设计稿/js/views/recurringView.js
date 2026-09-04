/**
 * recurringView.js — 循环规则列表
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { screenShell, emptyState } from "../components/common.js";
import { toast } from "../core/toast.js";
import * as store from "../core/store.js";
import { FREQ_LABELS } from "../data/enums.js";
import { formatSchedule } from "../core/format.js";

export function renderRecurring(_p, _q, ctx) {
  const rules = store.getState().recurringRules;
  const listsMap = new Map(store.getState().lists.map((l) => [l.id, l]));

  const bar = appbar({
    back: true, onBack: () => ctx.nav.back(),
    title: "循环任务",
    actions: [{ icon: "plus", label: "新建规则", onClick: () => toast("设计稿演示：真机在此打开规则编辑器") }],
  });

  const cards = rules.map((rule) => {
    const list = listsMap.get(rule.listId);
    const sw = h("button.switch" + (rule.enabled ? ".on" : ""), {
      "aria-label": "启用规则",
      onclick: () => {
        rule.enabled = !rule.enabled;
        sw.classList.toggle("on", rule.enabled);
        toast(rule.enabled ? "规则已启用" : "规则已暂停");
      },
    });
    return h("div.rule-card", {}, [
      h("div.rule-top", {}, [
        h("span.color-dot", { style: { background: list?.color ?? "var(--accent)", width: "12px", height: "12px" } }),
        h("h3.ellipsis.grow", { text: rule.title }),
        sw,
      ]),
      h("div.rule-meta", {}, [
        h("span", { html: `${icon("repeat-2","i")}${freqText(rule)}` }),
        rule.nextDueAt
          ? h("span", { html: `${icon("calendar-clock","i")}下次 ${formatSchedule(rule.nextDueAt.slice(0,10)) ?? rule.nextDueAt.slice(5,10)}` })
          : null,
        h("span", { html: `${icon("bell","i")}${rule.remindBefore ? "提前提醒" : "不提醒"}` }),
      ]),
    ]);
  });

  const body = rules.length
    ? [h("p.fs-xs.t-muted", { style: { padding: "4px 4px 12px", lineHeight: 1.6 }, text: "循环规则会按频率自动生成任务实例，实例与普通任务一样可以完成或顺延。" }), ...cards]
    : [emptyState({ icon: "repeat-2", title: "还没有循环规则", body: "把每天/每周重复的事项沉淀成规则，自动生成" })];

  return screenShell({ bar, body, noTab: true });
}

function freqText(rule) {
  const base = FREQ_LABELS[rule.frequency];
  if (rule.intervalCount > 1) return base.replace("每", `每 ${rule.intervalCount} `);
  return base;
}
