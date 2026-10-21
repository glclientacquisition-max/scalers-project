/**
 * Inbox bulk actions (select mode Confirm / Done / Mark done / Archive /
 * Unarchive, and archive Undo) as ONE server request with ONE update per
 * table, instead of one server action per selected row.
 *
 * Pure: no Next or Supabase imports, so the client bar, the server action and
 * node tests share the same rules.
 */
import type { InboxItem } from "@/lib/inboxPurpose";

export type InboxBulkKind = "confirm" | "done" | "mark_done" | "archive" | "unarchive";

/** A page holds up to 150 rows; anything past this is not a real selection. */
export const INBOX_BULK_MAX = 200;

export type InboxBulkTarget = {
  /** Inbox row id (for patch/hide on the client). */
  itemId: string;
  /** Id the server updates: call id, appointment id or hold id. */
  rowId: string;
  callId: string | null;
};

export type InboxBulkWrite = {
  table: "calls" | "appointments" | "service_requests";
  /** Column + value the single-row action writes. */
  column: "lead_status" | "status";
  value: string;
  /** Rows the single-row action re-read for its caller text. */
  select: string;
  /** Stamp updated_at like the single-row action. */
  touchUpdatedAt: boolean;
};

const WRITES: Record<InboxBulkKind, InboxBulkWrite> = {
  // updateLeadStatus(callId, …)
  mark_done: { table: "calls", column: "lead_status", value: "resolved", select: "id", touchUpdatedAt: false },
  archive: { table: "calls", column: "lead_status", value: "archived", select: "id", touchUpdatedAt: false },
  unarchive: { table: "calls", column: "lead_status", value: "new", select: "id", touchUpdatedAt: false },
  // updateAppointmentStatus(id, "confirmed")
  confirm: {
    table: "appointments",
    column: "status",
    value: "confirmed",
    select: "id, caller_phone, caller_name, service_name, when_text, call_id",
    touchUpdatedAt: true,
  },
  // updateServiceRequestStatus(id, "fulfilled")
  done: {
    table: "service_requests",
    column: "status",
    value: "fulfilled",
    select: "id, caller_phone, caller_name, item, request_type, call_id",
    touchUpdatedAt: true,
  },
};

export function isInboxBulkKind(kind: unknown): kind is InboxBulkKind {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(WRITES, kind);
}

export function inboxBulkWrite(kind: InboxBulkKind): InboxBulkWrite {
  return WRITES[kind];
}

/** Kinds that only touch `calls` (the dev harness skips the server for these, as before). */
export function inboxBulkIsCallsOnly(kind: InboxBulkKind): boolean {
  return WRITES[kind].table === "calls";
}

function archived(item: InboxItem): boolean {
  return item.lead?.leadStatus === "archived";
}

/**
 * Rows a bulk action applies to, with the same skip rules the old per-row
 * loop used. A row without the id that action needs is skipped (the old loop
 * would have stopped on "Missing call." / "Missing appointment.").
 */
export function inboxBulkTargets(kind: InboxBulkKind, items: InboxItem[]): InboxBulkTarget[] {
  const out: InboxBulkTarget[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let rowId: string | null | undefined = null;
    if (kind === "confirm") {
      if (String(item.job?.status || "").toLowerCase() !== "requested") continue;
      rowId = item.job?.id;
    } else if (kind === "done") {
      if (String(item.hold?.status || "").toLowerCase() !== "open") continue;
      rowId = item.hold?.id;
    } else if (kind === "mark_done") {
      if (item.job || item.hold || archived(item)) continue;
      rowId = item.callId;
    } else if (kind === "archive") {
      if (archived(item)) continue;
      rowId = item.callId;
    } else if (kind === "unarchive") {
      if (!archived(item)) continue;
      rowId = item.callId;
    }
    const id = String(rowId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ itemId: item.id, rowId: id, callId: item.callId ?? null });
  }
  return out;
}

/** Trimmed, de-duplicated string ids. Null when the list is empty or too long. */
export function cleanInboxBulkIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || id.length > 64 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (!out.length || out.length > INBOX_BULK_MAX) return null;
  return out;
}

export type InboxBulkSend = (
  kind: InboxBulkKind,
  ids: string[]
) => Promise<{ ok?: boolean; error?: string; notice?: string }>;

export type InboxBulkRun = {
  /** Rows the action applied to (hide/patch these on success). */
  targets: InboxBulkTarget[];
  error?: string;
  notice?: string;
};

/**
 * Client side of a bulk action: pick the rows, then ONE server request for all
 * of them (none when nothing applies, or in the dev harness for calls-only
 * kinds, matching the old per-row helpers).
 */
export async function sendInboxBulk(
  kind: InboxBulkKind,
  items: InboxItem[],
  send: InboxBulkSend,
  opts: { harness?: boolean } = {}
): Promise<InboxBulkRun> {
  const targets = inboxBulkTargets(kind, items);
  if (!targets.length) return { targets };
  if (opts.harness && inboxBulkIsCallsOnly(kind)) return { targets };
  const res = await send(kind, targets.map((t) => t.rowId));
  if (res?.error) return { targets: [], error: res.error };
  return res?.notice ? { targets, notice: res.notice } : { targets };
}

/** Archive Undo: every archived call back to New in one request. */
export async function sendInboxArchiveUndo(
  rows: Array<{ id: string; callId: string }>,
  send: InboxBulkSend
): Promise<{ error?: string }> {
  const ids = rows.map((row) => row.callId).filter(Boolean);
  if (!ids.length) return {};
  const res = await send("unarchive", ids);
  return res?.error ? { error: res.error } : {};
}
