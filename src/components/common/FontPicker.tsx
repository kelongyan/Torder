import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search, X } from "lucide-react";
import { usePresence } from "../../hooks/usePresence";
import {
  fontStackFor,
  noteFontOptions,
  type NoteFontId,
} from "../../services/widgetAppearance";

/** 下拉里的一项：预设 / 自定义导入字体 / 系统字体。 */
export interface FontPickerOption {
  value: string;
  label: string;
  /** 分组标题；相邻同组项共用一个标题。 */
  group: string;
  /** 是否用该字体自身渲染标签（系统字体预览）。预设项不预览。 */
  preview: boolean;
}

export function FontPicker({
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  /** 首次打开下拉时回调一次（用于惰性拉取系统字体）。 */
  onFirstOpen,
}: {
  value: NoteFontId;
  options: FontPickerOption[];
  onChange: (value: NoteFontId) => void;
  disabled?: boolean;
  loading?: boolean;
  onFirstOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const activeOpen = open && !disabled;
  const presence = usePresence(activeOpen, 180);
  const listboxId = useId();

  /**
   * 过滤后的分组列表。
   *
   * 搜索按大小写不敏感子串匹配；**空查询时预设组恒在**（用户最常选的几项
   * 不该因为搜不到就消失），系统字体在空查询下也全列（用户是来挑字体的）。
   */
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;
    const ordered: Array<{ group: string; items: FontPickerOption[] }> = [];
    for (const option of matched) {
      const last = ordered[ordered.length - 1];
      if (last && last.group === option.group) last.items.push(option);
      else ordered.push({ group: option.group, items: [option] });
    }
    return ordered;
  }, [options, query]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // 当前选中项：预设名或系统字体家族名
  const selectedLabel = useMemo(() => {
    const preset = noteFontOptions.find((option) => option.id === value);
    return preset ? preset.name : value;
  }, [value]);

  // 关闭时清空查询与高亮，在点击处处理而非 effect：
  // effect 里同步 setState 会触发级联渲染（react-hooks/set-state-in-effect），
  // 而这里本就是「用户点击」这一事件的直接结果，放在事件里语义更准确。
  function toggleOpen() {
    setOpen((current) => {
      if (current) {
        setQuery("");
        setHighlight(0);
        return false;
      }
      // 惰性拉取：只在「打开」这一侧触发一次，且由父组件去重
      onFirstOpen?.();
      return true;
    });
  }

  useEffect(() => {
    if (!disabled || !open) return;
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [disabled, open]);

  useEffect(() => {
    if (!activeOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    // 打开即聚焦搜索框：用户输入的下一步大概率就是搜索
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.clearTimeout(focusTimer);
    };
  }, [activeOpen]);

  // 键盘高亮项滚进可视区
  useEffect(() => {
    if (!activeOpen) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeOpen, highlight]);

  function commit(option: FontPickerOption) {
    onChange(option.value);
    setOpen(false);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = flat[highlight];
      if (option) commit(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else setOpen(false);
    }
  }

  // 高亮项变化时保持在范围内（搜索收窄后旧的 highlight 可能越界）
  const safeHighlight = Math.min(highlight, Math.max(flat.length - 1, 0));

  return (
    <div className="font-picker" ref={containerRef}>
      <button
        type="button"
        className={`font-picker-trigger ${activeOpen ? "is-open" : ""}`.trim()}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={activeOpen}
        aria-controls={activeOpen ? listboxId : undefined}
        aria-label="选择便签字体"
        onClick={toggleOpen}
      >
        <span
          className="font-picker-trigger-label"
          style={{ fontFamily: fontStackFor(value) }}
        >
          {selectedLabel}
        </span>
        <span className="font-picker-caret" aria-hidden="true" />
      </button>

      {presence.rendered && (
        <div className={`font-picker-panel ${presence.className}`}>
          <div className="font-picker-search">
            <Search size={12} aria-hidden="true" className="font-picker-search-icon" />
            <input
              ref={searchRef}
              type="text"
              className="font-picker-search-input"
              value={query}
              placeholder={loading ? "正在读取系统字体…" : "搜索字体…"}
              aria-label="搜索字体"
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            {query ? (
              <button
                type="button"
                className="font-picker-search-clear"
                aria-label="清空搜索"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <ul
            ref={listRef}
            id={listboxId}
            className="font-picker-list"
            role="listbox"
            aria-label="字体列表"
          >
            {flat.length === 0 ? (
              <li className="font-picker-empty">
                {loading ? "正在读取系统字体…" : "没有匹配的字体"}
              </li>
            ) : (
              groups.map((group) => (
                <li key={group.group} className="font-picker-group">
                  <div className="font-picker-group-title" aria-hidden="true">
                    {group.group}
                  </div>
                  <ul className="font-picker-group-items">
                    {group.items.map((option) => {
                      const index = flat.indexOf(option);
                      const active = option.value === value;
                      return (
                        <li key={option.value}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-index={index}
                            className={`font-picker-option ${
                              active ? "is-active" : ""
                            } ${index === safeHighlight ? "is-highlight" : ""}`.trim()}
                            // 用字体自身渲染自己的名字，选之前就能看到效果
                            style={
                              option.preview
                                ? { fontFamily: fontStackFor(option.value) }
                                : undefined
                            }
                            onMouseEnter={() => setHighlight(index)}
                            onClick={() => commit(option)}
                          >
                            <span className="font-picker-option-name">
                              {option.label}
                            </span>
                            {active ? (
                              <span
                                className="font-picker-option-check"
                                aria-hidden="true"
                              />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
