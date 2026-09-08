/* 便签 UI v5 渲染稿 · 演示交互（非产品代码）
   深浅桌面切换 + 纸纹/磁扣开关（对应真实 Phase 4 开关体系的扩展位） */

const body = document.body;
const btnDesktop = document.getElementById("btn-desktop");
const btnTexture = document.getElementById("btn-texture");
const btnMagnet = document.getElementById("btn-magnet");

let desktopDark = true;
let textureOn = true;
let magnetOn = true;

function syncFrameClasses() {
  document.querySelectorAll(".note-frame").forEach((frame) => {
    if (frame.classList.contains("legacy-frame")) return;
    frame.classList.toggle("texture-off", !textureOn);
    frame.classList.toggle("magnet-off", !magnetOn);
  });
}

btnDesktop.addEventListener("click", () => {
  desktopDark = !desktopDark;
  body.classList.toggle("desktop-light", !desktopDark);
  btnDesktop.classList.toggle("is-on", desktopDark);
  btnDesktop.textContent = desktopDark ? "深色桌面" : "浅色桌面";
});

btnTexture.addEventListener("click", () => {
  textureOn = !textureOn;
  btnTexture.classList.toggle("is-on", textureOn);
  syncFrameClasses();
});

btnMagnet.addEventListener("click", () => {
  magnetOn = !magnetOn;
  btnMagnet.classList.toggle("is-on", magnetOn);
  syncFrameClasses();
});
