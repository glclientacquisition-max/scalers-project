// Notify send ledger. Records every SMS / WhatsApp / email that left.
// Staff and caller SMS count as tenant usage. Wallet and line-outage
// alerts stay platform-billed. No quota enforcement in this slice.

const PLATFORM_KINDS = new Set([
  'wallet_low',
  'wallet_empty',
  'outage_speech',
  'outage_llm',
]);

const CALLER_KINDS = new Set([
  'caller_appointment',
  'caller_appointment_confirmed',
  'caller_appointment_cancelled',
  'caller_appointment_rescheduled',
  'caller_hold',
  'caller_hold_updated',
  'caller_order',
  'caller_callback',
  'caller_note',
  'missed_textback',
]);

function billedTo(kind) {
  return PLATFORM_KINDS.has(String(kind || '')) ? 'platform' : 'tenant';
}

function audience(kind) {
  return CALLER_KINDS.has(String(kind || '')) ? 'caller' : 'staff';
}

/**
 * SMS segments. GSM-7 160 / 153. Anything outside ASCII uses UCS-2 70 / 67.
 */
function smsSegments(body) {
  const text = String(body || '');
  if (!text) return 0;
  const ucs2 = /[^\x00-\x7F]/.test(text);
  const single = ucs2 ? 70 : 160;
  const concat = ucs2 ? 67 : 153;
  if (text.length <= single) return 1;
  return Math.ceil(text.length / concat);
}

function unitsForChannel(channel, body) {
  return String(channel || '') === 'sms' ? smsSegments(body) : 1;
}

function normalizeDest(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\d@._a-z-]/g, '');
}

function idempotencyKey({ tenantId, callSid, kind, channel, to, at } = {}) {
  const dest = normalizeDest(to) || 'none';
  const ch = String(channel || 'sms');
  const k = String(kind || 'unknown');
  const tenant = String(tenantId || 'none');
  const sid = String(callSid || '').trim();
  if (sid) return `call:${tenant}:${sid}:${k}:${ch}:${dest}`;
  const rowId = String(callId || '').trim();
  if (rowId) return `row:${tenant}:${rowId}:${k}:${ch}:${dest}`;
  const when = at instanceof Date ? at : new Date();
  const hour = when.toISOString().slice(0, 13);
  return `ops:${tenant}:${k}:${ch}:${dest}:${hour}`;
}

function classify(kind) {
  const k = String(kind || '').trim() || 'unknown';
  return {
    kind: k,
    billed_to: billedTo(k),
    audience: audience(k),
  };
}

function buildLedgerRow({
  tenantId,
  callId,
  callSid,
  kind,
  channel,
  to,
  body,
  providerMessageId,
  at,
} = {}) {
  const cls = classify(kind);
  const ch = String(channel || '').trim();
  return {
    tenant_id: tenantId || null,
    call_id: callId || null,
    call_sid: callSid || null,
    kind: cls.kind,
    channel: ch,
    recipient: String(to || '').trim() || null,
    audience: cls.audience,
    billed_to: cls.billed_to,
    units: unitsForChannel(ch, body),
    body: String(body || '').slice(0, 2000),
    provider_message_id: providerMessageId || null,
    idempotency_key: idempotencyKey({
      tenantId,
      callSid,
      callId,
      kind: cls.kind,
      channel: ch,
      to,
      at,
    }),
  };
}

/**
 * Persist one accepted send. Never throws. Missing table is a no-op.
 */
async function recordNotifySend(entry = {}) {
  const row = buildLedgerRow(entry);
  if (!row.tenant_id || !row.kind || !row.channel) {
    return { ok: false, reason: 'invalid' };
  }
  try {
    const db = require('../db');
    return await db.insertNotifySend(row);
  } catch (err) {
    console.warn('[notify-ledger] record failed:', err?.message || err);
    return { ok: false, reason: 'record_failed' };
  }
}

async function recordDispatchResult(ledger, result, body) {
  if (!ledger?.tenantId || !result?.channel) return { ok: false, reason: 'skipped' };
  return recordNotifySend({
    ...ledger,
    kind: ledger.kind,
    channel: result.channel,
    to: result.to,
    body,
    providerMessageId: result.result?.messageId || null,
  });
}

module.exports = {
  PLATFORM_KINDS,
  CALLER_KINDS,
  audience,
  billedTo,
  buildLedgerRow,
  classify,
  idempotencyKey,
  recordDispatchResult,
  recordNotifySend,
  smsSegments,
  unitsForChannel,
};
