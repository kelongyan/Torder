/**
 * mobile/pages/sub.tsx — 移动端次级页（页面栈 push 目标，M-A）
 *   /view/:view /list/:listId /tag/:tag → TaskListPage（复用 taskQuery + TaskRow）
 *   /task/:id → TaskDetailPage（复用 TaskDetailPanel，全屏呈现）
 *   其余（search/recurring/focus/review）→ 占位页（对应批次实装）
 */
import { useMemo, type JSX } from "react";
import { CalendarDays, Flame, Repeat2, Search, TrendingUp } from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { listScope, viewScope } from "../../stores/taskStore";
import { emptyTaskFilter, type TaskScope } from "../../types/database";
import { filterAndSortTasks } from "../../services/taskQuery";
import { taskViewCopy } from "../../constants/taskViews";
import { getScopeTitle } from "../../utils/taskHelpers";
import { TaskDetailPanel } from "../../components/detail/TaskDetailPanel";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { EmptyView, ScreenShell, TopBar } from "../ui";
import { MobileTaskRows } from "./rows";
import type { Task } from "../../types/database";

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
  const allTasks = useTaskStore((s) => s.allTasks);
  const sortBy = useTaskStore((s) => s.sortBy) ?? "priority";
  const sortAsc = useTaskStore((s) => s.sortAsc);

  const scope: TaskScope | null = useMemo(() => {
    if (kind === "view" && view) return viewScope(view as never);
    if (kind === "list" && listId) return listScope(listId);
    return null;
  }, [kind, view, listId]);

  const isDeleted =
    kind === "view" && (view === "deleted" || view === "completed");

  const rows = useMemo(() => {
    if (!scope) return [];
    const input = {
      scope,
      query: "",
      sortBy,
      sortAsc,
      showCompleted: kind === "view" && view === "completed",
      filter:
        kind === "tag" && tag ? { ...emptyTaskFilter, tags: [tag] } : null,
    };
    return filterAndSortTasks(allTasks, input);
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
      const list = props.lists.find((l) => l.id === listId);
      return list?.name ?? "清单";
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
        <MobileTaskRows
          tasks={rows}
          lists={props.lists}
          attachmentCounts={props.attachmentCounts}
          deleted={isDeleted && kind === "view" && view === "deleted"}
          onOpen={openTask}
          onToggle={props.onToggleTask}
          onDelete={props.onDeleteTask}
          onRestore={props.onRestoreTask}
          onPermanentDelete={props.onPermanentDeleteTask}
        />
      )}
    </ScreenShell>
  );
}

/* ================= 任务详情页（全屏承载 TaskDetailPanel） ================= */

export function TaskDetailPage({ taskId }: { taskId: string }): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const allTasks = useTaskStore((s) => s.allTasks);
  const loading = useTaskStore((s) => s.loading);

  const task = useMemo(
    () => allTasks.find((t) => t.id === taskId) ?? null,
    [allTasks, taskId],
  );

  if (!task) {
    return (
      <ScreenShell
        topbar={<TopBar back onBack={() => nav.back()} title="任务详情" />}
      >
        <EmptyView title="任务不存在或已删除" />
      </ScreenShell>
    );
  }

  return (
    <div className="m-detail-host">
      <TaskDetailPanel
        task={task}
        lists={props.lists}
        busy={loading}
        onClose={() => nav.back()}
        onSave={props.onSaveTask}
        onToggle={(item) => props.onToggleTask(item)}
        onDelete={props.onDeleteTask}
        onOpenRecurring={() => nav.push("/recurring")}
        onOpenTask={(id) => nav.push(`/task/${id}`)}
        onToast={props.onToast}
      />
    </div>
  );
}

/* ================= 占位页（后续批次实装） ================= */

const PLACEHOLDER_META: Record<
  string,
  { title: string; note: string; icon: JSX.Element; batch: string }
> = {
  "/search": {
    title: "搜索",
    note: "全库搜索页（含常用标签）将在批次 M-B 实装",
    icon: <Search aria-hidden="true" />,
    batch: "M-B",
  },
  "/recurring": {
    title: "循环任务",
    note: "循环规则列表页将在批次 M-B 实装",
    icon: <Repeat2 aria-hidden="true" />,
    batch: "M-B",
  },
  "/focus": {
    title: "专注模式",
    note: "专注计时页将在批次 M-C 实装",
    icon: <Flame aria-hidden="true" />,
    batch: "M-C",
  },
  "/review": {
    title: "每日回顾",
    note: "每日回顾页将在批次 M-C 实装",
    icon: <CalendarDays aria-hidden="true" />,
    batch: "M-C",
  },
};

export function PlaceholderPage({ path }: { path: string }): JSX.Element {
  const { nav } = useMobilePage();
  const meta = PLACEHOLDER_META[path] ?? {
    title: "建设中",
    note: "该页面将在后续批次实装",
    icon: <TrendingUp aria-hidden="true" />,
    batch: "M-B",
  };
  return (
    <ScreenShell
      topbar={<TopBar back onBack={() => nav.back()} title={meta.title} />}
    >
      <EmptyView
        icon={meta.icon}
        title={`${meta.title}（${meta.batch}）`}
        body={meta.note}
      />
    </ScreenShell>
  );
}
