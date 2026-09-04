/**
 * focusView.js — 专注模式（可运行的番茄倒计时，演示移动端保留的能力）
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { screenShell } from "../components/common.js";
import { toast } from "../core/toast.js";

const PRESETS = [15, 25, 45];
const R = 116;
const CIRC = 2 * Math.PI * R;

export function renderFocus(_p, _q, ctx) {
  let minutes = 25;
  let remain = minutes * 60;
  let running = false;
  let timer = null;

  const bar = appbar({
    back: true, onBack: () => { stop(); ctx.nav.back(); },
    title: "专注",
  });

  const timeLabel = h("strong", { text: "25:00" });
  const stateLabel = h("span", { text: "准备开始" });
  const progCircle = h("circle.ring-prog", {
    cx: 130, cy: 130, r: R,
    style: { strokeDasharray: String(CIRC), strokeDashoffset: "0" },
  });
  const ring = h("svg.focus-ring", { viewBox: "0 0 260 260" }, [
    h("circle.ring-track", { cx: 130, cy: 130, r: R }),
    progCircle,
  ]);
  const ringWrap = h("div.focus-ring-wrap", {}, [
    ring,
    h("div.focus-time", {}, [timeLabel, stateLabel]),
  ]);

  const presetRow = h("div.focus-presets", {}, PRESETS.map((m) =>
    h("button.chip" + (m === minutes ? ".active" : ""), {
      onclick: () => {
        if (running) return;
        minutes = m; remain = m * 60;
        [...presetRow.children].forEach((c, i) => c.classList.toggle("active", PRESETS[i] === m));
        paint();
      },
    }, [h("span", { text: `${m} 分钟` })]),
  ));

  const playBtn = h("button.focus-play", { "aria-label": "开始", html: icon("play") });
  const resetBtn = h("button.focus-side", { "aria-label": "重置", html: icon("rotate-ccw", "i-lg"), onclick: reset });
  const skipBtn = h("button.focus-side", { "aria-label": "跳过", html: icon("skip-forward", "i-lg"), onclick: reset });
  const controls = h("div.focus-controls", {}, [resetBtn, playBtn, skipBtn]);

  playBtn.addEventListener("click", () => (running ? pause() : start()));

  function paint() {
    const mm = String(Math.floor(remain / 60)).padStart(2, "0");
    const ss = String(remain % 60).padStart(2, "0");
    timeLabel.textContent = `${mm}:${ss}`;
    const pct = remain / (minutes * 60);
    progCircle.style.strokeDashoffset = String(CIRC * (1 - pct));
  }
  function start() {
    running = true;
    stateLabel.textContent = "专注中，保持心流";
    playBtn.innerHTML = icon("pause");
    timer = setInterval(() => {
      remain -= 1;
      paint();
      if (remain <= 0) finish();
    }, 1000);
  }
  function pause() {
    running = false;
    stateLabel.textContent = "已暂停";
    playBtn.innerHTML = icon("play");
    stop();
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function reset() {
    stop(); running = false; remain = minutes * 60;
    stateLabel.textContent = "准备开始";
    playBtn.innerHTML = icon("play");
    paint();
  }
  function finish() {
    stop(); running = false; remain = minutes * 60;
    playBtn.innerHTML = icon("play");
    stateLabel.textContent = "本段完成，休息一下";
    navigator.vibrate?.([60, 40, 60]);
    toast("专注完成，休息 5 分钟吧");
    paint();
  }

  return screenShell({
    bar, noTab: true,
    body: [h("div.col.center", { style: { flex: "1", textAlign: "center" } }, [
      h("p.t-muted.fs-sm", { style: { padding: "8px 32px", lineHeight: 1.6 }, text: "专注期间将抑制任务提醒，结束后补发（对应设置：专注时段免打扰）。" }),
      ringWrap, presetRow, controls,
    ])],
  });
}
