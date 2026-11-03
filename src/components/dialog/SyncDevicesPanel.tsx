import type { SyncDevice, SyncStatus } from "../../types/sync";
import { Eraser, FileDown, KeyRound, UserX } from "lucide-react";

/**
 * P1-05c：已连接设备列表与同步维护动作（清理历史 / 加密密钥行 / 导出诊断），
 * 从 SettingsSyncSection 抽出。状态与确认浮层由容器持有，面板只发请求回调。
 * 2026-11-03：整行按钮（.settings-row-action）取代 5 个通栏 btn-secondary，
 * 列表项改用标准设置行。
 */

interface SyncDevicesPanelProps {
  devices: SyncDevice[];
  status: SyncStatus | null;
  /** 任一同步操作进行中，禁用全部按钮。 */
  busy: boolean;
  onRevokeRequest: (device: SyncDevice) => void;
  /** 清理「已撤销」设备记录（issue #12 的幽灵设备）。 */
  onPruneRevokedRequest: () => void;
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
  onPruneRevokedRequest,
  onCleanupRequest,
  onRotateRequest,
  onExport,
}: SyncDevicesPanelProps) {
  const configured = Boolean(status?.configured);
  const revokedCount = devices.filter((device) => !device.enabled).length;
  return (
    <>
      {devices.length > 0 && (
        <>
          <div className="settings-section-title">已连接设备</div>
          {devices.map((device) => (
            <div key={device.id} className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">{device.name}</span>
                <span className="settings-row-desc">
                  {device.current
                    ? "当前设备"
                    : device.enabled
                      ? "可同步"
                      : "已撤销"}{" "}
                  · {formatDeviceTime(device.lastSyncAt)}
                </span>
              </div>
              {device.enabled && !device.current && (
                <div className="settings-row-control">
                  <button
                    type="button"
                    className="settings-ghost-button"
                    disabled={busy}
                    onClick={() => onRevokeRequest(device)}
                  >
                    撤销
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {/* 「移除同步配置 → 重新添加」会换新 deviceId，旧记录只会被置为已撤销，
          同名设备于是在列表里越堆越多。这里给一个显式出口，不按名字自动去重
          （默认名在两台同型号机器上会撞名）。 */}
      {revokedCount > 0 && (
        <button
          type="button"
          className="settings-row settings-row-action"
          disabled={busy}
          onClick={onPruneRevokedRequest}
        >
          <span className="settings-row-label settings-row-nav-label">
            <UserX aria-hidden="true" className="icon-sm" />
            清理已撤销设备（{revokedCount}）
          </span>
        </button>
      )}
      {configured && (
        <button
          type="button"
          className="settings-row settings-row-action"
          disabled={busy}
          onClick={onCleanupRequest}
        >
          <span className="settings-row-label settings-row-nav-label">
            <Eraser aria-hidden="true" className="icon-sm" />
            清理同步历史
          </span>
        </button>
      )}
      {configured && status && (
        <div className="settings-row">
          <div className="settings-row-copy">
            <span className="settings-row-label">
              {status.encryptionEnabled ? "加密密钥" : "端到端加密"}
            </span>
            <span className="settings-row-desc">
              {status.encryptionEnabled
                ? status.encryptionKeyAvailable
                  ? "密钥 " + (status.encryptionKeyId ?? "可用")
                  : "缺少密钥，需输入密码"
                : "未启用"}
              {status.pendingChanges > 0
                ? " · 待上传 " + status.pendingChanges + " 项"
                : ""}
            </span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className="settings-ghost-button"
              disabled={
                busy ||
                status.pendingChanges > 0 ||
                (status.encryptionEnabled && !status.encryptionKeyAvailable)
              }
              onClick={onRotateRequest}
            >
              <KeyRound aria-hidden="true" className="icon-xs" />
              {status.encryptionEnabled ? "轮换密钥" : "启用加密"}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="settings-row settings-row-action"
        disabled={busy}
        onClick={onExport}
      >
        <span className="settings-row-label settings-row-nav-label">
          <FileDown aria-hidden="true" className="icon-sm" />
          导出同步诊断
        </span>
      </button>
    </>
  );
}
