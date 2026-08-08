import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { applyThemePreference } from "./theme";
import { saveAppSetting } from "../services/settingsService";
import { useTaskStore } from "../stores/taskStore";
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

import { useAppInit } from "../hooks/useAppInit";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { usePresence } from "../hooks/usePresence";
import { useTaskReminder } from "../hooks/useTaskReminder";
import { useToast } from "../hooks/useToast";
import { useTrayQuickAdd } from "../hooks/useTrayQuickAdd";
import {
  createRecurringRule,
  deleteRecurringRule,
  generateNextRecurringOccurrence,
  listRecurringRules,
  setRecurringRuleEnabled,
  skipNextRecurringOccurrence,
  updateRecurringRule,
} from "../services/recurringService";

function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [appError, setAppError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [autoBackup, setAutoBackup] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringViewActive, setRecurringViewActive] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [editingRecurringRule, setEditingRecurringRule] =
    useState<RecurringRule | null>(null);
  const [recurringSourceTask, setRecurringSourceTask] = useState<Task | null>(null);

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
    batchUpdate,
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
  const defaultListId = useMemo(
    () => pickDefaultListId(scope, lists),
    [lists, scope],
  );
  const contentKey = useMemo(
    () =>
      [
        recurringViewActive ? "recurring" : layout,
        scope.kind,
        scope.kind === "view" ? scope.view : scope.listId,
        sortBy,
        showCompleted,
      ].join(":"),
    [layout, recurringViewActive, scope, sortBy, showCompleted],
  );
  const createPresence = usePresence(createOpen, 280);
  const listDialogPresence = usePresence(listDialogOpen, 280);
  const shortcutsPresence = usePresence(shortcutsOpen, 280);
  const settingsPresence = usePresence(settingsOpen, 280);
  const statsPresence = usePresence(statsOpen, 280);
  const batchEditPresence = usePresence(batchEditOpen, 280);
  const confirmPresence = usePresence(confirmState, 280);
  const recurringDialogPresence = usePresence(recurringDialogOpen, 280);

  const openCreateDialog = useCallback(() => setCreateOpen(true), []);
  const loadRecurringRules = useCallback(async () => {
    setRecurringLoading(true);
    try {
      setRecurringRules(await listRecurringRules());
    } finally {
      setRecurringLoading(false);
    }
  }, []);
  const openSettingsDialog = useCallback(() => {
    setMenuOpen(false);
    setSettingsOpen(true);
  }, []);
  const openStatsDialog = useCallback(() => {
    setMenuOpen(false);
    setStatsOpen(true);
  }, []);
  const openAddListDialog = useCallback(() => {
    setEditingList(null);
    setListDialogOpen(true);
  }, []);
  const openEditListDialog = useCallback((listToEdit: TaskList) => {
    setEditingList(listToEdit);
    setListDialogOpen(true);
  }, []);

  const openRecurringView = useCallback(() => {
    setRecurringViewActive(true);
    setMenuOpen(false);
    selectTask(null);
    clearBatchSelection();
    void loadRecurringRules();
  }, [clearBatchSelection, loadRecurringRules, selectTask]);

  const openNewRecurringDialog = useCallback(() => {
    setEditingRecurringRule(null);
    setRecurringSourceTask(null);
    setRecurringDialogOpen(true);
  }, []);

  const closeEverything = useCallback(() => {
    setMenuOpen(false);
    setShortcutsOpen(false);
    setCreateOpen(false);
    setListDialogOpen(false);
    setSettingsOpen(false);
    setStatsOpen(false);
    setBatchEditOpen(false);
    setConfirmState(null);
    setRecurringDialogOpen(false);
    setEditingRecurringRule(null);
    setRecurringSourceTask(null);
    setRecurringViewActive(false);
    selectTask(null);
    clearBatchSelection();
  }, [clearBatchSelection, selectTask]);

  useAppInit(setSettings, setLists, setAppError, setAutoBackup);
  useEffect(() => {
    let cancelled = false;
    void listRecurringRules()
      .then((rules) => {
        if (!cancelled) setRecurringRules(rules);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setAppError(String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
  useTrayQuickAdd(openCreateDialog, setAppError);
  useTaskReminder();
  useKeyboardShortcuts({
    onOpenCreateDialog: openCreateDialog,
    onOpenShortcuts: () => setShortcutsOpen(true),
    onToggleBatchMode: toggleBatchMode,
    onEscape: closeEverything,
  });

  useEffect(() => applyThemePreference(settings.theme), [settings.theme]);

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
      body: `确定要删除清单"${listToDelete.name}"吗？关联的任务仍将保留在全集中。`,
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

  async function handleCreateRecurring(input: CreateRecurringRuleInput) {
    await createRecurringRule(input);
    await Promise.all([loadRecurringRules(), useTaskStore.getState().loadTasks()]);
    setCreateOpen(false);
    setRecurringDialogOpen(false);
    pushToast("循环任务已创建", "success");
  }

  async function handleUpdateRecurring(input: UpdateRecurringRuleInput) {
    await updateRecurringRule(input);
    await Promise.all([loadRecurringRules(), useTaskStore.getState().loadTasks()]);
    setRecurringDialogOpen(false);
    pushToast("循环规则已更新", "success");
  }

  async function handleToggleTask(task: Task) {
    await toggleTask(task.id, task.status !== "done");
    pushToast(task.status === "done" ? "任务已恢复" : "任务已完成", "success");
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
        ? recurringRules.find((rule) => rule.id === task.recurringRuleId) ?? null
        : null,
    );
    setRecurringDialogOpen(true);
  }

  function requestDeleteRecurring(rule: RecurringRule) {
    setConfirmState({
      title: "删除循环规则",
      body: `删除“${rule.title}”后不会再生成新任务。已生成的任务默认保留。`,
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
        await Promise.all([loadRecurringRules(), useTaskStore.getState().loadTasks()]);
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
    await Promise.all([loadRecurringRules(), useTaskStore.getState().loadTasks()]);
    pushToast("下一次任务已生成", "success");
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

  async function handleBatchUpdate(
    patch: Parameters<typeof batchUpdate>[0],
  ) {
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
          onAddList={openAddListDialog}
          onEditList={openEditListDialog}
          onDeleteList={requestDeleteList}
          recurringActive={recurringViewActive}
          recurringCount={recurringRules.length}
          onOpenRecurring={openRecurringView}
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
            onOpenSettings={openSettingsDialog}
            onOpenStats={openStatsDialog}
            showLayoutControls={!recurringViewActive}
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
              className={`content-motion content-motion-${layout}`}
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
              ) : layout === "list" ? (
                <TaskListView
                  tasks={tasks}
                  lists={lists}
                  loading={loading}
                  selectedTaskId={selectedTaskId}
                  batchMode={batchMode}
                  batchSelectedIds={batchSelectedIds}
                  searchQuery={searchQuery}
                  scope={scope}
                  defaultListId={defaultListId}
                  onInlineCreate={(input) => void addTask(input)}
                  onQuickAdd={openCreateDialog}
                  onOpen={(task) => selectTask(task.id)}
                  onToggle={(task) => void handleToggleTask(task)}
                  onDelete={requestDeleteTask}
                  onToggleBatchSelected={toggleBatchSelected}
                  onBatchComplete={() => void handleBatchComplete()}
                  onBatchDelete={requestBatchDelete}
                  onBatchEdit={() => setBatchEditOpen(true)}
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
            </div>
          </section>
        </main>
      </div>

      {createPresence.rendered && (
        <TaskCreateDialog
          lists={lists}
          defaultListId={defaultListId}
          presence={createPresence.phase}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => void handleCreateTask(input)}
          onSubmitRecurring={(input) => void handleCreateRecurring(input)}
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
      />

      {recurringDialogPresence.rendered && (
        <RecurringRuleDialog
          rule={editingRecurringRule}
          sourceTask={recurringSourceTask}
          lists={lists}
          defaultListId={defaultListId}
          presence={recurringDialogPresence.phase}
          onClose={() => setRecurringDialogOpen(false)}
          onCreate={(input) => void handleCreateRecurring(input)}
          onUpdate={(input) => void handleUpdateRecurring(input)}
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

      {shortcutsPresence.rendered && (
        <ShortcutsDialog
          presence={shortcutsPresence.phase}
          onClose={() => setShortcutsOpen(false)}
        />
      )}

      {settingsPresence.rendered && (
        <SettingsDialog
          autoBackup={autoBackup}
          presence={settingsPresence.phase}
          onClose={() => setSettingsOpen(false)}
          onAutoBackupChange={setAutoBackup}
          onToast={pushToast}
        />
      )}

      {statsPresence.rendered && (
        <StatsDialog
          tasks={allTasks}
          lists={lists}
          presence={statsPresence.phase}
          onClose={() => setStatsOpen(false)}
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
        state={confirmPresence.value}
        presence={confirmPresence.phase}
        onClose={() => setConfirmState(null)}
      />

      <ToastHost toasts={toasts} />
    </div>
  );
}

export default App;
