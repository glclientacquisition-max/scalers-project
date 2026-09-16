/**
 * Universal conversation-row anatomy (messaging-app grammar): neutral identity
 * circle, two-line body, timestamp right, state carried by type weight + dot.
 * Canon: docs/frontend/design-system/MASTER.md (list rows).
 */

/** Initials for the identity circle. Phone numbers and placeholders have none. */
export function deskRowInitials(name: string | null | undefined): string {
  const clean = String(name || "").trim();
  if (!clean || /^\+?[\d\s()-]+$/.test(clean)) return "";
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <circle cx="8" cy="5.2" r="2.6" />
      <path d="M2.8 13.6c.7-2.5 2.8-3.9 5.2-3.9s4.5 1.4 5.2 3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Neutral circle. Never tinted by state and never rainbow by name: it only
 * signals "this row is a person". State lives in the dot and the type weight.
 */
export function RowIdentity({ name }: { name?: string | null }) {
  const initials = deskRowInitials(name);
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-xs font-semibold text-ink-soft"
    >
      {initials || <PersonGlyph />}
    </span>
  );
}

/** Brand-blue dot for rows that need the owner. Sits with the timestamp. */
export function RowStateDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="img"
      aria-label="Needs you"
      className="h-2 w-2 shrink-0 rounded-full bg-accent"
    />
  );
}

/** Name/headline weight: semibold while the row needs you, medium once handled. */
export function deskRowWeightClass(needsYou: boolean): string {
  return needsYou ? "font-semibold text-ink" : "font-medium text-ink";
}
