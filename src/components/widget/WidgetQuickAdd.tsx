import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { CreateTaskInput, TaskList } from "../../types/database";
import { parseQuickAddText } from "../../utils/taskHelpers";

export function WidgetQuickAdd({
  lists,
  defaultListId,
  targetDateKey,
  onCreate,
  onClose,
}: {
  lists: TaskList[];
  defaultListId: string;
  targetDateKey: string;
  onCreate: (input: CreateTaskInput) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 展开时自动聚焦
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        // 未显式指定日期时落到小窗当前查看日期，保证任务出现在当前视图
        dueAt: parsed.dueAt,
        scheduledDate: parsed.dueAt ? null : targetDateKey,
        remindBefore: null,
      });
      setTitle("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="widget-quick-add">
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
          onClick={() => void handleSubmit()}
        >
          <Check aria-hidden="true" />
        </button>
        <button
          type="button"
          className="widget-quick-add-cancel"
          aria-label="取消"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
