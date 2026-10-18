import { formatNeedsBadge } from "./inboxCounts";

/**
 * Needs you count for the Inbox nav badge. Same pile as the filter. Not a second pile.
 * Shows the real number up to 99: "9+" next to a "Needs you 78" tab read as a different count.
 */
export function formatAttentionCount(count: number): string | null {
  return formatNeedsBadge(count);
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
