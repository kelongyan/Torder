import { ShieldCheck } from "lucide-react";

/**
 * P1-05c：端到端加密配置卡（开关 + 双密码输入），从 SettingsSyncSection 抽出。
 * 纯受控组件：所有值经 props 下发、变更走回调上抛，无内部状态。
 */
interface SyncEncryptionCardProps {
  /** 本地开关（向导第 2 步收集）。 */
  enabled: boolean;
  /** 远端集合是否已启用加密（来自连接检查）。 */
  remoteEnabled: boolean | undefined;
  /** 已保存配置后锁定开关。 */
  configured: boolean;
  keyAvailable: boolean | undefined;
  password: string;
  passwordConfirm: string;
  onEnabledChange: (next: boolean) => void;
  onPasswordChange: (next: string) => void;
  onPasswordConfirmChange: (next: string) => void;
}

export function SyncEncryptionCard({
  enabled,
  remoteEnabled,
  configured,
  keyAvailable,
  password,
  passwordConfirm,
  onEnabledChange,
  onPasswordChange,
  onPasswordConfirmChange,
}: SyncEncryptionCardProps) {
  const turnedOn = enabled || remoteEnabled === true;
  return (
    <div className="sync-encryption-card form-grid-full">
      <div className="sync-encryption-head">
        <span className="sync-encryption-icon">
          <ShieldCheck aria-hidden="true" className="icon-sm" />
        </span>
        <span className="sync-encryption-copy">
          <strong>端到端加密</strong>
          <span>
            {remoteEnabled === true
              ? "远端已启用，需使用加密密码"
              : "开启后同步数据会加密保存"}
          </span>
        </span>
        <label className="settings-toggle sync-encryption-toggle">
          <input
            type="checkbox"
            aria-label="端到端加密"
            checked={turnedOn}
            disabled={configured || remoteEnabled === true}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
        </label>
      </div>
      {turnedOn && (
        <div className="sync-encryption-fields">
          <label className="form-field">
            <span>{keyAvailable ? "更新加密密码（可选）" : "加密密码"}</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>确认密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={passwordConfirm}
              onChange={(event) => onPasswordConfirmChange(event.target.value)}
            />
          </label>
          <p>密码只保存在本机，不会上传。</p>
        </div>
      )}
    </div>
  );
}
