import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
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

/** 关闭淡出动效时长（与 widget.css `.widget-stage.is-closing` 保持一致） */
const CLOSE_ANIMATION_MS = 360;
/** 位置 / 尺寸落盘的防抖时长 */
const GEOMETRY_FLUSH_MS = 300;

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

  // 拖拽 / 拉伸后的几何记忆（仅 Tauri）：onMoved + onResized 合并防抖写入设置键。
  // 拖起手本身由 .widget-stage 上的 data-tauri-drag-region="deep" + Tauri 注入的
  // drag.js 负责；拉伸起手由 WidgetResizeHandles 调 startResizeDragging，
  // 这里都不碰鼠标，只记结果。
  //
  // 尺寸只在 manual 模式下落盘：auto 模式下自动高度自己也会调 setSize，
  // 把那些程序化尺寸存下来会让「跟随内容」变成一个僵化的存档值。
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    const currentWindow = getCurrentWindow();
    void (async () => {
      const nextUnlisteners = await Promise.all([
        currentWindow.onMoved((event) => {
          pendingGeometry.current.position = {
            x: event.payload.x,
            y: event.payload.y,
          };
          scheduleGeometryFlush();
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

  // 按实测高度重设窗口；固定底边，避免向下扩出屏幕。
  // manual 模式（用户拖过手柄）下完全不介入，否则任何内容变化都会把手动尺寸吃掉。
  useEffect(() => {
    if (!isTauri()) return;
    // 关闭动效中不再调整高度，避免与 .is-closing 动画打架
    if (closing || naturalHeight === 0) return;
    // null = 设置还没读出来，先别动；manual = 尺寸归用户
    if (sizeMode !== "auto") return;
    const targetHeight = clampWidgetHeight(naturalHeight);
    let cancelled = false;
    void (async () => {
      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const [pos, size] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
        ]);
        if (cancelled) return;
        const currentHeightLogical = size.height / scale;
        // 宽度必须沿用当前实际值，不能写回常量：否则用户横向拉宽后，
        // 任何一次内容变化都会把宽度按回默认值。clamp 只用于自愈越界存档。
        const targetWidth = clampWidgetWidth(size.width / scale);
        const widthChanged = Math.abs(targetWidth - size.width / scale) >= 1;
        if (
          Math.abs(currentHeightLogical - targetHeight) < 1 &&
          !widthChanged
        ) {
          return;
        }
        const bottomY = pos.y / scale + currentHeightLogical;
        const newY = Math.max(0, bottomY - targetHeight);
        await win.setSize(new LogicalSize(targetWidth, targetHeight));
        await win.setPosition(new LogicalPosition(pos.x / scale, newY));
      } catch {
        // 窗口尚未就绪 / IPC 失败时静默
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [naturalHeight, closing, sizeMode]);

  /**
   * 关闭：播淡出动效（opacity → 0 + 上移 + 缩放 0.95），
   * 动效结束后再调 Rust close（被 Rust 拦截为 hide，window 仍存活）。
   * 非 Tauri 模式下直接走原 getCurrentWindow().close 路径。
   */
  const handleClose = useCallback(() => {
    if (!isTauri()) return;
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      void getCurrentWindow()
        .close()
        .catch(() => undefined);
      // 兜底：万一 close 真的销毁了 window，下次渲染不会发生；保留 setClosing(false) 也没事
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
  }, [closing]);

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

  async function handleToggle(task: Task) {
    const completed = task.status !== "done";
    setBusyTaskId(task.id);
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
      className={`widget-stage ${closing ? "is-closing" : ""}`.trim()}
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
          onPrev={() => changeAnchorDate(shiftDateKey(displayedDateKey, -1))}
          onNext={() => changeAnchorDate(shiftDateKey(displayedDateKey, 1))}
          onBackToToday={() => changeAnchorDate(null)}
        />
        {adding && (
          <WidgetQuickAdd
            lists={lists}
            defaultListId={defaultListId}
            targetDateKey={displayedDateKey}
            onCreate={handleCreate}
            onClose={() => setAdding(false)}
          />
        )}
        <div
          className={`widget-list ${scrollable ? "is-scrollable" : ""}`.trim()}
          data-tauri-drag-region={scrollable ? "false" : undefined}
          ref={listRef}
        >
          <div className="widget-list-inner" ref={listInnerRef}>
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
