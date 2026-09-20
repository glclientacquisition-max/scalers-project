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
  | "caller_note";

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
  }
): Promise<"sent" | "absent" | "table_missing"> {
  if (!opts.tenantId || !opts.to) return "absent";
  const { data, error } = await client
    .from("notify_sends")
    .select("id")
    .eq("tenant_id", opts.tenantId)
    .eq("idempotency_key", deskCallerIdempotencyKey(opts))
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

export async function sendRecordedDeskCallerSms(opts: {
  client: SupabaseClient;
  tenantId: string;
  callId?: string | null;
  kind: CallerLedgerKind | string;
  to: string;
  body: string;
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
  const row = deskCallerLedgerRow({
    tenantId: opts.tenantId,
    callId: opts.callId,
    kind: opts.kind,
    to: opts.to,
    body: opts.body,
    overage: claim.overage,
  });
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
