import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { CreateTaskInput, TaskList } from "../../types/database";
import { parseQuickAddText } from "../../utils/taskHelpers";

/**
 * F1 · T-05/T-13 快速新建 composer。
 *
 * 收起态是一行「+ 快速新建」，点开变输入行；Enter 创建、Esc 收起、空值失焦自动收起。
 * 文本走 `parseQuickAddText`（与便签速记同一解析器），所以 `明天 15:00 交周报 #工作 !高`
 * 这类写法在两处行为一致。列表底部与看板列头共用本组件，差异只在 `variant` 与
 * 调用方给的 `overrides`。
 */
export function TaskQuickComposer({
  lists,
  defaultListId,
  variant = "list",
  placeholder = "快速新建",
  inputPlaceholder = "输入事项，Enter 创建（支持「明天 15:00 交周报 #工作 !高」）",
  defaultOpen = false,
  /** T-10 甲组：设置里的「识别自然语言速记」开关，关闭则整句作标题。 */
  parseNaturalLanguage = true,
  overrides,
  onCreate,
}: {
  lists: TaskList[];
  defaultListId: string;
  variant?: "list" | "board";
  placeholder?: string;
  inputPlaceholder?: string;
  /** 落位补丁：列表视图用来继承当前视图日期，看板用来带上列语义（状态/优先级）。 */
  overrides?: Partial<CreateTaskInput>;
  /** 看板列内联新建：由列头 + 号唤起，挂载即展开输入行。 */
  defaultOpen?: boolean;
  /** T-10 甲组：识别自然语言速记开关（默认开启）。 */
  parseNaturalLanguage?: boolean;
  onCreate: (input: CreateTaskInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function submit(keepOpen: boolean) {
    const raw = text.trim();
    if (!raw || busy) return;
    const parsed = parseNaturalLanguage
      ? parseQuickAddText(raw, lists)
      : {
          title: raw,
          priority: undefined,
          listId: undefined,
          tags: [],
          dueAt: null,
        };
    const title = parsed.title.trim();
    // 整行都是修饰词（如只写了「#工作 !高」）时不建空标题任务
    if (!title) return;

    const listId =
      parsed.listId ??
      (lists.some((list) => list.id === defaultListId)
        ? defaultListId
        : "work");

    setBusy(true);
    try {
      await onCreate({
        title,
        priority: parsed.priority ?? 1,
        listId,
        tags: parsed.tags,
        dueAt: parsed.dueAt,
        remindBefore: null,
        ...overrides,
        // 解析出显式日期时以它为准，否则才用调用方给的落位日期
        ...(parsed.dueAt ? { scheduledDate: null } : {}),
      });
      setText("");
      if (!keepOpen) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`task-composer task-composer--${variant}`}
        onClick={() => setOpen(true)}
      >
        <span className="task-composer-plus" aria-hidden="true">
          <Plus />
        </span>
        <span>{placeholder}</span>
      </button>
    );
  }

  return (
    <div className={`task-composer task-composer--${variant} is-open`}>
      <span className="task-composer-plus" aria-hidden="true">
        <Plus />
      </span>
      <input
        ref={inputRef}
        className="task-composer-input"
        type="text"
        name="task-quick-add"
        autoComplete="off"
        value={text}
        placeholder={inputPlaceholder}
        aria-label="快速新建事项"
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            // Ctrl/⌘ + Enter 连续录入，普通 Enter 建完收起
            void submit(event.ctrlKey || event.metaKey);
            return;
          }
          if (event.key === "Escape") {
            // 阻止冒泡到全局 Esc 链（否则会连带关掉详情抽屉等）
            event.preventDefault();
            event.stopPropagation();
            setText("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!text.trim()) setOpen(false);
        }}
      />
    </div>
  );
}
