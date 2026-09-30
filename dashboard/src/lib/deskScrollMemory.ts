import { isDeskNestedPath } from "./deskTicketChat";

/** List roots that scroll inside `[data-desk-main]`. Nested records are not keys. */
const LIST_ROOTS = new Set([
  "/home",
  "/calls",
  "/contacts",
  "/wallet",
  "/settings",
  "/requests",
  "/appointments",
]);

/**
 * Scroll memory key for a desk list URL.
 * Nested ticket, contact, and Profile panels return null so the list position stays stored.
 */
export function deskListScrollKey(
  pathname: string | null | undefined,
  search?: string | null
): string | null {
  const path = String(pathname || "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const query = String(search || "").replace(/^\?/, "");
  if (isDeskNestedPath(path, query)) return null;
  if (!LIST_ROOTS.has(path)) return null;
  return query ? `${path}?${query}` : path;
}

type ScrollBox = { scrollTop: number };

const memory = new Map<string, number>();
let applying = false;
let holdSaves = false;

export function deskScrollApplying(): boolean {
  return applying;
}

export function deskScrollSavesHeld(): boolean {
  return holdSaves;
}

/** Block scroll writes from the commit that clamps `scrollTop` before restore. */
export function holdDeskScrollSaves(hold: boolean): void {
  holdSaves = hold;
}

export function snapshotDeskScroll(main: ScrollBox | null, key: string | null): void {
  if (!main || !key) return;
  memory.set(key, main.scrollTop);
}

export function writeDeskScroll(key: string | null, top: number): void {
  if (!key || applying || holdSaves) return;
  memory.set(key, top);
}

/** Restore a list, or zero the well on a nested record without dropping the saved list position. */
export function applyDeskScroll(main: ScrollBox | null, key: string | null): void {
  if (!main) return;
  applying = true;
  try {
    const top = key ? (memory.get(key) ?? 0) : 0;
    if (main.scrollTop !== top) main.scrollTop = top;
  } finally {
    applying = false;
  }
}
