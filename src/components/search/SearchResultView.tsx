import { useMemo, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Task, TaskList } from "../../types/database";
import { TaskRow } from "../task/TaskRow";
import { HighlightedText } from "../common/HighlightedText";
import {
  getMatchingSnippet,
  groupTasksByList,
  type TaskListGroup,
} from "./searchUtils";

/**
 * 阶段 D-3 · T-08 独立搜索结果页组件。
 * 负责跨清单展示全库搜索结果，按清单分组展示、关键词 mark 高亮、
 * 描述中匹配摘录预览，并提供保存为视图、快速新建和空态交互。
 */
export function SearchResultView({
  query,
  tasks,
  lists,
  loading,
  selectedTaskId,
  batchMode,
  batchSelectedIds,
  attachmentCounts = {},
  onOpenTask,
  onToggleTask,
  onDeleteTask,
  onRestoreTask,
  onPermanentDeleteTask,
  onToggleBatchSelected,
  onExitSearch,
  onOpenCreateDialog,
  onSaveAsView,
}: {
  query: string;
  tasks: Task[];
  lists: TaskList[];
  loading: boolean;
  selectedTaskId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  attachmentCounts?: Record<string, number>;
  onOpenTask: (task: Task) => void;
  onToggleTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onRestoreTask?: (task: Task) => void;
  onPermanentDeleteTask?: (task: Task) => void;
  onToggleBatchSelected?: (id: string) => void;
  onExitSearch: () => void;
  onOpenCreateDialog?: (initialTitle?: string) => void;
  onSaveAsView?: () => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  const groups = useMemo<TaskListGroup[]>(
    () => groupTasksByList(tasks, lists),
    [tasks, lists],
  );

  const totalActive = useMemo(
    () => tasks.filter((t) => t.status !== "done").length,
    [tasks],
  );

  const totalCompleted = tasks.length - totalActive;

  function toggleGroupCollapse(listId: string) {
    setCollapsedGroups((prev) => ({
      ...prev,
      [listId]: !prev[listId],
    }));
  }

  if (loading && tasks.length === 0) {
    return (
      <div className="list-container search-view-container">
        <div className="skeleton-list" aria-label="搜索中…">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`list-container search-view-container ${batchMode ? "batching" : ""}`}
    >
      {/* 搜索结果页头条 */}
      <header className="search-result-header">
        <div className="search-header-meta">
          <div className="search-header-badge" aria-hidden="true">
            <Search className="icon-sm" />
          </div>
          <div className="search-header-text">
            <h2 className="search-header-title">
              {query.trim() ? (
                <>
                  搜索：
                  <span className="search-header-query">“{query.trim()}”</span>
                </>
              ) : (
                "全库搜索结果"
              )}
            </h2>
            <p className="search-header-sub">
              共找到 {tasks.length} 项（{totalActive} 项进行中
              {totalCompleted > 0 ? `，${totalCompleted} 项已完成` : ""}）
            </p>
          </div>
        </div>

        <div className="search-header-actions">
          {onSaveAsView && tasks.length > 0 && (
            <button
              type="button"
              className="btn-ghost search-save-btn"
              onClick={onSaveAsView}
              title="将此搜索保存为自定义视图"
            >
              <Bookmark aria-hidden="true" className="icon-xs" />
              <span>保存为视图</span>
            </button>
          )}
          <button
            type="button"
            className="btn-ghost search-exit-btn"
            onClick={onExitSearch}
            title="退出搜索 (Esc)"
            aria-label="退出搜索"
          >
            <X aria-hidden="true" className="icon-sm" />
            <span>退出搜索</span>
          </button>
        </div>
      </header>

      {/* 无结果空态 */}
      {tasks.length === 0 ? (
        <div className="empty-state search-empty-state">
          <div className="empty-art" aria-hidden="true">
            <span className="empty-art-lines" />
            <Search />
          </div>
          <h2>未找到匹配事项</h2>
          <p className="search-empty-note">
            没有找到包含 “{query.trim()}”
            的待办事项。您可以更换关键词，或直接以此名称创建事项。
          </p>
          <div className="search-empty-actions">
            {onOpenCreateDialog && query.trim() && (
              <button
                type="button"
                className="empty-action-btn primary"
                onClick={() => onOpenCreateDialog(query.trim())}
              >
                <Plus aria-hidden="true" className="icon-sm" />
                新建 “{query.trim()}”
              </button>
            )}
            <button
              type="button"
              className="empty-action-btn secondary"
              onClick={onExitSearch}
            >
              返回原视图
            </button>
          </div>
        </div>
      ) : (
        /* 分组渲染 */
        <div className="search-groups">
          {groups.map((group) => {
            const isCollapsed = Boolean(collapsedGroups[group.listId]);
            return (
              <section
                key={group.listId}
                className="search-list-group"
                aria-label={`${group.listName}清单匹配项`}
              >
                {/* 清单分组头 */}
                <button
                  type="button"
                  className="search-group-header"
                  onClick={() => toggleGroupCollapse(group.listId)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="search-group-header-left">
                    <span className="search-group-chevron" aria-hidden="true">
                      {isCollapsed ? (
                        <ChevronRight className="icon-xs" />
                      ) : (
                        <ChevronDown className="icon-xs" />
                      )}
                    </span>
                    <span
                      className="search-group-dot"
                      style={{ backgroundColor: group.color }}
                      aria-hidden="true"
                    />
                    <span className="search-group-title">{group.listName}</span>
                  </span>
                  <span className="search-group-count">
                    {group.tasks.length} 项
                    {group.completedCount > 0
                      ? `（已完成 ${group.completedCount}）`
                      : ""}
                  </span>
                </button>

                {/* 组内任务列表 */}
                {!isCollapsed && (
                  <div className="search-group-tasks">
                    {group.tasks.map((task, index) => {
                      const noteSnippet = getMatchingSnippet(task.note, query);
                      return (
                        <div key={task.id} className="search-task-item-wrapper">
                          <TaskRow
                            task={task}
                            lists={lists}
                            selected={task.id === selectedTaskId}
                            batchMode={batchMode}
                            batchSelected={batchSelectedIds.includes(task.id)}
                            motionIndex={index}
                            searchQuery={query}
                            attachmentCount={attachmentCounts[task.id] ?? 0}
                            onOpen={onOpenTask}
                            onToggle={onToggleTask}
                            onDelete={onDeleteTask}
                            onRestore={onRestoreTask}
                            onPermanentDelete={onPermanentDeleteTask}
                            onToggleBatchSelected={
                              onToggleBatchSelected ?? (() => undefined)
                            }
                          />
                          {/* 如果 note 命中了关键词，额外渲染描述摘要预览 */}
                          {noteSnippet && (
                            <div className="search-snippet-bar">
                              <span className="search-snippet-label">
                                描述匹配：
                              </span>
                              <span className="search-snippet-text">
                                <HighlightedText
                                  text={noteSnippet}
                                  query={query}
                                />
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
