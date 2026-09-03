import { useState } from "react";
import { Check, GitMerge, Pencil, Tags, Trash2, X } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { manageTag } from "../../services/tagService";

/**
 * 标签管理弹窗（阶段 C / T-07 二期）：重命名 / 合并 / 删除。
 * 每个动作都跨任务批量改写 tasks.tags（Rust manage_tag），删除前提示
 * 受影响任务数。动作成功回调 onChanged(affected, message) 由 App 重拉并
 * 弹 toast。
 */

type PendingAction =
  | { kind: "rename"; tag: string }
  | { kind: "merge"; tag: string }
  | { kind: "remove"; tag: string };

export function TagManagerDialog({
  tags,
  presence,
  onClose,
  onChanged,
}: {
  tags: Array<{ tag: string; count: number }>;
  presence: PresencePhase;
  onClose: () => void;
  onChanged: (affected: number, message: string) => void;
}) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [input, setInput] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countOf = (tag: string) =>
    tags.find((item) => item.tag === tag)?.count ?? 0;

  async function run(payload: {
    action: "rename" | "merge" | "remove";
    to?: string;
  }) {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const affected = await manageTag(payload.action, pending.tag, payload.to);
      onChanged(
        affected,
        payload.action === "remove"
          ? `已删除标签「${pending.tag}」（影响 ${affected} 个任务）`
          : payload.action === "rename"
            ? `已重命名「${pending.tag}」→「${payload.to}」（影响 ${affected} 个任务）`
            : `已合并「${pending.tag}」→「${payload.to}」（影响 ${affected} 个任务）`,
      );
      setPending(null);
      setInput("");
      setMergeInto("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="标签管理"
      icon={Tags}
      width="420px"
      presence={presence}
      onClose={onClose}
    >
      <div className="dialog-form">
        {tags.length === 0 ? (
          <p className="settings-section-hint">
            还没有标签。给任务添加 #标签 后即可在这里管理。
          </p>
        ) : (
          <ul className="tag-manage-list">
            {tags.map(({ tag }) => {
              return (
                <li key={tag} className="tag-manage-row">
                  {pending?.tag === tag && pending.kind === "rename" ? (
                    <span className="tag-manage-edit">
                      <input
                        className="tag-manage-input"
                        value={input}
                        autoFocus
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && input.trim()) {
                            void run({ action: "rename", to: input.trim() });
                          }
                          if (event.key === "Escape") setPending(null);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={busy || !input.trim()}
                        onClick={() =>
                          void run({ action: "rename", to: input.trim() })
                        }
                        aria-label="确认重命名"
                      >
                        <Check aria-hidden="true" className="icon-sm" />
                      </button>
                    </span>
                  ) : pending?.tag === tag && pending.kind === "merge" ? (
                    <span className="tag-manage-edit">
                      <select
                        className="tag-manage-select"
                        value={mergeInto}
                        autoFocus
                        onChange={(event) => setMergeInto(event.target.value)}
                      >
                        <option value="">并入哪个标签…</option>
                        {tags
                          .filter((item) => item.tag !== tag)
                          .map((item) => (
                            <option key={item.tag} value={item.tag}>
                              {item.tag}（{item.count}）
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={busy || !mergeInto}
                        onClick={() =>
                          void run({ action: "merge", to: mergeInto })
                        }
                        aria-label="确认合并"
                      >
                        <Check aria-hidden="true" className="icon-sm" />
                      </button>
                    </span>
                  ) : pending?.tag === tag && pending.kind === "remove" ? (
                    <span className="tag-manage-edit">
                      <span className="tag-manage-remove-text">
                        删除「{tag}」将影响 {countOf(tag)} 个任务
                      </span>
                      <button
                        type="button"
                        className="btn-danger-solid btn-sm"
                        disabled={busy}
                        onClick={() => void run({ action: "remove" })}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => setPending(null)}
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className="tag-manage-name">
                        {tag}
                        <span className="tag-manage-count">{countOf(tag)}</span>
                      </span>
                      <span className="tag-manage-actions">
                        <button
                          type="button"
                          className="icon-button btn-sm"
                          title="重命名"
                          aria-label={`重命名 ${tag}`}
                          onClick={() => {
                            setPending({ kind: "rename", tag });
                            setInput(tag);
                            setMergeInto("");
                          }}
                        >
                          <Pencil aria-hidden="true" className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          className="icon-button btn-sm"
                          title="并入其他标签"
                          aria-label={`合并 ${tag}`}
                          onClick={() => {
                            setPending({ kind: "merge", tag });
                            setMergeInto("");
                          }}
                        >
                          <GitMerge aria-hidden="true" className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          className="icon-button btn-sm"
                          title="删除标签"
                          aria-label={`删除 ${tag}`}
                          onClick={() => setPending({ kind: "remove", tag })}
                        >
                          <Trash2 aria-hidden="true" className="icon-sm" />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="settings-section-hint tag-manage-error">{error}</p>
        )}
        {!error && pending && (
          <p className="settings-section-hint">按 Esc 取消当前操作。</p>
        )}
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={onClose}
        >
          <X aria-hidden="true" className="icon-sm" />
          完成
        </button>
      </div>
    </DialogShell>
  );
}
