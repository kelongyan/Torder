import {
  useLayoutEffect,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  LogicalPosition,
  LogicalSize,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { WidgetPinTop } from "../components/widget/WidgetPin";
import { WidgetQuickAdd } from "../components/widget/WidgetQuickAdd";
import { WidgetResizeHandles } from "../components/widget/WidgetResizeHandles";
import { WidgetTaskItem } from "../components/widget/WidgetTaskItem";
import { WidgetTitleBar } from "../components/widget/WidgetTitleBar";
import { listLists } from "../services/listService";
import { loadAppSettings } from "../services/settingsService";
import {
  createTask,
  queryTasksForDate,
  setTaskCompleted,
} from "../services/taskService";
import {
  localDateKey,
  shiftDateKey,
  taskPlanDateKey,
} from "../services/taskQuery";
import {
  getWidgetSettings,
  notifyTasksChanged,
  openTaskInMainWindow,
  patchWidgetSettings,
  type TasksChangedPayload,
  type WidgetSettings,
} from "../services/widgetService";
import {
  applyWidgetAppearance,
  ensureCustomNoteFont,
  listenAppTheme,
  listenWidgetSettings,
  type WidgetAppearance,
} from "../services/widgetAppearance";
import type { CreateTaskInput, Task, TaskList } from "../types/database";
import { applyThemePreference } from "../utils/theme";
import {
  clampWidgetHeight,
  clampWidgetWidth,
  type WidgetSizeMode,
} from "../services/widgetLayout";
import {
  easeOutCubic,
  leaveClassName,
  navDirectionFromDelta,
  type NavDirection,
} from "../utils/widgetMotion";

/** 关闭淡出动效时长（与 widget.css `.widget-stage.is-closing` 保持一致） */
const CLOSE_ANIMATION_MS = 360;
/** 位置 / 尺寸落盘的防抖时长 */
const GEOMETRY_FLUSH_MS = 300;
/** 日期切换：旧内容滑出时长（与 widget.css `.is-leaving-*` transition 一致） */
const NAV_LEAVE_MS = 130;
/** auto 模式窗口高度动画时长（W2-1，rAF 分帧插值） */
const WINDOW_SIZE_ANIM_MS = 180;

/** 窗口高度动画（W2-1）的插值状态；跨 effect 运行共享于 heightAnimRef */
type HeightAnimState = {
  raf: number | null;
  writeInFlight: boolean;
  startedAt: number;
  lastHeight: number;
  targetHeight: number;
  start: { x: number; bottomY: number; height: number; width: number };
};
/** 拖拽 / 动画中 prefers-reduced-motion 短路用 */
const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WidgetApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  const [defaultListId, setDefaultListId] = useState("work");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  /** 隐藏已完成条目（noteHideDone）；外观广播同步，唯一的行为型外观字段 */
  const [hideDone, setHideDone] = useState(false);
  /** 最新外观快照：应用主题广播（跟随应用）重解析纸色时读取 */
  const appearanceRef = useRef<WidgetAppearance | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 待落盘的窗口几何，存**物理**像素（事件 payload 的原始单位）。
   * 逻辑值在 flush 时用当次读到的 scaleFactor 换算 —— 便签可能被拖到另一块
   * 缩放比不同的显示器上，挂载时抓一次的 scale 会过期。
   */
  const pendingGeometry = useRef<{
    position: { x: number; y: number } | null;
    size: { width: number; height: number } | null;
  }>({ position: null, size: null });
  /**
   * 设置写入串行化。字段合并本身已由 Rust `patch_widget_settings` 单点完成，
   * 跨窗口不再互相吞字段；但拖上边缘会同时触发 onMoved + onResized，
   * 写请求仍需排队保证顺序（例如锚点写不能插进几何落盘中间）。
   */
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listInnerRef = useRef<HTMLDivElement | null>(null);
  /** 实测的内容自然高度（px）；0 = 尚未测量，此时不动窗口 */
  const [naturalHeight, setNaturalHeight] = useState(0);
  /** 实测「内容超出列表视口」→ 需要滚动 */
  const [scrollable, setScrollable] = useState(false);
  /**
   * 尺寸模式。null = 尚未从设置读出，此时自动高度不介入 ——
   * 否则持久化的手动尺寸会在设置加载完成前被自动高度抢先改掉。
   * 不单独持久化：由「设置里有没有 h」派生（见 `widgetService.WidgetSettings`）。
   * 单向 auto → manual，用户一旦定过尺寸就一直记住。
   */
  const [sizeMode, setSizeMode] = useState<WidgetSizeMode | null>(null);
  const sizeModeRef = useRef<WidgetSizeMode | null>(null);

  // ==== 动效状态（方案书 docx/widget-ux-polish-plan-2026-09-08.md W1/W2） ====
  /** 日期切换方向（W1-3）：决定旧内容滑出 class 与新条目入场 keyframes */
  const [navDirection, setNavDirection] = useState<NavDirection | null>(null);
  const [navLeaving, setNavLeaving] = useState(false);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * FLIP（W1-1）：上一帧条目位置快照（key = task id）。
   * 仅在 flipEnabledRef 置位后的第一次重排播放位移（勾选完成/取消沉降），
   * 日期切换 / 重拉 / 草稿变化不播（各有自己的过渡或应即时呈现）。
   */
  const prevRectsRef = useRef<Map<string, { el: HTMLElement; rect: DOMRect }>>(
    new Map(),
  );
  const flipEnabledRef = useRef(false);
  /** 窗口高度动画（W2-1）：进行中的插值状态，跨 effect 运行共享 */
  const heightAnimRef = useRef<HeightAnimState | null>(null);
  // ==== 拖拽「拿起」反馈（W3-1） ====
  // Tauri 拖拽区是原生接管，前端拿不到拖拽生命周期；用 onMoved 事件流近似：
  // 连续事件（间隔 <120ms）累计 ≥2 次判定为拖拽中，260ms 静默复位。
  // 程序化 setPosition（高度动画逐帧、几何自愈）同样会触发 onMoved，
  // 以 heightAnimRef 活动为标志抑制，避免「动画被当成拖拽」的误亮。
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragTraceRef = useRef<{
    lastAt: number;
    count: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ lastAt: 0, count: 0, timer: null });

  const displayedDateKey = anchorDate ?? todayKey;
  // 事件回调里要拿最新值；闭包旧值会让"按日重拉"打错目标
  // 通过 effect 同步（render 期间改 ref 会被 React 19 lint 拦下）
  const displayedDateKeyRef = useRef(displayedDateKey);
  useEffect(() => {
    displayedDateKeyRef.current = displayedDateKey;
  }, [displayedDateKey]);

  const refreshDate = useCallback(async (dateKey: string) => {
    try {
      const rows = await queryTasksForDate(dateKey);
      setTasks(rows);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const enqueueSettings = useCallback((task: () => Promise<unknown>) => {
    writeChain.current = writeChain.current.then(task).catch(() => undefined);
  }, []);

  const flushGeometry = useCallback(() => {
    const pending = pendingGeometry.current;
    if (!pending.position && !pending.size) return;
    pendingGeometry.current = { position: null, size: null };
    enqueueSettings(async () => {
      const scale = await getCurrentWindow().scaleFactor();
      const patch: Partial<WidgetSettings> = {};
      if (pending.position) {
        patch.x = Math.round(pending.position.x / scale);
        patch.y = Math.round(pending.position.y / scale);
      }
      if (pending.size) {
        patch.w = Math.round(pending.size.width / scale);
        patch.h = Math.round(pending.size.height / scale);
      }
      await patchWidgetSettings(patch);
    });
  }, [enqueueSettings]);

  const scheduleGeometryFlush = useCallback(() => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => {
      moveTimer.current = null;
      flushGeometry();
    }, GEOMETRY_FLUSH_MS);
  }, [flushGeometry]);

  /**
   * 用户按下 resize 热区：这一下就是「尺寸归我」的意思。
   * 之后 `onResized` 才会开始把 w/h 落盘，下次启动就按这个尺寸开窗。
   * 单向切换，没有回到 auto 的入口。
   */
  const handleResizeStart = useCallback(() => {
    if (sizeModeRef.current === "manual") return;
    sizeModeRef.current = "manual";
    setSizeMode("manual");
  }, []);

  // 初始化：主题、设置恢复、清单与当日任务加载
  useEffect(() => {
    let cancelled = false;
    let disposeTheme: (() => void) | null = null;
    void (async () => {
      const settings = await loadAppSettings();
      if (cancelled) return;
      disposeTheme = applyThemePreference(settings.theme);
      setDefaultListId(settings.defaultListId);
      const widgetSettings = await getWidgetSettings();
      if (cancelled) return;
      // 自定义字体要先注册再应用外观，否则 custom 栈落到 var(--font-ui) 渲染
      if (widgetSettings.noteFont === "custom") {
        await ensureCustomNoteFont();
      }
      // 权威外观（缓存只保证首帧不闪，这里读 SQLite/设置键后覆盖）
      appearanceRef.current = widgetSettings;
      applyWidgetAppearance(widgetSettings);
      setHideDone(widgetSettings.noteHideDone);
      setAnchorDate(widgetSettings.anchorDate);
      // 「有 h」即说明用户手动定过尺寸，据此派生模式，不另存字段
      const restoredMode: WidgetSizeMode =
        widgetSettings.h !== null ? "manual" : "auto";
      sizeModeRef.current = restoredMode;
      setSizeMode(restoredMode);
      const initialDate = widgetSettings.anchorDate ?? localDateKey(new Date());
      // 当日数据 + 清单并行加载；任务只拉一天，远小于原来的全表查询
      const [taskRows, listRows] = await Promise.all([
        queryTasksForDate(initialDate),
        listLists(),
      ]);
      if (cancelled) return;
      setTasks(taskRows);
      setLists(listRows);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      disposeTheme?.();
    };
  }, []);

  // 事件监听：主窗变更、循环任务生成、同步完成
  // - tasks-changed (main)：仅当 affectedDateKeys 命中当前显示日期才重拉
  // - recurring-tasks-generated：循环展开可能落到任意一天，保守重拉当日
  // - sync-completed：远端可能改了任意一天，重拉当日；清单也同步
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const nextUnlisteners = await Promise.all([
        listen<TasksChangedPayload>("tasks-changed", (event) => {
          const payload = event.payload;
          if (payload.source === "widget") return;
          const current = displayedDateKeyRef.current;
          if (payload.affectedDateKeys.length === 0) {
            // 兜底：源端没给出受影响日期集合时，无条件重拉当日
            void refreshDate(current);
            return;
          }
          if (payload.affectedDateKeys.includes(current)) {
            void refreshDate(current);
          }
        }),
        listen("recurring-tasks-generated", () => {
          void refreshDate(displayedDateKeyRef.current);
        }),
        listen("sync-completed", () => {
          void refreshDate(displayedDateKeyRef.current);
          void listLists()
            .then(setLists)
            .catch(() => undefined);
        }),
      ]);
      if (cancelled) {
        nextUnlisteners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...nextUnlisteners);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [refreshDate]);

  // 外观设置广播：其它窗口（主窗外观分区）patch 后即时同步到这里。
  // payload 在写入端已归一化，applyWidgetAppearance 幂等——widget 自己的
  // 几何写入触发的广播只是空操作重放，无需按来源排除。
  // noteFont === "custom" 时先确保字体字节已注册（导入动作发生在主窗）。
  // noteHideDone 是行为字段，绕过 CSS 直接进条目派生。
  // Tauri 走 emit/listen，mock 走 BroadcastChannel，两条路径注册方式一致。
  useEffect(() => {
    return listenWidgetSettings((settings) => {
      appearanceRef.current = settings;
      void (async () => {
        if (settings.noteFont === "custom") {
          await ensureCustomNoteFont();
        }
        applyWidgetAppearance(settings);
      })();
      setHideDone(settings.noteHideDone);
    });
  }, []);

  // 应用主题广播（「跟随应用」主题的数据源）：更新自身 data-theme 后，
  // auto 主题重解析纸色（亮→经典黄 / 暗→夜墨）。
  useEffect(
    () =>
      listenAppTheme((dark) => {
        const root = document.documentElement;
        root.classList.toggle("dark", dark);
        root.dataset.theme = dark ? "dark" : "light";
        const current = appearanceRef.current;
        if (current?.noteTheme === "auto") {
          applyWidgetAppearance(current);
        }
      }),
    [],
  );

  // 跟随今天模式下的跨午夜翻页：检查频率从 60s 提到 5min（跨日瞬间精度不重要），
  // 跨日后如果处于跟随模式则顺带刷新当日；锚定模式不刷。
  const anchorDateRef = useRef(anchorDate);
  useEffect(() => {
    anchorDateRef.current = anchorDate;
  }, [anchorDate]);
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setInterval(() => {
      const next = localDateKey(new Date());
      if (next === todayKey) return;
      setTodayKey(next);
      if (anchorDateRef.current === null) {
        void refreshDate(next);
      }
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [refreshDate, todayKey]);

  // 卸载时清掉日期导航的滑出定时器（W1-3），避免卸载后 setState
  useEffect(
    () => () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    },
    [],
  );

  // 拖拽 / 拉伸后的几何记忆（仅 Tauri）：onMoved + onResized 合并防抖写入设置键。
  // 拖起手本身由 .widget-stage 上的 data-tauri-drag-region="deep" + Tauri 注入的
  // drag.js 负责；拉伸起手由 WidgetResizeHandles 调 startResizeDragging，
  // 这里都不碰鼠标，只记结果。
  // 尺寸只在 manual 模式下落盘：auto 模式下自动高度自己也会调 setSize，
  // 把那些程序化尺寸存下来会让「跟随内容」变成一个僵化的存档值。
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    // ref 对象本身稳定，cleanup 读取同一对象的 timer 字段（exhaustive-deps 友好）
    const dragTrace = dragTraceRef.current;
    const currentWindow = getCurrentWindow();
    void (async () => {
      const nextUnlisteners = await Promise.all([
        currentWindow.onMoved((event) => {
          pendingGeometry.current.position = {
            x: event.payload.x,
            y: event.payload.y,
          };
          scheduleGeometryFlush();
          // W3-1：拖拽中判定（程序化移动不计入，见 dragTraceRef 注释）
          const anim = heightAnimRef.current;
          const programmatic =
            (anim?.raf != null || anim?.writeInFlight) === true;
          const now = performance.now();
          if (programmatic) {
            dragTrace.lastAt = now;
            dragTrace.count = 0;
            return;
          }
          if (now - dragTrace.lastAt < 120) {
            dragTrace.count += 1;
            if (dragTrace.count >= 2 && !draggingRef.current) {
              draggingRef.current = true;
              setIsDragging(true);
            }
          } else {
            dragTrace.count = 1;
          }
          dragTrace.lastAt = now;
          if (dragTrace.timer) clearTimeout(dragTrace.timer);
          dragTrace.timer = setTimeout(() => {
            dragTrace.timer = null;
            draggingRef.current = false;
            setIsDragging(false);
          }, 260);
        }),
        currentWindow.onResized((event) => {
          if (sizeModeRef.current !== "manual") return;
          pendingGeometry.current.size = {
            width: event.payload.width,
            height: event.payload.height,
          };
          scheduleGeometryFlush();
        }),
      ]);
      if (cancelled) {
        nextUnlisteners.forEach((unlisten) => unlisten());
        return;
      }
      [unlistenMove, unlistenResize] = nextUnlisteners;
    })();
    const flushOnUnload = () => flushGeometry();
    window.addEventListener("beforeunload", flushOnUnload);
    return () => {
      cancelled = true;
      unlistenMove?.();
      unlistenResize?.();
      if (moveTimer.current) clearTimeout(moveTimer.current);
      if (dragTrace.timer) clearTimeout(dragTrace.timer);
      window.removeEventListener("beforeunload", flushOnUnload);
    };
  }, [flushGeometry, scheduleGeometryFlush]);

  // 实测内容自然高度：不手抄子区域像素常量，CSS 怎么改都不会和窗口尺寸错位。
  // list.offsetTop 已含 shell padding-top + 抬头 + QuickAdd（含其 margin）；
  // inner.offsetHeight 是条目流的真实高度（标题换 2 行时会变长）。
  //
  // 同一次测量顺带判定是否需要滚动：不能再拿自然高度和 MAX 常量比 ——
  // manual 模式下窗口高度是用户定的，和那个常量没有关系。
  // 因此 observe 的是 inner（内容高度）和 list（视口高度）两者。
  // 这里不会来回抖：滚动条槽位由 CSS 恒定预留（scrollbar-gutter: stable），
  // is-scrollable 的切换不改变内容盒宽度，也就不会反过来影响内容高度。
  useEffect(() => {
    const shell = shellRef.current;
    const list = listRef.current;
    const inner = listInnerRef.current;
    if (!shell || !list || !inner) return;
    const measure = () => {
      const shellPaddingBottom =
        Number.parseFloat(window.getComputedStyle(shell).paddingBottom) || 0;
      const next = list.offsetTop + inner.offsetHeight + shellPaddingBottom;
      setNaturalHeight((previous) =>
        Math.abs(previous - next) < 1 ? previous : next,
      );
      setScrollable(inner.offsetHeight > list.clientHeight + 1);
    };
    measure();
    // observe() 首次注册即回调一次，初始尺寸不依赖 effect 执行顺序
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tasks.length, adding, failed]);

  // FLIP 沉降动画（W1-1）：勾选完成/取消后条目在待办区↔完成区之间位移，
  // 用「记录旧位置 → 重排 → invert → play」补上缺失的滑动。
  // 只动 transform（合成层友好，透明窗红线安全）；WAAPI 动画不会与
  // CSS transition/animation 打架。reduced-motion 下直接跳过。
  useLayoutEffect(() => {
    const inner = listInnerRef.current;
    if (!inner) return;
    const current = new Map<string, { el: HTMLElement; rect: DOMRect }>();
    for (const el of inner.querySelectorAll<HTMLElement>("[data-task-id]")) {
      const id = el.dataset.taskId;
      if (id) current.set(id, { el, rect: el.getBoundingClientRect() });
    }
    if (flipEnabledRef.current) {
      flipEnabledRef.current = false;
      if (!prefersReducedMotion()) {
        for (const [id, entry] of current) {
          const prev = prevRectsRef.current.get(id);
          if (!prev) continue;
          const dx = prev.rect.left - entry.rect.left;
          const dy = prev.rect.top - entry.rect.top;
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
          entry.el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "translate(0, 0)" },
            ],
            { duration: 240, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" },
          );
        }
      }
    }
    prevRectsRef.current = current;
  }, [tasks]);

  // 按实测高度重设窗口；固定底边，避免向下扩出屏幕。
  // W2-1：auto 模式下高度变化不再一次 setSize 硬跳，而是 rAF 在
  // WINDOW_SIZE_ANIM_MS 内 ease-out 分帧插值（每帧至多一次写 IPC，
  // 上一次写未返回则跳帧防堆积），内容与窗口同步渐变。
  // - 动画进行中目标变化：从当前插值高度重新起跑（连续，无跳变）；
  // - 起点即目标（<1px）：不启动；
  // - manual 模式（用户拖过手柄）与关闭动效中不介入并停掉动画。
  // 手动拖拽 onResized 只在 manual 模式落盘，与这里的 auto 动画天然互斥。
  useEffect(() => {
    if (!isTauri()) return;
    const running = heightAnimRef.current;
    if (running?.raf != null) {
      cancelAnimationFrame(running.raf);
      running.raf = null;
    }
    if (closing || naturalHeight === 0 || sizeMode !== "auto") return;
    const targetHeight = clampWidgetHeight(naturalHeight);
    void (async () => {
      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const [pos, size] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
        ]);
        // await 期间可能又有一次 effect 触发——重读最新动画状态，
        // 若已有人在跑则只更新目标并从当前插值高度重新起跑
        const existing = heightAnimRef.current;
        if (existing?.raf != null) {
          existing.targetHeight = targetHeight;
          existing.startedAt = performance.now();
          existing.start = { ...existing.start, height: existing.lastHeight };
          return;
        }
        const startHeight = size.height / scale;
        if (Math.abs(startHeight - targetHeight) < 1) return;
        const nextState: HeightAnimState = {
          raf: null,
          writeInFlight: false,
          startedAt: performance.now(),
          lastHeight: startHeight,
          targetHeight,
          start: {
            x: pos.x / scale,
            bottomY: pos.y / scale + startHeight,
            height: startHeight,
            width: clampWidgetWidth(size.width / scale),
          },
        };
        heightAnimRef.current = nextState;
        const step = () => {
          const a = heightAnimRef.current;
          // 世代校验：被更新的 effect 覆盖后旧循环自动退出
          if (a !== nextState || a.raf === null) return;
          const t = (performance.now() - a.startedAt) / WINDOW_SIZE_ANIM_MS;
          const k = easeOutCubic(Math.min(1, t));
          const height = a.start.height + (a.targetHeight - a.start.height) * k;
          a.lastHeight = height;
          const y = Math.max(0, a.start.bottomY - height);
          if (!a.writeInFlight) {
            a.writeInFlight = true;
            const { x, width: w } = a.start;
            void win
              .setSize(new LogicalSize(w, height))
              .catch(() => undefined)
              .then(() => win.setPosition(new LogicalPosition(x, y)))
              .catch(() => undefined)
              .finally(() => {
                a.writeInFlight = false;
              });
          }
          if (t < 1) {
            a.raf = requestAnimationFrame(step);
          } else {
            a.raf = null;
          }
        };
        nextState.raf = requestAnimationFrame(step);
      } catch {
        // 窗口尚未就绪 / IPC 失败时静默，下次 naturalHeight 变化重试
      }
    })();
  }, [naturalHeight, closing, sizeMode]);

  /**
   * 隐藏：播淡出动效（opacity → 0 + 上移 + 缩放 0.95），
   * 动效结束后 invoke `hide_widget_window`（Rust hide，window 仍存活）。
   * 关窗按钮与托盘「widget-hide-request」共用此函数（方案书 D-5）；
   * 托盘路径由 Rust 侧 500ms 兜底，前端卡死也不会关不掉。
   */
  const handleClose = useCallback(() => {
    if (!isTauri()) return;
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      void invoke("hide_widget_window").catch(() => undefined);
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
  }, [closing]);

  // 事件回调要拿最新 handleClose；listener 只注册一次（与 displayedDateKeyRef 同款模式）
  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  // W2-2 show/hide 双向动效：
  // - widget-shown：Rust show() 后广播 → WAAPI 重播 drop-in 曲线（与首次
  //   建窗的 CSS note-drop-in 同幅度），hide→show 不再硬切出现；
  // - widget-hide-request：托盘隐藏路径 → 复用 .is-closing 淡出后 invoke hide。
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const next = await Promise.all([
        listen("widget-shown", () => {
          if (prefersReducedMotion()) return;
          shellRef.current?.animate(
            [
              { opacity: 0, transform: "translateY(-12px) scale(0.99)" },
              { opacity: 1, transform: "translateY(0) scale(1)" },
            ],
            { duration: 300, easing: "ease-out" },
          );
        }),
        listen("widget-hide-request", () => {
          handleCloseRef.current();
        }),
      ]);
      if (disposed) {
        next.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...next);
    })();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // 数据已经按日期过滤过；这里只做"已完成沉底"的本地派生，
  // 不改后端 priority / dueAt 顺序，也不额外发 IPC。
  // hideDone（noteHideDone）把已完成条目从列表剔除，但进度标签仍统计全部，
  // 让用户知道被藏了多少。
  const { displayedTasks, progressLabel, allDone } = useMemo(() => {
    const pending: Task[] = [];
    const finished: Task[] = [];
    for (const task of tasks) {
      (task.status === "done" ? finished : pending).push(task);
    }
    const label =
      tasks.length === 0
        ? null
        : finished.length === 0
          ? `共 ${tasks.length} 项`
          : `共 ${tasks.length} 项 · 已完成 ${finished.length}`;
    return {
      displayedTasks: hideDone ? pending : [...pending, ...finished],
      progressLabel: label,
      allDone: tasks.length > 0 && finished.length === tasks.length,
    };
  }, [tasks, hideDone]);

  const listColorById = useMemo(
    () => new Map(lists.map((list) => [list.id, list.color])),
    [lists],
  );

  function changeAnchorDate(nextAnchor: string | null) {
    // 锚定到恰好是今天时归一为跟随模式
    const normalized =
      nextAnchor === localDateKey(new Date()) ? null : nextAnchor;
    setAnchorDate(normalized);
    // 显式触发新日期的数据拉取（避免在 effect 内 setState）
    const target = normalized ?? localDateKey(new Date());
    if (target !== displayedDateKeyRef.current) {
      void refreshDate(target);
    }
    // 落盘走串行队列，不与几何防抖写并发交错
    enqueueSettings(() => patchWidgetSettings({ anchorDate: normalized }));
  }

  /**
   * 日期导航（W1-3 方向感）：旧内容向进入方向的反侧滑出（NAV_LEAVE_MS），
   * 换数据后新条目按方向 keyframes 滑入（CSS `[data-nav]`）。
   * 连点时跳过滑出直接切换，不叠动画。方向语义见方案书 D-3：
   * prev（←，过去）内容从左入，next（→，未来）从右入。
   */
  function navigateBy(delta: number) {
    const direction = navDirectionFromDelta(delta);
    const nextKey = shiftDateKey(displayedDateKey, delta);
    setNavDirection(direction);
    if (navTimer.current) {
      // 连点：取消待完成的滑出，立即切数据
      clearTimeout(navTimer.current);
      navTimer.current = null;
      setNavLeaving(false);
      changeAnchorDate(nextKey);
      return;
    }
    const hasContent = displayedTasks.length > 0;
    if (!hasContent || prefersReducedMotion()) {
      changeAnchorDate(nextKey);
      return;
    }
    setNavLeaving(true);
    navTimer.current = setTimeout(() => {
      navTimer.current = null;
      changeAnchorDate(nextKey);
      setNavLeaving(false);
    }, NAV_LEAVE_MS);
  }

  async function handleToggle(task: Task) {
    const completed = task.status !== "done";
    setBusyTaskId(task.id);
    // 下一次 tasks 重排播 FLIP 沉降（W1-1）；失败回滚的重排不会置位，不播
    flipEnabledRef.current = true;
    // 最小乐观：先本地打勾，服务端返回行整行替换
    setTasks((previous) =>
      previous.map((row) =>
        row.id === task.id
          ? {
              ...row,
              status: completed ? "done" : "todo",
              completedAt: completed ? new Date().toISOString() : null,
            }
          : row,
      ),
    );
    try {
      const updated = await setTaskCompleted(task.id, completed);
      setTasks((previous) =>
        previous.map((row) => (row.id === updated.id ? updated : row)),
      );
      notifyTasksChanged("widget");
    } catch {
      await refreshDate(displayedDateKeyRef.current);
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleCreate(input: CreateTaskInput) {
    const created = await createTask(input);
    // 快速添加支持"明天/周X"，新任务可能落在别的日期：
    // 只有落在当前显示日期才本地插入，否则不能混进当前列表，
    // 改为对显示日期做一次权威重拉兜底
    if (taskPlanDateKey(created) === displayedDateKeyRef.current) {
      setTasks((previous) => {
        // 过滤掉可能已存在的同 id 行（重拉兜底场景），再插入新行
        const without = previous.filter((row) => row.id !== created.id);
        return [...without, created].sort((a, b) => {
          if (a.priority !== b.priority) return b.priority - a.priority;
          const aTime = a.dueAt ?? "";
          const bTime = b.dueAt ?? "";
          if (aTime !== bTime) return aTime.localeCompare(bTime);
          return b.createdAt.localeCompare(a.createdAt);
        });
      });
    } else {
      void refreshDate(displayedDateKeyRef.current);
    }
    notifyTasksChanged("widget");
  }

  return (
    <div
      ref={stageRef}
      className={[
        "widget-stage",
        closing ? "is-closing" : "",
        isDragging ? "is-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tauri-drag-region="deep"
    >
      <WidgetPinTop />
      <WidgetResizeHandles onResizeStart={handleResizeStart} />
      <div className="widget-shell" ref={shellRef}>
        <WidgetTitleBar
          onAdd={() => setAdding((value) => !value)}
          adding={adding}
          onClose={handleClose}
          dateKey={displayedDateKey}
          todayKey={todayKey}
          isAnchored={anchorDate !== null}
          progressLabel={progressLabel}
          onPrev={() => navigateBy(-1)}
          onNext={() => navigateBy(1)}
          onBackToToday={() => changeAnchorDate(null)}
        />
        <WidgetQuickAdd
          open={adding}
          lists={lists}
          defaultListId={defaultListId}
          targetDateKey={displayedDateKey}
          onCreate={handleCreate}
          onClose={() => setAdding(false)}
        />
        <div
          className={`widget-list ${scrollable ? "is-scrollable" : ""}`.trim()}
          data-tauri-drag-region={scrollable ? "false" : undefined}
          ref={listRef}
        >
          <div
            className={[
              "widget-list-inner",
              navLeaving && navDirection ? leaveClassName(navDirection) : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-nav={navDirection ?? undefined}
            ref={listInnerRef}
          >
            {failed ? (
              <button
                type="button"
                className="widget-empty widget-empty-retry"
                onClick={() => void refreshDate(displayedDateKey)}
              >
                加载失败，点击重试
              </button>
            ) : displayedTasks.length === 0 ? (
              <p className="widget-empty">
                {displayedDateKey === todayKey
                  ? allDone
                    ? "今天的事都做完啦"
                    : "今天没有安排，点 + 记一笔"
                  : "这天还没有安排"}
              </p>
            ) : (
              displayedTasks.map((task) => (
                <WidgetTaskItem
                  key={task.id}
                  task={task}
                  listColor={listColorById.get(task.listId) ?? null}
                  busy={busyTaskId === task.id}
                  onToggle={() => void handleToggle(task)}
                  onOpen={() => openTaskInMainWindow(task.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
