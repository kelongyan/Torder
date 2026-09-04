/**
 * noteWidget.js — 桌面便签（独立 widget 窗 mock，镜像 WidgetApp 纸张体系）
 * 永远置顶的小便签，展示当天任务；纸张/墨水配色与主窗主题解耦。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { todayAgenda, toggleTask } from "../core/store.js";
import { formatLongDate } from "../core/format.js";

export function noteWidget() {
  const { timed, allday, completedToday } = todayAgenda();
  const rows = [...timed, ...allday];
  const listBox = h("div");

  function paint() {
    const a = todayAgenda();
    const all = [...a.timed, ...a.allday];
    listBox.replaceChildren(
      ...all.map((t) => {
        const time = t.dueAt ? new Date(t.dueAt).toTimeString().slice(0, 5) : null;
        return h("div.note-item" + (t.status === "done" ? ".done" : ""), {
          onclick: () => toggleTask(t.id),
        }, [
          h("span.note-check", { html: icon("check", "i-xs") }),
          h("span.note-text", {}, [
            time ? h("span.note-time", { text: time }) : null,
            document.createTextNode(t.title),
          ]),
        ]);
      }),
      ...a.completedToday.map((t) =>
        h("div.note-item.done", { onclick: () => toggleTask(t.id) }, [
          h("span.note-check", { html: icon("check", "i-xs") }),
          h("span.note-text", { text: t.title }),
        ])),
    );
  }
  paint();

  return h("div.widget-stage", {}, [
    h("div.note-window", {}, [
      h("div.note-bar", {}, [
        icon("sticky-note", "i-sm"),
        h("span", { text: "今日便签" }),
        h("span.sp"),
        h("button", { html: icon("chevrons-up", "i-xs"), title: "字体" }),
        h("button", { html: icon("pin", "i-xs"), title: "钉在边缘" }),
        h("button", { html: icon("x", "i-xs"), title: "隐藏" }),
      ]),
      h("div.note-body.scroll", {}, [
        h("div.note-date", { text: formatLongDate(new Date()) }),
        listBox,
        rows.length + completedToday.length === 0 ? h("div.note-item", { text: "今天没有安排，享受留白。" }) : null,
      ]),
      h("div.note-foot", {}, [
        h("span", { text: `${completedToday.length}/${rows.length + completedToday.length} 已完成` }),
        h("span.sp"),
        h("span", { text: "点击勾选 · 右键主窗任务可加入" }),
      ]),
    ]),
    h("div.stage-caption", { text: "独立窗口 mock：桌面便签（纸张主题、可拖拽缩放、置顶）" }),
  ]);
}
