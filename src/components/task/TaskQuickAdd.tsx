import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { Calendar, Flag, Folder, Plus } from "lucide-react";
import type { CreateTaskInput, TaskList } from "../../types/database";

export function TaskQuickAdd({
  lists,
  defaultListId,
  onInlineCreate,
  onOpenDialog,
}: {
  lists: TaskList[];
  defaultListId: string;
  onInlineCreate: (input: CreateTaskInput) => Promise<void> | void;
  onOpenDialog?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<0 | 1 | 2>(1);
  const [listId, setListId] = useState(defaultListId);
  const [dueChoice, setDueChoice] = useState<"none" | "today" | "tomorrow">("none");

  const activeListId = lists.some((l) => l.id === listId) ? listId : defaultListId;
  const currentList = lists.find((l) => l.id === activeListId);

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && title.trim()) {
      e.preventDefault();
      let dueAt: string | null = null;
      const now = new Date();
      if (dueChoice === "today") {
        dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0).toISOString();
      } else if (dueChoice === "tomorrow") {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dueAt = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0).toISOString();
      }

      await onInlineCreate({
        title: title.trim(),
        priority,
        listId: activeListId,
        dueAt,
      });
      setTitle("");
    }
  };

  const cyclePriority = (e: MouseEvent) => {
    e.stopPropagation();
    setPriority((prev) => ((prev + 1) % 3) as 0 | 1 | 2);
  };

  const cycleList = (e: MouseEvent) => {
    e.stopPropagation();
    if (lists.length === 0) return;
    const currentIndex = lists.findIndex((l) => l.id === activeListId);
    const nextIndex = (currentIndex + 1) % lists.length;
    setListId(lists[nextIndex].id);
  };

  const cycleDue = (e: MouseEvent) => {
    e.stopPropagation();
    if (dueChoice === "none") setDueChoice("today");
    else if (dueChoice === "today") setDueChoice("tomorrow");
    else setDueChoice("none");
  };

  const priorityLabels = ["低", "普通", "高"];
  const dueLabels = { none: "截止时间", today: "今天 20:00", tomorrow: "明天 09:00" };

  return (
    <div className="quick-add-inline">
      <div className="quick-add-input-row">
        <Plus aria-hidden="true" className="add-icon" />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="添加任务（按 Enter 快速录入，Ctrl+N 打开高级表单）..."
        />
        {onOpenDialog && (
          <button
            type="button"
            className="btn-dialog-trigger"
            onClick={onOpenDialog}
            title="高级弹窗创建 (Ctrl+N)"
          >
            <kbd>Ctrl+N</kbd>
          </button>
        )}
      </div>

      <div className="quick-add-chips-row">
        <button
          type="button"
          className={`quick-add-chip ${dueChoice !== "none" ? "active" : ""}`}
          onClick={cycleDue}
        >
          <Calendar className="chip-icon" />
          <span>{dueLabels[dueChoice]}</span>
        </button>

        <button
          type="button"
          className={`quick-add-chip ${priority === 2 ? "active" : ""}`}
          onClick={cyclePriority}
        >
          <Flag className="chip-icon" />
          <span>优先级: {priorityLabels[priority]}</span>
        </button>

        <button
          type="button"
          className="quick-add-chip"
          onClick={cycleList}
        >
          <Folder className="chip-icon" />
          <span>清单: {currentList?.name ?? "工作"}</span>
        </button>
      </div>
    </div>
  );
}
