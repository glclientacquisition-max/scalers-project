import type { ReactNode } from "react";

export type OpsTone = "ok" | "info" | "warn" | "danger" | "neutral" | "beta";

/** Tone plus the word. Colour never carries meaning alone. */
export function StatusPill({ tone, children }: { tone: OpsTone; children: ReactNode }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-ops-label"
      style={{ color: `var(--ops-status-${tone}-fg)`, background: `var(--ops-status-${tone}-bg)` }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
