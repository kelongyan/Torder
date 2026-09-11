/* 便签 UI v5 三方向渲染稿 · 演示交互（非产品代码）
   仅保留深浅桌面切换；三方向为静态展示，不做开关扩展 */

const body = document.body;
const btnDesktop = document.getElementById("btn-desktop");

let desktopDark = true;

btnDesktop.addEventListener("click", () => {
  desktopDark = !desktopDark;
  body.classList.toggle("desktop-light", !desktopDark);
  btnDesktop.textContent = desktopDark ? "切浅色桌面" : "切深色桌面";
});
