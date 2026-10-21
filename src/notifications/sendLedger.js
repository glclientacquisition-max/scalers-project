// Notify send ledger. Records every SMS / WhatsApp / email that left.
// Staff and caller SMS count as tenant usage. Wallet and line-outage
// alerts stay platform-billed. Tenant SMS stops at included unless
// on-demand (same Wallet toggle as prepaid minutes). Beta never blocks.

const PLATFORM_KINDS = new Set([
  'wallet_low',
  'wallet_empty',
  'outage_speech',
  'outage_llm',
  'platform_ops_speech',
  'platform_ops_reasoning',
  'platform_ops_telephony',
  'platform_ops_package',
]);

const CALLER_KINDS = new Set([
  'caller_inbox_reply',
  'caller_appointment',
  'caller_appointment_confirmed',
  'caller_appointment_cancelled',
  'caller_appointment_rescheduled',
  'caller_hold',
  'caller_hold_updated',
  'caller_hold_ready',
  'caller_hold_cancelled',
  'caller_order',
  'caller_callback',
  'caller_note',
  'missed_textback',
]);

function billedTo(kind) {
  const k = String(kind || '');
  // platform_ops_* (ops alerts) and platform_wa_* (platform WhatsApp replies)
  // are Scalers' own cost, never tenant usage.
  return PLATFORM_KINDS.has(k) || k.startsWith('platform_') ? 'platform' : 'tenant';
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
  status,
  error,
} = {}) {
  const cls = classify(kind);
  const failed = String(status || '') === 'failed';
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
    status: failed ? 'failed' : 'sent',
    error: failed ? String(error || 'send_failed').slice(0, 300) : null,
    // A failed row must never block a later real send (instanceAlreadyDelivered
    // looks up the plain key), so it gets its own key, one per hour.
    idempotency_key:
      idempotencyKey({
        tenantId,
        callSid,
        callId,
        kind: cls.kind,
        channel: ch,
        to,
        at,
      }) + (failed ? `:failed:${(at instanceof Date ? at : new Date()).toISOString().slice(0, 13)}` : ''),
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

const INSTANCE_CHANNELS = ['sms', 'whatsapp', 'email'];
const instanceFlights = new Set();

function destKeys(to) {
  const raw = Array.isArray(to) ? to : [to];
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    const dest = normalizeDest(value);
    if (!dest || seen.has(dest)) continue;
    seen.add(dest);
    out.push(dest);
  }
  return out;
}

function instanceFlightKey(ledger, to) {
  const dests = destKeys(to);
  if (!ledger?.tenantId || !dests.length) return null;
  const call = String(ledger.callSid || ledger.callId || '').trim() || 'ops';
  return `${ledger.tenantId}:${call}:${String(ledger.kind || 'unknown')}:${dests
    .slice()
    .sort()
    .join(',')}`;
}

function claimInstanceFlight(ledger, to) {
  const key = instanceFlightKey(ledger, to);
  if (!key) return { ok: true, key: null };
  if (instanceFlights.has(key)) {
    return { ok: false, reason: 'instance_in_flight', key };
  }
  instanceFlights.add(key);
  return { ok: true, key };
}

function releaseInstanceFlight(key) {
  if (key) instanceFlights.delete(key);
}

function resetInstanceFlights() {
  instanceFlights.clear();
  unrecordedSends.clear();
}

function ledgerTableMissing(found) {
  return Boolean(found && found.reason === 'table_missing' && !found.id);
}

function durableSendClaim(recordResult) {
  if (!recordResult || recordResult.ok) return { ok: true };
  if (recordResult.reason === 'duplicate') return { ok: true };
  if (recordResult.reason === 'table_missing') {
    return { ok: false, reason: 'table_missing' };
  }
  if (recordResult.reason === 'insert_failed' || recordResult.reason === 'record_failed') {
    return { ok: false, reason: 'ledger_unrecorded' };
  }
  return { ok: true };
}

async function instanceAlreadyDelivered(ledger, to) {
  const dests = destKeys(to);
  if (!ledger?.tenantId || !dests.length) return { delivered: false };
  try {
    const db = require('../db');
    for (const dest of dests) {
      for (const channel of INSTANCE_CHANNELS) {
        const key = idempotencyKey({
          tenantId: ledger.tenantId,
          callSid: ledger.callSid,
          callId: ledger.callId,
          kind: ledger.kind,
          channel,
          to: dest,
        });
        const found = await db.findNotifySend({
          tenantId: ledger.tenantId,
          idempotencyKey: key,
        });
        if (ledgerTableMissing(found)) {
          return { delivered: false, reason: 'table_missing' };
        }
        if (found) return { delivered: true };
      }
    }
  } catch (err) {
    if (/notify_sends|does not exist|schema cache|relation/i.test(err?.message || '')) {
      return { delivered: false, reason: 'table_missing' };
    }
    console.warn('[notify-ledger] instance check skipped:', err?.message || err);
  }
  return { delivered: false };
}

/**
 * Closed-tenant guard (VOICE_CLOSED_TENANT_GUARD, default on): nothing leaves
 * for an archived, suspended or is_active=false business. Sends with no
 * tenant id still pass. A lookup error answers open (logged).
 */
async function closedTenantSendGate(ledger, to) {
  const tenantId = ledger?.tenantId;
  // No tenant id or nothing to send to: nothing to guard.
  if (!tenantId || !destKeys(to).length) return null;
  const { tenantLineForAction } = require('../sautikit/closedTenantGuard');
  const line = await tenantLineForAction(tenantId);
  if (!line.closed) return null;
  console.warn(
    `[notify] send blocked: tenant line closed (${line.reason}) tenant=${tenantId}` +
      ` kind=${ledger?.kind || 'unknown'}${ledger?.callSid ? ` call=${ledger.callSid}` : ''}`
  );
  return { ok: false, reason: 'tenant_line_closed', lineState: line.reason, key: null };
}

// A4 metering fix: a send the provider accepted but the ledger could not
// record. Its units were never claimed; this blocks a retry of the same
// message in this process so a resend can never charge (or text) twice.
const unrecordedSends = new Set();

function noteUnrecordedSend(key) {
  if (!key) return;
  unrecordedSends.add(key);
  if (unrecordedSends.size > 5000) unrecordedSends.delete(unrecordedSends.values().next().value);
}

async function beginInstanceSend(ledger, to) {
  const closed = await closedTenantSendGate(ledger, to);
  if (closed) return closed;
  const unrecordedKey = instanceFlightKey(ledger, to);
  if (unrecordedKey && unrecordedSends.has(unrecordedKey) && !ledger.force) {
    return { ok: false, reason: 'instance_already_sent', key: null };
  }
  const flight = claimInstanceFlight(ledger, to);
  if (!flight.ok) return { ok: false, reason: flight.reason, key: null };
  const prior = await instanceAlreadyDelivered(ledger, to);
  if (prior.reason === 'table_missing') {
    releaseInstanceFlight(flight.key);
    return { ok: false, reason: 'table_missing', key: null };
  }
  if (prior.delivered && !ledger.force) {
    releaseInstanceFlight(flight.key);
    return { ok: false, reason: 'instance_already_sent', key: null };
  }
  return { ok: true, reason: 'ok', key: flight.key };
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
    const claim = await db.consumeSmsUnits({
      tenantId: ledger.tenantId,
      units: smsSegments(body),
    });
    if (claim?.reason === 'rpc_missing') {
      return { allowed: false, reason: 'rpc_missing', overage: false };
    }
    return claim;
  } catch (err) {
    if (
      /consume_sms_units|does not exist|schema cache|sms_included_units|sms_used_units/i.test(
        err?.message || ''
      )
    ) {
      console.warn('[notify-ledger] consume SMS missing:', err?.message || err);
      return { allowed: false, reason: 'rpc_missing', overage: false };
    }
    console.warn('[notify-ledger] consume SMS skipped:', err?.message || err);
    return { allowed: true, reason: 'consume_skipped', overage: false };
  }
}

/**
 * Read-only SMS allowance check (no units counted). Legacy path only, used
 * BEFORE the provider call so the cap still stops a send; units are claimed
 * only after the provider accepts (sendTenantSmsLegacy).
 */
async function precheckTenantSms(ledger, body) {
  if (!ledger?.tenantId) return { allowed: true, reason: 'no_tenant', overage: false };
  if (billedTo(ledger.kind) === 'platform') {
    return { allowed: true, reason: 'platform', overage: false };
  }
  let db;
  try {
    db = require('../db');
  } catch {
    return { allowed: true, reason: 'precheck_skipped', overage: false };
  }
  if (typeof db.getTenantSmsUsage !== 'function') {
    return { allowed: true, reason: 'precheck_skipped', overage: false };
  }
  let usage = null;
  try {
    usage = await db.getTenantSmsUsage(ledger.tenantId);
  } catch (err) {
    usage = { error: err?.message || String(err) };
  }
  if (usage?.error) {
    // Same rule as consume_sms_units missing: no allowance SQL, no tenant SMS.
    if (/sms_included_units|sms_used_units|column|schema cache/i.test(usage.error)) {
      return { allowed: false, reason: 'rpc_missing', overage: false };
    }
    console.warn('[notify-ledger] SMS precheck skipped:', usage.error);
    return { allowed: true, reason: 'precheck_skipped', overage: false };
  }
  if (!usage) return { allowed: true, reason: 'precheck_skipped', overage: false };
  return smsAllowanceDecision({
    enforcement: usage.enforcement,
    included: usage.smsIncluded,
    used: usage.smsUsed,
    units: smsSegments(body),
    onDemand: usage.onDemand,
  });
}

/**
 * Legacy tenant SMS (reserve_notify_send not applied): claim units only after
 * the provider accepts, and only once the ledger row exists.
 *   1. read-only allowance precheck (cap still stops the send)
 *   2. provider call; a throw or no result claims nothing
 *   3. notify_sends row (one retry)
 *   4. consume_sms_units, only now. If the row never lands, the units are
 *      never claimed (that is the compensation) and the key is blocked here
 *      so a retry cannot text or charge twice.
 * Returns { sent, result?, reason?, overage, accepted? }.
 */
async function sendTenantSmsLegacy({ ledger, body, send, flightKey } = {}) {
  const pre = await precheckTenantSms(ledger, body);
  if (!pre.allowed) return { sent: false, reason: pre.reason || 'sms_allowance_exhausted', overage: false };
  if (ledger && typeof ledger === 'object') ledger.overage = Boolean(pre.overage);
  const result = await send();
  if (!result) return { sent: false, reason: 'sms_unavailable', overage: false };
  let recorded = await recordDispatchResult(ledger, result, body);
  let claim = durableSendClaim(recorded);
  if (!claim.ok && claim.reason !== 'table_missing') {
    recorded = await recordDispatchResult(ledger, result, body);
    claim = durableSendClaim(recorded);
  }
  if (!claim.ok) {
    noteUnrecordedSend(flightKey || instanceFlightKey(ledger, result.to));
    console.warn(
      `[notify-ledger] SMS accepted but ledger row not written (${claim.reason}); units not claimed, resend blocked` +
        (ledger?.callSid ? ` call=${ledger.callSid}` : '')
    );
    return { sent: false, accepted: true, reason: claim.reason, result, overage: false };
  }
  // A duplicate key means a concurrent send already wrote and claimed it.
  if (ledger?.tenantId && recorded?.reason !== 'duplicate') {
    const units = await claimTenantSms(ledger, body);
    if (units?.reason === 'rpc_missing') {
      console.warn('[notify-ledger] SMS sent and recorded; consume_sms_units missing (counter not advanced)');
    }
  }
  return { sent: true, result, overage: Boolean(pre.overage) };
}

/**
 * Persist one accepted send. Never throws. Missing table is not sent.
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

/** Persist one failed send (status failed, error text). Never throws. */
async function recordFailedSend(entry = {}) {
  return recordNotifySend({ ...entry, status: 'failed', error: entry.error });
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

// ---------------------------------------------------------------------------
// Reserve -> send -> settle (docs/supabase/notify_send_reserve_settle.sql).
// One notify_sends row per stable key. SMS units are counted at reserve and
// released when the send fails, so the counter can never run ahead of the
// ledger. Billing reads notify_sends (status sent), not sms_used_units.
// While the RPC is not applied (rpc_missing) callers keep the legacy path.
// ---------------------------------------------------------------------------

function minuteBucket(at) {
  const when = at instanceof Date ? at : new Date();
  return when.toISOString().slice(0, 16);
}

function hourBucket(at) {
  const when = at instanceof Date ? at : new Date();
  return when.toISOString().slice(0, 13);
}

/**
 * Who a staff alert is for: recipient id, else phone, else email.
 * By person, not by channel, so an SMS -> WhatsApp -> email fallback stays
 * ONE row and can never count twice.
 */
function personTag({ recipientId, to, email } = {}) {
  const id = String(recipientId || '').trim();
  if (id) return `id_${normalizeDest(id)}`;
  const phone = normalizeDest(to);
  if (phone) return phone;
  const mail = normalizeDest(email);
  return mail ? `email_${mail}` : 'none';
}

/**
 * Stable per-person key for staff / ops alerts.
 *   staff alert: call:<tenant>:<CallSid>:<kind>:<person>
 *   Desk ping:   ping:<tenant>:<call>:<person>:<pingId|minute>
 *   ops alert:   <keyBase>:<person> (keyBase from the caller, per incident)
 *   no call:     ops:<tenant>:<kind>:<person>:<hour>
 */
function personKey(ledger = {}, dest = {}) {
  const who = personTag({ recipientId: ledger.recipientId, ...dest });
  const tenant = String(ledger.tenantId || 'platform');
  const k = String(ledger.kind || 'unknown');
  const base = String(ledger.keyBase || '').trim();
  if (base) return `${base}:${who}`;
  const sid = String(ledger.callSid || '').trim();
  const rowId = String(ledger.callId || '').trim();
  if (ledger.force || ledger.pingId) {
    const ping = String(ledger.pingId || '').trim() || minuteBucket(ledger.at);
    return `ping:${tenant}:${rowId || sid || 'none'}:${who}:${ping}`;
  }
  if (sid) return `call:${tenant}:${sid}:${k}:${who}`;
  if (rowId) return `row:${tenant}:${rowId}:${k}:${who}`;
  return `ops:${tenant}:${k}:${who}:${hourBucket(ledger.at)}`;
}

/**
 * Stable key for a caller send (one text per call per kind):
 *   call:<tenant>:<CallSid>:<kind>   (Voice caller SMS, text-back)
 *   row:<tenant>:<callId>:<kind>
 */
function callerKey(ledger = {}, kind, to) {
  const tenant = String(ledger.tenantId || 'none');
  const k = String(kind || ledger.kind || 'unknown');
  const sid = String(ledger.callSid || '').trim();
  if (sid) return `call:${tenant}:${sid}:${k}`;
  const rowId = String(ledger.callId || '').trim();
  if (rowId) return `row:${tenant}:${rowId}:${k}`;
  return `ops:${tenant}:${k}:${normalizeDest(to) || 'none'}:${hourBucket(ledger.at)}`;
}

function providerMessageId(result) {
  const r = result && typeof result === 'object' ? result : {};
  const inner = r.result && typeof r.result === 'object' ? r.result : {};
  return (
    r.messageId || r.wamid || r.message_id || r.id ||
    inner.messageId || inner.wamid || inner.message_id || inner.id || null
  );
}

/**
 * Reserve one send. Returns:
 *   { mode: 'reserved', id, allowed, replayed, reason, overage }
 *   { mode: 'legacy' }   RPC not applied yet: use claimTenantSms + recordNotifySend
 *   { mode: 'skip', allowed: true }   nothing to record (no tenant, not platform)
 * Fail-closed for tenant SMS when the RPC errors (falls to WhatsApp/email);
 * WhatsApp/email and platform sends still go out unrecorded and are logged.
 */
async function reserveSend({ ledger, key, kind, channel, to, body, strict } = {}) {
  const cls = classify(kind || ledger?.kind);
  const tenantId = ledger?.tenantId || null;
  if (!tenantId && cls.billed_to !== 'platform') {
    return { mode: 'skip', allowed: true, reason: 'no_tenant' };
  }
  let db;
  try {
    db = require('../db');
  } catch {
    return { mode: 'legacy' };
  }
  if (typeof db.reserveNotifySend !== 'function') return { mode: 'legacy' };
  let res;
  try {
    res = await db.reserveNotifySend({
      tenantId,
      idempotencyKey: key,
      kind: cls.kind,
      channel,
      recipient: String(to || '').trim() || null,
      body: String(body || '').slice(0, 2000),
      units: unitsForChannel(channel, body),
      callId: ledger?.callId || null,
      callSid: ledger?.callSid || null,
      audience: tenantId ? cls.audience : 'platform',
      billedTo: cls.billed_to,
      strict: Boolean(strict),
    });
  } catch (err) {
    res = { ok: false, reason: 'rpc_failed', error: err?.message || String(err) };
  }
  if (!res?.ok && res?.reason === 'rpc_missing') return { mode: 'legacy' };
  if (!res?.ok) {
    console.warn(`[notify-ledger] reserve failed key=${key} (${res?.reason || 'rpc_failed'})`);
    if (channel === 'sms' && cls.billed_to === 'tenant') {
      return { mode: 'blocked', allowed: false, reason: 'ledger_unavailable' };
    }
    return { mode: 'skip', allowed: true, reason: 'ledger_unavailable' };
  }
  if (!res.replayed && channel === 'sms' && cls.billed_to === 'tenant' && tenantId) {
    // 80% / 100% package SMS ops notice (src/billing/smsUsageAlerts.js).
    // Fire-and-forget: never delays or fails the send. Refused reserves check too.
    noteSmsUsage(db, tenantId);
  }
  return {
    mode: 'reserved',
    id: res.id,
    allowed: res.allowed,
    replayed: res.replayed,
    reason: res.reason,
    overage: Boolean(res.overage),
  };
}

function noteSmsUsage(db, tenantId) {
  if (typeof db?.checkSmsUsageAlertsForTenant !== 'function') return;
  try {
    void Promise.resolve(db.checkSmsUsageAlertsForTenant(tenantId)).catch((err) => {
      console.warn('[notify-ledger] sms usage alert failed:', err?.message || err);
    });
  } catch (err) {
    console.warn('[notify-ledger] sms usage alert failed:', err?.message || err);
  }
}

/** Settle a reservation. Never throws. No-op unless mode is 'reserved'. */
async function settleSend(reservation, { ok, result, error } = {}) {
  if (reservation?.mode !== 'reserved' || !reservation.id) return { ok: true, skipped: true };
  try {
    const db = require('../db');
    const args = {
      id: reservation.id,
      status: ok ? 'sent' : 'failed',
      providerMessageId: ok ? providerMessageId(result) : null,
      failureReason: ok ? null : String(error?.message || error || 'send_failed'),
    };
    let settled = await db.settleNotifySend(args).catch((err) => ({ ok: false, reason: err?.message || 'settle_failed' }));
    // A4: one retry. A lost settle leaves the row pending, which blocks a
    // resend (in_flight) until the stale sweep releases it: never a double
    // charge, but a sent SMS would end up unbilled, so try once more.
    if (!settled?.ok) settled = await db.settleNotifySend(args).catch((err) => ({ ok: false, reason: err?.message || 'settle_failed' }));
    if (!settled?.ok) {
      // The stale sweep releases a pending row after 15 min.
      console.warn(`[notify-ledger] settle failed id=${reservation.id} (${settled?.reason})`);
    }
    return settled;
  } catch (err) {
    console.warn('[notify-ledger] settle failed:', err?.message || err);
    return { ok: false, reason: 'settle_failed' };
  }
}

function replayReason(reservation) {
  return reservation?.reason === 'already_sent' ? 'instance_already_sent' : 'instance_in_flight';
}

/**
 * Reserve -> send -> settle for one channel. `send` returns the provider result
 * or throws. Returns { sent: true, result } | { sent: false, reason } and
 * { legacy: true } when the RPC is not applied yet (caller keeps its old path).
 */
async function sendReserved(opts, send) {
  const reservation = await reserveSend(opts);
  if (reservation.mode === 'legacy') return { legacy: true };
  if (reservation.mode === 'reserved' && reservation.replayed) {
    return { sent: false, reason: replayReason(reservation), reservation };
  }
  if (!reservation.allowed) {
    return {
      sent: false,
      reason: reservation.reason || 'sms_allowance_exhausted',
      reservation,
    };
  }
  let result;
  try {
    result = await send();
  } catch (err) {
    await settleSend(reservation, { ok: false, error: err });
    throw err;
  }
  await settleSend(reservation, { ok: true, result });
  return { sent: true, result, reservation, overage: Boolean(reservation.overage) };
}

module.exports = {
  PLATFORM_KINDS,
  CALLER_KINDS,
  audience,
  billedTo,
  buildLedgerRow,
  classify,
  beginInstanceSend,
  callerKey,
  claimInstanceFlight,
  claimTenantSms,
  precheckTenantSms,
  sendTenantSmsLegacy,
  noteUnrecordedSend,
  durableSendClaim,
  instanceFlightKey,
  idempotencyKey,
  personKey,
  personTag,
  providerMessageId,
  reserveSend,
  sendReserved,
  settleSend,
  releaseInstanceFlight,
  resetInstanceFlights,
  recordDispatchResult,
  recordFailedSend,
  recordNotifySend,
  allowanceDecision,
  smsAllowanceDecision,
  smsSegments,
  unitsForChannel,
};
