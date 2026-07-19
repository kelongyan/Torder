import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ListTodo, RefreshCw, X } from "lucide-react";
import { endOfTodayIso } from "./taskDates";
import { applyThemePreference } from "./theme";
import { taskViewCopy } from "./taskViews";
import { AppSidebar } from "../components/layout/AppSidebar";
import { ReminderToast } from "../components/reminder/ReminderToast";
import { SettingsPage } from "../components/settings/SettingsPage";
import { TagManagerDialog } from "../components/task/TagManagerDialog";
import { TaskDetailDrawer } from "../components/task/TaskDetailDrawer";
import { TaskListView } from "../components/task/TaskList";
import {
  TaskToolbar,
  type TaskToolbarHandle,
  type TaskToolbarPanel,
} from "../components/task/TaskToolbar";
import { getAppInfo, getDatabaseStatus } from "../services/appService";
import { listLists } from "../services/listService";
import {
  listDueReminders,
  listenForNotificationActions,
  markTaskReminded,
  sendTaskNotification,
  snoozeTaskReminder,
} from "../services/reminderService";
import {
  loadAppSettings,
  saveAppSetting,
  synchronizeLaunchAtStartup,
} from "../services/settingsService";
import { listTags } from "../services/tagService";
import { useTaskStore } from "../stores/taskStore";
import type {
  DatabaseStatus,
  Tag,
  Task,
  TaskList,
  TaskView,
  UpdateTaskInput,
} from "../types/database";
import {
  defaultAppSettings,
  type AppInfo,
  type AppSettings,
} from "../types/settings";

function App() {
  const toolbarRef = useRef<TaskToolbarHandle>(null);
  const initializedRef = useRef(false);
  const reminderScanRunningRef = useRef(false);
  const reminderTaskIdsRef = useRef(new Set<string>());
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [toolbarPanel, setToolbarPanel] = useState<TaskToolbarPanel>(null);
  const [activeSection, setActiveSection] = useState<"tasks" | "settings">(
    "tasks",
  );
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(
    null,
  );
  const [appError, setAppError] = useState<string | null>(null);
  const [reminderQueue, setReminderQueue] = useState<Task[]>([]);
  const {
    view,
    filters,
    tasks,
    selectedTaskId,
    loading,
    error,
    setView,
    setFilters,
    clearFilters,
    loadTasks,
    addTask,
    saveTask,
    toggleTask,
    removeTask,
    selectTask,
    clearError,
  } = useTaskStore();

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const copy = taskViewCopy[view];
  const hasActiveFilters = Boolean(
    filters.query.trim() ||
    filters.dateFilter ||
    filters.priorities.length ||
    filters.listIds.length ||
    filters.tagIds.length,
  );
  const structuredFilterCount = [
    Boolean(filters.dateFilter),
    filters.priorities.length > 0,
    filters.listIds.length > 0,
    filters.tagIds.length > 0,
  ].filter(Boolean).length;

  const focusQuickAdd = useCallback(
    async (forceToday = false) => {
      setActiveSection("tasks");
      const currentView = useTaskStore.getState().view;
      if (forceToday || (currentView !== "today" && currentView !== "all")) {
        await setView("today");
      }
      window.setTimeout(() => toolbarRef.current?.focusQuickAdd(), 0);
    },
    [setView],
  );

  const focusSearch = useCallback(() => {
    setActiveSection("tasks");
    window.setTimeout(() => toolbarRef.current?.focusSearch(), 0);
  }, []);

  const toggleQuickAddFromNavigation = useCallback(() => {
    if (toolbarPanel === "add") {
      toolbarRef.current?.toggleQuickAdd();
      return;
    }
    void focusQuickAdd(false);
  }, [focusQuickAdd, toolbarPanel]);

  const toggleSearchFromNavigation = useCallback(() => {
    if (toolbarPanel === "search") {
      toolbarRef.current?.toggleSearch();
      return;
    }
    focusSearch();
  }, [focusSearch, toolbarPanel]);

  const toggleFiltersFromNavigation = useCallback(() => {
    setActiveSection("tasks");
    window.setTimeout(() => toolbarRef.current?.toggleFilters(), 0);
  }, []);

  const openSettings = useCallback(() => {
    selectTask(null);
    setTagManagerOpen(false);
    toolbarRef.current?.close();
    setToolbarPanel(null);
    setActiveSection("settings");
    void getDatabaseStatus()
      .then(setDatabaseStatus)
      .catch((nextError: unknown) => setAppError(normalizeError(nextError)));
  }, [selectTask]);

  const openTaskFromReminder = useCallback(
    async (taskId: string) => {
      if (isTauri()) {
        const window = getCurrentWindow();
        await window.show();
        await window.unminimize();
        await window.setFocus();
      }
      setActiveSection("tasks");
      setTagManagerOpen(false);
      await clearFilters();
      await setView("all");
      const exists = useTaskStore
        .getState()
        .tasks.some((task) => task.id === taskId);
      if (exists) {
        selectTask(taskId);
      } else {
        setAppError("提醒对应的任务已不存在或无法打开");
      }
    },
    [clearFilters, selectTask, setView],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void Promise.all([
      loadAppSettings(),
      listLists(),
      listTags(),
      getAppInfo(),
      getDatabaseStatus(),
    ])
      .then(
        async ([
          nextSettings,
          nextLists,
          nextTags,
          nextAppInfo,
          nextDatabaseStatus,
        ]) => {
          setSettings(nextSettings);
          setLists(nextLists);
          setTags(nextTags);
          setAppInfo(nextAppInfo);
          setDatabaseStatus(nextDatabaseStatus);
          await setView(nextSettings.defaultView);
        },
      )
      .catch((nextError: unknown) => {
        setAppError(normalizeError(nextError));
      });
  }, [setView]);

  useEffect(() => applyThemePreference(settings.theme), [settings.theme]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;

      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        void focusQuickAdd(false);
      } else if (key === "f") {
        event.preventDefault();
        focusSearch();
      } else if (key === "," || event.code === "Comma") {
        event.preventDefault();
        openSettings();
      }
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [focusQuickAdd, focusSearch, openSettings]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      setReminderQueue((current) => {
        const [task, ...rest] = current;
        if (task) reminderTaskIdsRef.current.delete(task.id);
        return rest;
      });
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen("tray-quick-add", () => {
      void focusQuickAdd(true);
    })
      .then((nextUnlisten) => {
        if (cancelled) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setAppError(normalizeError(nextError));
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [focusQuickAdd]);

  useEffect(() => {
    let cancelled = false;
    let stopListening: (() => void) | undefined;

    void listenForNotificationActions((taskId) => {
      void openTaskFromReminder(taskId);
    })
      .then((nextStopListening) => {
        if (cancelled) nextStopListening();
        else stopListening = nextStopListening;
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setAppError(normalizeError(nextError));
      });

    return () => {
      cancelled = true;
      stopListening?.();
    };
  }, [openTaskFromReminder]);

  useEffect(() => {
    let cancelled = false;

    async function scanReminders() {
      if (cancelled || reminderScanRunningRef.current) return;
      reminderScanRunningRef.current = true;
      try {
        const dueReminders = await listDueReminders();
        for (const task of dueReminders) {
          if (cancelled) return;
          if (reminderTaskIdsRef.current.has(task.id)) continue;

          reminderTaskIdsRef.current.add(task.id);
          try {
            await sendTaskNotification(task);
            await markTaskReminded(task.id);
            if (!cancelled) {
              setReminderQueue((current) =>
                current.some((item) => item.id === task.id)
                  ? current
                  : [...current, task],
              );
            }
          } catch (nextError) {
            reminderTaskIdsRef.current.delete(task.id);
            throw nextError;
          }
        }
      } catch (nextError) {
        if (!cancelled) setAppError(normalizeError(nextError));
      } finally {
        reminderScanRunningRef.current = false;
      }
    }

    const initialTimer = window.setTimeout(() => void scanReminders(), 400);
    const interval = window.setInterval(() => void scanReminders(), 30_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  async function handleSelectView(nextView: TaskView) {
    toolbarRef.current?.close();
    setToolbarPanel(null);
    setActiveSection("tasks");
    await setView(nextView);
  }

  async function handleSettingChange(
    key: keyof AppSettings,
    value: AppSettings[keyof AppSettings],
  ) {
    await saveAppSetting(key, value);
    setSettings((current) => ({ ...current, [key]: value }) as AppSettings);
  }

  async function handleRestoreComplete() {
    const [nextSettings, nextLists, nextTags, nextDatabaseStatus] =
      await Promise.all([
        loadAppSettings(),
        listLists(),
        listTags(),
        getDatabaseStatus(),
      ]);
    try {
      await synchronizeLaunchAtStartup(nextSettings.launchAtStartup);
    } catch (nextError) {
      setAppError(
        `数据已恢复，但开机启动同步失败：${normalizeError(nextError)}`,
      );
    }
    setSettings(nextSettings);
    setLists(nextLists);
    setTags(nextTags);
    setDatabaseStatus(nextDatabaseStatus);
    selectTask(null);
    await clearFilters();
    await setView(nextSettings.defaultView);
  }

  async function handleCreate(title: string) {
    const dueAt = view === "today" ? endOfTodayIso() : null;
    const remindAt =
      dueAt && settings.defaultReminderMinutes !== null
        ? new Date(
            new Date(dueAt).getTime() -
              settings.defaultReminderMinutes * 60_000,
          ).toISOString()
        : null;
    await addTask({
      title,
      listId: "inbox",
      dueAt,
      remindAt,
    });
  }

  async function handleOpenReminder(task: Task) {
    await openTaskFromReminder(task.id);
    reminderTaskIdsRef.current.delete(task.id);
    setReminderQueue((current) =>
      current.filter((item) => item.id !== task.id),
    );
  }

  async function handleSnoozeReminder(task: Task) {
    try {
      await snoozeTaskReminder(task.id, 10);
      reminderTaskIdsRef.current.delete(task.id);
      setReminderQueue((current) =>
        current.filter((item) => item.id !== task.id),
      );
    } catch (nextError) {
      setAppError(normalizeError(nextError));
    }
  }

  function dismissReminder() {
    setReminderQueue((current) => {
      const [task, ...rest] = current;
      if (task) reminderTaskIdsRef.current.delete(task.id);
      return rest;
    });
  }

  async function handleToggle(task: Task) {
    await toggleTask(task.id, task.status !== "done");
  }

  async function handleSave(input: UpdateTaskInput, tagIds: string[]) {
    await saveTask(input, tagIds);
    selectTask(null);
  }

  async function handleDelete(id: string) {
    await removeTask(id);
    selectTask(null);
  }

  async function handleTagsChange(nextTags: Tag[]) {
    setTags(nextTags);
    const availableIds = new Set(nextTags.map((tag) => tag.id));
    const nextFilterTagIds = filters.tagIds.filter((id) =>
      availableIds.has(id),
    );
    if (nextFilterTagIds.length !== filters.tagIds.length) {
      await setFilters({ tagIds: nextFilterTagIds });
    } else {
      await loadTasks();
    }
  }

  return (
    <div className="app-ambient min-h-screen p-0 text-stone-900 dark:text-stone-100 md:p-3">
      <div className="glass-shell mx-auto flex min-h-screen max-w-[1440px] flex-col overflow-hidden md:min-h-[calc(100vh-1.5rem)] md:flex-row md:rounded-[28px]">
        <AppSidebar
          view={view}
          activeSection={activeSection}
          activeQuickAction={toolbarPanel}
          hasSearchQuery={Boolean(filters.query.trim())}
          filterCount={structuredFilterCount}
          onSelectView={(nextView) => void handleSelectView(nextView)}
          onOpenQuickAdd={toggleQuickAddFromNavigation}
          onOpenSearch={toggleSearchFromNavigation}
          onOpenFilters={toggleFiltersFromNavigation}
          onOpenSettings={openSettings}
        />

        <main className="relative min-w-0 flex-1">
          {activeSection === "settings" ? (
            <SettingsPage
              settings={settings}
              appInfo={appInfo}
              databaseStatus={databaseStatus}
              onSettingChange={handleSettingChange}
              onRestoreComplete={handleRestoreComplete}
            />
          ) : (
            <div className="mx-auto max-w-4xl px-5 pt-6 pb-12 sm:px-7 lg:px-8 lg:pt-8 lg:pb-14">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="page-title">{copy.title}</h1>
                <div className="glass-surface meta-copy tabular-nums flex items-center rounded-2xl p-1">
                  <span
                    className="flex h-10 items-center gap-1.5 px-2.5"
                    aria-label={`${tasks.length} 条任务`}
                    title={`${tasks.length} 条任务`}
                  >
                    <ListTodo aria-hidden="true" className="size-4" />
                    <span>{tasks.length}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadTasks()}
                    disabled={loading}
                    className="glass-button grid size-10 place-items-center rounded-xl text-stone-400 hover:text-stone-900 disabled:opacity-40 dark:text-stone-400 dark:hover:text-stone-100"
                    aria-label="刷新任务"
                    title="刷新任务"
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={`size-4 ${loading ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </header>

              <TaskToolbar
                ref={toolbarRef}
                filters={filters}
                lists={lists}
                tags={tags}
                view={view}
                addDisabled={loading}
                onChange={setFilters}
                onManageTags={() => setTagManagerOpen(true)}
                onCreate={handleCreate}
                onPanelChange={setToolbarPanel}
              />

              {(error || appError) && (
                <div
                  className="glass-surface mt-5 flex items-start justify-between gap-4 rounded-2xl border-red-200/70 bg-red-50/70 px-4 py-3 text-sm text-red-800 dark:border-red-800/50 dark:bg-red-950/35 dark:text-red-200"
                  role="alert"
                >
                  <span>{error ?? appError}</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearError();
                      setAppError(null);
                    }}
                    aria-label="关闭错误提示"
                    className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </div>
              )}

              <section className="mt-6" aria-label={`${copy.title}任务列表`}>
                <TaskListView
                  view={view}
                  tasks={tasks}
                  lists={lists}
                  loading={loading}
                  hasActiveFilters={hasActiveFilters}
                  onToggle={handleToggle}
                  onOpen={(task) => selectTask(task.id)}
                />
              </section>
            </div>
          )}
        </main>
      </div>

      <TaskDetailDrawer
        task={selectedTask}
        lists={lists}
        tags={tags}
        open={activeSection === "tasks" && Boolean(selectedTask)}
        busy={loading}
        onOpenChange={(open) => {
          if (!open) selectTask(null);
        }}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      <TagManagerDialog
        open={activeSection === "tasks" && tagManagerOpen}
        tags={tags}
        onOpenChange={setTagManagerOpen}
        onTagsChange={handleTagsChange}
      />

      <ReminderToast
        task={reminderQueue[0] ?? null}
        onOpen={handleOpenReminder}
        onSnooze={handleSnoozeReminder}
        onDismiss={dismissReminder}
      />
    </div>
  );
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
