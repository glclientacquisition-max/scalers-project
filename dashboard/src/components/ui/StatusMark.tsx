import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Icon + word + tone. Colour never carries the state alone. */
export type StatusTone = "ok" | "info" | "warn" | "danger" | "neutral" | "beta";
export type StatusIcon = "check" | "ring" | "tri" | "x" | "info" | "clock";

const DEFAULT_ICON: Record<StatusTone, StatusIcon> = {
  ok: "check",
  info: "info",
  warn: "tri",
  danger: "x",
  neutral: "ring",
  beta: "info",
};

function Glyph({ kind, tone }: { kind: StatusIcon; tone: StatusTone }) {
  const box = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true as const, className: "shrink-0" };
  if (kind === "check") {
    return (
      <svg {...box} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7.2 5.7 9.8 11 4.2" />
      </svg>
    );
  }
  if (kind === "tri") {
    return (
      <svg {...box} viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
        <path d="M7 1.8 12.4 12.2H1.6L7 1.8Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "x") {
    return (
      <svg {...box} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="7" cy="7" r="5.2" fill="currentColor" stroke="none" />
        <path d="M5 5l4 4M9 5 5 9" stroke={`var(--status-${tone}-bg)`} />
      </svg>
    );
  }
  if (kind === "info") {
    return (
      <svg {...box} aria-hidden="true" className="shrink-0">
        <circle cx="7" cy="7" r="5.2" fill="currentColor" />
        <rect x="6.2" y="6" width="1.6" height="4.2" fill={`var(--status-${tone}-bg)`} />
        <circle cx="7" cy="4.2" r="0.9" fill={`var(--status-${tone}-bg)`} />
      </svg>
    );
  }
  if (kind === "clock") {
    return (
      <svg {...box} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="7" cy="7" r="5" />
        <path d="M7 4.2V7.2H9.2" />
      </svg>
    );
  }
  return (
    <svg {...box} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="7" r="4.5" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

/**
 * Shared status pill. Desk `Stamp` and Admin `StatusPill` both render this.
 * Pills do not animate. The x and info glyphs use the pill background so the mark stays readable in grayscale.
 */
export function StatusMark({
  tone,
  icon,
  children,
  className,
  wrap = false,
}: {
  tone: StatusTone;
  icon?: StatusIcon;
  children: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-meta font-semibold",
        className,
      )}
      style={{ color: `var(--status-${tone}-fg)`, background: `var(--status-${tone}-bg)` }}
    >
      <Glyph kind={icon ?? DEFAULT_ICON[tone]} tone={tone} />
      <span className={wrap ? "text-pretty leading-snug" : "truncate"}>{children}</span>
    </span>
  );
}
