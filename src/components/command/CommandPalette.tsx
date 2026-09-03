import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PresencePhase } from "../../hooks/usePresence";

/**
 * F2 · T-01 命令面板（Ctrl K / 工具栏图标唤起）。
 * 命令表由 App 层组装传入（保持组件无业务依赖）；输入按子串过滤，
 * ↑↓ 选择、Enter 执行、Esc 关闭。Esc 由全局 closeEverything 链兜底。
 */
export interface CommandEntry {
  id: string;
  title: string;
  group: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({
  commands,
  presence,
  onClose,
}: {
  commands: CommandEntry[];
  presence: PresencePhase;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.title} ${command.group} ${command.keywords ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [commands, query]);

  // 过滤结果变短时索引可能越界，取有效值而不是在 effect 里回写 state
  const activeRow = filtered.length
    ? Math.min(activeIndex, filtered.length - 1)
    : 0;

  // 打开时聚焦（presence 进入相位后输入框才挂载）
  useEffect(() => {
    if (presence === "enter") inputRef.current?.focus();
  }, [presence]);

  useEffect(() => {
    const item = listRef.current?.querySelector('[data-active="true"]');
    item?.scrollIntoView({ block: "nearest" });
  }, [activeRow, filtered.length]);

  function runCommand(command: CommandEntry) {
    // 先关面板再执行，命令里若再开别的弹层不会被面板遮挡
    onClose();
    command.run();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length ? (index + 1) % filtered.length : 0,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length ? (index - 1 + filtered.length) % filtered.length : 0,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeRow];
      if (command) runCommand(command);
      return;
    }
    if (event.key === "Escape") {
      // 面板自收起，同时阻断冒泡，避免全局 Esc 链再关掉底层弹层
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className={`dialog-overlay command-palette-overlay ${
        presence === "exit" ? "is-exiting" : "is-entering"
      }`}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="command-palette-card"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
      >
        <div className="command-palette-input-row">
          <Command aria-hidden="true" className="icon-sm" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="输入命令，或搜索设置…"
            aria-label="搜索命令"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-list" ref={listRef} role="listbox">
          {filtered.map((command, index) => {
            const Icon = command.icon;
            const active = index === activeRow;
            return (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={active}
                data-active={active}
                className={`command-palette-item ${active ? "is-active" : ""}`}
                onClick={() => runCommand(command)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <Icon aria-hidden="true" className="menu-icon" />
                <span className="command-palette-title">{command.title}</span>
                <span className="command-palette-group">{command.group}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="command-palette-empty">没有匹配的命令</p>
          )}
        </div>
      </section>
    </div>
  );
}
