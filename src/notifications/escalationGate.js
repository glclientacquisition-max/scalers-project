'use strict';

const SUPABASE_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Billing escalation gate for voicemails and call updates (#775).
//
// Before any SMS / WhatsApp / email for a voicemail or call update (owner
// lead alert, escalation, service request, appointment; the #647 reserve ->
// send -> settle path in dispatch.js), ask tenant_escalation_allowed(tenant).
// allowed = false (trial_ended, minutes_cap, voicemail, line_not_available,
// suspended, ...) means the item stays in the owner Inbox only: the call row
// already exists, and the hold reason is noted on its summary meta.
//
// Fail safe. If the RPC is missing (#775 not applied yet), errors, or answers
// something unexpected, today's behaviour stands (send) and it is logged.
// Billing notices (platform_billing_*), wallet / ops alerts and caller texts
// are never gated. Kill switch: ESCALATION_GATE=off.

const { audience, billedTo } = require('./sendLedger');

const RPC = 'tenant_escalation_allowed';
const TAG = '[escalation-gate]';
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MISSING_BACKOFF_MS = 10 * 60_000;
const ERROR_LOG_EVERY_MS = 60_000;

// Owner-facing call alerts. Any other tenant staff send tied to a call
// (callSid / callId) counts too, so new owner-message kinds are covered.
const CALL_UPDATE_KINDS = new Set([
  'lead',
  'escalation',
  'service_request',
  'appointment',
  'voicemail',
  'callback',
]);

function escalationGateEnabled(env = process.env) {
  const v = String(env.ESCALATION_GATE || '').trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(v);
}

function isCallUpdate(ledger) {
  if (!ledger || typeof ledger !== 'object' || !ledger.tenantId) return false;
  const kind = String(ledger.kind || '').trim();
  if (billedTo(kind) === 'platform' || audience(kind) === 'caller') return false;
  if (CALL_UPDATE_KINDS.has(kind)) return true;
  return Boolean(String(ledger.callSid || '').trim() || String(ledger.callId || '').trim());
}

function isMissingRpc(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(String(error.message || ''));
}

function parseAnswer(data) {
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || typeof r !== 'object' || typeof r.allowed !== 'boolean') return null;
  return { allowed: r.allowed, reason: String(r.reason || (r.allowed ? 'ok' : 'unknown')) };
}

function createEscalationGate({
  rpc,
  log = (m) => console.warn(m),
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  missingBackoffMs = DEFAULT_MISSING_BACKOFF_MS,
  env = process.env,
} = {}) {
  const cache = new Map(); // tenantId -> { at, answer }
  const flights = new Map(); // tenantId -> Promise
  let missingUntil = 0;
  let lastErrorLog = -Infinity;

  async function ask(id) {
    let res;
    try {
      res = await rpc(RPC, { p_tenant_id: id });
    } catch (err) {
      res = { data: null, error: { message: err?.message || String(err) } };
    }
    const error = res?.error || null;
    if (error && isMissingRpc(error)) {
      missingUntil = now() + missingBackoffMs;
      log(`${TAG} ${RPC} missing (#775 not applied); sending as today`);
      return { allowed: true, reason: 'rpc_missing', source: 'missing' };
    }
    const answer = error ? null : parseAnswer(res?.data);
    if (!answer) {
      if (now() - lastErrorLog >= ERROR_LOG_EVERY_MS) {
        lastErrorLog = now();
        const why = error ? `${error.code || 'error'}: ${String(error.message || '').slice(0, 120)}` : 'unexpected answer';
        log(`${TAG} check failed (${why}); sending as today`);
      }
      return { allowed: true, reason: 'check_failed', source: 'error' };
    }
    const out = { ...answer, source: 'rpc' };
    cache.set(id, { at: now(), answer: out });
    return out;
  }

  async function check(tenantId) {
    const id = String(tenantId || '').trim();
    if (!id || !escalationGateEnabled(env) || typeof rpc !== 'function') {
      return { allowed: true, reason: 'not_checked', source: 'off' };
    }
    if (missingUntil && now() < missingUntil) {
      return { allowed: true, reason: 'rpc_missing', source: 'missing' };
    }
    const hit = cache.get(id);
    if (hit && now() - hit.at <= ttlMs) return hit.answer;
    if (flights.has(id)) return flights.get(id);
    const p = ask(id).finally(() => flights.delete(id));
    flights.set(id, p);
    return p;
  }

  return { check, clear: () => cache.clear() };
}

// Default gate: service-role Supabase RPC, only when the voice env has it
// (tests and tools without Supabase never touch the network).
let defaultGate = null;
let injectedGate = null;

function supabaseRpc() {
  // Same vars src/lib/supabaseClient.js needs (it exits without them).
  if (!SUPABASE_VARS.every((k) => process.env[k])) return null;
  const { supabase } = require('../lib/supabaseClient');
  return (name, args) => supabase.rpc(name, args);
}

function getDefaultEscalationGate() {
  if (injectedGate) return injectedGate;
  if (!defaultGate) defaultGate = createEscalationGate({ rpc: supabaseRpc() });
  return defaultGate;
}

/** Tests only: swap the gate used by dispatch (null restores the default). */
function setDefaultEscalationGate(gate) {
  injectedGate = gate || null;
}

/**
 * Null when the send may go ahead; { reason } when it must stay in the Inbox.
 * Never throws.
 */
async function escalationHold(ledger, { gate = null } = {}) {
  if (!isCallUpdate(ledger)) return null;
  try {
    const g = gate || getDefaultEscalationGate();
    const answer = await g.check(ledger.tenantId);
    if (answer && answer.allowed === false) return { reason: answer.reason || 'unknown' };
    return null;
  } catch (err) {
    console.warn(`${TAG} check threw (${err?.message || err}); sending as today`);
    return null;
  }
}

/** Note the hold on the call so the Inbox can say why nothing was texted. */
async function noteInboxOnly(ledger, reason) {
  const callSid = String(ledger?.callSid || '').trim();
  if (!callSid) return false;
  try {
    const db = require('../db');
    if (typeof db?.mergeCallSummaryMeta !== 'function') return false;
    await db.mergeCallSummaryMeta({
      callSid,
      patch: { owner_notify_held: reason, owner_notify_kind: String(ledger.kind || 'unknown') },
    });
    return true;
  } catch (err) {
    console.warn(`${TAG} inbox note failed (${err?.message || err})`);
    return false;
  }
}

module.exports = {
  CALL_UPDATE_KINDS,
  createEscalationGate,
  escalationGateEnabled,
  escalationHold,
  isCallUpdate,
  noteInboxOnly,
  setDefaultEscalationGate,
};
