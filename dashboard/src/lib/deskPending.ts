/**
 * Tap skeleton for a desk destination.
 * `start` paints it. It stays up after the URL changes until the page body
 * commits. A cancelled tap, or the desk error boundary, clears it.
 */
export type DeskPendingEvent =
  | { type: "start"; href: string; pathname: string }
  | { type: "link-idle"; href: string; pathname: string }
  | { type: "committed"; pathname: string; concealed: boolean }
  | { type: "error" };

export function nextDeskPendingHref(
  current: string | null,
  event: DeskPendingEvent
): string | null {
  if (event.type === "start") {
    if (event.pathname === event.href) return current;
    return event.href;
  }
  if (event.type === "error") return null;
  if (!current) return null;
  if (event.type === "link-idle") {
    if (current !== event.href) return current;
    if (event.pathname === event.href) return current;
    return null;
  }
  if (event.concealed) return current;
  if (event.pathname === current) return null;
  return current;
}
