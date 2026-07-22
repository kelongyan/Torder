import type { ReactNode } from "react";

export function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="detail-block">
      <span>{label}</span>
      <div>{children}</div>
    </section>
  );
}
