export const INBOX_ARCHIVE_UNDO_MS = 5000;
export const INBOX_ARCHIVE_UNDO_KEY = "scalers-inbox-archive-undo";
export const INBOX_ARCHIVE_UNDO_EVENT = "scalers-inbox-archive-undo";

export type InboxArchiveUndoRow = {
  id: string;
  callId: string;
};

export type InboxArchiveUndoPayload = {
  /** Call rows archived (the toast counts these). */
  rows: InboxArchiveUndoRow[];
  expiresAt: number;
  /** inbox_archive_undo id (cascade). Absent: Undo sends the calls back to New (#860 path). */
  undoId?: string;
  /** Selected request rows archived with their call (hidden with it, back with it). */
  requests?: InboxArchiveUndoRow[];
  /** Holds (service_requests) the server stamped with these calls (inbox_archive_calls `holds`). */
  holdIds?: string[];
  /** Visits (appointments) the server stamped with these calls (inbox_archive_calls `visits`). */
  visitIds?: string[];
};

export type InboxArchiveUndoExtra = {
  undoId?: string | null;
  requests?: InboxArchiveUndoRow[];
  holdIds?: string[];
  visitIds?: string[];
};

export type InboxArchiveUndoStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserStore(): InboxArchiveUndoStore | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * "1 open request", "2 open requests and 4 visits". Zero parts dropped.
 * Empty when both are zero.
 */
export function inboxCascadeCountParts(holds: number, visits: number): string {
  const parts: string[] = [];
  if (holds > 0) parts.push(`${holds} open ${holds === 1 ? "request" : "requests"}`);
  if (visits > 0) parts.push(`${visits} ${visits === 1 ? "visit" : "visits"}`);
  return parts.join(" and ");
}

/**
 * Toast label. `holds` / `visits`: what inbox_archive_calls stamped with
 * these calls (every open hold and visit on them, not only selected rows),
 * e.g. "24 archived, plus 9 open requests and 4 visits on those calls".
 */
export function inboxArchiveUndoLabel(count: number, holds = 0, visits = 0): string {
  const head = archivedHead(count);
  const parts = inboxCascadeCountParts(holds, visits);
  if (!parts) return head;
  return `${head}, plus ${parts} on ${count > 1 ? "those calls" : "that call"}`;
}

function archivedHead(count: number): string {
  if (count <= 1) return "Archived";
  return `${count} archived`;
}

function usableRows(rows: InboxArchiveUndoRow[]): InboxArchiveUndoRow[] {
  const out: InboxArchiveUndoRow[] = [];
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const callId = String(row?.callId || "").trim();
    if (!id || !callId) continue;
    out.push({ id, callId });
  }
  return out;
}

export function parseInboxArchiveUndo(
  raw: string | null,
  now = Date.now()
): InboxArchiveUndoPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InboxArchiveUndoPayload>;
    if (!parsed || !Array.isArray(parsed.rows) || typeof parsed.expiresAt !== "number") {
      return null;
    }
    if (parsed.expiresAt <= now) return null;
    const rows = usableRows(parsed.rows as InboxArchiveUndoRow[]);
    if (!rows.length) return null;
    return withExtra({ rows, expiresAt: parsed.expiresAt }, parsed);
  } catch {
    return null;
  }
}

function withExtra(payload: InboxArchiveUndoPayload, extra?: InboxArchiveUndoExtra | null): InboxArchiveUndoPayload {
  const undoId = typeof extra?.undoId === "string" ? extra.undoId.trim() : "";
  if (!undoId) return payload;
  const requests = usableRows(Array.isArray(extra?.requests) ? extra.requests : []);
  const ids = (raw: unknown) =>
    (Array.isArray(raw) ? raw : []).map((id) => String(id || "").trim()).filter(Boolean);
  return { ...payload, undoId, requests, holdIds: ids(extra?.holdIds), visitIds: ids(extra?.visitIds) };
}

export function writeInboxArchiveUndo(
  rows: InboxArchiveUndoRow[],
  now = Date.now(),
  store: InboxArchiveUndoStore | null = browserStore(),
  extra: InboxArchiveUndoExtra | null = null
): InboxArchiveUndoPayload | null {
  const usable = usableRows(rows);
  if (!usable.length) return null;
  const payload: InboxArchiveUndoPayload = withExtra(
    { rows: usable, expiresAt: now + INBOX_ARCHIVE_UNDO_MS },
    extra
  );
  try {
    store?.setItem(INBOX_ARCHIVE_UNDO_KEY, JSON.stringify(payload));
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(INBOX_ARCHIVE_UNDO_EVENT, { detail: payload }));
  }
  return payload;
}

export function readInboxArchiveUndo(
  now = Date.now(),
  store: InboxArchiveUndoStore | null = browserStore()
): InboxArchiveUndoPayload | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(INBOX_ARCHIVE_UNDO_KEY) ?? null;
  } catch {
    return null;
  }
  const payload = parseInboxArchiveUndo(raw, now);
  if (!payload) {
    clearInboxArchiveUndo(store);
    return null;
  }
  return payload;
}

export function clearInboxArchiveUndo(store: InboxArchiveUndoStore | null = browserStore()) {
  try {
    store?.removeItem(INBOX_ARCHIVE_UNDO_KEY);
  } catch {
    /* ignore */
  }
}
