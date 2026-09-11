import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { ToastMessage } from "../../types/ui";

interface ToastHostProps {
  toasts: ToastMessage[];
  onDismiss?: (id: number) => void;
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => {
        const Icon =
          toast.type === "success"
            ? CheckCircle2
            : toast.type === "error"
              ? AlertCircle
              : Info;
        return (
          <div
            key={toast.id}
            className={`toast ${toast.type} ${toast.leaving ? "is-leaving" : ""}${toast.pulseKey ? " is-pulsing" : ""}`}
            role="status"
          >
            <div className="toast-icon-badge" aria-hidden="true">
              <Icon className="icon-sm" />
            </div>
            <span className="toast-text">{toast.message}</span>
            {toast.actions.length > 0 && (
              <div className="toast-actions">
                {toast.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="toast-action"
                    onClick={() => {
                      void action.onClick();
                      onDismiss?.(toast.id);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            {onDismiss && (
              <button
                type="button"
                className="toast-close"
                aria-label="关闭提示"
                onClick={() => onDismiss(toast.id)}
              >
                <X className="icon-xs" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
