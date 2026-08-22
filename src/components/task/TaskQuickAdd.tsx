import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Calendar, MoreHorizontal, Plus, X } from "lucide-react";
import type { CreateTaskInput, TaskList } from "../../types/database";
import { reminderOptions } from "../../constants/reminderConfig";
import { priorityOptions } from "../../constants/taskConfig";
import { parseQuickAddText } from "../../utils/taskHelpers";
import { toLocalDateTimeValue } from "../../utils/taskDates";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";

const dateChips = [
  { key: "today", label: "今天", hour: 20, minute: 0 },
  { key: "tomorrow", label: "明天", hour: 9, minute: 0 },
  { key: "friday", label: "本周五", hour: 18, minute: 0 },
  { key: "monday", label: "下周一", hour: 9, minute: 0 },
] as const;

const timeChips = ["09:00", "14:00", "18:00", "21:00"];

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<0 | 1 | 2>(1);
  const [listId, setListId] = useState(defaultListId);
  const [dueValue, setDueValue] = useState("");
  const [remindBefore, setRemindBefore] = useState<number | null>(1440);
  const [active, setActive] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);

  const activeListId = lists.some((l) => l.id === listId)
    ? listId
    : defaultListId;

  const isExpanded = active || title.trim().length > 0;

  useEffect(() => {
    if (!active) return;

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setActive(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [active]);

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && title.trim()) {
      e.preventDefault();
      // 标题去掉已生效的指令词（#清单/!优先级/日期/时间）
      const parsedTitle = parseQuickAddText(title, lists).title;
      if (!parsedTitle.trim()) return;
      await onInlineCreate({
        title: parsedTitle.trim(),
        priority,
        listId: activeListId,
        dueAt: dueValue ? new Date(dueValue).toISOString() : null,
        remindBefore: dueValue ? remindBefore : null,
      });
      setTitle("");
      setDueValue("");
      setDueOpen(false);
      setActive(false);
    }
  };

  // 自然语言快速录入：输入时实时解析 `#清单 !优先级 日期 时间` 并回填控件，
  // 输入框保持原文；Enter 时指令词已被控件吸收，标题取解析后的纯文本。
  function handleTitleChange(value: string) {
    setTitle(value);
    const parsed = parseQuickAddText(value, lists);
    if (parsed.priority !== undefined) setPriority(parsed.priority);
    if (parsed.listId !== undefined) setListId(parsed.listId);
    if (parsed.dueAt !== null) {
      setDueValue(toLocalDateTimeValue(new Date(parsed.dueAt)));
    }
  }

  const pickDateChip = (key: (typeof dateChips)[number]["key"]) => {
    const chip = dateChips.find((c) => c.key === key);
    if (!chip) return;
    const date = new Date();
    const day = date.getDay(); // 0=Sun
    if (key === "tomorrow") {
      date.setDate(date.getDate() + 1);
    } else if (key === "friday") {
      const diff = (5 - day + 7) % 7 || 7;
      date.setDate(date.getDate() + diff);
    } else if (key === "monday") {
      const diff = (1 - day + 7) % 7 || 7;
      date.setDate(date.getDate() + diff);
    }
    date.setHours(chip.hour, chip.minute, 0, 0);
    setDueValue(toLocalDateTimeValue(date));
    setDueOpen(false);
  };

  const pickTimeChip = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    const date = dueValue ? new Date(dueValue) : new Date();
    date.setHours(hour, minute, 0, 0);
    setDueValue(toLocalDateTimeValue(date));
  };

  const dueLabel = useMemo(() => {
    if (!dueValue) return "截止时间";
    const date = new Date(dueValue);
    const now = new Date();
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (sameDay(date, now)) return `今天 ${time}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (sameDay(date, tomorrow)) return `明天 ${time}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }, [dueValue]);

  return (
    <div
      ref={rootRef}
      className={`quick-add-inline ${isExpanded ? "is-expanded" : "is-collapsed"}`}
    >
      <div className="quick-add-input-row">
        <Plus aria-hidden="true" className="add-icon" />
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onFocus={() => setActive(true)}
          onKeyDown={handleKeyDown}
          placeholder="添加任务"
        />
        {onOpenDialog && (
          <button
            type="button"
            className="quick-add-more"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpenDialog}
            title="新建任务"
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="quick-add-chips-row">
          <div className="quick-add-date-wrap">
            <button
              type="button"
              className={`quick-add-chip ${dueValue ? "active due-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setDueOpen((open) => !open)}
            >
              <Calendar className="chip-icon" />
              <span>{dueLabel}</span>
            </button>
            {dueOpen && (
              <div className="quick-add-date-panel">
                <div className="date-chip-row">
                  {dateChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => pickDateChip(chip.key)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <div className="date-chip-row">
                  {timeChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className={isTimeMatch(dueValue, chip) ? "active" : ""}
                      onClick={() => pickTimeChip(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <div className="date-chip-footer">
                  {dueValue && (
                    <button type="button" onClick={() => setDueValue("")}>
                      <X aria-hidden="true" className="icon-sm" />
                      清除截止
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <SegmentedControl
            value={priority}
            options={priorityOptions}
            onChange={setPriority}
            ariaLabel="优先级"
          />

          <div className="quick-add-select">
            <Select<TaskList["id"]>
              value={activeListId}
              options={lists.map((list) => ({
                value: list.id,
                label: list.name,
                dotColor: list.color ?? undefined,
              }))}
              onChange={setListId}
              placeholder="清单"
              ariaLabel="选择清单"
              className="quick-add-list-select"
            />
          </div>

          {dueValue && (
            <div className="quick-add-select">
              <Select<number>
                value={remindBefore ?? -1}
                options={reminderOptions}
                onChange={(value) => setRemindBefore(value < 0 ? null : value)}
                placeholder="提醒"
                ariaLabel="提醒时间"
                className="quick-add-remind-select"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isTimeMatch(dueValue: string, chip: string): boolean {
  if (!dueValue) return false;
  const date = new Date(dueValue);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}` === chip;
}
