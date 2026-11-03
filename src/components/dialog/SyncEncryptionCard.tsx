import { ToggleSwitch } from "../common/ToggleSwitch";

/**
 * P1-05c：端到端加密配置卡（开关 + 双密码输入），从 SettingsSyncSection 抽出。
 * 纯受控组件：所有值经 props 下发、变更走回调上抛，无内部状态。
 * 2026-11-03：原来的 10px 内衬描边卡（容器里再套容器）改为若干设置行，
 * 与所在同步分组同一套语言；分组外壳仍由 .settings-section 唯一提供。
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
    <>
      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label">端到端加密</span>
          <span className="settings-row-desc">
            {remoteEnabled === true
              ? "远端已启用，需使用加密密码"
              : "同步内容加密后再上传"}
          </span>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            checked={turnedOn}
            label="端到端加密"
            disabled={configured || remoteEnabled === true}
            onChange={onEnabledChange}
          />
        </div>
      </div>
      {turnedOn && (
        <>
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">
                {keyAvailable ? "更新加密密码" : "加密密码"}
              </span>
              <span className="settings-row-desc">
                {keyAvailable
                  ? "留空表示沿用已有密钥"
                  : "至少 8 位，丢了无法解密远端数据"}
              </span>
            </div>
            <div className="settings-row-control">
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                aria-label="加密密码"
                onChange={(event) => onPasswordChange(event.target.value)}
              />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">确认密码</span>
            <div className="settings-row-control">
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={passwordConfirm}
                aria-label="确认加密密码"
                onChange={(event) =>
                  onPasswordConfirmChange(event.target.value)
                }
              />
            </div>
          </div>
          <p className="settings-section-hint">密码只保存在本机，不会上传。</p>
        </>
      )}
    </>
  );
}
