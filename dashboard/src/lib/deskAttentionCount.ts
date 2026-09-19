/** Compact Needs you count for the Inbox nav badge. Same pile as the filter. Not a second pile. */
export function formatAttentionCount(count: number): string | null {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  return n > 9 ? "9+" : String(n);
}

export function formatAttentionCountAriaLabel(count: number): string | null {
  const display = formatAttentionCount(count);
  if (!display) return null;
  return `${display} need you`;
}

/** Accessible name for the Inbox DESK_LINKS item. Null when the badge is hidden. */
export function formatInboxNavAriaLabel(count: number): string | null {
  const needs = formatAttentionCountAriaLabel(count);
  if (!needs) return null;
  return `Inbox, ${needs}`;
}
