/**
 * sheet.js — 底部弹层（Bottom Sheet）与居中对话框
 * 移动端用 sheet 替代桌面端的 hover 浮层菜单；统一从这里创建/回收。
 */
import { h, frag } from "./dom.js";
import { icon } from "./icons.js";

const SHEET_MS = 330;

/**
 * 打开底部弹层
 * @param {{title?:string, body:HTMLElement|string, host?:HTMLElement}} opts
 * @returns {{close:()=>void, body:HTMLElement}}
 */
export function openSheet({ title, body, host = document.querySelector(".phone") }) {
  const scrim = h("div.sheet-scrim");
  const sheet = h("div.sheet", { role: "dialog", "aria-modal": "true" }, [
    h("div.sheet-handle"),
    title ? h("div.sheet-title", { text: title }) : null,
    h("div.sheet-body", {}, [body]),
  ]);
  const bodyWrap = sheet.querySelector(".sheet-body");
  host.append(scrim, sheet);

  requestAnimationFrame(() => {
    scrim.classList.add("open");
    sheet.classList.add("open");
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scrim.classList.remove("open");
    sheet.classList.remove("open");
    setTimeout(() => {
      scrim.remove();
      sheet.remove();
    }, SHEET_MS);
  }
  scrim.addEventListener("click", close);
  // 下拉关闭：在 handle 上按下并下滑超过 40px
  let startY = null;
  sheet.querySelector(".sheet-handle").addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });
  sheet.querySelector(".sheet-handle").addEventListener("touchmove", (e) => {
    if (startY == null) return;
    if (e.touches[0].clientY - startY > 40) { close(); startY = null; }
  }, { passive: true });

  return { close, body: bodyWrap };
}

/**
 * 操作菜单（Action Sheet）
 * @param {{title?:string, items:Array<{label:string, icon?:string, danger?:boolean, onSelect:Function}>, host?:HTMLElement}}
 */
export function openActionSheet({ title, items, host }) {
  const body = h("div", {}, items.map((item) =>
    h("button.sheet-action" + (item.danger ? ".danger" : ""), {
      onclick: () => {
        ctrl.close();
        item.onSelect?.();
      },
    }, [
      item.icon ? icon(item.icon, "i-sm") : null,
      h("span", { text: item.label }),
    ]),
  ));
  const ctrl = openSheet({ title, body, host });
  return ctrl;
}

/** 居中确认对话框，返回 Promise<boolean> */
export function openConfirm({
  title, body, confirmText = "确定", cancelText = "取消", danger = false, host,
}) {
  return new Promise((resolve) => {
    const hostEl = host ?? document.querySelector(".phone");
    const scrim = h("div.modal-scrim");
    const modal = h("div.modal", {}, [
      h("h3", { style: { fontSize: "var(--fs-md)", marginBottom: "8px" }, text: title }),
      body ? h("p.t-secondary.fs-sm", { style: { lineHeight: 1.6, marginBottom: "20px" }, text: body }) : h("div", { style: { marginBottom: "20px" } }),
      h("div.row.gap-3", {}, [
        h("button.btn.btn-ghost.grow", { text: cancelText, onclick: () => done(false) }),
        h("button.btn.grow" + (danger ? ".btn-danger" : ".btn-primary"), { text: confirmText, onclick: () => done(true) }),
      ]),
    ]);
    scrim.append(modal);
    hostEl.append(scrim);
    requestAnimationFrame(() => scrim.classList.add("open"));
    function done(val) {
      scrim.classList.remove("open");
      setTimeout(() => scrim.remove(), 200);
      resolve(val);
    }
    scrim.addEventListener("click", (e) => { if (e.target === scrim) done(false); });
  });
}
