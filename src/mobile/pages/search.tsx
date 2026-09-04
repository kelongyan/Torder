/**
 * mobile/pages/search.tsx — 全库搜索页（M-B）
 * 语义 = taskQuery.filterAndSortTasks 的文本/标签/p:/l: 查询（与桌面全局搜索同源）。
 * 常用标签 chips 快捷进入标签列表页。
 */
import { useMemo, useState, type JSX } from "react";
import { Hash, Search, X } from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { viewScope } from "../../stores/taskStore";
import { filterAndSortTasks } from "../../services/taskQuery";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { useTaskMore } from "../parts/TaskMoreMenu";
import { EmptyView, ScreenShell, TopBar } from "../ui";
import { MobileTaskRows } from "../parts/MobileTaskRows";

export function SearchScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const { openMore, moreMenu } = useTaskMore();
  const allTasks = useTaskStore((s) => s.allTasks);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return filterAndSortTasks(allTasks, {
      scope: viewScope("all"),
      query: q,
      sortBy: "created",
      sortAsc: false,
      showCompleted: false,
    });
  }, [allTasks, query]);

  const hotTags = props.tags.slice(0, 8);

  return (
    <ScreenShell
      topbar={
        <TopBar
          back
          onBack={() => nav.back()}
          title="搜索"
          sub={query.trim() ? `共 ${results.length} 项` : undefined}
        />
      }
    >
      <div className="m-search-box">
        <Search aria-hidden="true" />
        <input
          className="m-search-input"
          placeholder="搜索标题、备注或 #标签"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="m-search-clear"
            aria-label="清空"
            onClick={() => setQuery("")}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {!query.trim() ? (
        <div className="m-search-hints">
          {hotTags.length > 0 && (
            <>
              <div className="m-section-title">常用标签</div>
              <div className="m-tag-row">
                {hotTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="m-tag-pill"
                    onClick={() => nav.push(`/tag/${encodeURIComponent(tag)}`)}
                  >
                    <Hash aria-hidden="true" /> {tag}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : results.length === 0 ? (
        <EmptyView
          title="没有匹配的任务"
          body="换个关键词，或用 p: / l: / # 精确搜索"
        />
      ) : (
        <>
          <MobileTaskRows
            tasks={results}
            lists={props.lists}
            attachmentCounts={props.attachmentCounts}
            onOpen={(task) => nav.push(`/task/${task.id}`)}
            onToggle={props.onToggleTask}
            onDelete={props.onDeleteTask}
            onMore={openMore}
          />
          {moreMenu}
        </>
      )}
    </ScreenShell>
  );
}
