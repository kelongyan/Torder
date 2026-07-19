import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ListFilter, Plus, Search, Tags, X } from "lucide-react";
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
  onRequestQuickAdd: () => void;
}

export interface TaskToolbarHandle {
  focusSearch: () => void;
  focusQuickAdd: () => void;
}

type ActivePanel = "search" | "add" | "filters" | null;

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
      onRequestQuickAdd,
    },
    ref,
  ) {
    const searchButtonRef = useRef<HTMLButtonElement>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const filterButtonRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const quickAddInputRef = useRef<HTMLInputElement>(null);
    const [activePanel, setActivePanel] = useState<ActivePanel>(null);
    const [query, setQuery] = useState(filters.query);
    const filterCount = useMemo(
      () => countStructuredFilters(filters),
      [filters],
    );

    function focusSearch() {
      if (activePanel === "search") {
        searchInputRef.current?.focus();
        return;
      }
      setActivePanel("search");
    }

    function focusQuickAdd() {
      if (activePanel === "add") {
        quickAddInputRef.current?.focus();
        return;
      }
      setActivePanel("add");
    }

    function closePanel(button: React.RefObject<HTMLButtonElement | null>) {
      setActivePanel(null);
      window.setTimeout(() => button.current?.focus(), 0);
    }

    useImperativeHandle(ref, () => ({ focusSearch, focusQuickAdd }));

    useEffect(() => {
      if (activePanel === "search") searchInputRef.current?.focus();
      if (activePanel === "add") quickAddInputRef.current?.focus();
    }, [activePanel, view]);

    useEffect(() => {
      if (!activePanel) return;

      function handleEscape(event: KeyboardEvent) {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        const button =
          activePanel === "search"
            ? searchButtonRef
            : activePanel === "add"
              ? addButtonRef
              : filterButtonRef;
        closePanel(button);
      }

      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }, [activePanel]);

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

    return (
      <section
        className="fixed right-4 bottom-4 z-40 flex flex-col-reverse items-end gap-4 sm:right-6 sm:bottom-6"
        aria-label="任务快捷操作"
      >
        <div className="shrink-0">
          <div
            className="glass-floating inline-flex flex-col items-center gap-1 rounded-2xl p-1"
            role="toolbar"
            aria-label="任务工具"
            aria-orientation="vertical"
          >
            <button
              ref={searchButtonRef}
              type="button"
              onClick={() => {
                if (activePanel === "search") {
                  closePanel(searchButtonRef);
                } else {
                  focusSearch();
                }
              }}
              aria-label={activePanel === "search" ? "收起搜索" : "搜索任务"}
              aria-expanded={activePanel === "search"}
              aria-controls="task-toolbar-panel"
              title="搜索任务（Ctrl + F）"
              className={toolbarButton(
                activePanel === "search" || !!query.trim(),
              )}
            >
              <Search aria-hidden="true" className="size-[18px]" />
              {query.trim() && activePanel !== "search" && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-emerald-700 dark:bg-blue-300"
                />
              )}
            </button>

            <button
              ref={addButtonRef}
              type="button"
              onClick={() => {
                if (activePanel === "add") {
                  closePanel(addButtonRef);
                } else {
                  onRequestQuickAdd();
                }
              }}
              aria-label={
                activePanel === "add" ? "收起快速添加" : "快速添加任务"
              }
              aria-expanded={activePanel === "add"}
              aria-controls="task-toolbar-panel"
              title="快速添加任务（Ctrl + N）"
              className={toolbarButton(activePanel === "add", true)}
            >
              <Plus aria-hidden="true" className="size-5" />
            </button>

            <button
              ref={filterButtonRef}
              type="button"
              onClick={() => {
                if (activePanel === "filters") {
                  closePanel(filterButtonRef);
                } else {
                  setActivePanel("filters");
                }
              }}
              aria-label={activePanel === "filters" ? "收起筛选" : "筛选任务"}
              aria-expanded={activePanel === "filters"}
              aria-controls="task-toolbar-panel"
              title="筛选任务"
              className={toolbarButton(
                activePanel === "filters" || filterCount > 0,
              )}
            >
              <ListFilter aria-hidden="true" className="size-[18px]" />
              {filterCount > 0 && (
                <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-emerald-900 text-[9px] font-semibold text-white ring-2 ring-white dark:bg-blue-400 dark:text-blue-950 dark:ring-slate-950">
                  {filterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div
          id="task-toolbar-panel"
          className={`grid transition-[grid-template-columns,width,opacity] duration-200 ease-out ${
            activePanel
              ? "w-[min(560px,calc(100vw-2rem))] grid-cols-[1fr] opacity-100"
              : "w-0 grid-cols-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            {activePanel === "search" && (
              <div className="glass-floating liquid-panel rounded-2xl p-2">
                <label className="relative block">
                  <span className="sr-only">搜索任务</span>
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400"
                  />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closePanel(searchButtonRef);
                      }
                    }}
                    placeholder="搜索标题、备注、清单或标签"
                    className="field-control pr-10 pl-10"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        searchInputRef.current?.focus();
                      }}
                      aria-label="清空搜索"
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  )}
                </label>
              </div>
            )}

            {activePanel === "add" && (
              <div className="glass-floating liquid-panel rounded-2xl p-2">
                <QuickAdd
                  ref={quickAddInputRef}
                  view={view}
                  disabled={addDisabled}
                  onCreate={onCreate}
                  onEscape={() => closePanel(addButtonRef)}
                />
              </div>
            )}

            {activePanel === "filters" && (
              <div
                className="glass-floating liquid-panel max-h-[min(70vh,560px)] overflow-y-auto rounded-2xl p-4 sm:p-5"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closePanel(filterButtonRef);
                  }
                }}
              >
                <div className="grid gap-5 lg:grid-cols-2">
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
                        onClick={() =>
                          void onChange({ dateFilter: option.value })
                        }
                        className={filterChip(
                          filters.dateFilter === option.value,
                        )}
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
                      <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
                        标签
                      </h2>
                      <button
                        type="button"
                        onClick={onManageTags}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-900/8 dark:text-blue-300 dark:hover:bg-blue-500/10"
                      >
                        <Tags aria-hidden="true" className="size-3.5" />
                        管理标签
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tags.length === 0 ? (
                        <span className="text-xs text-stone-400">暂无标签</span>
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

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-border-muted)] pt-4">
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    不同类别按 AND 组合，同一类别多选按 OR 匹配。
                  </p>
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
                    className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-200 hover:text-stone-900 disabled:cursor-default disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                  >
                    清空筛选
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
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
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function toolbarButton(active: boolean, primary = false): string {
  const base =
    "glass-button relative grid size-10 place-items-center rounded-xl outline-none duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 dark:focus-visible:outline-blue-300";
  if (active) {
    return `${base} border-emerald-700/40 bg-emerald-900/90 text-white shadow-[0_8px_24px_rgba(5,95,75,.24)] dark:border-blue-300/20 dark:bg-blue-500/70 dark:shadow-[0_8px_26px_rgba(74,111,220,.24)]`;
  }
  if (primary) {
    return `${base} text-emerald-900 hover:bg-emerald-900/8 dark:text-blue-300 dark:hover:bg-blue-500/10`;
  }
  return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100`;
}

function filterChip(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
    active
      ? "border-emerald-800/60 bg-emerald-900/90 text-white shadow-sm dark:border-blue-300/30 dark:bg-blue-500/65"
      : "border-[var(--glass-border-muted)] bg-white/30 text-stone-600 shadow-[inset_0_1px_0_var(--glass-highlight)] hover:border-[var(--glass-border)] hover:bg-white/55 dark:bg-white/5 dark:text-stone-300"
  }`;
}

function checkChip(): string {
  return "inline-flex items-center gap-2 rounded-lg border border-[var(--glass-border-muted)] bg-white/30 px-3 py-1.5 text-xs font-medium text-stone-600 shadow-[inset_0_1px_0_var(--glass-highlight)] transition hover:border-[var(--glass-border)] hover:bg-white/55 dark:bg-white/5 dark:text-stone-300";
}

function countStructuredFilters(filters: TaskFilters): number {
  return [
    Boolean(filters.dateFilter),
    filters.priorities.length > 0,
    filters.listIds.length > 0,
    filters.tagIds.length > 0,
  ].filter(Boolean).length;
}
