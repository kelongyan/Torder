/**
 * focusDialog.js — 专注模式（镜像 FocusDialog）
 * SVG 进度环 + 真实倒计时；预设 15/25/45/60；开始/暂停/重置。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openDialog } from "../core/modal.js";
import { FOCUS_PRESETS } from "../data/enums.js";

const R = 120;
const C = 2 * Math.PI * R;

export function openFocusDialog() {
  let minutes = 25;
  let remain = minutes * 60;
  let running = false;
  let timer = null;

  const timeEl = h("div.focus-time", { text: "25:00" });
  const stateEl = h("div.focus-state", { text: "准备开始" });
  const fg = h("circle.focus-progress", {
    cx: 132, cy: 132, r: R, fill: "none", "stroke-width": 8,
    "stroke-dasharray": C, "stroke-dashoffset": 0,
  });
  const ring = h("div.focus-ring", {}, [
    h("svg", { viewBox: "0 0 264 264" }, [
      h("circle.focus-track", { cx: 132, cy: 132, r: R, fill: "none", "stroke-width": 8 }),
      fg,
    ]),
    timeEl,
  ]);

  const presetRow = h("div.focus-presets", {}, FOCUS_PRESETS.map((m) =>
    h("button.chip" + (m === minutes ? ".chip-accent" : ""), {
      text: `${m} 分钟`,
      onclick: () => { minutes = m; reset(); paintPresets(); },
    })));
  function paintPresets() {
    presetRow.replaceChildren(...FOCUS_PRESETS.map((m) =>
      h("button.chip" + (m === minutes ? ".chip-accent" : ""), {
        text: `${m} 分钟`,
        onclick: () => { minutes = m; reset(); paintPresets(); },
      })));
  }

  const mainBtn = h("button.btn.btn-primary.btn-lg", { style: { minWidth: 110 } }, [icon("play", "i-sm"), document.createTextNode("开始")]);
  const resetBtn = h("button.btn.btn-lg", { html: icon("rotate-ccw", "i-sm") });

  function fmt(sec) {
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  }
  function paint() {
    timeEl.textContent = fmt(remain);
    const total = minutes * 60;
    fg.setAttribute("stroke-dashoffset", C * (1 - remain / total));
    mainBtn.replaceChildren(icon(running ? "pause" : "play", "i-sm"), document.createTextNode(running ? "暂停" : remain < total ? "继续" : "开始"));
    stateEl.textContent = running ? "专注中，保持心流" : remain < total ? "已暂停" : "准备开始";
  }
  function tick() {
    remain -= 1;
    if (remain <= 0) { remain = 0; pause(); stateEl.textContent = "本轮专注完成"; }
    paint();
  }
  function start() { running = true; timer = setInterval(tick, 1000); paint(); }
  function pause() { running = false; clearInterval(timer); paint(); }
  function reset() { pause(); remain = minutes * 60; paint(); }

  mainBtn.addEventListener("click", () => (running ? pause() : start()));
  resetBtn.addEventListener("click", reset);

  const body = h("div.focus-body", {}, [
    ring, stateEl,
    h("div.focus-phase-row", {}, [
      h("span.focus-phase.active", { text: "专注" }),
      h("span.focus-phase", { text: "短休息" }),
      h("span.focus-phase", { text: "长休息" }),
    ]),
    presetRow,
    h("div.focus-actions", {}, [resetBtn, mainBtn]),
  ]);

  const ctrl = openDialog({ title: "专注模式", icon: "flame", body, width: 460 });
  paint();
  return ctrl;
}
