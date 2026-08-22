import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type { PresencePhase } from "../../hooks/usePresence";
import type { ConfirmState } from "../../types/ui";

type ConfirmAction = "primary" | "secondary";

export function ConfirmDialog({
  state,
  presence,
  onClose,
}: {
  state: ConfirmState | null;
  presence: PresencePhase;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<{
    state: ConfirmState;
    action: ConfirmAction;
  } | null>(null);

  if (!state) return null;

  const confirmState = state;
  const submitting = pending?.state === confirmState ? pending.action : null;
  const secondaryAction =
    confirmState.secondaryText && confirmState.onSecondary
      ? {
          text: confirmState.secondaryText,
          handler: confirmState.onSecondary,
        }
      : null;

  async function runAction(
    action: ConfirmAction,
    handler: () => Promise<void>,
  ) {
    if (submitting) return;
    setPending({ state: confirmState, action });
    try {
      await handler();
    } finally {
      setPending((current) =>
        current?.state === confirmState ? null : current,
      );
    }
  }

  return (
    <div
      className={`dialog-overlay ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="presentation"
    >
      <section
        className="dialog-card confirm-card"
        role="alertdialog"
        aria-modal="true"
      >
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
          <button
            type="button"
            className="btn-secondary"
            disabled={submitting !== null}
            onClick={onClose}
          >
            取消
          </button>
          {secondaryAction && (
            <button
              type="button"
              className="btn-danger-solid"
              disabled={submitting !== null}
              aria-busy={submitting === "secondary"}
              onClick={() =>
                void runAction("secondary", secondaryAction.handler)
              }
            >
              {submitting === "secondary" ? "处理中..." : secondaryAction.text}
            </button>
          )}
          <button
            type="button"
            className={state.danger ? "btn-danger-solid" : "btn-primary"}
            disabled={submitting !== null}
            aria-busy={submitting === "primary"}
            onClick={() => void runAction("primary", state.onConfirm)}
          >
            {submitting === "primary" ? "处理中..." : state.confirmText}
          </button>
        </footer>
      </section>
    </div>
  );
}
