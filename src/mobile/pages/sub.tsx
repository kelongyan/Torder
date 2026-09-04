/**
 * mobile/pages/sub.tsx — 移动端次级页（列表类）
 *   /view/:view /list/:listId /tag/:tag → TaskListPage（复用 taskQuery + MobileTaskRow）
 */
import { useMemo, type JSX } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { listScope, viewScope } from "../../stores/taskStore";
import { emptyTaskFilter } from "../../types/database";
import type { TaskScope, Task } from "../../types/database";
import { filterAndSortTasks } from "../../services/taskQuery";
import { taskViewCopy } from "../../constants/taskViews";
import { getScopeTitle } from "../../utils/taskHelpers";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { useTaskMore } from "../parts/TaskMoreMenu";
import { EmptyView, ScreenShell, TopBar } from "../ui";
import { MobileTaskRows } from "../parts/MobileTaskRows";

/* ================= 任务列表页（view / list / tag） ================= */

export function TaskListPage({
  kind,
  view,
  listId,
  tag,
}: {
  kind: "view" | "list" | "tag";
  view?: string;
  listId?: string;
  tag?: string;
}): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const { openMore, moreMenu } = useTaskMore();
  const allTasks = useTaskStore((s) => s.allTasks);
  const sortBy = useTaskStore((s) => s.sortBy) ?? "priority";
  const sortAsc = useTaskStore((s) => s.sortAsc);

  const scope: TaskScope | null = useMemo(() => {
    if (kind === "view" && view) return viewScope(view as never);
    if (kind === "list" && listId) return listScope(listId);
    return null;
  }, [kind, view, listId]);

  const isDeletedView = kind === "view" && view === "deleted";

  const rows = useMemo(() => {
    if (!scope) return [];
    return filterAndSortTasks(allTasks, {
      scope,
      query: "",
      sortBy,
      sortAsc,
      showCompleted: kind === "view" && view === "completed",
      filter:
        kind === "tag" && tag ? { ...emptyTaskFilter, tags: [tag] } : null,
    });
  }, [allTasks, scope, sortBy, sortAsc, kind, view, tag]);

  const title = useMemo(() => {
    if (
      kind === "view" &&
      view &&
      taskViewCopy[view as keyof typeof taskViewCopy]
    ) {
      return taskViewCopy[view as keyof typeof taskViewCopy].title;
    }
    if (kind === "list" && listId) {
      return props.lists.find((l) => l.id === listId)?.name ?? "清单";
    }
    if (kind === "tag" && tag) return `#${tag}`;
    return getScopeTitle(scope ?? viewScope("all"), props.lists);
  }, [kind, view, listId, tag, props.lists, scope]);

  const openTask = (task: Task) => nav.push(`/task/${task.id}`);

  return (
    <ScreenShell
      topbar={
        <TopBar
          back
          onBack={() => nav.back()}
          title={title}
          sub={`${rows.length} 项`}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyView
          title={
            kind === "view" &&
            view &&
            taskViewCopy[view as keyof typeof taskViewCopy]
              ? taskViewCopy[view as keyof typeof taskViewCopy].emptyTitle
              : "这里没有任务"
          }
          body="点击下方 ＋ 新建一项"
        />
      ) : (
        <>
          <MobileTaskRows
            tasks={rows}
            lists={props.lists}
            attachmentCounts={props.attachmentCounts}
            deleted={isDeletedView}
            onOpen={openTask}
            onToggle={props.onToggleTask}
            onDelete={props.onDeleteTask}
            onRestore={props.onRestoreTask}
            onPermanentDelete={props.onPermanentDeleteTask}
            onMore={openMore}
          />
          {moreMenu}
        </>
      )}
    </ScreenShell>
  );
}
