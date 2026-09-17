/**
 * Desk mirror of src/notifications/sendLedger.js for caller SMS rows.
 * Staff sends are recorded by the voice engine.
 */

export type CallerLedgerKind =
  | "caller_appointment_confirmed"
  | "caller_appointment_cancelled"
  | "caller_appointment_rescheduled"
  | "caller_hold_updated"
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
    idempotency_key: deskCallerIdempotencyKey(opts),
  };
}
