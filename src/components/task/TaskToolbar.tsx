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

    const isAdd = activePanel === "add";

    return (
      <section
        id="task-toolbar-panel"
        className={`mt-3 w-full ${
          isAdd
            ? "quickadd-drop"
            : `toolbar-panel ml-auto ${
                activePanel === "filters" ? "max-w-[600px]" : "max-w-[460px]"
              }`
        }`}
        aria-label="任务快捷面板"
      >
        {activePanel === "search" && (
          <div className="glass-floating rounded-[var(--radius-lg)] p-1.5">
            <label className="flex min-h-12 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--glass-border-muted)] bg-[var(--glass-control)] p-1.5 pl-2 shadow-[inset_0_1px_0_var(--glass-highlight)] transition-[border-color,background-color] duration-[var(--duration-fast)] focus-within:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus-within:bg-[var(--glass-panel)]">
              <span className="sr-only">搜索任务</span>
              <span className="grid size-8 shrink-0 place-items-center text-[var(--accent)]">
                <Search aria-hidden="true" className="size-4" />
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
                className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
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
                  className="glass-button grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              )}
            </label>
          </div>
        )}

        {activePanel === "add" && (
          <QuickAdd
            ref={quickAddInputRef}
            view={view}
            disabled={addDisabled}
            onCreate={onCreate}
            onEscape={() => closePanel("add")}
          />
        )}

        {activePanel === "filters" && (
          <div
            className="glass-floating max-h-[min(70vh,560px)] overflow-y-auto rounded-[var(--radius-lg)] p-4 sm:p-5"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePanel("filters");
              }
            }}
          >
            {/* Active filter summary */}
            {filterCount > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                <span className="meta-copy mr-1">当前筛选：</span>
                {filters.dateFilter && (
                  <FilterSummaryChip
                    label={
                      dateOptions.find((o) => o.value === filters.dateFilter)
                        ?.label ?? filters.dateFilter
                    }
                    onClear={() => void onChange({ dateFilter: null })}
                  />
                )}
                {filters.priorities.map((p) => (
                  <FilterSummaryChip
                    key={p}
                    label={
                      priorityOptions.find((o) => o.value === p)?.label ??
                      String(p)
                    }
                    onClear={() =>
                      void onChange({
                        priorities: filters.priorities.filter((v) => v !== p),
                      })
                    }
                  />
                ))}
                {filters.listIds.map((id) => (
                  <FilterSummaryChip
                    key={id}
                    label={lists.find((l) => l.id === id)?.name ?? id}
                    onClear={() =>
                      void onChange({
                        listIds: filters.listIds.filter((v) => v !== id),
                      })
                    }
                  />
                ))}
                {filters.tagIds.map((id) => (
                  <FilterSummaryChip
                    key={id}
                    label={tags.find((t) => t.id === id)?.name ?? id}
                    onClear={() =>
                      void onChange({
                        tagIds: filters.tagIds.filter((v) => v !== id),
                      })
                    }
                  />
                ))}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <FilterGroup title="日期">
                <button
                  type="button"
                  onClick={() => void onChange({ dateFilter: null })}
                  className={`chip ${filters.dateFilter === null ? "chip-active" : ""}`}
                  aria-pressed={filters.dateFilter === null}
                >
                  不限
                </button>
                {dateOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void onChange({ dateFilter: option.value })}
                    className={`chip ${filters.dateFilter === option.value ? "chip-active" : ""}`}
                    aria-pressed={filters.dateFilter === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </FilterGroup>

              <FilterGroup title="优先级">
                {priorityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      void onChange({
                        priorities: toggleNumber(
                          filters.priorities,
                          option.value,
                        ),
                      })
                    }
                    className={`chip ${filters.priorities.includes(option.value) ? "chip-active" : ""}`}
                    aria-pressed={filters.priorities.includes(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </FilterGroup>

              <FilterGroup title="清单">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() =>
                      void onChange({
                        listIds: toggleString(filters.listIds, list.id),
                      })
                    }
                    className={`chip ${filters.listIds.includes(list.id) ? "chip-active" : ""}`}
                    aria-pressed={filters.listIds.includes(list.id)}
                  >
                    {list.color && (
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: list.color }}
                      />
                    )}
                    {list.name}
                  </button>
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
                    className="glass-button grid size-7 place-items-center rounded-[var(--radius-sm)] text-[var(--accent)] hover:bg-[var(--accent-muted)]"
                  >
                    <Tags aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.length === 0 ? (
                    <span className="meta-copy">暂无标签</span>
                  ) : (
                    tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          void onChange({
                            tagIds: toggleString(filters.tagIds, tag.id),
                          })
                        }
                        className={`chip ${filters.tagIds.includes(tag.id) ? "chip-active" : ""}`}
                        aria-pressed={filters.tagIds.includes(tag.id)}
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: tag.color ?? "#78716c",
                          }}
                        />
                        {tag.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end border-t border-[var(--glass-border-muted)] pt-3">
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
                className="btn-secondary min-h-8 px-3 text-[13px] disabled:opacity-35"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                重置筛选
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
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterSummaryChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`移除筛选：${label}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--accent-muted)]"
      >
        <X aria-hidden="true" className="size-2.5" />
      </button>
    </span>
  );
}

function countStructuredFilters(filters: TaskFilters): number {
  return [
    Boolean(filters.dateFilter),
    filters.priorities.length > 0,
    filters.listIds.length > 0,
    filters.tagIds.length > 0,
  ].filter(Boolean).length;
}
