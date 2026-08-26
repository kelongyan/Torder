import { useState } from "react";
import type { CreateTaskInput, TaskList } from "../../types/database";
import { parseQuickAddText } from "../../utils/taskHelpers";

export function WidgetQuickAdd({
  lists,
  defaultListId,
  targetDateKey,
  onCreate,
}: {
  lists: TaskList[];
  defaultListId: string;
  targetDateKey: string;
  onCreate: (input: CreateTaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    const text = title.trim();
    if (!text || busy) return;
    const parsed = parseQuickAddText(text, lists);
    if (!parsed.title.trim()) return;
    const listId =
      parsed.listId ??
      (lists.some((list) => list.id === defaultListId) ? defaultListId : "work");
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="widget-quick-add">
      <input
        className="widget-quick-add-input"
        type="text"
        name="widget-quick-add"
        value={title}
        placeholder="添加任务，回车确认"
        aria-label="快速添加任务"
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void handleSubmit();
        }}
      />
    </div>
  );
}
