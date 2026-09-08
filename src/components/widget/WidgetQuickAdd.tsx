import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { CreateTaskInput, TaskList } from "../../types/database";
import { parseQuickAddText } from "../../utils/taskHelpers";

export function WidgetQuickAdd({
  open,
  lists,
  defaultListId,
  targetDateKey,
  onCreate,
  onClose,
}: {
  /**
   * 展开/收起由父组件受控。本组件**常挂载**（不再条件渲染卸载），
   * 展开收起动画由 CSS grid-template-rows 过渡承担（方案书 D-2）；
   * 收起时清空草稿并释放焦点，与旧「卸载丢状态」行为一致。
   */
  open: boolean;
  lists: TaskList[];
  defaultListId: string;
  targetDateKey: string;
  onCreate: (input: CreateTaskInput) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 收起时清空草稿（与旧「条件渲染卸载丢状态」行为一致）。
  // 按 React 官方「render 期间调整 state」模式写，绕开
  // react-hooks/set-state-in-effect（effect 内同步 setState 被禁）。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setTitle("");
  }

  // 展开时自动聚焦（DOM 副作用放 effect）；收起时释放焦点
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      inputRef.current?.blur();
    }
  }, [open]);

  async function handleSubmit() {
    const text = title.trim();
    if (!text || busy) return;
    const parsed = parseQuickAddText(text, lists);
    if (!parsed.title.trim()) return;
    const listId =
      parsed.listId ??
      (lists.some((list) => list.id === defaultListId)
        ? defaultListId
        : "work");
    setBusy(true);
    try {
      await onCreate({
        title: parsed.title.trim(),
        priority: parsed.priority ?? 1,
        listId,
        tags: parsed.tags,
        // 无日期词落到小窗当前查看日期；「到周X」截止语法从当前查看日期
        // 跨到截止日（区间任务，便签逐日可见）；普通日期词只设截止（原行为）
        dueAt: parsed.dueAt,
        scheduledDate: parsed.dueAt
          ? parsed.dueIsDeadline
            ? targetDateKey
            : null
          : targetDateKey,
        remindBefore: null,
      });
      setTitle("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`widget-quick-add ${open ? "is-open" : ""}`.trim()}>
      <div className="widget-quick-add-inner">
        <input
          ref={inputRef}
          className="widget-quick-add-input"
          type="text"
          name="widget-quick-add"
          // 字段级提示：Chromium 按 name 累积表单历史，聚焦就会弹「保存的信息」。
          // 权威开关在 `widget.rs` 的 general_autofill_enabled(false)——WebView2
          // 的 Suggestions 在某些情况下不认这里的 off。
          autoComplete="off"
          value={title}
          placeholder="输入事项，按 Enter 添加"
          aria-label="快速添加任务"
          disabled={busy}
          tabIndex={open ? 0 : -1}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div className="widget-quick-add-actions">
          <button
            type="button"
            className="widget-quick-add-confirm"
            aria-label="确认"
            disabled={busy || !title.trim()}
            tabIndex={open ? 0 : -1}
            onClick={() => void handleSubmit()}
          >
            <Check aria-hidden="true" />
          </button>
          <button
            type="button"
            className="widget-quick-add-cancel"
            aria-label="取消"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
