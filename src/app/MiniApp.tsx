import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { TaskList } from "../types/database";
import { createTask } from "../services/taskService";
import { listLists } from "../services/listService";
import { notifyTasksChanged } from "../services/widgetService";
import { parseQuickAddText } from "../utils/taskHelpers";
import "../styles/mini.css";

/**
 * 迷你速记窗入口（阶段 B / T-03）：`#mini` 路由渲染。
 * 无边框独立窗口：输入自然语言（明天 3 点 #工作 !高 交周报），
 * 下方实时预览解析结果（把日期 token 渲染成具体日期供确认），
 * Enter 创建后自动关闭（Rust 端失焦/关闭均转隐藏）。创建成功经
 * `notifyTasksChanged("mini")` 广播，主窗 task 列表自动重拉。
 */

function previewDate(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MiniApp() {
  const [text, setText] = useState("");
  const [lists, setLists] = useState<TaskList[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void listLists()
      .then(setLists)
      .catch(() => setLists([]));
    inputRef.current?.focus();
  }, []);

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAddText(text, lists) : null),
    [lists, text],
  );
  const canSubmit = Boolean(parsed?.title.trim()) && !busy;

  const hide = () => void getCurrentWindow().close();

  async function handleSubmit() {
    if (!parsed?.title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createTask({
        title: parsed.title.trim(),
        priority: parsed.priority ?? 1,
        listId:
          parsed.listId ??
          (lists.find((list) => list.id === "work")
            ? "work"
            : (lists[0]?.id ?? "work")),
        tags: parsed.tags,
        dueAt: parsed.dueAt,
        scheduledDate: null,
        remindBefore: null,
      });
      notifyTasksChanged("mini");
      hide();
    } catch (cause) {
      setError(
        `创建失败：${cause instanceof Error ? cause.message : String(cause)}`,
      );
      setBusy(false);
    }
  }

  return (
    <div className="mini-root">
      <div className="mini-field">
        <input
          ref={inputRef}
          className="mini-input"
          type="text"
          autoComplete="off"
          value={text}
          placeholder="速记：明天 3 点 #工作 !高 交周报"
          aria-label="快速创建任务"
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSubmit();
            if (event.key === "Escape") hide();
          }}
        />
        <button
          type="button"
          className="mini-submit"
          disabled={!canSubmit}
          aria-label="创建任务"
          onClick={() => void handleSubmit()}
        >
          ↵
        </button>
      </div>

      {parsed && parsed.title.trim() && (
        <div className="mini-preview">
          <span className="mini-preview-title">{parsed.title.trim()}</span>
          <span className="mini-preview-chips">
            {parsed.priority !== undefined && (
              <span className="mini-chip">
                {parsed.priority === 2
                  ? "高"
                  : parsed.priority === 1
                    ? "中"
                    : "低"}
              </span>
            )}
            {parsed.dueAt && (
              <span className="mini-chip mini-chip--date">
                {previewDate(parsed.dueAt)}
              </span>
            )}
            {parsed.listId && (
              <span className="mini-chip">
                {lists.find((list) => list.id === parsed.listId)?.name ??
                  "清单"}
              </span>
            )}
            {parsed.tags.map((tag) => (
              <span key={tag} className="mini-chip">
                #{tag}
              </span>
            ))}
          </span>
        </div>
      )}
      {error && <div className="mini-error">{error}</div>}
    </div>
  );
}
