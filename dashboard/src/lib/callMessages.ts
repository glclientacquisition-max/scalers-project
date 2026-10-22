/**
 * Per-call text thread (call_messages, Platform #868). Reads and writes go
 * through the call_messages_* RPCs only; members have no table access.
 *
 * Every function here is safe when the RPCs are not on the database yet:
 * reads report `available: false` (the call view then renders exactly as
 * before, with no Call | Texts toggle) and writes return a result instead of
 * throwing, so a caller SMS is never blocked or changed by the thread.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CallMessageStatus = "pending" | "sent" | "delivered" | "failed" | "refused" | "received";

export type CallMessage = {
  id: string;
  createdAt: string;
  direction: "in" | "out";
  body: string;
  status: CallMessageStatus;
  failureReason: string | null;
  retryOf: string | null;
  authorKind: "owner" | "assistant" | "system" | null;
  source: string;
  sentAt: string | null;
};

export type CallMessagesLoad = {
  /** False when the RPCs are missing or the read failed: hide the Texts tab. */
  available: boolean;
  messages: CallMessage[];
  unreadIn: number;
  hasMore: boolean;
};

type RpcError = { code?: string | null; message?: string | null } | null | undefined;

/** Sources call_messages_record_out accepts (outbound only). */
export const CALL_MESSAGE_SOURCES = new Set([
  "caller_note",
  "caller_inbox_reply",
  "caller_callback",
  "caller_appointment",
  "caller_appointment_confirmed",
  "caller_appointment_cancelled",
  "caller_appointment_rescheduled",
  "caller_hold",
  "caller_hold_updated",
  "caller_hold_ready",
  "caller_hold_cancelled",
  "caller_order",
  "missed_textback",
]);

const STATUSES = new Set<CallMessageStatus>(["pending", "sent", "delivered", "failed", "refused", "received"]);

/** The function (or table) is not on this database yet. Only then do we fall back silently. */
export function isCallMessagesRpcMissing(error: RpcError): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST202" || code === "42883" || code === "42P01") return true;
  const msg = String(error.message || "");
  return /call_messages/i.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function normalizeCallMessage(raw: unknown): CallMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const body = str(r.body);
  if (!id || !body) return null;
  const direction = r.direction === "in" ? "in" : "out";
  const status = STATUSES.has(r.status as CallMessageStatus)
    ? (r.status as CallMessageStatus)
    : direction === "in"
      ? "received"
      : "pending";
  const author = r.author_kind;
  return {
    id,
    createdAt: str(r.created_at),
    direction,
    body,
    status,
    failureReason: str(r.failure_reason) || null,
    retryOf: str(r.retry_of) || null,
    authorKind: author === "owner" || author === "assistant" || author === "system" ? author : null,
    source: str(r.source),
    sentAt: str(r.sent_at) || null,
  };
}

const NONE: CallMessagesLoad = { available: false, messages: [], unreadIn: 0, hasMore: false };

/**
 * Newest page of one call's thread (oldest first). Only the first page is
 * read, so the call stays signature-agnostic while Platform moves the keyset
 * to (created_at, id).
 */
export async function loadCallMessages(
  client: SupabaseClient,
  tenantId: string,
  callId: string,
  limit = 100
): Promise<CallMessagesLoad> {
  if (!tenantId || !callId) return NONE;
  try {
    const { data, error } = await client.rpc("call_messages_list", {
      p_tenant_id: tenantId,
      p_call_id: callId,
      p_limit: limit,
    });
    if (error) {
      if (!isCallMessagesRpcMissing(error)) console.warn("[call messages] list", error.code, error.message);
      return NONE;
    }
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const rows = Array.isArray(obj.messages) ? obj.messages : [];
    return {
      available: true,
      messages: rows.map(normalizeCallMessage).filter((m): m is CallMessage => Boolean(m)),
      unreadIn: Math.max(0, Number(obj.unread_in) || 0),
      hasMore: obj.has_more === true,
    };
  } catch (err) {
    console.warn("[call messages] list", err instanceof Error ? err.message : err);
    return NONE;
  }
}

export type RecordOutResult =
  | { mode: "recorded"; id: string | null; status: string | null }
  | { mode: "skipped"; reason: string }
  | { mode: "missing" }
  | { mode: "error"; code: string | null; message: string };

/**
 * Put one outbound caller SMS on its call's thread, with the same key the
 * ledger got (deskSendKey). Never throws. 23505 (already on the thread) is
 * treated as done.
 */
export async function recordCallMessageOut(
  client: SupabaseClient,
  opts: {
    tenantId: string;
    callId?: string | null;
    key: string;
    source: string;
    body: string;
    notifySendId?: string | null;
    appointmentId?: string | null;
    requestId?: string | null;
  }
): Promise<RecordOutResult> {
  const callId = String(opts.callId || "").trim();
  const body = String(opts.body || "").trim();
  if (!opts.tenantId || !callId) return { mode: "skipped", reason: "no_call" };
  if (!opts.key) return { mode: "skipped", reason: "no_key" };
  if (!CALL_MESSAGE_SOURCES.has(opts.source)) return { mode: "skipped", reason: "source" };
  if (!body) return { mode: "skipped", reason: "empty" };
  try {
    const { data, error } = await client.rpc("call_messages_record_out", {
      p_tenant_id: opts.tenantId,
      p_call_id: callId,
      p_key: opts.key,
      p_source: opts.source,
      p_body: body.slice(0, 1600),
      p_notify_send_id: opts.notifySendId || null,
      p_appointment_id: opts.appointmentId || null,
      p_request_id: opts.requestId || null,
    });
    if (error) {
      if (isCallMessagesRpcMissing(error)) return { mode: "missing" };
      if (error.code === "23505") return { mode: "skipped", reason: "already_recorded" };
      console.warn("[call messages] record_out", error.code, error.message);
      return { mode: "error", code: error.code || null, message: error.message || "" };
    }
    const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return { mode: "recorded", id: str(row.id) || null, status: str(row.status) || null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[call messages] record_out", message);
    return { mode: "error", code: null, message };
  }
}
