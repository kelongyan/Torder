import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { applyThemePreference } from "./theme";
import { saveAppSetting } from "../services/settingsService";
import { useTaskStore } from "../stores/taskStore";
import type {
  CreateTaskInput,
  Task,
  TaskList,
  TaskScope,
  UpdateTaskInput,
} from "../types/database";
import {
  defaultAppSettings,
  type AppSettings,
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
import { TaskDetailPanel } from "../components/detail/TaskDetailPanel";
import { TaskCreateDialog } from "../components/dialog/TaskCreateDialog";
import { ConfirmDialog } from "../components/dialog/ConfirmDialog";
import { ShortcutsDialog } from "../components/dialog/ShortcutsDialog";
import { ToastHost } from "../components/common/ToastHost";
import { WindowTitleBar } from "../components/layout/WindowTitleBar";

import { useAppInit } from "../hooks/useAppInit";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useToast } from "../hooks/useToast";
import { useTrayQuickAdd } from "../hooks/useTrayQuickAdd";

function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [appError, setAppError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const { toasts, pushToast } = useToast();

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
    addTask,
    saveTask,
    toggleTask,
    removeTask,
    batchComplete,
    batchDelete,
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
    () => getScopeTitle(scope, lists),
    [lists, scope],
  );
  const counts = useMemo(() => buildCounts(allTasks, lists), [allTasks, lists]);
  const defaultListId = useMemo(
    () => pickDefaultListId(scope, lists),
    [lists, scope],
  );

  const openCreateDialog = useCallback(() => setCreateOpen(true), []);
  const closeEverything = useCallback(() => {
    setMenuOpen(false);
    setShortcutsOpen(false);
    setCreateOpen(false);
    setConfirmState(null);
    clearBatchSelection();
  }, [clearBatchSelection]);

  useAppInit(setSettings, setLists, setAppError);
  useTrayQuickAdd(openCreateDialog, setAppError);
  useKeyboardShortcuts({
    onOpenCreateDialog: openCreateDialog,
    onOpenShortcuts: () => setShortcutsOpen(true),
    onToggleBatchMode: toggleBatchMode,
    onEscape: closeEverything,
  });

  useEffect(() => applyThemePreference(settings.theme), [settings.theme]);

  async function handleSelectScope(nextScope: TaskScope) {
    setMenuOpen(false);
    selectTask(null);
    if (searchQuery.trim()) await setSearchQuery("");
    await setScope(nextScope);
  }

  async function handleThemeToggle() {
    const nextTheme: ThemePreference =
      settings.theme === "dark" ? "light" : "dark";
    await saveAppSetting("theme", nextTheme);
    setSettings((current) => ({ ...current, theme: nextTheme }));
  }

  async function handleCreateTask(input: CreateTaskInput) {
    await addTask(input);
    setCreateOpen(false);
    pushToast("任务已创建", "success");
  }

  async function handleToggleTask(task: Task) {
    await toggleTask(task.id, task.status !== "done");
    pushToast(task.status === "done" ? "任务已恢复" : "任务已完成", "success");
  }

  async function handleSaveTask(input: UpdateTaskInput) {
    await saveTask(input);
    pushToast("任务已更新", "success");
  }

  function requestDeleteTask(task: Task) {
    setConfirmState({
      title: "确认删除任务",
      body: `确定要删除"${task.title}"吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await removeTask(task.id);
        setConfirmState(null);
        pushToast("任务已删除", "info");
      },
    });
  }

  function requestBatchDelete() {
    if (batchSelectedIds.length === 0) return;
    setConfirmState({
      title: "确认批量删除",
      body: `确定要删除已选的 ${batchSelectedIds.length} 项任务吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await batchDelete();
        setConfirmState(null);
        pushToast("已删除选中任务", "info");
      },
    });
  }

  async function handleBatchComplete() {
    if (batchSelectedIds.length === 0) return;
    await batchComplete();
    pushToast("已完成选中任务", "success");
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
    <div className="window-frame">
      <WindowTitleBar />

      <div className="app-shell">
        <Sidebar
          lists={lists}
          scope={scope}
          searchQuery={searchQuery}
          counts={counts}
          onSearchChange={(query) => void setSearchQuery(query)}
          onScopeChange={(nextScope) => void handleSelectScope(nextScope)}
        />

        <main className="main">
          <MainHeader
            title={currentTitle}
            taskCount={tasks.length}
            layout={layout}
            theme={settings.theme}
            sortBy={sortBy}
            showCompleted={showCompleted}
            onLayoutChange={setLayout}
            onThemeToggle={() => void handleThemeToggle()}
            onMenuToggle={() => setMenuOpen((open) => !open)}
            menuOpen={menuOpen}
            onSortChange={(nextSort) => void handleSortChange(nextSort)}
            onShowCompletedChange={() => void handleShowCompletedChange()}
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
            {layout === "list" ? (
              <TaskListView
                tasks={tasks}
                lists={lists}
                loading={loading}
                selectedTaskId={selectedTaskId}
                batchMode={batchMode}
                batchSelectedIds={batchSelectedIds}
                searchQuery={searchQuery}
                scope={scope}
                onQuickAdd={openCreateDialog}
                onOpen={(task) => selectTask(task.id)}
                onToggle={(task) => void handleToggleTask(task)}
                onDelete={requestDeleteTask}
                onToggleBatchSelected={toggleBatchSelected}
                onBatchComplete={() => void handleBatchComplete()}
                onBatchDelete={requestBatchDelete}
                onExitBatch={clearBatchSelection}
              />
            ) : layout === "board" ? (
              <TaskBoard
                tasks={tasks}
                lists={lists}
                searchQuery={searchQuery}
                selectedTaskId={selectedTaskId}
                onOpen={(task) => selectTask(task.id)}
                onToggle={(task) => void handleToggleTask(task)}
              />
            ) : (
              <TaskCalendar
                tasks={tasks}
                lists={lists}
                searchQuery={searchQuery}
                selectedTaskId={selectedTaskId}
                onOpen={(task) => selectTask(task.id)}
                onToggle={(task) => void handleToggleTask(task)}
              />
            )}
          </section>
        </main>
      </div>

      <TaskDetailPanel
        task={selectedTask}
        lists={lists}
        busy={loading}
        onClose={() => selectTask(null)}
        onSave={handleSaveTask}
        onToggle={(task) => void handleToggleTask(task)}
        onDelete={requestDeleteTask}
      />

      {createOpen && (
        <TaskCreateDialog
          lists={lists}
          defaultListId={defaultListId}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => void handleCreateTask(input)}
        />
      )}

      {shortcutsOpen && (
        <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />
      )}

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />

      <ToastHost toasts={toasts} />
    </div>
  );
}

export default App;
