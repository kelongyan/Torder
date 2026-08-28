import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { AlertCircle, Plus, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { applyThemePreference } from "../utils/theme";
import { saveAppSetting } from "../services/settingsService";
import { checkForUpdate } from "../services/appService";
import { useTaskStore, viewScope } from "../stores/taskStore";
import type {
  CreateTaskInput,
  CreateRecurringRuleInput,
  RecurringRule,
  Task,
  TaskList,
  TaskScope,
  UpdateTaskInput,
  UpdateRecurringRuleInput,
} from "../types/database";
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
import { isMobile } from "../utils/platform";
import {
  createRecurringRule,
  deleteRecurringRule,
  generateNextRecurringOccurrence,
  setRecurringRuleEnabled,
  skipNextRecurringOccurrence,
  updateRecurringRule,
} from "../services/recurringService";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "../services/calendarEventService";
import { MonthCalendar } from "../components/task/MonthCalendar";
import { WeekCalendar } from "../components/task/WeekCalendar";
import { CalendarEventDialog } from "../components/dialog/CalendarEventDialog";
import type { CalendarEvent } from "../types/database";
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
  const mobile = isMobile();

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
    showCompleted,
    allTasks,
    tasks,
    selectedTaskId,
    batchMode,
    batchSelectedIds,
    loading,
    error,
    setScope,
    setLayout,
    setSearchQuery,
    setSortBy,
    setShowCompleted,
    applyViewState,
    addTask,
    saveTask,
    toggleTask,
    removeTask,
    restoreTask,
    permanentDeleteTask,
    emptyTrash,
    batchComplete,
    batchDelete,
    batchRestore,
    batchPermanentDelete,
    batchUpdate,
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
  useTaskReminder(handleReminder);
  useKeyboardShortcuts({
    onOpenCreateDialog: openTaskCreateDialog,
    onOpenShortcuts: handleOpenShortcuts,
    onToggleBatchMode: toggleBatchMode,
    onEscape: closeEverything,
  });

  useEffect(() => applyThemePreference(settings.theme), [settings.theme]);

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

  async function handleOpenSavedView(view: SavedTaskView) {
    setRecurringViewActive(false);
    setMenuOpen(false);
    setMobileSidebarOpen(false);
    selectTask(null);
    await applyViewState({
      scope: view.scope,
      searchQuery: view.query,
      sortBy: view.sortBy,
      showCompleted: view.showCompleted,
      layout: view.layout,
    });
  }

  function openCreateSavedViewDialog() {
    setEditingSavedView(null);
    setSavedViewDialogOpen(true);
  }

  function openEditSavedViewDialog(view: SavedTaskView) {
    setEditingSavedView(view);
    setSavedViewDialogOpen(true);
  }

  async function handleSaveSavedView(view: SavedTaskView) {
    const nextViews = editingSavedView
      ? settings.savedViews.map((item) => (item.id === view.id ? view : item))
      : [...settings.savedViews, view];
    await saveAppSetting("savedViews", nextViews);
    setSettings((current) => ({ ...current, savedViews: nextViews }));
    setSavedViewDialogOpen(false);
    pushToast(
      editingSavedView ? "保存视图已更新" : "筛选视图已保存",
      "success",
    );
  }

  function requestDeleteSavedView(view: SavedTaskView) {
    setConfirmState({
      title: "删除保存视图",
      body: `删除“${view.name}”？不会删除任何任务。`,
      confirmText: "删除视图",
      danger: true,
      onConfirm: async () => {
        const nextViews = settings.savedViews.filter(
          (item) => item.id !== view.id,
        );
        await saveAppSetting("savedViews", nextViews);
        setSettings((current) => ({ ...current, savedViews: nextViews }));
        setConfirmState(null);
        pushToast("保存视图已删除", "info");
      },
    });
  }

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

  async function handleCreateRecurring(input: CreateRecurringRuleInput) {
    await createRecurringRule(input);
    await Promise.all([
      loadRecurringRules(),
      useTaskStore.getState().loadTasks(),
    ]);
    setCreateOpen(false);
    setRecurringDialogOpen(false);
    setCreateScheduledDate("");
    pushToast("循环任务已创建", "success");
  }

  async function handleUpdateRecurring(input: UpdateRecurringRuleInput) {
    await updateRecurringRule(input);
    await Promise.all([
      loadRecurringRules(),
      useTaskStore.getState().loadTasks(),
    ]);
    setRecurringDialogOpen(false);
    pushToast("循环规则已更新", "success");
  }

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

  function openTaskRecurring(task: Task) {
    selectTask(null);
    setRecurringSourceTask(task.recurringRuleId ? null : task);
    setEditingRecurringRule(
      task.recurringRuleId
        ? (recurringRules.find((rule) => rule.id === task.recurringRuleId) ??
            null)
        : null,
    );
    setRecurringDialogOpen(true);
  }

  function requestDeleteRecurring(rule: RecurringRule) {
    setConfirmState({
      title: "删除循环规则",
      body: `删除“${rule.title}”。已生成任务保留。`,
      confirmText: "仅删除规则",
      secondaryText: "删除未来实例",
      danger: true,
      onConfirm: async () => {
        await deleteRecurringRule(rule.id, false);
        await loadRecurringRules();
        setConfirmState(null);
        pushToast("循环规则已删除", "info");
      },
      onSecondary: async () => {
        await deleteRecurringRule(rule.id, true);
        await Promise.all([
          loadRecurringRules(),
          useTaskStore.getState().loadTasks(),
        ]);
        setConfirmState(null);
        pushToast("规则和未来实例已删除", "info");
      },
    });
  }

  async function handleToggleRecurring(rule: RecurringRule) {
    await setRecurringRuleEnabled(rule.id, !rule.enabled);
    await loadRecurringRules();
    pushToast(rule.enabled ? "循环任务已暂停" : "循环任务已恢复", "info");
  }

  async function handleSkipRecurring(rule: RecurringRule) {
    await skipNextRecurringOccurrence(rule.id);
    await loadRecurringRules();
    pushToast("下一次循环已跳过", "info");
  }

  async function handleGenerateRecurring(rule: RecurringRule) {
    await generateNextRecurringOccurrence(rule.id);
    await Promise.all([
      loadRecurringRules(),
      useTaskStore.getState().loadTasks(),
    ]);
    pushToast("下一次任务已生成", "success");
  }

  async function handleSaveCalendarEvent(data: {
    id?: string;
    title: string;
    eventType: CalendarEvent["eventType"];
    startDate: string;
    endDate: string;
    note: string | null;
  }) {
    if (data.id) {
      await updateCalendarEvent({ ...data, id: data.id });
      pushToast("日程事件已更新", "success");
    } else {
      await createCalendarEvent(data);
      pushToast("日程事件已创建", "success");
    }
    setCalendarEvents(await listCalendarEvents());
    setCalendarEventDialogOpen(false);
  }

  function requestDeleteCalendarEvent(event: CalendarEvent) {
    setCalendarEventDialogOpen(false);
    setConfirmState({
      title: "确认删除日程事件",
      body: `删除“${event.title}”？不可撤销。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await deleteCalendarEvent(event.id);
        setCalendarEvents(await listCalendarEvents());
        setConfirmState(null);
        pushToast("日程事件已删除", "info");
      },
    });
  }

  function requestDeleteTask(task: Task) {
    setConfirmState({
      title: "确认删除任务",
      body: `删除“${task.title}”？可恢复。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await removeTask(task.id);
        setConfirmState(null);
        pushToast("任务已移入回收站", "info", {
          label: "撤销",
          onClick: async () => {
            await restoreTask(task.id);
            pushToast("已撤销删除", "success");
          },
        });
      },
    });
  }

  async function handleRestoreTask(task: Task) {
    await restoreTask(task.id);
    pushToast(`已恢复"${task.title}"`, "success", {
      label: "撤销",
      onClick: async () => {
        await removeTask(task.id);
        pushToast("已撤销恢复", "info");
      },
    });
  }

  function requestPermanentDeleteTask(task: Task) {
    setConfirmState({
      title: "永久删除任务",
      body: `永久删除“${task.title}”？此操作不可撤销。`,
      confirmText: "永久删除",
      danger: true,
      onConfirm: async () => {
        await permanentDeleteTask(task.id);
        setConfirmState(null);
        pushToast("任务已永久删除", "info");
      },
    });
  }

  function requestEmptyTrash() {
    if (tasks.length === 0) return;
    setConfirmState({
      title: "清空回收站",
      body: `永久删除回收站内 ${tasks.length} 项任务？此操作不可撤销。`,
      confirmText: "清空回收站",
      danger: true,
      onConfirm: async () => {
        const count = await emptyTrash();
        setConfirmState(null);
        pushToast(`已清空 ${count} 项任务`, "info");
      },
    });
  }

  function requestBatchDelete() {
    if (batchSelectedIds.length === 0) return;
    const selectedIds = [...batchSelectedIds];
    setConfirmState({
      title: "确认批量删除",
      body: `删除已选 ${batchSelectedIds.length} 项？可从回收站恢复。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await batchDelete();
        setConfirmState(null);
        pushToast("已删除选中任务", "info", {
          label: "撤销",
          onClick: async () => {
            for (const id of selectedIds) {
              await useTaskStore.getState().restoreTask(id);
            }
            pushToast("已撤销批量删除", "success");
          },
        });
      },
    });
  }

  async function handleBatchComplete() {
    if (batchSelectedIds.length === 0) return;
    const selectedIds = [...batchSelectedIds];
    const lookup = new Map(
      [...allTasks, ...tasks].map((task) => [task.id, task] as const),
    );
    const restoreTodoIds = selectedIds.filter(
      (id) => lookup.get(id)?.status !== "done",
    );
    await batchComplete();
    pushToast("已完成选中任务", "success", {
      label: "撤销",
      onClick: async () => {
        for (const id of restoreTodoIds) {
          await useTaskStore.getState().toggleTask(id, false);
        }
        pushToast("已撤销批量完成", "info");
      },
    });
  }

  async function handleBatchRestore() {
    if (batchSelectedIds.length === 0) return;
    const selectedIds = [...batchSelectedIds];
    await batchRestore();
    pushToast("已恢复选中任务", "success", {
      label: "撤销",
      onClick: async () => {
        for (const id of selectedIds) {
          await useTaskStore.getState().removeTask(id);
        }
        pushToast("已撤销批量恢复", "info");
      },
    });
  }

  function requestBatchPermanentDelete() {
    if (batchSelectedIds.length === 0) return;
    setConfirmState({
      title: "永久删除选中任务",
      body: `永久删除已选 ${batchSelectedIds.length} 项？此操作不可撤销。`,
      confirmText: "永久删除",
      danger: true,
      onConfirm: async () => {
        await batchPermanentDelete();
        setConfirmState(null);
        pushToast("已永久删除选中任务", "info");
      },
    });
  }

  async function handleBatchUpdate(patch: Parameters<typeof batchUpdate>[0]) {
    await batchUpdate(patch);
    pushToast("已更新选中任务", "success");
  }

  async function handleSortChange(nextSort: typeof sortBy) {
    await setSortBy(nextSort);
    setMenuOpen(false);
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
            meta={recurringViewActive ? null : undefined}
            taskCount={tasks.length}
            layout={effectiveLayout}
            theme={settings.theme}
            sortBy={sortBy}
            showCompleted={showCompleted}
            onOpenSidebar={openMobileSidebar}
            onOpenCreate={() => openTaskCreateDialog()}
            onLayoutChange={setLayout}
            onThemeToggle={() => void handleThemeToggle()}
            onMenuToggle={() => setMenuOpen((open) => !open)}
            menuOpen={menuOpen}
            onSortChange={(nextSort) => void handleSortChange(nextSort)}
            onShowCompletedChange={() => void handleShowCompletedChange()}
            onOpenSettings={openSettingsDialog}
            onOpenStats={openStatsDialog}
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
                  lists={lists}
                  loading={loading}
                  selectedTaskId={selectedTaskId}
                  batchMode={batchMode}
                  batchSelectedIds={batchSelectedIds}
                  searchQuery={searchQuery}
                  scope={scope}
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
                  onOpen={(task) => selectTask(task.id)}
                  onToggle={(task) => void handleToggleTask(task)}
                  onMove={(task, columnId) =>
                    void handleBoardMove(task, columnId)
                  }
                />
              ) : effectiveLayout === "month" ? (
                <MonthCalendar
                  tasks={tasks}
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
            !deletedViewActive && (
              <button
                type="button"
                className="mobile-create-fab"
                onClick={() => openTaskCreateDialog()}
                aria-label="新建任务"
                title="新建任务"
              >
                <Plus aria-hidden="true" />
              </button>
            )}
        </main>
      </div>

      {createPresence.rendered && (
        <TaskCreateDialog
          lists={lists}
          defaultListId={defaultListId}
          defaultScheduledDate={createScheduledDate}
          defaultReminderMinutes={settings.defaultReminderMinutes}
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
