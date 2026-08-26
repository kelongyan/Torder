import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WidgetDateBar } from "../components/widget/WidgetDateBar";
import { WidgetQuickAdd } from "../components/widget/WidgetQuickAdd";
import { WidgetTaskItem } from "../components/widget/WidgetTaskItem";
import { WidgetTitleBar } from "../components/widget/WidgetTitleBar";
import { listLists } from "../services/listService";
import { loadAppSettings } from "../services/settingsService";
import {
  createTask,
  queryTasks,
  setTaskCompleted,
} from "../services/taskService";
import {
  filterAndSortTasks,
  localDateKey,
  shiftDateKey,
  taskPlanDateKey,
} from "../services/taskQuery";
import {
  getWidgetSettings,
  notifyTasksChanged,
  openTaskInMainWindow,
  saveWidgetSettings,
} from "../services/widgetService";
import type {
  CreateTaskInput,
  Task,
  TaskList,
} from "../types/database";
import { applyThemePreference } from "../utils/theme";

const fullScopeQuery = {
  scope: { kind: "view", view: "all" },
  query: "",
  sortBy: "priority",
  showCompleted: true,
} as const;

export function WidgetApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  const [defaultListId, setDefaultListId] = useState("work");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPosition = useRef<{ x: number; y: number } | null>(null);

  const displayedDateKey = anchorDate ?? todayKey;

  const refresh = useCallback(async () => {
    try {
      const rows = await queryTasks({ ...fullScopeQuery });
      setTasks(rows);
      setTodayKey(localDateKey(new Date()));
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

  // 初始化：主题、设置恢复、清单与任务加载
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
      const [taskRows, listRows] = await Promise.all([
        queryTasks({ ...fullScopeQuery }),
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

  // 事件监听：主窗变更、循环任务生成、同步完成；重新可见时无条件重查兜底
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const nextUnlisteners = await Promise.all([
        listen<{ source: string }>("tasks-changed", (event) => {
          if (event.payload.source !== "widget") void refresh();
        }),
        listen("recurring-tasks-generated", () => void refresh()),
        listen("sync-completed", () => {
          void refresh();
          void listLists().then(setLists).catch(() => undefined);
        }),
      ]);
      if (cancelled) {
        nextUnlisteners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...nextUnlisteners);
    })();

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
      else flushPosition();
    };
    const refreshOnFocus = () => void refresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshOnFocus);

    // 跟随今天模式下的跨午夜翻页
    const midnightTimer = setInterval(() => {
      const nextToday = localDateKey(new Date());
      setTodayKey((previous) =>
        previous === nextToday ? previous : nextToday,
      );
    }, 60_000);

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshOnFocus);
      clearInterval(midnightTimer);
    };
  }, [refresh, flushPosition]);

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

  const displayedTasks = useMemo(
    () => tasks.filter((task) => taskPlanDateKey(task) === displayedDateKey),
    [tasks, displayedDateKey],
  );

  const listColorById = useMemo(
    () => new Map(lists.map((list) => [list.id, list.color])),
    [lists],
  );

  function changeAnchorDate(nextAnchor: string | null) {
    // 锚定到恰好是今天时归一为跟随模式
    const normalized =
      nextAnchor === localDateKey(new Date()) ? null : nextAnchor;
    setAnchorDate(normalized);
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
      await refresh();
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleCreate(input: CreateTaskInput) {
    const created = await createTask(input);
    setTasks((previous) =>
      filterAndSortTasks([...previous, created], { ...fullScopeQuery }),
    );
    notifyTasksChanged("widget");
  }

  return (
    <div className="widget-shell">
      <WidgetTitleBar />
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
            onClick={() => void refresh()}
          >
            加载失败，点击重试
          </button>
        ) : displayedTasks.length === 0 ? (
          <p className="widget-empty">这一天没有待办事项</p>
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
      <WidgetQuickAdd
        lists={lists}
        defaultListId={defaultListId}
        targetDateKey={displayedDateKey}
        onCreate={handleCreate}
      />
    </div>
  );
}
