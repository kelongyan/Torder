/**
 * router.js — 移动端页面栈路由（无框架）
 *
 * - push(path)   进入下一级：新页从右侧滑入，旧页向左下沉
 * - back()       返回：上一页从左侧回位，当前页向右滑出
 * - tab(path)    切换底部主 Tab：整栈替换，交叉淡入（无方向滑动）
 * - replace(path)替换当前页（如新建后进入详情）
 *
 * 同时与浏览器 History 同步，桌面预览时可用浏览器后退键模拟安卓返回手势。
 */

const TRANSITION_MS = 290;

export function createRouter(routeTable, rootEl, { onNavigate } = {}) {
  /** @type {{path:string, el:HTMLElement, route:object, params:object}[]} */
  let stack = [];
  let busy = false;

  function match(path) {
    const [pure] = path.split("?");
    for (const route of routeTable) {
      const params = matchPattern(route.pattern, pure);
      if (params) return { route, params };
    }
    return null;
  }

  function buildEntry(path) {
    const hit = match(path);
    if (!hit) {
      console.warn(`[router] 未注册路由：${path}，回退 /today`);
      return buildEntry("/today");
    }
    const { route, params } = hit;
    const query = parseQuery(path);
    const el = route.render(params, query);
    el.classList.add("screen");
    el.dataset.path = path;
    return { path, el, route, params };
  }

  function finishSwap(prevEl) {
    prevEl?.remove();
    busy = false;
  }

  function enter(entry, mode) {
    const prev = stack[stack.length - 1];
    const prevEl = prev?.el;
    stack.push(entry);
    rootEl.append(entry.el);
    onNavigate?.(entry.route, entry.params, stack.length);

    if (!prevEl || mode === "tab") {
      // Tab 切换 / 首屏：交叉淡入
      entry.el.style.opacity = "0";
      requestAnimationFrame(() => {
        entry.el.style.transition = `opacity ${TRANSITION_MS}ms var(--ease-emphasized)`;
        entry.el.style.opacity = "1";
        if (prevEl && mode === "tab") prevEl.remove();
      });
      busy = false;
      return;
    }

    if (mode === "back") {
      entry.el.classList.add("screen--enter-back");
      requestAnimationFrame(() => {
        entry.el.classList.remove("screen--enter-back");
        entry.el.classList.add("is-active");
        prevEl.classList.add("screen--leave-back");
      });
    } else {
      entry.el.classList.add("screen--enter-fwd");
      requestAnimationFrame(() => {
        entry.el.classList.remove("screen--enter-fwd");
        entry.el.classList.add("is-active");
        prevEl.classList.add("is-under");
      });
    }
    setTimeout(() => finishSwap(prevEl), TRANSITION_MS + 20);
  }

  function push(path) {
    if (busy) return;
    busy = true;
    window.history.pushState({ stackDepth: stack.length + 1 }, "", `#${path}`);
    enter(buildEntry(path), "push");
  }

  function replace(path) {
    const entry = buildEntry(path);
    const top = stack.pop();
    stack.push(entry);
    rootEl.append(entry.el);
    entry.el.classList.add("is-active");
    top?.el.remove();
    window.history.replaceState({ stackDepth: stack.length }, "", `#${path}`);
    onNavigate?.(entry.route, entry.params, stack.length);
  }

  function back() {
    if (stack.length <= 1) {
      // 已在根 Tab：预览环境里回退到今日页
      if (currentPath() !== "/today") tab("/today");
      return;
    }
    if (busy) return;
    busy = true;
    stack.pop(); // 弹出当前
    const prevPath = stack[stack.length - 1].path;
    const entry = buildEntry(prevPath);
    window.history.replaceState({ stackDepth: stack.length }, "", `#${prevPath}`);
    enter(entry, "back");
  }

  function tab(path) {
    if (stack.length === 1 && currentPath() === path) return;
    // 整栈替换
    const oldEls = stack.map((s) => s.el);
    stack = [];
    window.history.pushState({ tab: true }, "", `#${path}`);
    enter(buildEntry(path), "tab");
    setTimeout(() => oldEls.forEach((el) => el.remove()), TRANSITION_MS);
  }

  /** 数据变更后静默重建当前屏（保留滚动位置，不做转场） */
  function rerenderCurrent() {
    const top = stack[stack.length - 1];
    if (!top) return;
    const scrollEl = top.el.querySelector(".screen-body");
    const scroll = scrollEl?.scrollTop ?? 0;
    const fresh = buildEntry(top.path);
    fresh.el.classList.add("is-active");
    top.el.replaceWith(fresh.el);
    stack[stack.length - 1] = fresh;
    const body = fresh.el.querySelector(".screen-body");
    if (body) body.scrollTop = scroll;
  }

  function currentPath() {
    return stack[stack.length - 1]?.path ?? null;
  }
  function currentRoute() {
    return stack[stack.length - 1]?.route ?? null;
  }
  function currentParams() {
    return stack[stack.length - 1]?.params ?? {};
  }
  function depth() {
    return stack.length;
  }

  // 浏览器/系统后退
  window.addEventListener("popstate", () => back());

  function start(initial) {
    const hash = window.location.hash.replace(/^#/, "") || initial;
    stack = [];
    enter(buildEntry(hash), "tab");
  }

  return { push, back, replace, tab, rerenderCurrent, currentPath, currentRoute, currentParams, depth, start };
}

/* ---------------- 路由模式匹配 ---------------- */
function matchPattern(pattern, path) {
  const pSeg = pattern.split("/").filter(Boolean);
  const xSeg = path.split("/").filter(Boolean);
  if (pSeg.length !== xSeg.length) return null;
  const params = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(":")) params[pSeg[i].slice(1)] = decodeURIComponent(xSeg[i]);
    else if (pSeg[i] !== xSeg[i]) return null;
  }
  return params;
}
function parseQuery(path) {
  const q = path.split("?")[1];
  if (!q) return {};
  return Object.fromEntries(new URLSearchParams(q));
}
