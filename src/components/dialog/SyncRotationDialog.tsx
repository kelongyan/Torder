/**
 * P1-05c：加密密钥轮换 / 启用浮层（双密码输入），从 SettingsSyncSection 抽出。
 * 密码字段受控于容器；取消时容器负责清空密码。
 */
interface SyncRotationDialogProps {
  rendered: boolean;
  className: string;
  encryptionEnabled: boolean | undefined;
  password: string;
  passwordConfirm: string;
  /** 当前同步忙态：仅 "rotate" 时按钮显示轮换中。 */
  busy: string | null;
  onPasswordChange: (next: string) => void;
  onPasswordConfirmChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SyncRotationDialog({
  rendered,
  className,
  encryptionEnabled,
  password,
  passwordConfirm,
  busy,
  onPasswordChange,
  onPasswordConfirmChange,
  onCancel,
  onConfirm,
}: SyncRotationDialogProps) {
  if (!rendered) return null;
  return (
    <div className={`dialog-overlay restore-confirm-overlay ${className}`}>
      <div
        className="restore-confirm-card"
        role="alertdialog"
        aria-modal="true"
      >
        <h3>{encryptionEnabled ? "轮换加密密钥?" : "启用端到端加密?"}</h3>
        <p>其他设备需要用新密码重新同步。</p>
        <label className="form-field">
          <span>新加密密码</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>确认新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={passwordConfirm}
            onChange={(event) => onPasswordConfirmChange(event.target.value)}
          />
        </label>
        <div className="settings-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={onConfirm}
          >
            {busy === "rotate" ? "轮换中…" : "确认轮换"}
          </button>
        </div>
      </div>
    </div>
  );
}
