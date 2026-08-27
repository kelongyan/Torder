import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTodo } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { WidgetDateBar } from "../components/widget/WidgetDateBar";
import { WidgetQuickAdd } from "../components/widget/WidgetQuickAdd";
import { WidgetTaskItem } from "../components/widget/WidgetTaskItem";
import { WidgetTitleBar } from "../components/widget/WidgetTitleBar";
import { listLists } from "../services/listService";
import { loadAppSettings } from "../services/settingsService";
import {
  createTask,
  queryTasksForDate,
  setTaskCompleted,
} from "../services/taskService";
import { localDateKey, shiftDateKey } from "../services/taskQuery";
import {
  getWidgetSettings,
  notifyTasksChanged,
  openTaskInMainWindow,
  saveWidgetSettings,
  type TasksChangedPayload,
} from "../services/widgetService";
import type {
  CreateTaskInput,
  Task,
  TaskList,
} from "../types/database";
import { applyThemePreference } from "../utils/theme";
import {
  WIDGET_WIDTH,
  calculateWidgetHeight,
} from "../services/widgetLayout";

export function WidgetApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  const [defaultListId, setDefaultListId] = useState("work");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPosition = useRef<{ x: number; y: number } | null>(null);

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

  const flushPosition = useCallback(() => {
    if (!pendingPosition.current) return;
    const { x, y } = pendingPosition.current;
    pendingPosition.current = null;
    void saveWidgetSettings({ x, y }).catch(() => undefined);
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
      setAnchorDate(widgetSettings.anchorDate);
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
          void listLists().then(setLists).catch(() => undefined);
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

  // 拖拽位置记忆（仅 Tauri）：onMoved 防抖写入设置键
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlistenMove: (() => void) | null = null;
    const currentWindow = getCurrentWindow();
    void (async () => {
      const scale = await currentWindow.scaleFactor();
      const nextUnlisten = await currentWindow.onMoved((event) => {
        pendingPosition.current = {
          x: Math.round(event.payload.x / scale),
          y: Math.round(event.payload.y / scale),
        };
        if (moveTimer.current) clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(() => {
          moveTimer.current = null;
          flushPosition();
        }, 300);
      });
      if (cancelled) {
        nextUnlisten();
        return;
      }
      unlistenMove = nextUnlisten;
    })();
    const flushOnUnload = () => flushPosition();
    window.addEventListener("beforeunload", flushOnUnload);
    return () => {
      cancelled = true;
      unlistenMove?.();
      if (moveTimer.current) clearTimeout(moveTimer.current);
      window.removeEventListener("beforeunload", flushOnUnload);
    };
  }, [flushPosition]);

  // 根据任务数 + adding 状态动态调窗口高度；固定底边，避免向下扩出屏
  useEffect(() => {
    if (!isTauri()) return;
    const targetHeight = calculateWidgetHeight({
      itemCount: tasks.length,
      adding,
    });
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
        const bottomY = pos.y / scale + currentHeightLogical;
        const newY = Math.max(0, bottomY - targetHeight);
        await win.setSize(new LogicalSize(WIDGET_WIDTH, targetHeight));
        await win.setPosition(new LogicalPosition(pos.x / scale, newY));
      } catch {
        // 窗口尚未就绪 / IPC 失败时静默
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks.length, adding]);

  // 数据已经按日期过滤过；这里直接消费，无需前端再 filter
  const displayedTasks = useMemo(() => tasks, [tasks]);

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
    void saveWidgetSettings({ anchorDate: normalized }).catch(() => undefined);
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
    notifyTasksChanged("widget");
  }

  return (
    <div className="widget-shell">
      <WidgetTitleBar onAdd={() => setAdding((value) => !value)} adding={adding} />
      {adding && (
        <WidgetQuickAdd
          lists={lists}
          defaultListId={defaultListId}
          targetDateKey={displayedDateKey}
          onCreate={handleCreate}
          onClose={() => setAdding(false)}
        />
      )}
      <WidgetDateBar
        dateKey={displayedDateKey}
        todayKey={todayKey}
        isAnchored={anchorDate !== null}
        onPrev={() => changeAnchorDate(shiftDateKey(displayedDateKey, -1))}
        onNext={() => changeAnchorDate(shiftDateKey(displayedDateKey, 1))}
        onBackToToday={() => changeAnchorDate(null)}
      />
      <div className="widget-list">
        {failed ? (
          <button
            type="button"
            className="widget-empty widget-empty-retry"
            onClick={() => void refreshDate(displayedDateKey)}
          >
            加载失败，点击重试
          </button>
        ) : displayedTasks.length === 0 ? (
          <div className="widget-empty">
            <div className="widget-empty-illustration" aria-hidden="true">
              <ListTodo />
            </div>
            <p className="widget-empty-title">今天没有待办</p>
            <p className="widget-empty-hint">点右上角 + 添加任务，或切换到其他日期</p>
          </div>
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
  );
}
