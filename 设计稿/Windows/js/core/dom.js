/**
 * dom.js — 极简 DOM 构造辅助（无框架）
 * 视图模块统一通过 h()/el() 产出节点，事件用委托，保证可维护、可复现。
 */

/** HTML 转义，防止 mock/用户输入破坏结构 */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 创建元素。
 * @param {string} tag      标签名，支持 'div.cls#id' 简写
 * @param {object} [props]  属性：class/style/attrs/on{Event}/dataset，或文本节点用 {text}
 * @param {(string|Node)[]} [children]
 */
export function h(tag, props = {}, children = []) {
  let node;
  // 支持 'div.a.b#x' 链，以及空格分隔的额外类名：'span.foo bar baz'
  const [chain, ...extraClasses] = String(tag).split(/\s+/);
  const tagMatch = chain.match(/^([a-z0-9]+)([.#][\w-]+)*$/i);
  if (!tagMatch) throw new Error(`非法标签描述：${tag}`);
  const SVG_TAGS = new Set(["svg", "circle", "path", "rect", "line", "g", "polyline", "polygon", "ellipse"]);
  node = SVG_TAGS.has(tagMatch[1])
    ? document.createElementNS("http://www.w3.org/2000/svg", tagMatch[1])
    : document.createElement(tagMatch[1]);
  let rest = chain.slice(tagMatch[1].length);
  while (rest) {
    const m = rest.match(/^([.#])([\w-]+)/);
    if (!m) break;
    if (m[1] === ".") node.classList.add(m[2]);
    else node.id = m[2];
    rest = rest.slice(m[0].length);
  }
  for (const cls of extraClasses) if (cls) node.classList.add(cls);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class" || key === "className") node.className += ` ${value}`;
    else if (key === "style" && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (v == null) continue;
        // 数值型尺寸属性自动补 px（flex/opacity/zIndex 等无单位属性保持原值）
        node.style[k] = (typeof v === "number" &&
          /^(width|height|top|left|right|bottom|inset|gap|fontSize|minWidth|maxWidth|minHeight|maxHeight|borderRadius|.*[Mm]argin.*|.*[Pp]adding.*)$/.test(k))
          ? `${v}px` : v;
      }
    }
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== "list" && key !== "form") {
      try { node[key] = value; } catch { node.setAttribute(key, value); }
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false || child === "") continue;
    if (child instanceof Node) {
      node.append(child);
    } else if (typeof child === "string" && child.trimStart().startsWith("<")) {
      // 受信的 HTML 字符串（如图标 SVG，全部来自 icon() 常量）；用户文本必须走 esc()/text
      const tpl = document.createElement("template");
      tpl.innerHTML = child.trim();
      node.append(tpl.content.cloneNode(true));
    } else {
      node.append(document.createTextNode(String(child)));
    }
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 把 HTML 字符串解析为单个节点 */
export function frag(htmlStr) {
  const tpl = document.createElement("template");
  tpl.innerHTML = htmlStr.trim();
  return tpl.content.firstElementChild;
}

/** 清空容器并填充 */
export function mount(root, ...nodes) {
  root.replaceChildren(...nodes.flat().filter(Boolean));
  return root;
}

/** 事件委托：在 root 上监听，命中 [data-action] 子节点时回调 */
export function delegate(root, eventName, handler) {
  root.addEventListener(eventName, (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger || !root.contains(trigger)) return;
    handler(trigger.dataset.action, trigger, event);
  });
}
