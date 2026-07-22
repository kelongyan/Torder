import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PresencePhase } from "../../hooks/usePresence";

export function DialogShell({
  title,
  subtitle,
  icon: Icon,
  width,
  presence = "enter",
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  width: string;
  presence?: PresencePhase;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={`dialog-overlay ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="presentation"
    >
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
      >
        <header className="dialog-header">
          <span className="dialog-icon">
            <Icon aria-hidden="true" />
          </span>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
