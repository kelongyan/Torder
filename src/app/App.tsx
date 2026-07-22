import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  FolderPlus,
  Info,
  Keyboard,
  ListTodo,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Sun,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import logoUrl from "../assets/torder-logo.png";
import {
  formatCalendarDate,
  formatTaskDate,
  formatTaskDateTime,
  fromDateTimeLocal,
  isOverdue,
  toDateTimeLocal,
} from "./taskDates";
import { applyThemePreference } from "./theme";
import { taskViewCopy } from "./taskViews";
import { createList, listLists } from "../services/listService";
import { loadAppSettings, saveAppSetting } from "../services/settingsService";
import {
  defaultTaskScope,
  listScope,
  useTaskStore,
  viewScope,
} from "../stores/taskStore";
import type {
  CreateTaskInput,
  SystemView,
  Task,
  TaskLayout,
  TaskList,
  TaskScope,
  TaskSortBy,
  UpdateTaskInput,
} from "../types/database";
import {
  defaultAppSettings,
  type AppSettings,
  type ThemePreference,
} from "../types/settings";

type ToastKind = "success" | "error" | "info";

interface ToastMessage {
  id: number;
  type: ToastKind;
  message: string;
}

interface ConfirmState {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

interface TaskDraft {
  title: string;
  note: string;
  priority: 0 | 1 | 2;
  listId: string;
  dueAt: string;
}

const systemNav: Array<{
  view: SystemView;
  icon: LucideIcon;
}> = [
  { view: "all", icon: ListTodo },
  { view: "today", icon: Calendar },
  { view: "planned", icon: CalendarDays },
  { view: "important", icon: Star },
  { view: "completed", icon: CheckCircle2 },
];

const layoutOptions: Array<{ value: TaskLayout; label: string }> = [
  { value: "list", label: "列表" },
  { value: "board", label: "看板" },
  { value: "calendar", label: "日历" },
];

const sortOptions: Array<{
  value: TaskSortBy;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "priority", label: "按优先级", icon: Flag },
  { value: "date", label: "按截止日期", icon: Calendar },
  { value: "created", label: "按创建时间", icon: Clock },
];

const priorityCopy: Record<0 | 1 | 2, { label: string; className: string }> = {
  2: { label: "高", className: "priority-high" },
  1: { label: "中", className: "priority-medium" },
  0: { label: "低", className: "priority-low" },
};

const listColorOptions = ["#6366f1", "#22c55e", "#a855f7"];

function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [appError, setAppError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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
    loadTasks,
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

  const pushToast = useCallback((message: string, type: ToastKind) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2400);
  }, []);

  const openCreateDialog = useCallback(() => {
    setCreateOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const [nextSettings, nextLists] = await Promise.all([
          loadAppSettings(),
          listLists(),
        ]);
        if (cancelled) return;
        setSettings(nextSettings);
        setLists(nextLists);
        await loadTasks();
      } catch (nextError) {
        if (!cancelled) setAppError(normalizeError(nextError));
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [loadTasks]);

  useEffect(() => applyThemePreference(settings.theme), [settings.theme]);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen("tray-quick-add", () => {
      openCreateDialog();
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
  }, [openCreateDialog]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const typing = isTypingTarget(event.target);

      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "n") {
        event.preventDefault();
        openCreateDialog();
        return;
      }

      if (typing) return;

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (key === "b") {
        event.preventDefault();
        toggleBatchMode();
        return;
      }

      if (event.key === "Escape") {
        setMenuOpen(false);
        setShortcutsOpen(false);
        setCreateOpen(false);
        setListDialogOpen(false);
        setConfirmState(null);
        clearBatchSelection();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [clearBatchSelection, openCreateDialog, toggleBatchMode]);

  async function refreshLists() {
    setLists(await listLists());
  }

  async function handleSelectScope(nextScope: TaskScope) {
    setMenuOpen(false);
    selectTask(null);
    if (searchQuery.trim()) await setSearchQuery("");
    await setScope(nextScope);
  }

  async function handleThemeToggle() {
    const nextTheme: ThemePreference = settings.theme === "dark" ? "light" : "dark";
    await saveAppSetting("theme", nextTheme);
    setSettings((current) => ({ ...current, theme: nextTheme }));
  }

  async function handleCreateTask(input: CreateTaskInput) {
    await addTask(input);
    setCreateOpen(false);
    pushToast("任务已创建", "success");
  }

  async function handleCreateList(name: string, color: string) {
    await createList({ name, color, sortOrder: lists.length });
    await refreshLists();
    setListDialogOpen(false);
    pushToast("清单已创建", "success");
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
      body: `确定要删除“${task.title}”吗？此操作不可撤销。`,
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

  async function handleSortChange(nextSort: TaskSortBy) {
    await setSortBy(nextSort);
    setMenuOpen(false);
  }

  async function handleShowCompletedChange() {
    await setShowCompleted(!showCompleted);
    setMenuOpen(false);
  }

  const displayError = error ?? appError;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={logoUrl} alt="" className="brand-logo" />
          <div>
            <div className="brand-title">Torder</div>
            <div className="brand-subtitle">待办清单</div>
          </div>
        </div>

        <label className="search-box">
          <Search aria-hidden="true" className="icon-sm" />
          <input
            value={searchQuery}
            onChange={(event) => void setSearchQuery(event.target.value)}
            placeholder="搜索任务..."
            aria-label="搜索任务"
          />
        </label>

        <nav className="sidebar-nav" aria-label="任务视图">
          <div className="nav-group-label">导航</div>
          {systemNav.map((item) => (
            <SidebarItem
              key={item.view}
              icon={item.icon}
              label={taskViewCopy[item.view].title}
              active={isScopeActive(scope, viewScope(item.view))}
              count={counts.views[item.view]}
              onClick={() => void handleSelectScope(viewScope(item.view))}
            />
          ))}

          <div className="sidebar-divider" />
          <div className="nav-group-label">我的清单</div>
          {lists.map((list) => (
            <SidebarItem
              key={list.id}
              color={list.color ?? "#6366f1"}
              label={list.name}
              active={isScopeActive(scope, listScope(list.id))}
              count={counts.lists[list.id] ?? 0}
              onClick={() => void handleSelectScope(listScope(list.id))}
            />
          ))}
        </nav>

        <button
          type="button"
          className="new-list-button"
          onClick={() => setListDialogOpen(true)}
        >
          <Plus aria-hidden="true" className="icon-sm" />
          新建清单
        </button>
      </aside>

      <main className="main">
        <header className="main-header">
          <div>
            <h1>{currentTitle}</h1>
            <p>{tasks.length} 项任务</p>
          </div>

          <div className="header-actions">
            <div className="layout-tabs" aria-label="布局切换">
              {layoutOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={layout === item.value ? "active" : ""}
                  onClick={() => setLayout(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="icon-button"
              onClick={() => void handleThemeToggle()}
              aria-label="切换主题"
              title="切换主题"
            >
              {settings.theme === "dark" ? (
                <Sun aria-hidden="true" />
              ) : (
                <Moon aria-hidden="true" />
              )}
            </button>

            <div className="menu-anchor">
              <button
                type="button"
                className="icon-button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="更多设置"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
              {menuOpen && (
                <ViewMenu
                  sortBy={sortBy}
                  showCompleted={showCompleted}
                  onSortChange={(nextSort) => void handleSortChange(nextSort)}
                  onShowCompletedChange={() => void handleShowCompletedChange()}
                />
              )}
            </div>
          </div>
        </header>

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

      <TaskDetailPanel
        task={selectedTask}
        lists={lists}
        busy={loading}
        onClose={() => selectTask(null)}
        onSave={(input) => void handleSaveTask(input)}
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

      {listDialogOpen && (
        <ListCreateDialog
          onClose={() => setListDialogOpen(false)}
          onSubmit={(name, color) => void handleCreateList(name, color)}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />

      <ToastHost toasts={toasts} />
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  color,
  label,
  count,
  active,
  onClick,
}: {
  icon?: LucideIcon;
  color?: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="icon-sm" />
      ) : (
        <span className="list-dot" style={{ backgroundColor: color }} />
      )}
      <span>{label}</span>
      <span className="nav-badge">{count}</span>
    </button>
  );
}

function ViewMenu({
  sortBy,
  showCompleted,
  onSortChange,
  onShowCompletedChange,
}: {
  sortBy: TaskSortBy;
  showCompleted: boolean;
  onSortChange: (sortBy: TaskSortBy) => void;
  onShowCompletedChange: () => void;
}) {
  return (
    <div className="view-menu" role="menu">
      <div className="menu-label">排序方式</div>
      {sortOptions.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            className="menu-item"
            onClick={() => onSortChange(item.value)}
          >
            <Icon aria-hidden="true" className="icon-sm" />
            <span>{item.label}</span>
            {sortBy === item.value && <Check aria-hidden="true" className="icon-sm" />}
          </button>
        );
      })}
      <div className="menu-separator" />
      <div className="menu-label">显示</div>
      <button type="button" className="menu-item" onClick={onShowCompletedChange}>
        <Eye aria-hidden="true" className="icon-sm" />
        <span>显示已完成</span>
        {showCompleted && <Check aria-hidden="true" className="icon-sm" />}
      </button>
    </div>
  );
}

function TaskListView({
  tasks,
  lists,
  loading,
  selectedTaskId,
  batchMode,
  batchSelectedIds,
  searchQuery,
  scope,
  onQuickAdd,
  onOpen,
  onToggle,
  onDelete,
  onToggleBatchSelected,
  onBatchComplete,
  onBatchDelete,
  onExitBatch,
}: {
  tasks: Task[];
  lists: TaskList[];
  loading: boolean;
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  searchQuery: string;
  scope: TaskScope;
  onQuickAdd: () => void;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
  onBatchComplete: () => void;
  onBatchDelete: () => void;
  onExitBatch: () => void;
}) {
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const completedTasks = tasks.filter((task) => task.status === "done");

  if (loading && tasks.length === 0) {
    return (
      <div className="list-container">
        <TaskQuickAdd onClick={onQuickAdd} />
        <div className="skeleton-list" aria-label="任务加载中">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="list-container">
        <TaskQuickAdd onClick={onQuickAdd} />
        <EmptyState scope={scope} searchQuery={searchQuery} />
      </div>
    );
  }

  return (
    <div className={`list-container ${batchMode ? "batching" : ""}`}>
      {batchMode && (
        <div className="batch-bar">
          <span>已选 {batchSelectedIds.length} 项</span>
          <button type="button" onClick={onBatchComplete} disabled={batchSelectedIds.length === 0}>
            <Check aria-hidden="true" className="icon-sm" />
            完成
          </button>
          <button type="button" onClick={onBatchDelete} disabled={batchSelectedIds.length === 0}>
            <Trash2 aria-hidden="true" className="icon-sm" />
            删除
          </button>
          <button type="button" onClick={onExitBatch}>退出</button>
        </div>
      )}
      <TaskQuickAdd onClick={onQuickAdd} />
      {activeTasks.length > 0 && (
        <>
          <SectionHeader label={`进行中 · ${activeTasks.length}`} />
          {activeTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              selected={task.id === selectedTaskId}
              last={index === activeTasks.length - 1 && completedTasks.length === 0}
              batchMode={batchMode}
              batchSelected={batchSelectedIds.includes(task.id)}
              searchQuery={searchQuery}
              onOpen={onOpen}
              onToggle={onToggle}
              onDelete={onDelete}
              onToggleBatchSelected={onToggleBatchSelected}
            />
          ))}
        </>
      )}
      {completedTasks.length > 0 && (
        <>
          <SectionHeader label={`已完成 · ${completedTasks.length}`} />
          {completedTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              selected={task.id === selectedTaskId}
              last={index === completedTasks.length - 1}
              batchMode={batchMode}
              batchSelected={batchSelectedIds.includes(task.id)}
              searchQuery={searchQuery}
              onOpen={onOpen}
              onToggle={onToggle}
              onDelete={onDelete}
              onToggleBatchSelected={onToggleBatchSelected}
            />
          ))}
        </>
      )}
    </div>
  );
}

function TaskQuickAdd({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="quick-add" onClick={onClick}>
      <Plus aria-hidden="true" className="icon-sm" />
      <span>添加新任务...</span>
      <kbd>Ctrl+N</kbd>
    </button>
  );
}

function SectionHeader({ label }: { label: string }) {
  return <div className="section-header">{label}</div>;
}

function TaskRow({
  task,
  lists,
  selected,
  last,
  batchMode,
  batchSelected,
  searchQuery,
  onOpen,
  onToggle,
  onDelete,
  onToggleBatchSelected,
}: {
  task: Task;
  lists: TaskList[];
  selected: boolean;
  last: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  searchQuery: string;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleBatchSelected: (id: string) => void;
}) {
  const completed = task.status === "done";
  const list = findList(lists, task.listId);

  function handleRowClick() {
    if (batchMode) onToggleBatchSelected(task.id);
    else onOpen(task);
  }

  return (
    <article
      className={`task-item ${selected ? "selected" : ""} ${completed ? "completed" : ""}`}
      onClick={handleRowClick}
    >
      {!batchMode && (
        <div className="timeline-node" aria-hidden="true">
          <span
            className={`timeline-dot ${completed ? "completed-dot" : priorityCopy[task.priority].className}`}
          />
          {!last && <span className="timeline-line" />}
        </div>
      )}

      {batchMode ? (
        <button
          type="button"
          className={`batch-check ${batchSelected ? "checked" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleBatchSelected(task.id);
          }}
          aria-label={batchSelected ? "取消选择任务" : "选择任务"}
        >
          {batchSelected && <Check aria-hidden="true" />}
        </button>
      ) : (
        <button
          type="button"
          className={`task-check ${completed ? "checked" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(task);
          }}
          aria-label={completed ? "恢复任务" : "完成任务"}
        >
          {completed && <Check aria-hidden="true" />}
        </button>
      )}

      <div className="task-content">
        <h3>
          <HighlightedText text={task.title} query={searchQuery} />
        </h3>
        {task.note && (
          <p>
            <HighlightedText text={task.note} query={searchQuery} />
          </p>
        )}
        <TaskMeta task={task} list={list} />
      </div>

      {!batchMode && (
        <div className="task-actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(task);
            }}
            aria-label="编辑任务"
          >
            <Pencil aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(task);
            }}
            aria-label="删除任务"
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}

function TaskMeta({ task, list }: { task: Task; list: TaskList | null }) {
  const dueLabel = formatTaskDate(task.dueAt);
  const overdue = isOverdue(task.dueAt, task.status);

  return (
    <div className="task-meta">
      <span
        className="list-badge"
        style={{
          color: list?.color ?? "#6366f1",
          backgroundColor: `${list?.color ?? "#6366f1"}24`,
        }}
      >
        {list?.name ?? "未分类"}
      </span>
      <span className={`priority-pill ${priorityCopy[task.priority].className}`}>
        {priorityCopy[task.priority].label}
      </span>
      {dueLabel && (
        <span className={`due-label ${overdue ? "overdue" : ""}`}>
          <Calendar aria-hidden="true" className="icon-xs" />
          {dueLabel}
        </span>
      )}
    </div>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return <>{text}</>;

  const haystack = text.toLocaleLowerCase("zh-CN");
  const index = haystack.indexOf(needle);
  if (index < 0) return <>{text}</>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + needle.length);
  const after = text.slice(index + needle.length);

  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  );
}

function EmptyState({
  scope,
  searchQuery,
}: {
  scope: TaskScope;
  searchQuery: string;
}) {
  const copy =
    searchQuery.trim().length > 0
      ? {
          icon: Search,
          title: `没有匹配“${searchQuery.trim()}”的任务`,
          body: "换个关键词试试，或者直接创建一条新任务。",
        }
      : getEmptyCopy(scope);
  const Icon = copy.icon;

  return (
    <div className="empty-state">
      <Icon aria-hidden="true" />
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
    </div>
  );
}

function TaskBoard({
  tasks,
  lists,
  searchQuery,
  selectedTaskId,
  onOpen,
  onToggle,
}: {
  tasks: Task[];
  lists: TaskList[];
  searchQuery: string;
  selectedTaskId: string | null;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const columns = [
    {
      id: "todo",
      title: "待处理",
      color: "var(--blue)",
      tasks: tasks.filter((task) => task.status !== "done" && task.priority !== 2),
    },
    {
      id: "doing",
      title: "进行中",
      color: "var(--red)",
      tasks: tasks.filter((task) => task.status !== "done" && task.priority === 2),
    },
    {
      id: "done",
      title: "已完成",
      color: "var(--green)",
      tasks: tasks.filter((task) => task.status === "done"),
    },
  ];

  return (
    <div className="board-view">
      {columns.map((column) => (
        <section key={column.id} className="board-column">
          <header>
            <span className="board-dot" style={{ backgroundColor: column.color }} />
            <h2>{column.title}</h2>
            <span>{column.tasks.length}</span>
          </header>
          <div className="board-cards">
            {column.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                list={findList(lists, task.listId)}
                searchQuery={searchQuery}
                selected={selectedTaskId === task.id}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  list,
  searchQuery,
  selected,
  onOpen,
  onToggle,
}: {
  task: Task;
  list: TaskList | null;
  searchQuery: string;
  selected: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  return (
    <article
      className={`board-card ${selected ? "selected" : ""} ${task.status === "done" ? "completed" : ""}`}
      onClick={() => onOpen(task)}
    >
      <div className="board-card-top">
        <span
          className="list-badge"
          style={{
            color: list?.color ?? "#6366f1",
            backgroundColor: `${list?.color ?? "#6366f1"}24`,
          }}
        >
          {list?.name ?? "未分类"}
        </span>
        <button
          type="button"
          className={`task-check compact ${task.status === "done" ? "checked" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(task);
          }}
          aria-label={task.status === "done" ? "恢复任务" : "完成任务"}
        >
          {task.status === "done" && <Check aria-hidden="true" />}
        </button>
      </div>
      <h3>
        <HighlightedText text={task.title} query={searchQuery} />
      </h3>
      {task.note && (
        <p>
          <HighlightedText text={task.note} query={searchQuery} />
        </p>
      )}
      <div className="board-card-footer">
        <span className={`priority-pill ${priorityCopy[task.priority].className}`}>
          {priorityCopy[task.priority].label}
        </span>
        <span>{formatTaskDateTime(task.dueAt)}</span>
      </div>
    </article>
  );
}

function TaskCalendar({
  tasks,
  lists,
  searchQuery,
  selectedTaskId,
  onOpen,
  onToggle,
}: {
  tasks: Task[];
  lists: TaskList[];
  searchQuery: string;
  selectedTaskId: string | null;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const groups = useMemo(() => groupCalendarTasks(tasks), [tasks]);

  return (
    <div className="calendar-view">
      {groups.map((group) => (
        <section key={group.key} className="calendar-group">
          <header>
            <div>
              <h2>{group.title}</h2>
              {group.weekday && <span>{group.weekday}</span>}
            </div>
            {group.isToday && <span className="today-badge">今天</span>}
            <strong>{group.tasks.length} 项</strong>
          </header>
          <div className="calendar-items">
            {group.tasks.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                lists={lists}
                selected={selectedTaskId === task.id}
                last={index === group.tasks.length - 1}
                batchMode={false}
                batchSelected={false}
                searchQuery={searchQuery}
                onOpen={onOpen}
                onToggle={onToggle}
                onDelete={() => undefined}
                onToggleBatchSelected={() => undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskDetailPanel({
  task,
  lists,
  busy,
  onClose,
  onSave,
  onToggle,
  onDelete,
}: {
  task: Task | null;
  lists: TaskList[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateTaskInput) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  if (!task) {
    return <aside className="detail-panel hidden" aria-hidden="true" />;
  }

  return (
    <TaskDetailContent
      key={task.id}
      task={task}
      lists={lists}
      busy={busy}
      onClose={onClose}
      onSave={onSave}
      onToggle={onToggle}
      onDelete={onDelete}
    />
  );
}

function TaskDetailContent({
  task,
  lists,
  busy,
  onClose,
  onSave,
  onToggle,
  onDelete,
}: {
  task: Task;
  lists: TaskList[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateTaskInput) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => createTaskDraft(task, lists));

  const list = findList(lists, task.listId);

  function handleSave() {
    if (!draft.title.trim()) return;
    onSave({
      id: task.id,
      title: draft.title,
      note: draft.note.trim() || null,
      status: task.status,
      priority: draft.priority,
      listId: draft.listId,
      dueAt: fromDateTimeLocal(draft.dueAt),
      sortOrder: task.sortOrder,
    });
    setEditing(false);
  }

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <span>任务详情</span>
          <h2>{editing ? "编辑任务" : task.title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="detail-body">
        {editing ? (
          <TaskFormFields draft={draft} lists={lists} onChange={setDraft} />
        ) : (
          <>
            <DetailBlock label="任务名称">{task.title}</DetailBlock>
            <DetailBlock label="描述">{task.note || "暂无描述"}</DetailBlock>
            <DetailBlock label="优先级">
              <span className={`priority-pill ${priorityCopy[task.priority].className}`}>
                {priorityCopy[task.priority].label}
              </span>
            </DetailBlock>
            <DetailBlock label="所属清单">
              <span
                className="list-badge"
                style={{
                  color: list?.color ?? "#6366f1",
                  backgroundColor: `${list?.color ?? "#6366f1"}24`,
                }}
              >
                {list?.name ?? "未分类"}
              </span>
            </DetailBlock>
            <DetailBlock label="截止日期时间">
              {formatTaskDateTime(task.dueAt)}
            </DetailBlock>
            <DetailBlock label="状态">
              <span className={`status-pill ${task.status === "done" ? "done" : ""}`}>
                {task.status === "done" ? "已完成" : "进行中"}
              </span>
            </DetailBlock>
          </>
        )}
      </div>

      <footer className="detail-footer">
        <button type="button" className="btn-danger" onClick={() => onDelete(task)}>
          <Trash2 aria-hidden="true" className="icon-sm" />
          删除
        </button>
        <div>
          {editing ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDraft(createTaskDraft(task, lists));
                  setEditing(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !draft.title.trim()}
                onClick={handleSave}
              >
                保存修改
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => onToggle(task)}>
                {task.status === "done" ? "恢复" : "完成"}
              </button>
              <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
                编辑
              </button>
            </>
          )}
        </div>
      </footer>
    </aside>
  );
}

function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="detail-block">
      <span>{label}</span>
      <div>{children}</div>
    </section>
  );
}

function TaskCreateDialog({
  lists,
  defaultListId,
  onClose,
  onSubmit,
}: {
  lists: TaskList[];
  defaultListId: string;
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaultListId));
  const [touched, setTouched] = useState(false);

  function submit() {
    setTouched(true);
    if (!draft.title.trim()) return;
    onSubmit({
      title: draft.title,
      note: draft.note.trim() || null,
      priority: draft.priority,
      listId: draft.listId,
      dueAt: fromDateTimeLocal(draft.dueAt),
    });
  }

  return (
    <DialogShell
      title="新建任务"
      subtitle="把下一件事放进合适的清单"
      icon={Plus}
      onClose={onClose}
      width="580px"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key === "Enter") submit();
        }}
      >
        <TaskFormFields
          draft={draft}
          lists={lists}
          onChange={setDraft}
          titleInvalid={touched && !draft.title.trim()}
        />
        <DialogFooter onCancel={onClose} submitLabel="创建任务" />
      </form>
    </DialogShell>
  );
}

function TaskFormFields({
  draft,
  lists,
  onChange,
  titleInvalid,
}: {
  draft: TaskDraft;
  lists: TaskList[];
  onChange: (draft: TaskDraft) => void;
  titleInvalid?: boolean;
}) {
  return (
    <>
      <label className="form-field">
        <span>任务名称</span>
        <input
          autoFocus
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          className={titleInvalid ? "invalid" : ""}
          placeholder="输入任务名称..."
        />
      </label>
      <label className="form-field">
        <span>描述</span>
        <textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="补充任务背景、要求或链接"
          rows={4}
        />
      </label>
      <div className="form-field">
        <span>优先级</span>
        <div className="pill-group">
          {([2, 1, 0] as const).map((priority) => (
            <button
              key={priority}
              type="button"
              className={`choice-pill ${draft.priority === priority ? "selected" : ""} ${priorityCopy[priority].className}`}
              onClick={() => onChange({ ...draft, priority })}
            >
              {priorityCopy[priority].label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-field">
        <span>所属清单</span>
        <div className="pill-group wrap">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              className={`choice-pill ${draft.listId === list.id ? "selected" : ""}`}
              style={
                draft.listId === list.id
                  ? { borderColor: list.color ?? "#6366f1", color: list.color ?? "#6366f1" }
                  : undefined
              }
              onClick={() => onChange({ ...draft, listId: list.id })}
            >
              <span className="list-dot" style={{ backgroundColor: list.color ?? "#6366f1" }} />
              {list.name}
            </button>
          ))}
        </div>
      </div>
      <label className="form-field">
        <span>截止日期时间</span>
        <input
          type="datetime-local"
          value={draft.dueAt}
          onChange={(event) => onChange({ ...draft, dueAt: event.target.value })}
        />
      </label>
    </>
  );
}

function ListCreateDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(listColorOptions[0]);
  const [touched, setTouched] = useState(false);

  function submit() {
    setTouched(true);
    if (!name.trim()) return;
    onSubmit(name, color);
  }

  return (
    <DialogShell
      title="新建清单"
      subtitle="为任务建立一个新的分类"
      icon={FolderPlus}
      onClose={onClose}
      width="420px"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="form-field">
          <span>清单名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={touched && !name.trim() ? "invalid" : ""}
            placeholder="例如：项目、旅行、灵感"
          />
        </label>
        <div className="form-field">
          <span>颜色</span>
          <div className="color-row">
            {listColorOptions.map((item) => (
              <button
                key={item}
                type="button"
                className={color === item ? "selected" : ""}
                style={{ backgroundColor: item }}
                onClick={() => setColor(item)}
                aria-label={`选择颜色 ${item}`}
              />
            ))}
          </div>
        </div>
        <DialogFooter onCancel={onClose} submitLabel="创建清单" />
      </form>
    </DialogShell>
  );
}

function DialogShell({
  title,
  subtitle,
  icon: Icon,
  width,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  width: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="dialog-overlay" role="presentation">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
      >
        <header className="dialog-header">
          <span className="dialog-icon">
            <Icon aria-hidden="true" />
          </span>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function DialogFooter({
  onCancel,
  submitLabel,
}: {
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <footer className="dialog-footer">
      <button type="button" className="btn-secondary" onClick={onCancel}>
        取消
      </button>
      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </footer>
  );
}

function ShortcutsDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <DialogShell
      title="快捷键"
      subtitle="常用操作可以直接从键盘触发"
      icon={Keyboard}
      onClose={onClose}
      width="420px"
    >
      <div className="shortcut-list">
        <ShortcutRow keys="Ctrl+N" label="新建任务" />
        <ShortcutRow keys="Ctrl+Enter" label="提交表单" />
        <ShortcutRow keys="Esc" label="关闭弹窗" />
        <ShortcutRow keys="?" label="快捷键面板" />
        <ShortcutRow keys="B" label="批量选择" />
      </div>
    </DialogShell>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="shortcut-row">
      <kbd>{keys}</kbd>
      <span>{label}</span>
    </div>
  );
}

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  if (!state) return null;
  return (
    <div className="dialog-overlay" role="presentation">
      <section className="dialog-card confirm-card" role="alertdialog" aria-modal="true">
        <header className="dialog-header">
          <span className={`dialog-icon ${state.danger ? "danger" : ""}`}>
            <AlertCircle aria-hidden="true" />
          </span>
          <div>
            <h2>{state.title}</h2>
            <p>{state.body}</p>
          </div>
        </header>
        <footer className="dialog-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={state.danger ? "btn-danger-solid" : "btn-primary"}
            onClick={() => void state.onConfirm()}
          >
            {state.confirmText}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ToastHost({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => {
        const Icon =
          toast.type === "success" ? CheckCircle2 : toast.type === "error" ? AlertCircle : Info;
        return (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <Icon aria-hidden="true" className="icon-sm" />
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function getScopeTitle(scope: TaskScope, lists: TaskList[]): string {
  if (scope.kind === "view") return taskViewCopy[scope.view].title;
  return findList(lists, scope.listId)?.name ?? "我的清单";
}

function isScopeActive(current: TaskScope, target: TaskScope): boolean {
  if (current.kind !== target.kind) return false;
  return current.kind === "view"
    ? current.view === (target as { kind: "view"; view: SystemView }).view
    : current.listId === (target as { kind: "list"; listId: string }).listId;
}

function buildCounts(tasks: Task[], lists: TaskList[]) {
  const views: Record<SystemView, number> = {
    all: tasks.length,
    today: tasks.filter((task) => matchesViewCount(task, "today")).length,
    planned: tasks.filter((task) => matchesViewCount(task, "planned")).length,
    important: tasks.filter((task) => matchesViewCount(task, "important")).length,
    completed: tasks.filter((task) => task.status === "done").length,
  };
  const listCounts: Record<string, number> = {};
  for (const list of lists) {
    listCounts[list.id] = tasks.filter((task) => task.listId === list.id).length;
  }
  return { views, lists: listCounts };
}

function matchesViewCount(task: Task, view: SystemView): boolean {
  if (task.status === "done" || task.status === "archived") return false;
  if (view === "today") {
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt);
    const now = new Date();
    return (
      due.getFullYear() === now.getFullYear() &&
      due.getMonth() === now.getMonth() &&
      due.getDate() === now.getDate()
    );
  }
  if (view === "planned") return task.dueAt !== null;
  if (view === "important") return task.priority === 2;
  return true;
}

function pickDefaultListId(scope: TaskScope, lists: TaskList[]): string {
  if (scope.kind === "list") return scope.listId;
  if (lists.some((list) => list.id === "work")) return "work";
  return lists[0]?.id ?? "work";
}

function findList(lists: TaskList[], id: string): TaskList | null {
  return lists.find((list) => list.id === id) ?? null;
}

function emptyDraft(defaultListId: string): TaskDraft {
  return {
    title: "",
    note: "",
    priority: 1,
    listId: defaultListId,
    dueAt: "",
  };
}

function createTaskDraft(task: Task | null, lists: TaskList[]): TaskDraft {
  if (!task) return emptyDraft(pickDefaultListId(defaultTaskScope, lists));
  return {
    title: task.title,
    note: task.note ?? "",
    priority: task.priority,
    listId: task.listId,
    dueAt: toDateTimeLocal(task.dueAt),
  };
}

function getEmptyCopy(scope: TaskScope): {
  icon: LucideIcon;
  title: string;
  body: string;
} {
  if (scope.kind === "view") {
    const copy = taskViewCopy[scope.view];
    const icon =
      scope.view === "today"
        ? Calendar
        : scope.view === "completed"
          ? CheckCircle2
          : scope.view === "important"
            ? Star
            : ListTodo;
    return { icon, title: copy.emptyTitle, body: copy.emptyBody };
  }
  return {
    icon: ListTodo,
    title: "这个清单还没有任务",
    body: "点击添加新任务，把它放进当前清单。",
  };
}

function groupCalendarTasks(tasks: Task[]) {
  const map = new Map<
    string,
    {
      key: string;
      title: string;
      weekday: string;
      isToday: boolean;
      tasks: Task[];
    }
  >();

  for (const task of tasks) {
    const date = formatCalendarDate(task.dueAt);
    const current =
      map.get(date.key) ??
      {
        ...date,
        tasks: [],
      };
    current.tasks.push(task);
    map.set(date.key, current);
  }

  return [...map.values()].sort((left, right) => {
    if (left.key === "unscheduled") return 1;
    if (right.key === "unscheduled") return -1;
    return left.key.localeCompare(right.key);
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
