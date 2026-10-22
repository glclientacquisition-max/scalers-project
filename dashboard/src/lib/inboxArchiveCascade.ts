/**
 * Inbox archive cascade (Platform #862): archiving a call also archives its
 * open holds and visits, in ONE database transaction
 * (inbox_archive_calls), and one Undo restores all of them
 * (inbox_undo_archive with the undo id the archive returned).
 *
 * Pure: no Next or Supabase imports, so the client, the server action and
 * node tests share the same rules.
 *
 * Fallback: where the RPC is not deployed yet (prod before #862) the server
 * answers mode "legacy" and archives the calls with the #860 single update;
 * request rows are then skipped exactly as before.
 */
import type { InboxHold, InboxItem, InboxJob } from "@/lib/inboxPurpose";
import { inboxArchiveUndoLabel, inboxCascadeCountParts, inboxUnarchivedLabel } from "@/lib/inboxArchiveUndo";
import { inboxBulkPlan, type InboxBulkRun, type InboxBulkSkip, type InboxBulkTarget } from "@/lib/inboxBulk";

export type InboxArchiveSkip = { id: string; reason: "already_archived" | "not_found" | string };

/** What the server action answers for Archive. */
export type InboxArchiveResult = {
  ok?: boolean;
  error?: string;
  /** cascade: inbox_archive_calls ran. legacy: RPC missing, calls archived with the #860 update. */
  mode?: "cascade" | "legacy";
  /** Calls the server archived in this run. */
  updatedIds?: string[];
  /** Open holds / visits archived with those calls (cascade only). */
  holds?: string[];
  visits?: string[];
  /** Call ids the server did not archive, with why. */
  skipped?: InboxArchiveSkip[];
  /** inbox_archive_undo row (cascade only, null when nothing changed). */
  undoId?: string | null;
};

export type InboxArchiveSend = (callIds: string[]) => Promise<InboxArchiveResult>;

/** What the server action answers for Undo. */
export type InboxUndoResult = {
  ok?: boolean;
  error?: string;
  restored?: { calls: string[]; holds: string[]; visits: string[] };
  changedSince?: string[];
  alreadyUndone?: boolean;
};

export type InboxUndoSend = (undoId: string) => Promise<InboxUndoResult>;

/** What the server action answers for Unarchive. */
export type InboxUnarchiveResult = {
  ok?: boolean;
  error?: string;
  /** cascade: inbox_unarchive_calls ran. legacy: RPC missing, calls set to New (#860 update). */
  mode?: "cascade" | "legacy";
  /** Calls set back to New in this run. */
  updatedIds?: string[];
  /** Holds / visits whose inbox_archived_at the server cleared (counts). */
  holds?: number;
  visits?: number;
  skipped?: InboxArchiveSkip[];
};

export type InboxUnarchiveSend = (callIds: string[]) => Promise<InboxUnarchiveResult>;

function count(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** inbox_unarchive_calls jsonb -> InboxUnarchiveResult (cascade). */
export function parseInboxUnarchiveRpc(data: unknown): InboxUnarchiveResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const detail = Array.isArray(d.skipped_detail) ? (d.skipped_detail as Array<Record<string, unknown>>) : [];
  return {
    ok: true,
    mode: "cascade",
    updatedIds: idList(d.call_ids),
    holds: count(d.holds),
    visits: count(d.visits),
    skipped: detail
      .map((row) => ({ id: String(row?.id ?? "").trim(), reason: String(row?.reason ?? "not_found") }))
      .filter((row) => row.id),
  };
}

export type InboxUnarchiveRun = InboxBulkRun & {
  mode: "cascade" | "legacy" | "harness" | "none";
  /** Calls set back to New (unique). */
  calls: number;
  holds: number;
  visits: number;
};

/**
 * Client side of Unarchive (bulk, row menu, ticket): ONE server request with
 * the call ids. A request row archived with its call unarchives that call.
 */
export async function sendInboxUnarchive(
  items: InboxItem[],
  send: InboxUnarchiveSend,
  opts: { harness?: boolean } = {}
): Promise<InboxUnarchiveRun> {
  const plan = inboxBulkPlan("unarchive", items);
  const base = { selected: items.length, skipped: plan.skipped };
  if (!plan.ids.length) return { ...base, applied: [], missed: [], mode: "none", calls: 0, holds: 0, visits: 0 };
  if (opts.harness) return { ...base, applied: plan.targets, missed: [], mode: "harness", calls: plan.ids.length, holds: 0, visits: 0 };
  const res = await send(plan.ids);
  if (res?.error) return { ...base, applied: [], missed: [], mode: "none", calls: 0, holds: 0, visits: 0, error: res.error };
  const updated = new Set(Array.isArray(res?.updatedIds) ? res.updatedIds : []);
  return {
    ...base,
    applied: plan.targets.filter((t) => updated.has(t.rowId)),
    missed: plan.targets.filter((t) => !updated.has(t.rowId)),
    mode: res?.mode === "cascade" ? "cascade" : "legacy",
    calls: updated.size,
    holds: res?.mode === "cascade" ? count(res.holds) : 0,
    visits: res?.mode === "cascade" ? count(res.visits) : 0,
  };
}

/** Toast line after Unarchive. Null when nothing came back. */
export function inboxUnarchiveText(run: { calls: number; holds: number; visits: number }): string | null {
  if (run.calls <= 0) return null;
  return inboxUnarchivedLabel(run.calls, run.holds, run.visits);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}

/** inbox_archive_calls jsonb -> InboxArchiveResult (cascade). */
export function parseInboxArchiveRpc(data: unknown): InboxArchiveResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const calls = Array.isArray(d.calls) ? (d.calls as Array<Record<string, unknown>>) : [];
  const detail = Array.isArray(d.skipped_detail) ? (d.skipped_detail as Array<Record<string, unknown>>) : [];
  const skipped: InboxArchiveSkip[] = detail
    .map((row) => ({ id: String(row?.id ?? "").trim(), reason: String(row?.reason ?? "not_found") }))
    .filter((row) => row.id);
  const named = new Set(skipped.map((row) => row.id));
  for (const id of idList(d.skipped)) if (!named.has(id)) skipped.push({ id, reason: "not_found" });
  return {
    ok: true,
    mode: "cascade",
    updatedIds: calls.map((row) => String(row?.id ?? "").trim()).filter(Boolean),
    holds: idList(d.holds),
    visits: idList(d.visits),
    skipped,
    undoId: typeof d.undo_id === "string" && d.undo_id ? d.undo_id : null,
  };
}

/** inbox_undo_archive jsonb -> InboxUndoResult. */
export function parseInboxUndoRpc(data: unknown): InboxUndoResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const r = (d.restored && typeof d.restored === "object" ? d.restored : {}) as Record<string, unknown>;
  return {
    ok: true,
    restored: { calls: idList(r.calls), holds: idList(r.holds), visits: idList(r.visits) },
    changedSince: idList(d.changed_since),
    alreadyUndone: d.already_undone === true,
  };
}

/**
 * The cascade is not on this database yet (#862 not applied): the function
 * or the inbox_archived_at column is missing. Only then do we fall back.
 */
export function isInboxCascadeMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || "");
  if (code === "PGRST202" || code === "42883") return true;
  if ((code === "42703" || code === "PGRST204") && /inbox_archived_at/i.test(msg)) return true;
  return /inbox_archive_calls|inbox_undo_archive|inbox_unarchive_calls|inbox_archived_at/i.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

/** Owner copy for an RPC refusal. Null: use the generic save error. */
export function inboxCascadeErrorText(
  error: { code?: string | null } | null | undefined,
  step: "archive" | "unarchive" | "undo"
): string | null {
  const code = String(error?.code || "");
  if (code === "42501") return `Your role cannot ${step} in this business.`;
  if (code === "22023") return step === "undo" ? "Nothing to undo." : `Pick 200 or fewer to ${step} at once.`;
  if (code === "P0002") return "Nothing to undo. It may have expired.";
  return null;
}

/**
 * A stamp only hides a request while its call is still archived. A call
 * brought back any other way than Undo (Unarchive, ticket menu) shows its
 * requests again. `callStatus` maps call id -> lead_status for the calls we
 * know; an unknown call keeps the stamp.
 */
export function settleInboxArchiveStamps<T extends InboxHold | InboxJob>(
  rows: T[],
  callStatus: ReadonlyMap<string, string | null | undefined>
): T[] {
  return rows.map((row) => {
    if (!row.inbox_archived_at || !row.call_id || !callStatus.has(row.call_id)) return row;
    return callStatus.get(row.call_id) === "archived" ? row : { ...row, inbox_archived_at: null };
  });
}

/** Call ids of stamped rows whose call status is not known yet. */
export function stampedCallIdsToCheck(
  rows: Array<InboxHold | InboxJob>,
  known: ReadonlySet<string>
): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.inbox_archived_at && row.call_id && !known.has(row.call_id)) out.add(row.call_id);
  }
  return [...out];
}

export type InboxArchivePlan = ReturnType<typeof inboxBulkPlan> & {
  /** Selected request rows with no call row of their own whose call IS selected. */
  riders: InboxBulkTarget[];
};

/**
 * Archive plan: call rows as in inboxBulkPlan. A request row whose call is
 * also being archived rides along (the server archives it with the call).
 * A request row whose call is not selected keeps the open_request skip.
 */
export function planInboxArchive(items: InboxItem[]): InboxArchivePlan {
  const plan = inboxBulkPlan("archive", items);
  const callIds = new Set(plan.ids);
  const byId = new Map(items.map((item) => [item.id, item]));
  const riders: InboxBulkTarget[] = [];
  const skipped: InboxBulkSkip[] = [];
  for (const skip of plan.skipped) {
    const item = byId.get(skip.itemId);
    const callId = String(item?.callId || "").trim();
    const rowId = String(item?.hold?.id || item?.job?.id || "").trim();
    if (skip.reason === "open_request" && item && callId && rowId && callIds.has(callId)) {
      riders.push({ itemId: item.id, rowId, callId });
    } else {
      skipped.push(skip);
    }
  }
  return { ...plan, skipped, riders };
}

export type InboxArchiveRun = InboxBulkRun & {
  cascaded: InboxBulkTarget[];
  mode: "cascade" | "legacy" | "harness" | "none";
  /** Holds and visits the server stamped with the archived calls (RPC `holds` / `visits`). */
  holdIds: string[];
  visitIds: string[];
  undoId: string | null;
};

/** Dev harness (no server): the open requests on the selected rows. */
function harnessIds(items: InboxItem[], plan: InboxArchivePlan, kind: "hold" | "job"): string[] {
  const chosen = new Set([...plan.targets, ...plan.riders].map((t) => t.itemId));
  const out = new Set<string>();
  for (const item of items) {
    if (!chosen.has(item.id)) continue;
    const id = kind === "hold" ? item.hold?.id : item.job?.id;
    if (id) out.add(id);
  }
  return [...out];
}

/**
 * Client side of Archive (bulk, row menu, ticket): ONE server request with
 * the call ids. Every selected row lands in exactly one of applied (call
 * archived), cascaded (request archived with its call), missed (server did
 * not change it: already handled) or skipped.
 */
export async function sendInboxArchive(
  items: InboxItem[],
  send: InboxArchiveSend,
  opts: { harness?: boolean } = {}
): Promise<InboxArchiveRun> {
  const plan = planInboxArchive(items);
  const base = { selected: items.length, undoId: null as string | null };
  if (!plan.ids.length) {
    return { ...base, applied: [], missed: [], cascaded: [], skipped: plan.skipped, mode: "none", holdIds: [], visitIds: [] };
  }
  if (opts.harness) {
    return {
      ...base,
      applied: plan.targets,
      missed: [],
      cascaded: plan.riders,
      skipped: plan.skipped,
      mode: "harness",
      holdIds: harnessIds(items, plan, "hold"),
      visitIds: harnessIds(items, plan, "job"),
    };
  }
  const res = await send(plan.ids);
  if (res?.error) {
    return { ...base, applied: [], missed: [], cascaded: [], skipped: plan.skipped, mode: "none", holdIds: [], visitIds: [], error: res.error };
  }
  const updated = new Set(Array.isArray(res?.updatedIds) ? res.updatedIds : []);
  const applied = plan.targets.filter((t) => updated.has(t.rowId));
  const missed = plan.targets.filter((t) => !updated.has(t.rowId));
  if (res?.mode !== "cascade") {
    // #862 not on this database: the calls were archived, requests were not.
    const skipped = [...plan.skipped, ...plan.riders.map((t) => ({ itemId: t.itemId, reason: "open_request" as const }))];
    return { ...base, applied, missed, cascaded: [], skipped, mode: "legacy", holdIds: [], visitIds: [] };
  }
  const flagged = new Set([...(res.holds || []), ...(res.visits || [])]);
  const cascaded = plan.riders.filter((t) => flagged.has(t.rowId));
  const ridersMissed = plan.riders.filter((t) => !flagged.has(t.rowId));
  return {
    ...base,
    applied,
    missed: [...missed, ...ridersMissed],
    cascaded,
    skipped: plan.skipped,
    mode: "cascade",
    holdIds: [...new Set(res.holds || [])],
    visitIds: [...new Set(res.visits || [])],
    undoId: res.undoId || null,
  };
}


/** "24 archived, plus 1 open request and 4 visits on those calls" (the toast label). */
export function inboxArchivedLabel(calls: number, holds = 0, visits = 0): string {
  return inboxArchiveUndoLabel(calls, holds, visits);
}

/** Undo copy from inbox_undo_archive `restored`: "24 restored, plus 1 open request and 4 visits." */
export function inboxCascadeUndoText(opts: {
  restoredCalls: number;
  restoredHolds: number;
  restoredVisits: number;
  changedSince: number;
  alreadyUndone?: boolean;
}): string {
  if (opts.alreadyUndone) return "Already restored.";
  const parts = inboxCascadeCountParts(opts.restoredHolds, opts.restoredVisits);
  const head = `${opts.restoredCalls} restored${parts ? `, plus ${parts}` : ""}.`;
  return opts.changedSince > 0 ? `${head} ${opts.changedSince} changed since.` : head;
}

/**
 * Undo with the server's undo record: ONE request. Rows come back only when
 * their call was restored; anything changed since the archive is counted,
 * never shown as restored.
 */
export async function sendInboxCascadeUndo(
  payload: {
    undoId: string;
    rows: Array<{ id: string; callId: string }>;
    requests?: Array<{ id: string; callId: string }>;
  },
  send: InboxUndoSend
): Promise<{
  restored: Array<{ id: string; callId: string }>;
  missed: Array<{ id: string; callId: string }>;
  restoredCalls: number;
  restoredHolds: number;
  restoredVisits: number;
  changedSince: number;
  alreadyUndone: boolean;
  error?: string;
}> {
  const res = await send(payload.undoId);
  const empty = { restored: [], missed: [], restoredCalls: 0, restoredHolds: 0, restoredVisits: 0, changedSince: 0, alreadyUndone: false };
  if (res?.error) return { ...empty, error: res.error };
  const calls = new Set(res.restored?.calls || []);
  const all = [...payload.rows, ...(payload.requests || [])];
  return {
    restored: all.filter((row) => calls.has(row.callId)),
    missed: payload.rows.filter((row) => !calls.has(row.callId)),
    restoredCalls: payload.rows.filter((row) => calls.has(row.callId)).length,
    restoredHolds: new Set(res.restored?.holds || []).size,
    restoredVisits: new Set(res.restored?.visits || []).size,
    changedSince: (res.changedSince || []).length,
    alreadyUndone: Boolean(res.alreadyUndone),
  };
}
