import { AlertCircle } from "lucide-react";
import type { PresencePhase } from "../../hooks/usePresence";
import type { ConfirmState } from "../../types/ui";

export function ConfirmDialog({
  state,
  presence,
  onClose,
}: {
  state: ConfirmState | null;
  presence: PresencePhase;
  onClose: () => void;
}) {
  if (!state) return null;
  return (
    <div
      className={`dialog-overlay ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="presentation"
    >
      <section className="dialog-card confirm-card" role="alertdialog" aria-modal="true">
        <header className="dialog-header">
          <span className={`dialog-icon ${state.danger ? "danger" : ""}`}>
            <AlertCircle aria-hidden="true" />
          </span>
          <div>
            <h2>{state.title}</h2>
            <p>{state.body}</p>
          </div>
        </header>
        <footer className="dialog-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={state.danger ? "btn-danger-solid" : "btn-primary"}
            onClick={() => void state.onConfirm()}
          >
            {state.confirmText}
          </button>
        </footer>
      </section>
    </div>
  );
}
