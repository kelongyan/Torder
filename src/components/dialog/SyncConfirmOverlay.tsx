import type { ReactNode } from "react";

/**
 * P1-05c：同步设置区的通用确认浮层（移除配置 / 撤销设备 / 清理历史复用）。
 * 进出场渲染门控由调用方 usePresence 提供；按钮文案与危险色由 props 区分。
 */
interface SyncConfirmOverlayProps {
  rendered: boolean;
  className: string;
  title: string;
  confirmLabel: string;
  /** body 内容：纯文本或含强调的 JSX。 */
  children: ReactNode;
  danger?: boolean;
  /** 任一同步操作进行中，禁用按钮。 */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SyncConfirmOverlay({
  rendered,
  className,
  title,
  confirmLabel,
  children,
  danger = false,
  busy,
  onCancel,
  onConfirm,
}: SyncConfirmOverlayProps) {
  if (!rendered) return null;
  return (
    <div className={`dialog-overlay restore-confirm-overlay ${className}`}>
      <div
        className="restore-confirm-card"
        role="alertdialog"
        aria-modal="true"
      >
        <h3>{title}</h3>
        {children}
        <div className="settings-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className={danger ? "btn-danger-solid" : "btn-primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
