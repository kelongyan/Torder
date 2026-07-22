import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ToastMessage } from "../../types/ui";

export function ToastHost({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => {
        const Icon =
          toast.type === "success" ? CheckCircle2 : toast.type === "error" ? AlertCircle : Info;
        return (
          <div
            key={toast.id}
            className={`toast ${toast.type} ${toast.leaving ? "is-leaving" : ""}`}
          >
            <Icon aria-hidden="true" className="icon-sm" />
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
