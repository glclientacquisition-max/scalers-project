/**
 * Desk mirror of src/notifications/sendLedger.js for caller SMS rows.
 * Staff sends are recorded by the voice engine.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendDeskCallerSms } from "@/lib/callerSms";

export type CallerLedgerKind =
  | "caller_appointment_confirmed"
  | "caller_appointment_cancelled"
  | "caller_appointment_rescheduled"
  | "caller_hold_updated"
  | "caller_hold_ready"
  | "caller_hold_cancelled"
  | "caller_note"
  | "caller_callback"
  | "caller_inbox_reply";

function normalizeDest(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\d@._a-z-]/g, "");
}

export function smsSegments(body: string): number {
  const text = String(body || "");
  if (!text) return 0;
  const ucs2 = /[^\x00-\x7F]/.test(text);
  const single = ucs2 ? 70 : 160;
  const concat = ucs2 ? 67 : 153;
  if (text.length <= single) return 1;
  return Math.ceil(text.length / concat);
}

export function deskCallerIdempotencyKey(opts: {
  tenantId: string;
  callId?: string | null;
  kind: string;
  to: string;
}): string {
  const dest = normalizeDest(opts.to) || "none";
  const tenant = String(opts.tenantId || "none");
  const rowId = String(opts.callId || "").trim();
  if (rowId) return `row:${tenant}:${rowId}:${opts.kind}:sms:${dest}`;
  const hour = new Date().toISOString().slice(0, 13);
  return `ops:${tenant}:${opts.kind}:sms:${dest}:${hour}`;
}

export function deskCallerLedgerRow(opts: {
  tenantId: string;
  callId?: string | null;
  kind: CallerLedgerKind | string;
  to: string;
  body: string;
  overage?: boolean;
}): {
  tenant_id: string;
  call_id: string | null;
  kind: string;
  channel: "sms";
  recipient: string;
  audience: "caller";
  billed_to: "tenant";
  units: number;
  body: string;
  overage: boolean;
  idempotency_key: string;
} {
  return {
    tenant_id: opts.tenantId,
    call_id: opts.callId || null,
    kind: opts.kind,
    channel: "sms",
    recipient: String(opts.to || "").trim(),
    audience: "caller",
    billed_to: "tenant",
    units: smsSegments(opts.body),
    body: String(opts.body || "").slice(0, 2000),
    overage: Boolean(opts.overage),
    idempotency_key: deskCallerIdempotencyKey(opts),
  };
}

export async function claimDeskSms(
  client: SupabaseClient,
  tenantId: string,
  body: string
): Promise<{ allowed: boolean; reason: string; overage: boolean }> {
  if (!tenantId) return { allowed: true, reason: "no_tenant", overage: false };
  const need = Math.max(1, smsSegments(body) || 1);
  const { data, error } = await client.rpc("consume_sms_units", {
    p_tenant_id: tenantId,
    p_units: need,
  });
  if (error) {
    if (
      /consume_sms_units|does not exist|schema cache|sms_included_units|sms_used_units/i.test(
        error.message || ""
      )
    ) {
      console.warn("[sms allowance] consume_sms_units missing");
      return { allowed: false, reason: "rpc_missing", overage: false };
    }
    console.warn("[sms allowance]", error.message);
    return { allowed: true, reason: "rpc_failed", overage: false };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed?: boolean; reason?: string; overage?: boolean }
    | null;
  if (!row) return { allowed: true, reason: "empty", overage: false };
  return {
    allowed: row.allowed !== false,
    reason: row.reason || "ok",
    overage: Boolean(row.overage),
  };
}

async function deskLedgerLookup(
  client: SupabaseClient,
  opts: {
    tenantId: string;
    callId?: string | null;
    kind: string;
    to: string;
    key?: string;
  }
): Promise<"sent" | "absent" | "table_missing"> {
  if (!opts.tenantId || !opts.to) return "absent";
  const { data, error } = await client
    .from("notify_sends")
    .select("id")
    .eq("tenant_id", opts.tenantId)
    .eq("idempotency_key", opts.key || deskCallerIdempotencyKey(opts))
    .maybeSingle();
  if (error) {
    if (
      /notify_sends|does not exist|schema cache|relation/i.test(error.message || "")
    ) {
      return "table_missing";
    }
    console.warn("[notify ledger] instance check", error.message);
    return "absent";
  }
  return data ? "sent" : "absent";
}

export type NotifyReservation =
  | { mode: "legacy" }
  | { mode: "blocked"; reason: string }
  | {
      mode: "reserved";
      id: string | null;
      allowed: boolean;
      replayed: boolean;
      reason: string;
      overage: boolean;
    };

function notifyRpcMissing(message: string): boolean {
  return /reserve_notify_send|settle_notify_send|does not exist|schema cache|could not find the function/i.test(
    message || ""
  );
}

/**
 * Reserve one send (docs/supabase/notify_send_reserve_settle.sql): a pending
 * notify_sends row and the SMS units, in one RPC. Idempotent by key.
 * mode "legacy" = RPC not applied yet (keep the old consume + insert path).
 */
export async function reserveNotifySend(
  client: SupabaseClient,
  opts: {
    tenantId: string | null;
    key: string;
    kind: string;
    channel: "sms" | "whatsapp" | "email";
    to: string;
    body: string;
    callId?: string | null;
    audience?: "staff" | "caller" | "platform";
    billedTo?: "tenant" | "platform";
  }
): Promise<NotifyReservation> {
  const { data, error } = await client.rpc("reserve_notify_send", {
    p_tenant_id: opts.tenantId,
    p_idempotency_key: opts.key,
    p_kind: opts.kind,
    p_channel: opts.channel,
    p_recipient: String(opts.to || "").trim() || null,
    p_body: String(opts.body || "").slice(0, 2000),
    p_units: opts.channel === "sms" ? Math.max(1, smsSegments(opts.body) || 1) : 1,
    p_call_id: opts.callId || null,
    p_call_sid: null,
    p_audience: opts.audience || null,
    p_billed_to: opts.billedTo || null,
    p_strict: false,
  });
  if (error) {
    if (notifyRpcMissing(error.message || "")) return { mode: "legacy" };
    console.warn("[notify ledger] reserve", error.message);
    return { mode: "blocked", reason: "ledger_unavailable" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        send_id?: string | null;
        allowed?: boolean;
        replayed?: boolean;
        reason?: string;
        overage?: boolean;
      }
    | null;
  if (!row) return { mode: "blocked", reason: "ledger_unavailable" };
  return {
    mode: "reserved",
    id: row.send_id || null,
    allowed: row.allowed === true,
    replayed: row.replayed === true,
    reason: row.reason || "",
    overage: Boolean(row.overage),
  };
}

/** Settle: sent, or failed (releases held SMS units). Never throws. */
export async function settleNotifySend(
  client: SupabaseClient,
  reservation: NotifyReservation,
  outcome: { ok: boolean; providerMessageId?: string | null; error?: string | null }
): Promise<void> {
  if (reservation.mode !== "reserved" || !reservation.id) return;
  const { error } = await client.rpc("settle_notify_send", {
    p_send_id: reservation.id,
    p_status: outcome.ok ? "sent" : "failed",
    p_provider_message_id: outcome.ok ? outcome.providerMessageId || null : null,
    p_failure_reason: outcome.ok ? null : String(outcome.error || "send_failed").slice(0, 200),
  });
  // A pending row left behind is released by release_stale_notify_sends.
  if (error) console.warn("[notify ledger] settle", error.message);
}

/**
 * Stable Desk keys (never clock-based):
 *   inbox reply:   reply:<tenant>:<replyId>
 *   callback/note: row:<tenant>:<callId>:<kind>:<noteKey>
 *   status SMS:    row:<tenant>:<rowId>:<kind>:<statusVersion>
 */
export function deskSendKey(opts: {
  tenantId: string;
  callId?: string | null;
  kind: string;
  to: string;
  replyId?: string | null;
  version?: string | null;
}): string {
  const tenant = String(opts.tenantId || "none");
  const replyId = String(opts.replyId || "").trim();
  if (replyId) return `reply:${tenant}:${replyId}`;
  const version = String(opts.version || "").trim();
  const rowId = String(opts.callId || "").trim();
  if (rowId && version) return `row:${tenant}:${rowId}:${opts.kind}:${version}`;
  return deskCallerIdempotencyKey(opts);
}

export async function sendRecordedDeskCallerSms(opts: {
  client: SupabaseClient;
  tenantId: string;
  callId?: string | null;
  kind: CallerLedgerKind | string;
  to: string;
  body: string;
  /** Inbox reply id: key becomes reply:<tenant>:<replyId>. */
  replyId?: string | null;
  /** Status version / note id: key becomes row:<tenant>:<id>:<kind>:<version>. */
  version?: string | null;
}): Promise<{ ok: boolean; reason?: string; overage?: boolean }> {
  // Reserve -> send -> settle. A TextSMS failure releases the units and leaves
  // a `failed` row (was: units consumed, no row, no refund).
  const key = deskSendKey(opts);
  const reservation = await reserveNotifySend(opts.client, {
    tenantId: opts.tenantId,
    key,
    kind: opts.kind,
    channel: "sms",
    to: opts.to,
    body: opts.body,
    callId: opts.callId || null,
    audience: "caller",
    billedTo: "tenant",
  });
  if (reservation.mode === "blocked") return { ok: false, reason: reservation.reason };
  if (reservation.mode === "reserved") {
    if (reservation.replayed) {
      return {
        ok: false,
        reason: reservation.reason === "already_sent" ? "instance_already_sent" : "instance_in_flight",
      };
    }
    if (!reservation.allowed) {
      return { ok: false, reason: reservation.reason || "sms_allowance_exhausted" };
    }
    let sent: { ok: boolean; reason?: string };
    try {
      sent = await sendDeskCallerSms({ to: opts.to, body: opts.body });
    } catch (err) {
      sent = { ok: false, reason: err instanceof Error ? err.message : "send_failed" };
    }
    await settleNotifySend(opts.client, reservation, {
      ok: sent.ok,
      error: sent.ok ? null : sent.reason || "send_failed",
    });
    if (!sent.ok) return sent;
    return { ok: true, overage: reservation.overage };
  }
  return sendLegacyDeskCallerSms({ ...opts, key });
}

/** Legacy path until reserve_notify_send is applied. Remove after rollout. */
async function sendLegacyDeskCallerSms(opts: {
  client: SupabaseClient;
  tenantId: string;
  callId?: string | null;
  kind: CallerLedgerKind | string;
  to: string;
  body: string;
  key: string;
}): Promise<{ ok: boolean; reason?: string; overage?: boolean }> {
  const prior = await deskLedgerLookup(opts.client, opts);
  if (prior === "sent") {
    return { ok: false, reason: "instance_already_sent" };
  }
  if (prior === "table_missing") {
    return { ok: false, reason: "table_missing" };
  }
  const claim = await claimDeskSms(opts.client, opts.tenantId, opts.body);
  if (!claim.allowed) {
    return { ok: false, reason: claim.reason || "sms_allowance_exhausted" };
  }
  const sent = await sendDeskCallerSms({ to: opts.to, body: opts.body });
  if (!sent.ok) return sent;
  const row = {
    ...deskCallerLedgerRow({
      tenantId: opts.tenantId,
      callId: opts.callId,
      kind: opts.kind,
      to: opts.to,
      body: opts.body,
      overage: claim.overage,
    }),
    idempotency_key: opts.key,
  };
  let { error } = await opts.client.from("notify_sends").insert(row);
  if (error && /overage/i.test(error.message || "")) {
    const rest = { ...row };
    delete (rest as { overage?: boolean }).overage;
    ({ error } = await opts.client.from("notify_sends").insert(rest));
  }
  if (error) {
    console.warn("[notify ledger]", error.message);
    if (
      /notify_sends|does not exist|schema cache|relation/i.test(error.message || "")
    ) {
      return { ok: false, reason: "table_missing" };
    }
    return { ok: false, reason: "ledger_unrecorded" };
  }
  return { ok: true, overage: claim.overage };
}
