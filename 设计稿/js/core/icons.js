/**
 * icons.js — 内联 SVG 图标渲染
 * 路径数据来自 icons.generated.js（由 tools/extract-icons.mjs 从
 * lucide-react 提取，ISC）。全部 stroke 风格，尺寸/颜色由 CSS currentColor 控制。
 */
import { ICON_PATHS } from "./icons.generated.js";

/**
 * @param {string} name 图标 kebab-case 名
 * @param {string} cls  附加 class（如 'i-sm'）
 * @returns {string} svg HTML 字符串
 */
export function icon(name, cls = "") {
  const node = ICON_PATHS[name];
  if (!node) {
    console.warn(`[icon] 未找到图标：${name}`);
    return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"></svg>`;
  }
  const inner = node
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${attrStr}/>`;
    })
    .join("");
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function hasIcon(name) {
  return Boolean(ICON_PATHS[name]);
}
