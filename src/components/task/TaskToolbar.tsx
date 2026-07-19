import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { RotateCcw, Search, Tags, X } from "lucide-react";
import type {
  Tag,
  TaskDateFilter,
  TaskFilters,
  TaskList,
  TaskView,
} from "../../types/database";
import { QuickAdd } from "./QuickAdd";

interface TaskToolbarProps {
  filters: TaskFilters;
  lists: TaskList[];
  tags: Tag[];
  view: TaskView;
  addDisabled: boolean;
  onChange: (filters: Partial<TaskFilters>) => Promise<void>;
  onManageTags: () => void;
  onCreate: (title: string) => Promise<void>;
  onPanelChange: (panel: TaskToolbarPanel) => void;
}

export interface TaskToolbarHandle {
  focusSearch: () => void;
  focusQuickAdd: () => void;
  toggleSearch: () => void;
  toggleQuickAdd: () => void;
  toggleFilters: () => void;
  close: () => void;
}

export type TaskToolbarPanel = "search" | "add" | "filters" | null;

const dateOptions: Array<{ value: TaskDateFilter; label: string }> = [
  { value: "today", label: "今天" },
  { value: "overdue", label: "过期" },
  { value: "next7", label: "未来 7 天" },
  { value: "none", label: "无截止日期" },
];

const priorityOptions = [
  { value: 2 as const, label: "紧急" },
  { value: 1 as const, label: "重要" },
  { value: 0 as const, label: "普通" },
];

export const TaskToolbar = forwardRef<TaskToolbarHandle, TaskToolbarProps>(
  function TaskToolbar(
    {
      filters,
      lists,
      tags,
      view,
      addDisabled,
      onChange,
      onManageTags,
      onCreate,
      onPanelChange,
    },
    ref,
  ) {
    const searchInputRef = useRef<HTMLInputElement>(null);
    const quickAddInputRef = useRef<HTMLInputElement>(null);
    const [activePanel, setActivePanel] = useState<TaskToolbarPanel>(null);
    const [query, setQuery] = useState(filters.query);
    const filterCount = useMemo(
      () => countStructuredFilters(filters),
      [filters],
    );

    function changePanel(nextPanel: TaskToolbarPanel) {
      setActivePanel(nextPanel);
      onPanelChange(nextPanel);
    }

    function focusSearch() {
      if (activePanel === "search") {
        searchInputRef.current?.focus();
        return;
      }
      changePanel("search");
    }

    function focusQuickAdd() {
      if (activePanel === "add") {
        quickAddInputRef.current?.focus();
        return;
      }
      changePanel("add");
    }

    function closePanel(panel = activePanel) {
      changePanel(null);
      const actionId = panel ? `task-action-${panel}` : null;
      if (actionId) {
        window.setTimeout(() => document.getElementById(actionId)?.focus(), 0);
      }
    }

    function toggleSearch() {
      if (activePanel === "search") closePanel("search");
      else focusSearch();
    }

    function toggleQuickAdd() {
      if (activePanel === "add") closePanel("add");
      else focusQuickAdd();
    }

    function toggleFilters() {
      if (activePanel === "filters") closePanel("filters");
      else changePanel("filters");
    }

    useImperativeHandle(ref, () => ({
      focusSearch,
      focusQuickAdd,
      toggleSearch,
      toggleQuickAdd,
      toggleFilters,
      close: () => changePanel(null),
    }));

    useEffect(() => {
      if (activePanel === "search") searchInputRef.current?.focus();
      if (activePanel === "add") quickAddInputRef.current?.focus();
    }, [activePanel, view]);

    useEffect(() => {
      if (!activePanel) return;

      function handleEscape(event: KeyboardEvent) {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        setActivePanel(null);
        onPanelChange(null);
        const actionId = `task-action-${activePanel}`;
        window.setTimeout(() => document.getElementById(actionId)?.focus(), 0);
      }

      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }, [activePanel, onPanelChange]);

    useEffect(() => {
      if (query === filters.query) return;
      const timer = window.setTimeout(() => {
        void onChange({ query });
      }, 250);
      return () => window.clearTimeout(timer);
    }, [filters.query, onChange, query]);

    function toggleNumber(values: number[], value: number): number[] {
      return values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
    }

    function toggleString(values: string[], value: string): string[] {
      return values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
    }

    if (!activePanel) return null;

    return (
      <section
        id="task-toolbar-panel"
        className={`toolbar-panel mt-4 ml-auto w-full ${
          activePanel === "filters" ? "max-w-[600px]" : "max-w-[460px]"
        }`}
        aria-label="任务快捷面板"
      >
        {activePanel === "search" && (
          <div className="glass-floating rounded-[18px] p-1.5">
            <label className="flex min-h-14 items-center gap-2 rounded-[14px] border border-[var(--glass-border-muted)] bg-white/40 p-1.5 pl-2 shadow-[inset_0_1px_0_var(--glass-highlight)] transition focus-within:border-emerald-800/35 focus-within:bg-white/65 dark:bg-white/5 dark:focus-within:border-blue-300/25 dark:focus-within:bg-white/8">
              <span className="sr-only">搜索任务</span>
              <span className="grid size-9 shrink-0 place-items-center text-emerald-900 dark:text-blue-300">
                <Search aria-hidden="true" className="size-[18px]" />
              </span>
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closePanel("search");
                  }
                }}
                placeholder="搜索事项…"
                className="h-10 min-w-0 flex-1 bg-transparent px-1 text-[15px] leading-6 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="清空搜索"
                  title="清空搜索"
                  className="glass-button grid size-10 shrink-0 place-items-center rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              )}
            </label>
          </div>
        )}

        {activePanel === "add" && (
          <div className="glass-floating rounded-[18px] p-1.5">
            <QuickAdd
              ref={quickAddInputRef}
              view={view}
              disabled={addDisabled}
              onCreate={onCreate}
              onEscape={() => closePanel("add")}
            />
          </div>
        )}

        {activePanel === "filters" && (
          <div
            className="glass-floating max-h-[min(70vh,560px)] overflow-y-auto rounded-[20px] bg-white/95 p-4 dark:bg-slate-950/95 sm:p-5"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePanel("filters");
              }
            }}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <FilterGroup title="日期">
                <button
                  type="button"
                  onClick={() => void onChange({ dateFilter: null })}
                  className={filterChip(filters.dateFilter === null)}
                  aria-pressed={filters.dateFilter === null}
                >
                  不限
                </button>
                {dateOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void onChange({ dateFilter: option.value })}
                    className={filterChip(filters.dateFilter === option.value)}
                    aria-pressed={filters.dateFilter === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </FilterGroup>

              <FilterGroup title="优先级">
                {priorityOptions.map((option) => (
                  <label key={option.value} className={checkChip()}>
                    <input
                      type="checkbox"
                      checked={filters.priorities.includes(option.value)}
                      onChange={() =>
                        void onChange({
                          priorities: toggleNumber(
                            filters.priorities,
                            option.value,
                          ),
                        })
                      }
                      className="accent-[var(--accent)]"
                    />
                    {option.label}
                  </label>
                ))}
              </FilterGroup>

              <FilterGroup title="清单">
                {lists.map((list) => (
                  <label key={list.id} className={checkChip()}>
                    <input
                      type="checkbox"
                      checked={filters.listIds.includes(list.id)}
                      onChange={() =>
                        void onChange({
                          listIds: toggleString(filters.listIds, list.id),
                        })
                      }
                      className="accent-[var(--accent)]"
                    />
                    {list.name}
                  </label>
                ))}
              </FilterGroup>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="field-label">标签</h2>
                  <button
                    type="button"
                    onClick={onManageTags}
                    aria-label="管理标签"
                    title="管理标签"
                    className="glass-button grid size-8 place-items-center rounded-lg text-emerald-900 hover:bg-emerald-900/8 dark:text-blue-300 dark:hover:bg-blue-500/10"
                  >
                    <Tags aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.length === 0 ? (
                    <span className="meta-copy">暂无标签</span>
                  ) : (
                    tags.map((tag) => (
                      <label key={tag.id} className={checkChip()}>
                        <input
                          type="checkbox"
                          checked={filters.tagIds.includes(tag.id)}
                          onChange={() =>
                            void onChange({
                              tagIds: toggleString(filters.tagIds, tag.id),
                            })
                          }
                          className="accent-[var(--accent)]"
                        />
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: tag.color ?? "#78716c",
                          }}
                        />
                        {tag.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end border-t border-[var(--glass-border-muted)] pt-4">
              <button
                type="button"
                onClick={() =>
                  void onChange({
                    dateFilter: null,
                    priorities: [],
                    listIds: [],
                    tagIds: [],
                  })
                }
                disabled={filterCount === 0}
                aria-label="清空筛选"
                title="清空筛选"
                className="glass-button grid size-9 place-items-center rounded-lg text-stone-500 hover:bg-stone-200 hover:text-stone-900 disabled:cursor-default disabled:opacity-35 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    );
  },
);

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="field-label mb-2">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function filterChip(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-[13px] leading-5 font-medium transition ${
    active
      ? "border-emerald-800/60 bg-emerald-900/90 text-white shadow-sm dark:border-blue-300/30 dark:bg-blue-500/65"
      : "border-[var(--glass-border-muted)] bg-white/30 text-stone-600 shadow-[inset_0_1px_0_var(--glass-highlight)] hover:border-[var(--glass-border)] hover:bg-white/55 dark:bg-white/5 dark:text-stone-300"
  }`;
}

function checkChip(): string {
  return "inline-flex items-center gap-2 rounded-lg border border-[var(--glass-border-muted)] bg-white/30 px-3 py-1.5 text-[13px] leading-5 font-medium text-stone-600 shadow-[inset_0_1px_0_var(--glass-highlight)] transition hover:border-[var(--glass-border)] hover:bg-white/55 dark:bg-white/5 dark:text-stone-300";
}

function countStructuredFilters(filters: TaskFilters): number {
  return [
    Boolean(filters.dateFilter),
    filters.priorities.length > 0,
    filters.listIds.length > 0,
    filters.tagIds.length > 0,
  ].filter(Boolean).length;
}
