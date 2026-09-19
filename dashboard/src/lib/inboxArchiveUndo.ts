export const INBOX_ARCHIVE_UNDO_MS = 5000;
export const INBOX_ARCHIVE_UNDO_KEY = "scalers-inbox-archive-undo";
export const INBOX_ARCHIVE_UNDO_EVENT = "scalers-inbox-archive-undo";

export type InboxArchiveUndoRow = {
  id: string;
  callId: string;
};

export type InboxArchiveUndoPayload = {
  rows: InboxArchiveUndoRow[];
  expiresAt: number;
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

export function inboxArchiveUndoLabel(count: number): string {
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
    return { rows, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function writeInboxArchiveUndo(
  rows: InboxArchiveUndoRow[],
  now = Date.now(),
  store: InboxArchiveUndoStore | null = browserStore()
): InboxArchiveUndoPayload | null {
  const usable = usableRows(rows);
  if (!usable.length) return null;
  const payload: InboxArchiveUndoPayload = {
    rows: usable,
    expiresAt: now + INBOX_ARCHIVE_UNDO_MS,
  };
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
