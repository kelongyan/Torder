import { forwardRef, useEffect, useMemo, useState } from "react";
import { Filter, Search, Tags, X } from "lucide-react";
import type {
  Tag,
  TaskDateFilter,
  TaskFilters,
  TaskList,
} from "../../types/database";

interface TaskFiltersPanelProps {
  filters: TaskFilters;
  lists: TaskList[];
  tags: Tag[];
  onChange: (filters: Partial<TaskFilters>) => Promise<void>;
  onClear: () => Promise<void>;
  onManageTags: () => void;
}

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

export const TaskFiltersPanel = forwardRef<
  HTMLInputElement,
  TaskFiltersPanelProps
>(function TaskFiltersPanel(
  { filters, lists, tags, onChange, onClear, onManageTags },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState(filters.query);
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

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
    <section className="mt-5" aria-label="搜索和筛选任务">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">搜索任务</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400"
          />
          <input
            ref={ref}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、备注、清单或标签"
            className="field-control pr-9 pl-10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清空搜索"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="task-filter-panel"
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition ${
            expanded || activeCount > 0
              ? "border-emerald-900/20 bg-emerald-900/8 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
          }`}
        >
          <Filter aria-hidden="true" className="size-4" />
          筛选
          {activeCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-emerald-900 text-[11px] text-white">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div
          id="task-filter-panel"
          className="mt-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-700 dark:bg-stone-950/50 sm:p-5"
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
                    className="accent-emerald-900"
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
                    className="accent-emerald-900"
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
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-900/8 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
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
                        className="accent-emerald-900"
                      />
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: tag.color ?? "#78716c" }}
                      />
                      {tag.name}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
            <p className="text-xs text-stone-500 dark:text-stone-400">
              不同类别按 AND 组合，同一类别多选按 OR 匹配。
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                void onClear();
              }}
              disabled={activeCount === 0}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-200 hover:text-stone-900 disabled:cursor-default disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              清空筛选
            </button>
          </div>
        </div>
      )}
    </section>
  );
});

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

function filterChip(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
    active
      ? "border-emerald-900 bg-emerald-900 text-white"
      : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600"
  }`;
}

function checkChip(): string {
  return "inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600";
}

function countActiveFilters(filters: TaskFilters): number {
  return [
    Boolean(filters.query.trim()),
    Boolean(filters.dateFilter),
    filters.priorities.length > 0,
    filters.listIds.length > 0,
    filters.tagIds.length > 0,
  ].filter(Boolean).length;
}
