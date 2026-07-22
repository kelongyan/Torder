import { useEffect, useState } from "react";

export type PresencePhase = "enter" | "exit";

export function usePresence<T>(
  value: T | null | false,
  exitMs = 260,
): {
  rendered: boolean;
  value: T | null;
  phase: PresencePhase;
  className: "is-entering" | "is-exiting";
} {
  const [rendered, setRendered] = useState(Boolean(value));
  const [presentValue, setPresentValue] = useState<T | null>(
    value ? value : null,
  );
  const [phase, setPhase] = useState<PresencePhase>("enter");

  useEffect(() => {
    if (value) {
      const timeoutId = window.setTimeout(() => {
        setPresentValue(value);
        setRendered(true);
        setPhase("enter");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    if (!rendered) return;

    const phaseTimeoutId = window.setTimeout(() => {
      setPhase("exit");
    }, 0);
    const removeTimeoutId = window.setTimeout(() => {
      setRendered(false);
      setPresentValue(null);
      setPhase("enter");
    }, exitMs);

    return () => {
      window.clearTimeout(phaseTimeoutId);
      window.clearTimeout(removeTimeoutId);
    };
  }, [exitMs, rendered, value]);

  return {
    rendered,
    value: presentValue,
    phase,
    className: phase === "exit" ? "is-exiting" : "is-entering",
  };
}
