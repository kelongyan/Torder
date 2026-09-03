import type { SyncDevice, SyncStatus } from "../../types/sync";

/**
 * P1-05c：已连接设备列表与同步维护动作（清理历史 / 加密密钥行 / 导出诊断），
 * 从 SettingsSyncSection 抽出。状态与确认浮层由容器持有，面板只发请求回调。
 */

interface SyncDevicesPanelProps {
  devices: SyncDevice[];
  status: SyncStatus | null;
  /** 任一同步操作进行中，禁用全部按钮。 */
  busy: boolean;
  onRevokeRequest: (device: SyncDevice) => void;
  onCleanupRequest: () => void;
  onRotateRequest: () => void;
  onExport: () => void;
}

function formatDeviceTime(value: string | null): string {
  if (!value) return "尚未同步";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function SyncDevicesPanel({
  devices,
  status,
  busy,
  onRevokeRequest,
  onCleanupRequest,
  onRotateRequest,
  onExport,
}: SyncDevicesPanelProps) {
  const configured = Boolean(status?.configured);
  return (
    <>
      {devices.length > 0 && (
        <div className="sync-device-list form-grid-full">
          <div className="settings-list-label">已连接设备</div>
          {devices.map((device) => (
            <div key={device.id} className="sync-device-item">
              <div className="sync-device-copy">
                <strong>{device.name}</strong>
                <span>
                  {device.current
                    ? "当前设备"
                    : device.enabled
                      ? "可同步"
                      : "已撤销"}{" "}
                  · {formatDeviceTime(device.lastSyncAt)}
                </span>
              </div>
              {device.enabled && !device.current && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => onRevokeRequest(device)}
                >
                  撤销
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {configured && (
        <button
          type="button"
          className="btn-secondary btn-sm form-grid-full"
          disabled={busy}
          onClick={onCleanupRequest}
        >
          清理历史
        </button>
      )}
      {configured && status && (
        <div className="sync-device-item form-grid-full">
          <div className="sync-device-copy">
            <strong>
              {status.encryptionEnabled ? "加密密钥" : "端到端加密"}
            </strong>
            <span>
              {status.encryptionEnabled
                ? status.encryptionKeyAvailable
                  ? "密钥 " + (status.encryptionKeyId ?? "可用")
                  : "缺少密钥，需输入密码"
                : "创建加密快照"}
              {status.pendingChanges > 0
                ? " · 待上传 " + status.pendingChanges + " 项"
                : ""}
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={
              busy ||
              status.pendingChanges > 0 ||
              (status.encryptionEnabled && !status.encryptionKeyAvailable)
            }
            onClick={onRotateRequest}
          >
            {status.encryptionEnabled ? "轮换密钥" : "启用加密"}
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn-secondary btn-sm form-grid-full"
        disabled={busy}
        onClick={onExport}
      >
        导出诊断
      </button>
    </>
  );
}
