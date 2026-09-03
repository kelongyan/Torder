import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AlertCircle,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Kanban,
  Keyboard,
  ListTodo,
  PanelLeft,
  Palette,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { CommandEntry } from "../components/command/CommandPalette";
import { CommandPalette } from "../components/command/CommandPalette";
import { toggleSidebarCollapsed } from "../hooks/useSidebarCollapsed";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { applyAccentPreference, applyThemePreference } from "../utils/theme";
import { saveAppSetting } from "../services/settingsService";
import { checkForUpdate } from "../services/appService";
import { listScope, useTaskStore, viewScope } from "../stores/taskStore";
import type {
  CreateTaskInput,
  Task,
  TaskList,
  TaskScope,
  UpdateTaskInput,
} from "../types/database";
import { countTaskFilter } from "../types/database";
import {
  defaultAppSettings,
  type AppSettings,
  type SavedTaskView,
  type ThemePreference,
} from "../types/settings";
import type { ConfirmState } from "../types/ui";
import {
  buildCounts,
  getScopeTitle,
  pickDefaultListId,
} from "../utils/taskHelpers";

import { Sidebar } from "../components/layout/Sidebar";
import { BottomNav } from "../components/layout/BottomNav";
import { MainHeader } from "../components/layout/MainHeader";
import { TaskListView } from "../components/task/TaskListView";
import { TaskBoard } from "../components/task/TaskBoard";
import { TaskCalendar } from "../components/task/TaskCalendar";
import {
  createList,
  deleteList,
  listLists,
  updateList,
} from "../services/listService";
import { TaskDetailPanel } from "../components/detail/TaskDetailPanel";
import {
  attachPendingAttachments,
  type PendingTaskAttachment,
} from "../services/pendingAttachmentService";
import { TaskCreateDialog } from "../components/dialog/TaskCreateDialog";
import { RecurringRuleDialog } from "../components/dialog/RecurringRuleDialog";
import { RecurringRulesView } from "../components/recurring/RecurringRulesView";
import { ListDialog } from "../components/dialog/ListDialog";
import { ConfirmDialog } from "../components/dialog/ConfirmDialog";
import { SettingsDialog } from "../components/dialog/SettingsDialog";
import { StatsDialog } from "../components/dialog/StatsDialog";
import { FocusDialog } from "../components/dialog/FocusDialog";
import { notifyFocusFinished } from "../services/focusService";
import { BatchEditDialog } from "../components/dialog/BatchEditDialog";
import { ShortcutsDialog } from "../components/dialog/ShortcutsDialog";
import { ToastHost } from "../components/common/ToastHost";
import { WindowTitleBar } from "../components/layout/WindowTitleBar";
import { SavedViewDialog } from "../components/dialog/SavedViewDialog";

import { useAppInit } from "../hooks/useAppInit";
import { useAppDataLoaders } from "../hooks/useAppDataLoaders";
import { useDialogManager } from "../hooks/useDialogManager";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useTaskReminder } from "../hooks/useTaskReminder";
import { usePresence } from "../hooks/usePresence";
import { useSyncLifecycle } from "../hooks/useSyncLifecycle";
import { useToast } from "../hooks/useToast";
import { useTrayQuickAdd } from "../hooks/useTrayQuickAdd";
import { useSavedViewActions } from "../hooks/useSavedViewActions";
import { useCalendarEventActions } from "../hooks/useCalendarEventActions";
import { useRecurringActions } from "../hooks/useRecurringActions";
import { useTaskActions } from "../hooks/useTaskActions";
import { isMobile } from "../utils/platform";
import { MonthCalendar } from "../components/task/MonthCalendar";
import { WeekCalendar } from "../components/task/WeekCalendar";
import { CalendarEventDialog } from "../components/dialog/CalendarEventDialog";
import type { SyncStatus } from "../types/sync";
import { normalizeError } from "../utils/normalizeError";
import { getTaskCalendarKey } from "../utils/taskDates";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
    skipTransition: () => void;
  };
};

function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [appError, setAppError] = useState<string | null>(null);
  const [autoBackup, setAutoBackup] = useState(false);
  const [syncAutoEnabled, setSyncAutoEnabled] = useState(true);
  const [syncWifiOnly, setSyncWifiOnly] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [recurringViewActive, setRecurringViewActive] = useState(false);
  const [createScheduledDate, setCreateScheduledDate] = useState("");
  const [savedViewDialogOpen, setSavedViewDialogOpen] = useState(false);
  const [editingSavedView, setEditingSavedView] =
    useState<SavedTaskView | null>(null);
  const savedViewPresence = usePresence(savedViewDialogOpen, 280);
  // 阶段 A：专注模式控制面板（T-02）。
  const [focusOpen, setFocusOpen] = useState(false);
  const focusPresence = usePresence(focusOpen, 280);

  const dialog = useDialogManager();
  const {
    menuOpen,
    mobileSidebarOpen,
    editingList,
    editingRecurringRule,
    recurringSourceTask,
    editingCalendarEvent,
    eventDialogDefaultDate,
    createPresence,
    listDialogPresence,
    shortcutsPresence,
    settingsPresence,
    statsPresence,
    batchEditPresence,
    commandPalettePresence,
    confirmPresence,
    recurringDialogPresence,
    calendarEventDialogPresence,
    setMenuOpen,
    setMobileSidebarOpen,
    setCreateOpen,
    setListDialogOpen,
    setShortcutsOpen,
    setSettingsOpen,
    setStatsOpen,
    setBatchEditOpen,
    setCommandPaletteOpen,
    setConfirmState,
    setRecurringDialogOpen,
    setEditingRecurringRule,
    setRecurringSourceTask,
    setCalendarEventDialogOpen,
    openCreateDialog,
    openSettingsDialog,
    openStatsDialog,
    openAddListDialog,
    openEditListDialog,
    openNewRecurringDialog,
    openNewCalendarEvent,
    openEditCalendarEvent,
    openMobileSidebar,
    closeMobileSidebar,
    closeDialogs,
  } = dialog;

  // 稳定引用：useAppDataLoaders 的两个 [onError] effect 依赖它，内联箭头会导致每次渲染全量重拉
  const handleDataLoadError = useCallback(
    (nextError: string) => setAppError(nextError),
    [],
  );

  const {
    calendarEvents,
    setCalendarEvents,
    recurringRules,
    setRecurringRules,
    recurringLoading,
    loadRecurringRules,
  } = useAppDataLoaders(handleDataLoadError);

  const { toasts, pushToast } = useToast();
  // 阶段 A：专注一轮自然结束 —— 本地提示 + Rust 权威系统通知。
  const handleFocusFinished = useCallback(() => {
    pushToast("本轮专注已完成", "success");
    void notifyFocusFinished();
  }, [pushToast]);
  const mobile = isMobile();

  // M3.2 移动端滚动折叠：捕获 .content-panel 滚动，向下隐藏主 header。
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const lastContentScroll = useRef(0);
  useEffect(() => {
    if (!mobile) return;
    const onScrollCapture = () => {
      const panel = document.querySelector<HTMLElement>(".content-panel");
      if (!panel) return;
      const y = panel.scrollTop;
      const delta = y - lastContentScroll.current;
      lastContentScroll.current = y;
      if (y <= 4) {
        setMobileHeaderHidden(false);
        return;
      }
      setMobileHeaderHidden(delta > 6);
    };
    window.addEventListener("scroll", onScrollCapture, true);
    return () => window.removeEventListener("scroll", onScrollCapture, true);
  }, [mobile]);

  useEffect(() => {
    const root = document.documentElement;
    if (!mobile) {
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-offset-top");
      return;
    }

    const updateViewportVars = () => {
      const viewport = window.visualViewport;
      root.style.setProperty(
        "--app-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.style.setProperty(
        "--app-viewport-offset-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };

    updateViewportVars();
    window.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("scroll", updateViewportVars);

    return () => {
      window.removeEventListener("resize", updateViewportVars);
      window.visualViewport?.removeEventListener("resize", updateViewportVars);
      window.visualViewport?.removeEventListener("scroll", updateViewportVars);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-offset-top");
    };
  }, [mobile]);

  const {
    scope,
    layout,
    searchQuery,
    sortBy,
    sortAsc,
    filter,
    showCompleted,
    allTasks,
    tasks,
    attachmentCounts,
    selectedTaskId,
    batchMode,
    batchSelectedIds,
    loading,
    error,
    setScope,
    setLayout,
    setSearchQuery,
    setSortBy,
    setSortAsc,
    toggleFilterList,
    toggleFilterTag,
    toggleFilterPriority,
    toggleFilterCompleted,
    clearFilterTags,
    clearFilter,
    setShowCompleted,
    addTask,
    saveTask,
    toggleTask,
    reorderTasks,
    patchTask,
    selectTask,
    toggleBatchMode,
    toggleBatchSelected,
    clearBatchSelection,
    clearError,
  } = useTaskStore();

  const selectedTask = useMemo(
    () =>
      allTasks.find((task) => task.id === selectedTaskId) ??
      tasks.find((task) => task.id === selectedTaskId) ??
      null,
    [allTasks, selectedTaskId, tasks],
  );

  const currentTitle = useMemo(
    () => (recurringViewActive ? "循环任务" : getScopeTitle(scope, lists)),
    [lists, recurringViewActive, scope],
  );
  const counts = useMemo(
    () => buildCounts(allTasks, lists, showCompleted),
    [allTasks, lists, showCompleted],
  );
  /** R04 筛选面板的标签组：取自全部任务，去重后按字典序稳定排列。 */
  const availableTags = useMemo(() => {
    const seen = new Set<string>();
    for (const task of allTasks) {
      for (const tag of task.tags) {
        const value = tag.trim();
        if (value) seen.add(value);
      }
    }
    return [...seen].sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN"),
    );
  }, [allTasks]);
  const filterCount = useMemo(() => countTaskFilter(filter), [filter]);
  const activeSavedViewId = useMemo(
    () =>
      settings.savedViews.find(
        (view) =>
          sameScope(view.scope, scope) &&
          view.query === searchQuery &&
          view.sortBy === sortBy &&
          view.showCompleted === showCompleted &&
          view.layout === layout,
      )?.id ?? null,
    [layout, scope, searchQuery, settings.savedViews, showCompleted, sortBy],
  );
  const defaultListId = useMemo(() => {
    if (scope.kind === "list") return scope.listId;
    if (lists.some((list) => list.id === settings.defaultListId)) {
      return settings.defaultListId;
    }
    return pickDefaultListId(scope, lists);
  }, [lists, scope, settings.defaultListId]);
  const deletedViewActive =
    !recurringViewActive && scope.kind === "view" && scope.view === "deleted";
  const effectiveLayout = deletedViewActive ? "list" : layout;
  // R3：视图副标题按设计稿映射（今天=日期、计划=接下来 7 天、已完成=最近 30 天、回收站=保留 30 天）。
  // 原头部 ViewSummary 进度与分组头进度重复且挤压标题，撤掉后由 MainHeader 显示「N 项 · 布局」兜底。
  // D4 今日已完成段：从 allTasks 筛 completedAt 在今天的任务（不动 taskQuery/Rust 查询语义）。
  const completedTodayTasks = useMemo(
    () =>
      allTasks.filter((task) => {
        if (task.status !== "done" || !task.completedAt) return false;
        try {
          return (
            new Date(task.completedAt).toDateString() ===
            new Date().toDateString()
          );
        } catch {
          return false;
        }
      }),
    [allTasks],
  );
  /**
   * F1 · T-07 侧栏标签分组：从在用标签聚合 `{tag, count}`。
   * 只数未删除的任务，按「计数降序 → 名称升序」排，保证顺序稳定不跳动。
   */
  const sidebarTags = useMemo(() => {
    const counter = new Map<string, number>();
    for (const task of allTasks) {
      if (task.deletedAt) continue;
      for (const tag of task.tags) {
        counter.set(tag, (counter.get(tag) ?? 0) + 1);
      }
    }
    return [...counter.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [allTasks]);
  const scopeSubtitle = useMemo(() => {
    if (recurringViewActive || scope.kind !== "view") return null;
    if (scope.view === "today") {
      const now = new Date();
      return `${now.getMonth() + 1}月${now.getDate()}日 星期${"日一二三四五六"[now.getDay()]}`;
    }
    if (scope.view === "planned") return "接下来 7 天";
    if (scope.view === "completed") return "最近 30 天";
    if (scope.view === "deleted") return "保留 30 天";
    return null;
  }, [recurringViewActive, scope]);
  const contentKey = useMemo(
    () =>
      [
        recurringViewActive ? "recurring" : effectiveLayout,
        scope.kind,
        scope.kind === "view" ? scope.view : scope.listId,
        sortBy,
        showCompleted,
      ].join(":"),
    [effectiveLayout, recurringViewActive, scope, sortBy, showCompleted],
  );
  const openRecurringView = useCallback(() => {
    setRecurringViewActive(true);
    setMenuOpen(false);
    setMobileSidebarOpen(false);
    selectTask(null);
    clearBatchSelection();
    void loadRecurringRules();
  }, [
    clearBatchSelection,
    loadRecurringRules,
    selectTask,
    setMenuOpen,
    setMobileSidebarOpen,
  ]);

  const closeEverything = useCallback(() => {
    closeDialogs();
    setSavedViewDialogOpen(false);
    setRecurringViewActive(false);
    selectTask(null);
    clearBatchSelection();
  }, [closeDialogs, clearBatchSelection, selectTask, setRecurringViewActive]);

  // M1.5 移动端系统返回：按弹层栈从内到外逐层关闭，返回 false 表示无层可关
  // （此时 WebView 可自行后退/退出）。
  const closeTopLayer = useCallback((): boolean => {
    if (dialog.confirmState) {
      setConfirmState(null);
      return true;
    }
    if (dialog.settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (dialog.statsOpen) {
      setStatsOpen(false);
      return true;
    }
    if (dialog.batchEditOpen) {
      setBatchEditOpen(false);
      return true;
    }
    if (dialog.commandPaletteOpen) {
      setCommandPaletteOpen(false);
      return true;
    }
    if (dialog.shortcutsOpen) {
      setShortcutsOpen(false);
      return true;
    }
    if (dialog.createOpen) {
      setCreateOpen(false);
      return true;
    }
    if (dialog.listDialogOpen || dialog.editingList) {
      setListDialogOpen(false);
      dialog.setEditingList(null);
      return true;
    }
    if (dialog.recurringDialogOpen) {
      setRecurringDialogOpen(false);
      return true;
    }
    if (dialog.calendarEventDialogOpen) {
      setCalendarEventDialogOpen(false);
      return true;
    }
    if (savedViewDialogOpen) {
      setSavedViewDialogOpen(false);
      return true;
    }
    if (focusOpen) {
      setFocusOpen(false);
      return true;
    }
    if (recurringViewActive) {
      setRecurringViewActive(false);
      return true;
    }
    if (selectedTask) {
      selectTask(null);
      return true;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return true;
    }
    if (mobileSidebarOpen) {
      setMobileSidebarOpen(false);
      return true;
    }
    return false;
  }, [
    menuOpen,
    mobileSidebarOpen,
    recurringViewActive,
    savedViewDialogOpen,
    focusOpen,
    selectedTask,
    selectTask,
    setBatchEditOpen,
    setCalendarEventDialogOpen,
    setCommandPaletteOpen,
    setConfirmState,
    setCreateOpen,
    setListDialogOpen,
    setMenuOpen,
    setMobileSidebarOpen,
    setRecurringDialogOpen,
    setRecurringViewActive,
    setSavedViewDialogOpen,
    setSettingsOpen,
    setShortcutsOpen,
    setStatsOpen,
    dialog,
  ]);

  // M1.5：每当有弹层新打开，向历史栈推入一帧，让系统返回先走 popstate。
  const layerCount =
    (dialog.confirmState ? 1 : 0) +
    (dialog.settingsOpen ? 1 : 0) +
    (dialog.statsOpen ? 1 : 0) +
    (dialog.batchEditOpen ? 1 : 0) +
    (dialog.commandPaletteOpen ? 1 : 0) +
    (dialog.shortcutsOpen ? 1 : 0) +
    (dialog.createOpen ? 1 : 0) +
    (dialog.listDialogOpen || dialog.editingList ? 1 : 0) +
    (dialog.recurringDialogOpen ? 1 : 0) +
    (dialog.calendarEventDialogOpen ? 1 : 0) +
    (savedViewDialogOpen ? 1 : 0) +
    (focusOpen ? 1 : 0) +
    (recurringViewActive ? 1 : 0) +
    (selectedTask ? 1 : 0) +
    (menuOpen ? 1 : 0) +
    (mobileSidebarOpen ? 1 : 0);
  const prevLayerCount = useRef<number | null>(null);
  useEffect(() => {
    const previous = prevLayerCount.current;
    prevLayerCount.current = layerCount;
    if (previous === null || layerCount <= previous) return;
    window.history.pushState(null, "");
  }, [layerCount]);

  useEffect(() => {
    if (!mobile || !isTauri()) return;
    const onPopState = () => {
      void closeTopLayer();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeTopLayer, mobile]);

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, [setCommandPaletteOpen]);

  useAppInit(
    setSettings,
    setLists,
    setAppError,
    setAutoBackup,
    setSyncAutoEnabled,
    setSyncWifiOnly,
  );
  // 持久化恢复的 scope 可能指向已删除的清单，失效时回退到「全部任务」。
  useEffect(() => {
    if (scope.kind !== "list") return;
    if (lists.some((list) => list.id === scope.listId)) return;
    void setScope(viewScope("all"));
  }, [lists, scope, setScope]);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("recurring-tasks-generated", () => {
      void useTaskStore.getState().loadTasks();
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const nextUnlisteners = await Promise.all([
        // emit 广播全窗口含自身，按 source 自排除避免回环重载
        listen<{ source: string }>("tasks-changed", (event) => {
          if (event.payload.source === "main") return;
          void useTaskStore.getState().loadTasks();
        }),
        listen<{ taskId: string }>("widget-open-task", async (event) => {
          const store = useTaskStore.getState();
          await store.loadTasks();
          store.selectTask(event.payload.taskId);
        }),
      ]);
      if (cancelled) {
        nextUnlisteners.forEach((dispose) => dispose());
        return;
      }
      unlisteners.push(...nextUnlisteners);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((dispose) => dispose());
    };
  }, []);
  useEffect(() => {
    // 今天/逾期视图的派生依赖 new Date()，窗口重新可见时重算以修复跨午夜过期
    const rederive = () => useTaskStore.getState().rederive();
    document.addEventListener("visibilitychange", rederive);
    window.addEventListener("focus", rederive);
    return () => {
      document.removeEventListener("visibilitychange", rederive);
      window.removeEventListener("focus", rederive);
    };
  }, []);
  // 稳定引用：useTrayQuickAdd / useKeyboardShortcuts 依赖它，每次渲染新建会重复订阅 IPC
  const openTaskCreateDialog = useCallback(
    (scheduledDate = "") => {
      setCreateScheduledDate(scheduledDate);
      openCreateDialog();
    },
    [openCreateDialog],
  );
  const handleOpenShortcuts = useCallback(
    () => setShortcutsOpen(true),
    [setShortcutsOpen],
  );
  useTrayQuickAdd(openTaskCreateDialog, setAppError);
  useSyncLifecycle({
    setLists,
    setRecurringRules,
    setCalendarEvents,
    setAppError,
    autoSyncEnabled: syncAutoEnabled,
    wifiOnly: syncWifiOnly,
    onStatusChange: setSyncStatus,
  });
  const handleReminder = useCallback(
    (event: { taskId: string; title: string; dueAt: string | null }) => {
      pushToast(`提醒：${event.title}`, "info", [
        {
          label: "10 分钟",
          onClick: async () => {
            await useTaskStore
              .getState()
              .snoozeTask(event.taskId, offsetReminder(new Date(), 10));
            pushToast("已延后 10 分钟", "success");
          },
        },
        {
          label: "1 小时",
          onClick: async () => {
            await useTaskStore
              .getState()
              .snoozeTask(event.taskId, offsetReminder(new Date(), 60));
            pushToast("已延后 1 小时", "success");
          },
        },
        {
          label: "明天",
          onClick: async () => {
            await useTaskStore
              .getState()
              .snoozeTask(event.taskId, tomorrowReminder());
            pushToast("已延后到明天", "success");
          },
        },
        {
          label: "完成",
          onClick: async () => {
            await toggleTask(event.taskId, true);
            pushToast("任务已完成", "success");
          },
        },
        {
          label: "打开",
          onClick: () => selectTask(event.taskId),
        },
      ]);
    },
    [pushToast, selectTask, toggleTask],
  );
  // P0-02：系统通知由 Rust 后台统一发送并受 notificationsEnabled 门控，
  // 此处仅订阅事件做应用内提示与刷新。
  useTaskReminder(handleReminder);
  useKeyboardShortcuts({
    onOpenCreateDialog: openTaskCreateDialog,
    onOpenShortcuts: handleOpenShortcuts,
    onToggleBatchMode: toggleBatchMode,
    onOpenCommandPalette: openCommandPalette,
    onEscape: closeEverything,
  });

  useEffect(() => applyThemePreference(settings.theme), [settings.theme]);
  // T-09：强调色与主题同一帧应用，保证切换时无中间态
  useEffect(() => applyAccentPreference(settings.accent), [settings.accent]);

  useEffect(() => {
    // 移动端无桌面安装包更新机制，跳过启动静默检查
    if (isMobile()) return;
    let cancelled = false;
    // 启动后延迟 3s 再检查：让首屏渲染和任务加载先完成，检查失败也完全静默。
    const timer = window.setTimeout(() => {
      const KEY = "torder-update-notified";
      void checkForUpdate()
        .then((info) => {
          if (cancelled || !info.hasUpdate) return;
          if (localStorage.getItem(KEY) === info.latestVersion) return;
          localStorage.setItem(KEY, info.latestVersion);
          pushToast(`发现新版本 v${info.latestVersion}`, "info");
        })
        .catch(() => {
          // 启动静默检查失败不打扰用户，可到设置里手动检查。
        });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pushToast]);

  async function handleSaveList(data: {
    id?: string;
    name: string;
    color: string;
  }) {
    if (data.id) {
      await updateList({
        id: data.id,
        name: data.name,
        color: data.color,
        sortOrder: editingList?.sortOrder ?? 0,
      });
      pushToast("清单修改完成", "success");
    } else {
      await createList({
        name: data.name,
        color: data.color,
        // 显式传末尾位置，保证两种模式下新清单排序行为一致。
        sortOrder:
          lists.reduce((max, list) => Math.max(max, list.sortOrder), -1) + 1,
      });
      pushToast("自定义清单已创建", "success");
    }
    const nextLists = await listLists();
    setLists(nextLists);
    setListDialogOpen(false);
  }

  function requestDeleteList(listToDelete: TaskList) {
    if (listToDelete.isDefault) return;
    setConfirmState({
      title: "确认删除清单",
      body: `删除“${listToDelete.name}”？任务保留。`,
      confirmText: "删除清单",
      danger: true,
      onConfirm: async () => {
        await deleteList(listToDelete.id);
        const nextLists = await listLists();
        setLists(nextLists);
        if (scope.kind === "list" && scope.listId === listToDelete.id) {
          await setScope({ kind: "view", view: "all" });
        }
        setConfirmState(null);
        pushToast("清单已删除", "info");
      },
    });
  }

  async function handleSelectScope(nextScope: TaskScope) {
    setRecurringViewActive(false);
    setMenuOpen(false);
    setMobileSidebarOpen(false);
    selectTask(null);
    if (searchQuery.trim()) await setSearchQuery("");
    await setScope(nextScope);
  }

  // P1-05：已存视图动作已提取到 useSavedViewActions（含打开/保存/删除）。
  const savedViewActions = useSavedViewActions({
    settings,
    editingSavedView,
    setSettings,
    setSavedViewDialogOpen,
    setEditingSavedView,
    setConfirmState,
    pushToast,
    setRecurringViewActive,
    setMenuOpen,
    setMobileSidebarOpen,
  });
  const {
    handleOpenSavedView,
    openCreateSavedViewDialog,
    openEditSavedViewDialog,
    handleSaveSavedView,
    requestDeleteSavedView,
  } = savedViewActions;

  async function handleReorderTask(sourceId: string, targetId: string) {
    await reorderTasks(sourceId, targetId);
    pushToast("手动排序已更新", "success");
  }

  async function handleBoardMove(
    task: Task,
    columnId: "todo" | "doing" | "done",
  ) {
    if (columnId === "done") {
      await patchTask(task.id, { status: "done" });
    } else if (columnId === "doing") {
      await patchTask(task.id, { status: "todo", priority: 2 });
    } else {
      await patchTask(task.id, {
        status: "todo",
        priority: task.priority === 2 ? 1 : task.priority,
      });
    }
    pushToast("看板状态已更新", "success");
  }

  async function handleMoveTaskDate(taskId: string, dateKey: string) {
    const task =
      allTasks.find((item) => item.id === taskId) ??
      tasks.find((item) => item.id === taskId);
    if (!task) {
      pushToast("任务不存在", "error");
      return;
    }
    if (getTaskCalendarKey(task) === dateKey) return;

    try {
      await patchTask(taskId, {
        scheduledDate: dateKey,
        ...(task.dueAt ? { dueAt: mergeTaskDate(task.dueAt, dateKey) } : {}),
      });
      pushToast(task.dueAt ? "日期已调整" : "计划日期已安排", "success");
    } catch (error) {
      pushToast(`调整日期失败：${normalizeError(error)}`, "error");
    }
  }

  async function handleThemeToggle() {
    const nextTheme: ThemePreference =
      settings.theme === "dark" ? "light" : "dark";
    await saveAppSetting("theme", nextTheme);
    const applyNextTheme = () => {
      const dark = nextTheme === "dark";
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setSettings((current) => ({ ...current, theme: nextTheme }));
    };
    const startViewTransition = (document as ViewTransitionDocument)
      .startViewTransition;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (startViewTransition && !reduceMotion) {
      startViewTransition.call(document, () => {
        flushSync(applyNextTheme);
      });
      return;
    }

    applyNextTheme();
  }

  /**
   * F2 · T-01：命令面板命令表。首版覆盖动作、布局切换、视图/清单跳转与
   * 设置入口；任务搜索待 T-08 落地后并入。
   */
  const commandEntries = useMemo<CommandEntry[]>(
    () => [
      {
        id: "create-task",
        title: "新建事项",
        group: "动作",
        keywords: "新建 添加 create new",
        icon: Plus,
        run: () => openTaskCreateDialog(),
      },
      {
        id: "layout-list",
        title: "切换到列表视图",
        group: "布局",
        keywords: "列表 视图 list",
        icon: ListTodo,
        run: () => setLayout("list"),
      },
      {
        id: "layout-board",
        title: "切换到看板视图",
        group: "布局",
        keywords: "看板 视图 board kanban",
        icon: Kanban,
        run: () => setLayout("board"),
      },
      {
        id: "layout-calendar",
        title: "切换到日历视图",
        group: "布局",
        keywords: "日历 视图 calendar",
        icon: CalendarDays,
        run: () => setLayout("calendar"),
      },
      {
        id: "layout-month",
        title: "切换到月历视图",
        group: "布局",
        keywords: "月历 视图 month",
        icon: CalendarRange,
        run: () => setLayout("month"),
      },
      {
        id: "layout-week",
        title: "切换到周视图",
        group: "布局",
        keywords: "周 视图 week",
        icon: CalendarClock,
        run: () => setLayout("week"),
      },
      {
        id: "goto-all",
        title: "跳转到全部任务",
        group: "跳转",
        keywords: "全部 任务 all",
        icon: ListTodo,
        run: () => void setScope(viewScope("all")),
      },
      {
        id: "goto-today",
        title: "跳转到今日任务",
        group: "跳转",
        keywords: "今天 今日 today",
        icon: CalendarCheck,
        run: () => void setScope(viewScope("today")),
      },
      {
        id: "goto-completed",
        title: "跳转到已完成",
        group: "跳转",
        keywords: "已完成 completed",
        icon: CheckCircle2,
        run: () => void setScope(viewScope("completed")),
      },
      {
        id: "goto-trash",
        title: "跳转到回收站",
        group: "跳转",
        keywords: "回收站 删除 trash",
        icon: Trash2,
        run: () => void setScope(viewScope("deleted")),
      },
      ...lists.map((list) => ({
        id: `goto-list-${list.id}`,
        title: `打开清单「${list.name}」`,
        group: "清单",
        keywords: "清单 打开 跳转",
        icon: ListTodo,
        run: () => void setScope(listScope(list.id)),
      })),
      {
        id: "open-settings",
        title: "打开设置",
        group: "应用",
        keywords: "设置 preferences settings",
        icon: Settings,
        run: () => setSettingsOpen(true),
      },
      {
        id: "toggle-theme",
        title: "切换主题",
        group: "应用",
        keywords: "主题 深色 浅色 theme",
        icon: Palette,
        run: () => void handleThemeToggle(),
      },
      {
        id: "toggle-sidebar",
        title: "折叠 / 展开侧栏",
        group: "应用",
        keywords: "侧栏 折叠 sidebar",
        icon: PanelLeft,
        run: () => toggleSidebarCollapsed(),
      },
      {
        id: "open-shortcuts",
        title: "查看快捷键",
        group: "应用",
        keywords: "快捷键 键盘 shortcuts",
        icon: Keyboard,
        run: () => handleOpenShortcuts(),
      },
    ],
    // handleThemeToggle 为组件内普通函数，稳定性足以接受（命令面板仅在打开时消费）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lists,
      setLayout,
      setScope,
      openTaskCreateDialog,
      setSettingsOpen,
      handleOpenShortcuts,
    ],
  );

  async function handleCreateTask(
    input: CreateTaskInput,
    attachments: PendingTaskAttachment[],
  ) {
    const task = await addTask(input);
    if (attachments.length > 0) {
      const result = await attachPendingAttachments(task.id, attachments);
      if (result.created > 0) {
        pushToast(`已添加 ${result.created} 个附件`, "success");
      }
      if (result.failed > 0) {
        pushToast(`${result.failed} 个附件添加失败`, "error");
        setAppError(result.errors[0] ?? "附件添加失败");
      }
    }
    setCreateOpen(false);
    setCreateScheduledDate("");
    pushToast("任务已创建", "success");
  }

  /**
   * F1 · T-05/T-13 快速新建：不走弹窗、不带附件，建完只提示。
   * 失败要吞掉异常并提示，否则 composer 的 await 会抛到渲染层。
   */
  async function handleQuickCreate(input: CreateTaskInput) {
    try {
      await addTask(input);
      pushToast("事项已创建", "success");
    } catch (error) {
      pushToast(`创建失败：${normalizeError(error)}`, "error");
    }
  }

  // P1-05：循环任务动作已提取到 useRecurringActions（见下方调用点）。
  async function handleToggleTask(task: Task) {
    await toggleTask(task.id, task.status !== "done");
    pushToast(task.status === "done" ? "任务已恢复" : "任务已完成", "success", {
      label: "撤销",
      onClick: async () => {
        await toggleTask(task.id, task.status === "done");
        pushToast("已撤销", "info");
      },
    });
  }

  async function handleSaveTask(input: UpdateTaskInput) {
    await saveTask(input);
    pushToast("任务已更新", "success");
  }

  const {
    handleCreateRecurring,
    handleUpdateRecurring,
    openTaskRecurring,
    requestDeleteRecurring,
    handleToggleRecurring,
    handleSkipRecurring,
    handleGenerateRecurring,
  } = useRecurringActions({
    recurringRules,
    loadRecurringRules,
    selectTask,
    setCreateOpen,
    setRecurringDialogOpen,
    setEditingRecurringRule,
    setRecurringSourceTask,
    setCreateScheduledDate,
    setConfirmState,
    pushToast,
  });

  // P1-05：日历事件动作已提取到 useCalendarEventActions。
  const { handleSaveCalendarEvent, requestDeleteCalendarEvent } =
    useCalendarEventActions({
      setCalendarEvents,
      setCalendarEventDialogOpen,
      setConfirmState,
      pushToast,
    });

  // P1-05：任务/批量动作已提取到 useTaskActions。
  const {
    requestDeleteTask,
    handleRestoreTask,
    requestPermanentDeleteTask,
    requestEmptyTrash,
    requestBatchDelete,
    handleBatchComplete,
    handleBatchRestore,
    requestBatchPermanentDelete,
    handleBatchUpdate,
  } = useTaskActions({
    tasks,
    allTasks,
    batchSelectedIds,
    setConfirmState,
    pushToast,
  });

  async function handleSortChange(nextSort: typeof sortBy) {
    await setSortBy(nextSort);
    setMenuOpen(false);
  }

  async function handleSortAscToggle() {
    await setSortAsc(!sortAsc);
    pushToast(sortAsc ? "已改为降序" : "已改为升序", "success");
  }

  async function handleClearFilter() {
    await clearFilter();
    pushToast("已清除全部筛选条件", "success");
  }

  async function handleShowCompletedChange() {
    await setShowCompleted(!showCompleted);
    setMenuOpen(false);
  }

  const displayError = error ?? appError;

  return (
    <div
      className={[
        "window-frame",
        mobile ? "mobile" : "",
        mobileSidebarOpen ? "sidebar-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!mobile && <WindowTitleBar />}

      <div className="app-shell">
        {mobileSidebarOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            onClick={closeMobileSidebar}
            aria-label="关闭导航"
          />
        )}
        <Sidebar
          lists={lists}
          scope={scope}
          searchQuery={searchQuery}
          counts={counts}
          savedViews={settings.savedViews}
          activeSavedViewId={activeSavedViewId}
          tags={sidebarTags}
          activeTags={filter.tags}
          onTagToggle={(tag) => void toggleFilterTag(tag)}
          onClearTags={() => void clearFilterTags()}
          onSearchChange={(query) => void setSearchQuery(query)}
          onScopeChange={(nextScope) => void handleSelectScope(nextScope)}
          onSavedViewOpen={(view) => void handleOpenSavedView(view)}
          onSavedViewAdd={openCreateSavedViewDialog}
          onSavedViewEdit={openEditSavedViewDialog}
          onSavedViewDelete={requestDeleteSavedView}
          onAddList={openAddListDialog}
          onEditList={openEditListDialog}
          onDeleteList={requestDeleteList}
          recurringActive={recurringViewActive}
          recurringCount={recurringRules.length}
          onOpenRecurring={openRecurringView}
          onClose={closeMobileSidebar}
        />

        <main className="main">
          <MainHeader
            title={currentTitle}
            detailOpen={Boolean(selectedTask)}
            headerHidden={mobile && mobileHeaderHidden}
            meta={scopeSubtitle}
            taskCount={tasks.length}
            layout={effectiveLayout}
            theme={settings.theme}
            sortBy={sortBy}
            sortAsc={sortAsc}
            filter={filter}
            filterCount={filterCount}
            lists={lists}
            tags={availableTags}
            showCompleted={showCompleted}
            batchMode={batchMode}
            onOpenSidebar={openMobileSidebar}
            onOpenCreate={() => openTaskCreateDialog()}
            onLayoutChange={setLayout}
            onThemeToggle={() => void handleThemeToggle()}
            onOpenCommandPalette={openCommandPalette}
            onMenuToggle={() => setMenuOpen((open) => !open)}
            menuOpen={menuOpen}
            onSortChange={(nextSort) => void handleSortChange(nextSort)}
            onSortAscToggle={() => void handleSortAscToggle()}
            onToggleFilterList={(listId) => void toggleFilterList(listId)}
            onToggleFilterTag={(tag) => void toggleFilterTag(tag)}
            onToggleFilterPriority={(priority) =>
              void toggleFilterPriority(priority)
            }
            onToggleFilterCompleted={() => void toggleFilterCompleted()}
            onClearFilter={() => void handleClearFilter()}
            onShowCompletedChange={() => void handleShowCompletedChange()}
            onOpenSettings={openSettingsDialog}
            onOpenStats={openStatsDialog}
            onOpenFocus={() => setFocusOpen(true)}
            onToggleBatchMode={toggleBatchMode}
            syncStatus={syncStatus}
            showLayoutControls={!recurringViewActive && !deletedViewActive}
          />

          {displayError && (
            <div className="alert-banner" role="alert">
              <AlertCircle aria-hidden="true" className="icon-sm" />
              <span>{displayError}</span>
              <button
                type="button"
                onClick={() => {
                  clearError();
                  setAppError(null);
                }}
                aria-label="关闭错误"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          <section className="content-panel" aria-label={`${currentTitle}任务`}>
            <div
              key={contentKey}
              className={`content-motion content-motion-${effectiveLayout}`}
            >
              {recurringViewActive ? (
                <RecurringRulesView
                  rules={recurringRules}
                  lists={lists}
                  loading={recurringLoading}
                  onCreate={openNewRecurringDialog}
                  onEdit={(rule) => {
                    setEditingRecurringRule(rule);
                    setRecurringSourceTask(null);
                    setRecurringDialogOpen(true);
                  }}
                  onToggle={(rule) => void handleToggleRecurring(rule)}
                  onSkip={(rule) => void handleSkipRecurring(rule)}
                  onGenerate={(rule) => void handleGenerateRecurring(rule)}
                  onDelete={requestDeleteRecurring}
                />
              ) : effectiveLayout === "list" ? (
                <TaskListView
                  tasks={tasks}
                  completedToday={completedTodayTasks}
                  lists={lists}
                  loading={loading}
                  selectedTaskId={selectedTaskId}
                  batchMode={batchMode}
                  batchSelectedIds={batchSelectedIds}
                  searchQuery={searchQuery}
                  scope={scope}
                  defaultListId={defaultListId}
                  trashRetentionDays={settings.trashRetentionDays}
                  attachmentCounts={attachmentCounts}
                  parseNaturalLanguage={settings.quickAddNaturalLanguage}
                  moveCompletedImmediately={settings.moveCompletedImmediately}
                  onOpenCreateDialog={() => openTaskCreateDialog()}
                  onQuickCreate={handleQuickCreate}
                  onOpen={(task) => selectTask(task.id)}
                  onToggle={(task) => void handleToggleTask(task)}
                  onDelete={requestDeleteTask}
                  onRestore={(task) => void handleRestoreTask(task)}
                  onPermanentDelete={requestPermanentDeleteTask}
                  onToggleBatchSelected={toggleBatchSelected}
                  onBatchComplete={() => void handleBatchComplete()}
                  onBatchDelete={requestBatchDelete}
                  onBatchRestore={() => void handleBatchRestore()}
                  onBatchPermanentDelete={requestBatchPermanentDelete}
                  onBatchEdit={() => setBatchEditOpen(true)}
                  onExitBatch={clearBatchSelection}
                  onEmptyTrash={requestEmptyTrash}
                  onReorder={(sourceId, targetId) =>
                    void handleReorderTask(sourceId, targetId)
                  }
                />
              ) : effectiveLayout === "board" ? (
                <TaskBoard
                  tasks={tasks}
                  lists={lists}
                  searchQuery={searchQuery}
                  selectedTaskId={selectedTaskId}
                  defaultListId={defaultListId}
                  onQuickCreate={handleQuickCreate}
                  onOpen={(task) => selectTask(task.id)}
                  onToggle={(task) => void handleToggleTask(task)}
                  onMove={(task, columnId) =>
                    void handleBoardMove(task, columnId)
                  }
                />
              ) : effectiveLayout === "month" ? (
                <MonthCalendar
                  tasks={tasks}
                  lists={lists}
                  events={calendarEvents}
                  showCompleted={showCompleted}
                  onOpenTask={(task) => selectTask(task.id)}
                  onCreateTask={(date) => openTaskCreateDialog(date)}
                  onCreateEvent={openNewCalendarEvent}
                  onEditEvent={openEditCalendarEvent}
                  onMoveTaskDate={handleMoveTaskDate}
                />
              ) : effectiveLayout === "week" ? (
                <WeekCalendar
                  tasks={tasks}
                  events={calendarEvents}
                  showCompleted={showCompleted}
                  onOpenTask={(task) => selectTask(task.id)}
                  onCreateTask={(date) => openTaskCreateDialog(date)}
                  onCreateEvent={openNewCalendarEvent}
                  onEditEvent={openEditCalendarEvent}
                  onMoveTaskDate={handleMoveTaskDate}
                />
              ) : (
                <TaskCalendar
                  tasks={tasks}
                  lists={lists}
                  searchQuery={searchQuery}
                  selectedTaskId={selectedTaskId}
                  onOpen={(task) => selectTask(task.id)}
                  onToggle={(task) => void handleToggleTask(task)}
                  onDelete={requestDeleteTask}
                />
              )}
            </div>
          </section>
          {!createPresence.rendered &&
            !selectedTask &&
            !batchMode &&
            !recurringViewActive &&
            !deletedViewActive &&
            !mobile && (
              <button
                type="button"
                className="mobile-create-fab"
                onClick={() => {
                  // M1.4 触感：新建入口 tap（desktop no-op）
                  navigator.vibrate?.(8);
                  openTaskCreateDialog();
                }}
                aria-label="新建任务"
                title="新建任务"
              >
                <Plus aria-hidden="true" />
              </button>
            )}
        </main>

        {/* M3.1 移动端底部导航（含中央新建 FAB）；横屏/桌面不渲染 */}
        {mobile && (
          <BottomNav
            layout={effectiveLayout}
            onLayoutChange={(next) => setLayout(next)}
            onCreate={() => {
              navigator.vibrate?.(8);
              openTaskCreateDialog();
            }}
            onOpenSettings={openSettingsDialog}
          />
        )}

        {/* R6：详情抽屉为 app-shell 第三列（非模态，挤压列表；≤1080 转覆盖） */}
        <TaskDetailPanel
          task={selectedTask}
          lists={lists}
          busy={loading}
          onClose={() => selectTask(null)}
          onSave={handleSaveTask}
          onToggle={(task) => void handleToggleTask(task)}
          onDelete={requestDeleteTask}
          onOpenRecurring={openTaskRecurring}
          onOpenTask={selectTask}
          onToast={pushToast}
        />
      </div>

      {createPresence.rendered && (
        <TaskCreateDialog
          lists={lists}
          defaultListId={defaultListId}
          defaultScheduledDate={createScheduledDate}
          defaultReminderMinutes={settings.defaultReminderMinutes}
          defaultPriority={settings.defaultPriority}
          defaultDueDate={settings.defaultDueDate}
          presence={createPresence.phase}
          onClose={() => {
            setCreateOpen(false);
            setCreateScheduledDate("");
          }}
          onSubmit={handleCreateTask}
          onSubmitRecurring={handleCreateRecurring}
          onToast={pushToast}
        />
      )}

      {/* F2 · T-01：命令面板（Ctrl K / 工具栏图标） */}
      {commandPalettePresence.rendered && (
        <CommandPalette
          commands={commandEntries}
          presence={commandPalettePresence.phase}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {recurringDialogPresence.rendered && (
        <RecurringRuleDialog
          rule={editingRecurringRule}
          sourceTask={recurringSourceTask}
          lists={lists}
          defaultListId={defaultListId}
          presence={recurringDialogPresence.phase}
          onClose={() => setRecurringDialogOpen(false)}
          onCreate={handleCreateRecurring}
          onUpdate={handleUpdateRecurring}
        />
      )}

      {calendarEventDialogPresence.rendered && (
        <CalendarEventDialog
          event={editingCalendarEvent}
          defaultDate={eventDialogDefaultDate}
          presence={calendarEventDialogPresence.phase}
          onClose={() => setCalendarEventDialogOpen(false)}
          onSubmit={(data) => void handleSaveCalendarEvent(data)}
          onDelete={requestDeleteCalendarEvent}
        />
      )}

      {listDialogPresence.rendered && (
        <ListDialog
          initialList={editingList}
          presence={listDialogPresence.phase}
          onClose={() => setListDialogOpen(false)}
          onSubmit={handleSaveList}
        />
      )}

      {/* 移动端无物理键盘入口，不渲染快捷键说明弹窗 */}
      {!isMobile() && shortcutsPresence.rendered && (
        <ShortcutsDialog
          presence={shortcutsPresence.phase}
          onClose={() => setShortcutsOpen(false)}
        />
      )}

      {settingsPresence.rendered && (
        <SettingsDialog
          autoBackup={autoBackup}
          settings={settings}
          lists={lists}
          syncAutoEnabled={syncAutoEnabled}
          syncWifiOnly={syncWifiOnly}
          externalSyncStatus={syncStatus}
          presence={settingsPresence.phase}
          onClose={() => setSettingsOpen(false)}
          onAutoBackupChange={setAutoBackup}
          onSettingsChange={setSettings}
          onSyncAutoEnabledChange={setSyncAutoEnabled}
          onSyncWifiOnlyChange={setSyncWifiOnly}
          onSyncStatusChange={setSyncStatus}
          onToast={pushToast}
          onImportComplete={async () => {
            setLists(await listLists());
            await Promise.all([
              loadRecurringRules(),
              useTaskStore.getState().loadTasks(),
            ]);
          }}
        />
      )}

      {statsPresence.rendered && (
        <StatsDialog
          tasks={allTasks}
          lists={lists}
          recurringRules={recurringRules}
          presence={statsPresence.phase}
          onClose={() => setStatsOpen(false)}
        />
      )}

      {focusPresence.rendered && (
        <FocusDialog
          tasks={allTasks}
          presence={focusPresence.phase}
          onClose={() => setFocusOpen(false)}
          onFinished={handleFocusFinished}
        />
      )}

      {savedViewPresence.rendered && (
        <SavedViewDialog
          view={editingSavedView}
          lists={lists}
          currentState={{
            scope,
            query: searchQuery,
            sortBy,
            showCompleted,
            layout,
          }}
          presence={savedViewPresence.phase}
          onClose={() => setSavedViewDialogOpen(false)}
          onSubmit={handleSaveSavedView}
        />
      )}

      {batchEditPresence.rendered && (
        <BatchEditDialog
          lists={lists}
          count={batchSelectedIds.length}
          presence={batchEditPresence.phase}
          onClose={() => setBatchEditOpen(false)}
          onSubmit={(patch) => void handleBatchUpdate(patch)}
        />
      )}

      <ConfirmDialog
        state={confirmPresence.value as ConfirmState | null}
        presence={confirmPresence.phase}
        onClose={() => setConfirmState(null)}
      />

      <ToastHost toasts={toasts} />
    </div>
  );
}

function sameScope(left: TaskScope, right: TaskScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "view" && right.kind === "view") {
    return left.view === right.view;
  }
  if (left.kind === "list" && right.kind === "list") {
    return left.listId === right.listId;
  }
  return false;
}

function mergeTaskDate(dueAt: string, dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(dueAt);
  date.setFullYear(year, month - 1, day);
  return date.toISOString();
}

function offsetReminder(anchor: Date, minutes: number): string {
  return new Date(anchor.getTime() + minutes * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function tomorrowReminder(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export default App;
