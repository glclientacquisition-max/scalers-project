/** Grow a list by one modest slice. Callers keep earlier rows. */

export const LIST_SLICE = 25;

export const listWindowClass =
  "[&_li]:[content-visibility:auto] [&_li]:[contain-intrinsic-size:auto_4.5rem] [&_tr]:[content-visibility:auto] [&_tr]:[contain-intrinsic-size:auto_4.5rem]";

export function nextShown(shown: number, total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const current = Math.max(0, Math.floor(shown) || 0);
  const cap = Math.max(0, Math.floor(total) || 0);
  if (current >= cap) return current;
  const base = Math.max(size, current);
  return Math.min(cap, base + size);
}

const PULL_REFRESH_PX = 64;

/**
 * Phone pull at the top of a list. A desktop pointer, a mid-list scroll,
 * and a sideways move (pile swipe) do not commit.
 */
export function pullRefreshCommit(input: {
  phone: boolean;
  scrollTop: number;
  dx: number;
  dy: number;
}): boolean {
  if (!input.phone) return false;
  if (input.scrollTop > 0) return false;
  if (!(input.dy >= PULL_REFRESH_PX)) return false;
  if (Math.abs(input.dx) >= input.dy) return false;
  return true;
}

/** Failed refresh keeps the rows on screen. Success replaces them with the first slice. */
export function listAfterPullRefresh<T>(
  current: readonly T[],
  incoming: readonly T[] | null,
  failed: boolean
): { rows: T[]; reset: boolean } {
  if (failed || incoming == null) return { rows: [...current], reset: false };
  return { rows: [...incoming], reset: true };
}

/**
 * Which scroller gates a phone pull. A ticket locks the desk well, so the
 * open pane's scrollTop wins. A scrolling desk well wins over that pane.
 */
export function pickPullScrollTop(input: {
  deskScrolls: boolean;
  deskTop: number;
  paneScrolls: boolean;
  paneTop: number;
}): number {
  if (input.deskScrolls) return input.deskTop;
  if (input.paneScrolls) return input.paneTop;
  return input.deskTop;
}

/** Dirty profile text skips the reload. A failed reload keeps the screen. */
export function shellPullPlan(input: { dirty: boolean; failed: boolean }): "skip" | "keep" | "refresh" {
  if (input.dirty) return "skip";
  if (input.failed) return "keep";
  return "refresh";
}

/** A field is dirty when its current token differs from the value first seen. New fields are clean. */
export function deskFieldsDirty(
  baseline: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>
): boolean {
  for (const [key, value] of Object.entries(current)) {
    if (Object.prototype.hasOwnProperty.call(baseline, key) && baseline[key] !== value) return true;
  }
  return false;
}

/** Same sentences the pages already use when a load fails. */
export function shellPullErrorCopy(pathname: string): string {
  const path = String(pathname || "").split("?")[0].split("#")[0] || "/";
  if (path.startsWith("/calls/")) return "Could not load this call.";
  if (path.startsWith("/contacts/")) return "Could not load this contact.";
  if (path === "/wallet" || path.startsWith("/wallet/")) return "Could not load Usage.";
  if (path === "/settings" || path.startsWith("/settings/")) return "Could not load Business Profile.";
  if (path === "/home" || path.startsWith("/home/")) return "Could not load Overview.";
  return "Could not refresh.";
}

export function appendUniqueById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[]
): { rows: T[]; added: number } {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const row of current) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  let added = 0;
  for (const row of incoming) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
    added += 1;
  }
  return { rows, added };
}
