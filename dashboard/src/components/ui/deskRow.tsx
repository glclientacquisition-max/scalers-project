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

function PersonGlyph({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-7 w-7" : "h-4 w-4";
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={box}>
      <circle cx="8" cy="5.2" r="2.6" />
      <path d="M2.8 13.6c.7-2.5 2.8-3.9 5.2-3.9s4.5 1.4 5.2 3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Neutral circle. Never tinted by state and never rainbow by name: it only
 * signals "this row is a person". State lives in the dot and the type weight.
 */
export function RowIdentity({
  name,
  size = "md",
}: {
  name?: string | null;
  size?: "md" | "lg";
}) {
  const initials = deskRowInitials(name);
  const box =
    size === "lg"
      ? "flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-lg font-semibold text-ink-soft"
      : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-xs font-semibold text-ink-soft";
  return (
    <span aria-hidden className={box}>
      {initials || <PersonGlyph size={size} />}
    </span>
  );
}

/** Brand-blue ping for a thing happening now. Live stamp and Home bulletin only. */
export function LivePing({ label = "Live" }: { label?: string }) {
  return (
    <span role="img" aria-label={label} className="relative inline-flex h-2 w-2 shrink-0">
      <span className="desk-live-ping absolute inset-0 rounded-full bg-accent" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}

/** Brand-blue dot for unread rows. Sits with the timestamp. Live unread rows ping. */
export function RowStateDot({ show, live }: { show: boolean; live?: boolean }) {
  if (!show) return null;
  if (live) return <LivePing />;
  return (
    <span
      role="img"
      aria-label="Unread"
      className="h-2 w-2 shrink-0 rounded-full bg-accent"
    />
  );
}

/** Name/headline weight: semibold while unread, medium once opened. */
export function deskRowWeightClass(unread: boolean): string {
  return unread ? "font-semibold text-ink" : "font-medium text-ink";
}
