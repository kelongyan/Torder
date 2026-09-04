/**
 * router.js — 极简 hash 路由（桌面端无页面栈转场，只解析当前 scope）
 * hash 形态：
 *   #/today | #/view/:view | #/list/:id | #/tag/:tag | #/search | #/recurring
 *   #/mini | #/widget  —— 独立窗（迷你速记 / 桌面便签），不渲染主外壳
 * 独立窗之外的路由都属于主窗口，由 app 装配外壳，内容按 scope 渲染。
 */
const handlers = new Set();
let current = parse();

function parse() {
  const raw = (location.hash || "#/today").slice(1);
  const [path] = raw.split("?");
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "mini") return { mode: "mini", scope: null };
  if (seg[0] === "widget") return { mode: "widget", scope: null };
  if (seg[0] === "view") return { mode: "main", scope: { kind: "view", view: seg[1] ?? "today" } };
  if (seg[0] === "list") return { mode: "main", scope: { kind: "list", listId: seg[1] ?? "" } };
  if (seg[0] === "tag") return { mode: "main", scope: { kind: "tag", tag: decodeURIComponent(seg[1] ?? "") } };
  if (seg[0] === "search") return { mode: "main", scope: { kind: "search", q: "" } };
  if (seg[0] === "recurring") return { mode: "main", scope: { kind: "recurring" } };
  const view = seg[0] ?? "today";
  return { mode: "main", scope: { kind: "view", view } };
}

function emit() {
  current = parse();
  handlers.forEach((fn) => fn(current));
}

export function startRouter(onChange) {
  handlers.add(onChange);
  window.addEventListener("hashchange", emit);
  current = parse();
  onChange(current);
}

export function go(path) {
  if (location.hash === `#${path}`) emit();
  else location.hash = path;
}
export function currentRoute() {
  return current;
}
