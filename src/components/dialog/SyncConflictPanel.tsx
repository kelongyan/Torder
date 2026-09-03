import type { SyncConflict } from "../../types/sync";
import {
  conflictDiffs,
  conflictFieldLabel,
  conflictLabel,
  type MergeChoiceMap,
} from "../../utils/syncConflict";

/**
 * P1-05c：同步冲突面板（纯展示 + 回调），从 SettingsSyncSection 抽出。
 * 状态仍由容器持有：mergeChoices 由 onMergeChoice 更新、决议动作走 onResolve。
 */

export type ConflictResolution =
  "keepLocal" | "acceptRemote" | "merge" | "copy";

interface SyncConflictPanelProps {
  conflicts: SyncConflict[];
  mergeChoices: MergeChoiceMap;
  /** 任一同步操作进行中（含冲突决议）时为 true，禁用所有按钮。 */
  busy: boolean;
  onMergeChoice: (
    conflictId: string,
    field: string,
    choice: "local" | "remote",
  ) => void;
  onResolve: (conflict: SyncConflict, resolution: ConflictResolution) => void;
}

export function SyncConflictPanel({
  conflicts,
  mergeChoices,
  busy,
  onMergeChoice,
  onResolve,
}: SyncConflictPanelProps) {
  if (conflicts.length === 0) return null;
  return (
    <div className="sync-conflict-list">
      <div className="settings-list-label">冲突</div>
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="sync-conflict-item">
          <div className="sync-conflict-copy">
            <strong>{conflictLabel(conflict)}</strong>
            <span>
              本地 v{conflict.localRevision} · 远端 v{conflict.remoteRevision}
            </span>
          </div>
          {conflictDiffs(conflict).length > 0 && (
            <div className="sync-conflict-diff" aria-label="冲突字段差异">
              <div className="sync-conflict-diff-head" aria-hidden="true">
                <span>字段</span>
                <span>本地版本</span>
                <span>远端版本</span>
              </div>
              {conflictDiffs(conflict).map(([field, local, remote]) => (
                <div key={field} className="sync-conflict-diff-row">
                  <span title={field}>{conflictFieldLabel(field)}</span>
                  <button
                    type="button"
                    className={`sync-conflict-value ${
                      mergeChoices[conflict.id]?.[field] === "local"
                        ? "is-selected"
                        : ""
                    }`}
                    aria-label={`${conflictFieldLabel(field)}使用本地值：${local}`}
                    aria-pressed={
                      mergeChoices[conflict.id]?.[field] === "local"
                    }
                    disabled={busy}
                    onClick={() => onMergeChoice(conflict.id, field, "local")}
                  >
                    <code>{local}</code>
                  </button>
                  <button
                    type="button"
                    className={`sync-conflict-value ${
                      mergeChoices[conflict.id]?.[field] !== "local"
                        ? "is-selected"
                        : ""
                    }`}
                    aria-label={`${conflictFieldLabel(field)}使用远端值：${remote}`}
                    aria-pressed={
                      mergeChoices[conflict.id]?.[field] !== "local"
                    }
                    disabled={busy}
                    onClick={() => onMergeChoice(conflict.id, field, "remote")}
                  >
                    <code>{remote}</code>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="sync-conflict-actions">
            {conflict.id.startsWith("list-name-conflict:") ? (
              <span className="settings-section-hint">
                清单名称冲突，先重命名本地清单。
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => onResolve(conflict, "keepLocal")}
                >
                  保留本地
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => onResolve(conflict, "acceptRemote")}
                >
                  接受远端
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => onResolve(conflict, "merge")}
                >
                  合并保存
                </button>
                {(conflict.entity === "task" ||
                  conflict.entity === "calendarEvent") && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onResolve(conflict, "copy")}
                  >
                    复制副本
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
