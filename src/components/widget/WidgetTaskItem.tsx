import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Task } from "../../types/database";
import { widgetSpanBadge } from "../../services/widgetService";

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

/**
 * 单行事项。竖版便签里标题最多换行 2 行，所以整行（含行尾空白）都是双击
 * 热区（noteDblEdit 开启时就地编辑）；复选框 click/dblclick 各自
 * stopPropagation，避免冒泡到 article 重复触发。
 * `data-tauri-drag-region="false"`：外层 stage 是 "deep"（整页可拖），
 * 行尾空白不是 BUTTON，不显式关掉就会被当成拖拽起手点。
 *
 * 双击就地编辑（2026-09-14）：标题原位换成自动增高的 textarea——纸面隐喻
 * 「同一行上擦掉重写」，字体字号行高墨色与展示态完全一致，编辑态的额外
 * 视觉只有一条虚线下划线（widget.css `.widget-item-edit-input`）。
 * Enter 落笔、Esc 作废、失焦落笔；空标题视为作废。编辑期间行尾元信息
 * （时间/色点/跨天标识）退场，输入框占满整行。
 */
export function WidgetTaskItem({
  task,
  listColor,
  busy,
  editable,
  onToggle,
  onRename,
}: {
  task: Task;
  listColor: string | null;
  busy: boolean;
  /** noteDblEdit：双击就地编辑开关（设置 → 桌面与启动） */
  editable: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
}) {
  const completed = task.status === "done";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Esc 作废标记：卸载前若还有 blur 冒进来，commit 据此让路 */
  const cancelledRef = useRef(false);
  // 编辑态隐藏行尾元信息：输入框需要整行宽度
  const time = editing ? null : formatTime(task.dueAt);
  const spanBadge = editing ? null : widgetSpanBadge(task);

  const className = [
    "widget-item",
    completed ? "is-done" : "",
    task.priority === 2 ? "is-high" : "",
    busy ? "is-busy" : "",
    editing ? "is-editing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // 进入编辑：聚焦 + 全选（改名范式：直接键入即覆盖）
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    input.style.height = `${input.scrollHeight}px`;
  }, [editing]);

  // 草稿变化：按内容重算高度（CSS max-height 封顶 2 行，超出内部滚动）。
  // editing 也在依赖里：进入编辑的那一拍与上面聚焦 effect 各算一次，幂等无妨。
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [editing, draft]);

  function enterEdit() {
    cancelledRef.current = false;
    setDraft(task.title);
    setEditing(true);
  }

  function cancelEdit() {
    cancelledRef.current = true;
    setEditing(false);
  }

  function commit() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    setEditing(false);
    const next = draft.trim();
    if (!next || next === task.title) return;
    onRename(next);
  }

  return (
    <article
      className={className}
      data-task-id={task.id}
      data-tauri-drag-region="false"
      onDoubleClick={(event) => {
        if (!editable || busy) return;
        // 双击选词是浏览器默认行为，编辑态本身就是选词的目的地，拦掉
        event.preventDefault();
        enterEdit();
      }}
    >
      <button
        type="button"
        className={`widget-item-checkbox ${completed ? "checked" : ""}`.trim()}
        aria-label={completed ? "取消完成" : "完成任务"}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {completed && <Check aria-hidden="true" />}
      </button>
      {editing ? (
        <textarea
          ref={inputRef}
          className="widget-item-edit-input"
          value={draft}
          rows={1}
          spellCheck={false}
          aria-label="编辑事项标题"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            // IME 组合中的 Enter/Esc 属于输入法会话（确认/取消候选），
            // 不是编辑器的落笔/作废——放行给输入法
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
        />
      ) : (
        <>
          <span className="widget-item-title" title={task.title}>
            {task.title}
          </span>
          {listColor && (
            <span
              className="widget-item-dot"
              style={{ background: listColor }}
            />
          )}
          {spanBadge && <span className="widget-item-until">{spanBadge}</span>}
          {time && <span className="widget-item-time">{time}</span>}
        </>
      )}
    </article>
  );
}
