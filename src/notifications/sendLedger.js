// Notify send ledger. Records every SMS / WhatsApp / email that left.
// Staff and caller SMS count as tenant usage. Wallet and line-outage
// alerts stay platform-billed. Tenant SMS stops at included unless
// on-demand (same Wallet toggle as prepaid minutes). Beta never blocks.

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

function idempotencyKey({ tenantId, callSid, callId, kind, channel, to, at } = {}) {
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
  overage,
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
    overage: Boolean(overage),
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
 * Package bucket math. Included first. Stop at cap unless overage is allowed
 * and on-demand is on. Beta never blocks. Seats pass overageAllowed=false.
 */
function allowanceDecision({
  enforcement,
  included,
  used,
  units,
  onDemand,
  overageAllowed = true,
  exhaustedReason = 'allowance_exhausted',
} = {}) {
  const need = Math.max(1, Number(units) || 1);
  const have = Math.max(0, Number(used) || 0);
  if (included == null || included === '') {
    return { allowed: true, reason: 'unlimited', overage: false, remaining: null };
  }
  const cap = Number(included);
  if (String(enforcement || 'off').toLowerCase() === 'off') {
    return { allowed: true, reason: 'beta', overage: false, remaining: cap - (have + need) };
  }
  if (!Number.isFinite(cap)) {
    return { allowed: true, reason: 'unlimited', overage: false, remaining: null };
  }
  if (have + need <= cap) {
    return {
      allowed: true,
      reason: 'included',
      overage: false,
      remaining: cap - (have + need),
    };
  }
  if (overageAllowed && onDemand) {
    return {
      allowed: true,
      reason: 'on_demand',
      overage: true,
      remaining: cap - (have + need),
    };
  }
  return {
    allowed: false,
    reason: exhaustedReason,
    overage: false,
    remaining: cap - have,
  };
}

function smsAllowanceDecision(opts = {}) {
  return allowanceDecision({
    ...opts,
    overageAllowed: true,
    exhaustedReason: 'sms_allowance_exhausted',
  });
}

async function claimTenantSms(ledger, body) {
  if (!ledger?.tenantId) return { allowed: true, reason: 'no_tenant', overage: false };
  if (billedTo(ledger.kind) === 'platform') {
    return { allowed: true, reason: 'platform', overage: false };
  }
  try {
    const db = require('../db');
    return await db.consumeSmsUnits({
      tenantId: ledger.tenantId,
      units: smsSegments(body),
    });
  } catch (err) {
    console.warn('[notify-ledger] consume SMS skipped:', err?.message || err);
    return { allowed: true, reason: 'consume_skipped', overage: false };
  }
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
    overage: Boolean(ledger.overage),
  });
}

module.exports = {
  PLATFORM_KINDS,
  CALLER_KINDS,
  audience,
  billedTo,
  buildLedgerRow,
  classify,
  claimTenantSms,
  idempotencyKey,
  recordDispatchResult,
  recordNotifySend,
  allowanceDecision,
  smsAllowanceDecision,
  smsSegments,
  unitsForChannel,
};
