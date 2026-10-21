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

export type InboxBulkSkip = {
  itemId: string;
  /**
   * open_request: a hold or visit row with no call row of its own (a second
   * request on the same call). Archiving the call does not close it, so it
   * would stay in Needs you; it needs Done or Confirm.
   * not_eligible: the row is not in the state this action changes.
   */
  reason: "open_request" | "not_eligible";
};

export type InboxBulkPlan = {
  /** Every selected row the action applies to, one per row (rows may share a rowId). */
  targets: InboxBulkTarget[];
  /** Selected rows the action does not apply to, with why. Never dropped silently. */
  skipped: InboxBulkSkip[];
  /** Unique ids for the server. */
  ids: string[];
};

/**
 * Split a selection into rows the action applies to and rows it skips (with
 * the reason). Archive, Unarchive and Mark done change the call row
 * (lead_status), so they only apply to rows that ARE a call row: a hold or
 * visit row without one (a second request on a call) is skipped as
 * open_request, because archiving its call leaves it in Needs you.
 */
export function inboxBulkPlan(kind: InboxBulkKind, items: InboxItem[]): InboxBulkPlan {
  const targets: InboxBulkTarget[] = [];
  const skipped: InboxBulkSkip[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let rowId: string | null | undefined = null;
    let eligible = true;
    if (kind === "confirm") {
      eligible = String(item.job?.status || "").toLowerCase() === "requested";
      rowId = item.job?.id;
    } else if (kind === "done") {
      eligible = String(item.hold?.status || "").toLowerCase() === "open";
      rowId = item.hold?.id;
    } else {
      if (!item.lead) {
        skipped.push({ itemId: item.id, reason: item.hold || item.job ? "open_request" : "not_eligible" });
        continue;
      }
      if (kind === "mark_done") eligible = !item.job && !item.hold && !archived(item);
      else if (kind === "archive") eligible = !archived(item);
      else eligible = archived(item);
      rowId = item.callId;
    }
    const id = String(rowId || "").trim();
    if (!eligible || !id) {
      skipped.push({ itemId: item.id, reason: "not_eligible" });
      continue;
    }
    targets.push({ itemId: item.id, rowId: id, callId: item.callId ?? null });
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { targets, skipped, ids };
}

/** Rows a bulk action applies to (see inboxBulkPlan). */
export function inboxBulkTargets(kind: InboxBulkKind, items: InboxItem[]): InboxBulkTarget[] {
  return inboxBulkPlan(kind, items).targets;
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
) => Promise<{ ok?: boolean; error?: string; notice?: string; updatedIds?: string[] }>;

export type InboxBulkRun = {
  /** Rows the server actually changed (hide/patch these, offer Undo for these). */
  applied: InboxBulkTarget[];
  /** Rows sent but not changed by the server (already handled, gone, or not this business). */
  missed: InboxBulkTarget[];
  /** Selected rows the action does not apply to. */
  skipped: InboxBulkSkip[];
  /** Rows selected. */
  selected: number;
  error?: string;
  notice?: string;
};

/**
 * Client side of a bulk action: plan the rows, then ONE server request with
 * every unique id. The server answers with the ids it actually updated, and
 * each selected row lands in exactly one of applied, missed or skipped.
 */
export async function sendInboxBulk(
  kind: InboxBulkKind,
  items: InboxItem[],
  send: InboxBulkSend,
  opts: { harness?: boolean } = {}
): Promise<InboxBulkRun> {
  const plan = inboxBulkPlan(kind, items);
  const base = { skipped: plan.skipped, selected: items.length };
  if (!plan.ids.length) return { ...base, applied: [], missed: [] };
  if (opts.harness && inboxBulkIsCallsOnly(kind)) return { ...base, applied: plan.targets, missed: [] };
  const res = await send(kind, plan.ids);
  if (res?.error) return { ...base, applied: [], missed: [], error: res.error };
  const updated = new Set(Array.isArray(res?.updatedIds) ? res.updatedIds : []);
  const applied = plan.targets.filter((t) => updated.has(t.rowId));
  const missed = plan.targets.filter((t) => !updated.has(t.rowId));
  return res?.notice ? { ...base, applied, missed, notice: res.notice } : { ...base, applied, missed };
}

const DONE_WORD: Record<InboxBulkKind, string> = {
  archive: "archived",
  unarchive: "moved back to the Inbox",
  mark_done: "marked done",
  confirm: "confirmed",
  done: "marked done",
};

/**
 * What the owner reads when not every selected row changed. Null when every
 * selected row changed (the normal toast or nothing).
 */
export function inboxBulkOutcomeText(kind: InboxBulkKind, run: InboxBulkRun): string | null {
  if (run.error) return run.error;
  const left = run.missed.length + run.skipped.length;
  if (!left) return null;
  const parts = [`${run.applied.length} of ${run.selected} ${DONE_WORD[kind]}.`];
  const open = run.skipped.filter((s) => s.reason === "open_request").length;
  const other = run.skipped.length - open;
  if (open) {
    parts.push(
      open === 1
        ? "1 is an open request on a call, so use Done or Confirm on it."
        : `${open} are open requests on a call, so use Done or Confirm on them.`
    );
  }
  if (run.missed.length) {
    parts.push(run.missed.length === 1 ? "1 was already handled." : `${run.missed.length} were already handled.`);
  }
  if (other) parts.push(other === 1 ? "1 did not need it." : `${other} did not need it.`);
  return parts.join(" ");
}

/**
 * Archive Undo: send exactly the archived calls back to New in one request.
 * Rows the server did not change are reported, never counted as restored.
 */
export async function sendInboxArchiveUndo(
  rows: Array<{ id: string; callId: string }>,
  send: InboxBulkSend
): Promise<{ restored: Array<{ id: string; callId: string }>; missed: Array<{ id: string; callId: string }>; error?: string }> {
  const ids = [...new Set(rows.map((row) => row.callId).filter(Boolean))];
  if (!ids.length) return { restored: [], missed: [] };
  const res = await send("unarchive", ids);
  if (res?.error) return { restored: [], missed: [], error: res.error };
  const updated = new Set(Array.isArray(res?.updatedIds) ? res.updatedIds : []);
  return {
    restored: rows.filter((row) => updated.has(row.callId)),
    missed: rows.filter((row) => !updated.has(row.callId)),
  };
}

/** Undo copy when not every archived row came back. */
export function inboxUndoOutcomeText(run: { restored: unknown[]; missed: unknown[]; error?: string }): string | null {
  if (run.error) return run.error;
  if (!run.missed.length) return null;
  const total = run.restored.length + run.missed.length;
  return `${run.restored.length} of ${total} restored. ${run.missed.length === 1 ? "1 was" : `${run.missed.length} were`} changed since.`;
}
