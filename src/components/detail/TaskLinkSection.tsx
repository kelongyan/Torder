import { useEffect, useMemo, useState } from "react";
import { Link2, Search, Trash2 } from "lucide-react";
import type { Task, TaskLink, TaskList } from "../../types/database";
import type { ToastKind } from "../../types/ui";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import {
  createTaskLink,
  deleteTaskLink,
  listTaskLinks,
  searchLinkableTasks,
} from "../../services/taskLinkService";
import { normalizeError } from "../../utils/normalizeError";
import {
  formatTaskDateTime,
  formatTaskScheduleDate,
} from "../../utils/taskDates";
import { HighlightedText } from "../common/HighlightedText";

type ToastSink = (message: string, type: ToastKind) => void;

export function TaskLinkSection({
  task,
  lists,
  onOpenTask,
  onToast,
}: {
  task: Task;
  lists: TaskList[];
  onOpenTask: (taskId: string) => void;
  onToast: ToastSink;
}) {
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLinks() {
    setLoading(true);
    setError(null);
    try {
      setLinks(await listTaskLinks(task.id));
    } catch (loadError) {
      setError(normalizeError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
      void listTaskLinks(task.id)
        .then((next) => {
          if (active) setLinks(next);
        })
        .catch((loadError) => {
          if (active) setError(normalizeError(loadError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [task.id]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchLinkableTasks(task.id, query, 8)
        .then((next) => {
          if (active) setCandidates(next);
        })
        .catch((searchError) => {
          if (active) setError(normalizeError(searchError));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, task.id, links.length]);

  const linkedTargetIds = useMemo(
    () => new Set(links.map((link) => link.targetTaskId)),
    [links],
  );
  const visibleCandidates = candidates.filter(
    (candidate) => !linkedTargetIds.has(candidate.id),
  );

  async function addLink(targetTaskId: string) {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      await createTaskLink({
        sourceTaskId: task.id,
        targetTaskId,
      });
      await loadLinks();
      setQuery("");
      onToast("任务引用已添加", "success");
    } catch (addError) {
      const message = normalizeError(addError);
      setError(message);
      onToast(message, "error");
    } finally {
      setMutating(false);
    }
  }

  async function removeLink(link: TaskLink) {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      await deleteTaskLink(link.id);
      await loadLinks();
      onToast("任务引用已移除", "info");
    } catch (deleteError) {
      const message = normalizeError(deleteError);
      setError(message);
      onToast(message, "error");
    } finally {
      setMutating(false);
    }
  }

  return (
    <section className="detail-section task-link-section">
      <div className="detail-section-header">
        <strong>引用任务</strong>
        <span className="attachment-section-meta">
          {loading ? "加载中" : `${links.length} 个`}
        </span>
      </div>

      <label className="task-link-search">
        <Search aria-hidden="true" className="icon-sm" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={mutating}
        />
      </label>

      {(query.trim() || visibleCandidates.length > 0) && (
        <div className="task-link-candidates">
          {visibleCandidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => void addLink(candidate.id)}
              disabled={mutating}
            >
              <TaskLinkSummary task={candidate} lists={lists} query={query} />
            </button>
          ))}
          {!searching && visibleCandidates.length === 0 && (
            <p className="attachment-empty">没有可引用的任务。</p>
          )}
        </div>
      )}

      {error && <p className="task-link-error">{error}</p>}

      <div className="task-link-list">
        {links.map((link) => (
          <div key={link.id} className="task-link-row">
            <button
              type="button"
              className="task-link-open"
              onClick={() => onOpenTask(link.targetTaskId)}
              disabled={mutating}
            >
              <Link2 aria-hidden="true" />
              <TaskLinkLinkSummary link={link} lists={lists} />
            </button>
            <button
              type="button"
              className="icon-button compact danger"
              onClick={() => void removeLink(link)}
              disabled={mutating}
              aria-label="删除任务引用"
              title="删除引用"
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        ))}
        {!loading && links.length === 0 && (
          <p className="attachment-empty">搜索任务后可建立引用。</p>
        )}
      </div>
    </section>
  );
}

function TaskLinkSummary({
  task,
  lists,
  query,
}: {
  task: Task;
  lists: TaskList[];
  query: string;
}) {
  const list = lists.find((item) => item.id === task.listId);
  const meta = taskMeta(task.scheduledDate, task.dueAt);
  return (
    <>
      <span
        className="detail-attr-dot"
        style={{ background: list?.color ?? DEFAULT_LIST_COLOR }}
      />
      <span className="task-link-summary-main">
        <strong>
          <HighlightedText text={task.title} query={query} />
        </strong>
        <span>
          {list?.name ?? "未分类"}
          {meta ? ` · ${meta}` : ""}
        </span>
      </span>
    </>
  );
}

function TaskLinkLinkSummary({
  link,
  lists,
}: {
  link: TaskLink;
  lists: TaskList[];
}) {
  const list = lists.find((item) => item.id === link.targetListId);
  const meta = taskMeta(link.targetScheduledDate, link.targetDueAt);
  return (
    <span className="task-link-summary-main">
      <strong>{link.targetTitle ?? "引用任务"}</strong>
      <span>
        {list?.name ?? "未分类"}
        {link.targetStatus === "done" ? " · 已完成" : ""}
        {meta ? ` · ${meta}` : ""}
      </span>
    </span>
  );
}

function taskMeta(scheduledDate: string | null, dueAt: string | null): string {
  if (scheduledDate)
    return formatTaskScheduleDate(scheduledDate) ?? scheduledDate;
  if (dueAt) return formatTaskDateTime(dueAt);
  return "";
}
