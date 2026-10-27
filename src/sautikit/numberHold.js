'use strict';

// Held numbers play "line unavailable" instead of a reject
// (VOICE_NUMBER_HOLD_CLIP; off by default, only the exact value `on` enables it).
//
// Super Admin plan section 11 (number hold and win-back). After a release,
// no business owns the number (the business keeps pending:<id>), so the
// closed-line gate (inactiveTenantGate.js) never matches and the call falls
// through to "unassigned number" and <Reject/>. While the number is on a
// win-back hold that we control, callers should hear the same generic
// line-unavailable message a suspended business plays (EN + SW clips, <Say>
// fallback), then hang up.
//
// Pool fields come from Desk's draft SQL #885 (docs/supabase/number_hold_winback.sql,
// NOT applied): sautikit_did_pool.winback_hold (boolean) with status =
// 'quarantine' and quarantine_until in the future (hold length default 14
// days, set per release; billing_lifecycle_settings.number_hold_days). Holds
// that already started run to their end even when hold_winback_enabled is
// off, so that switch is not read here.
//
// Rules
//   * Only asked about a dialled number that has NO owning business (the
//     caller checks that first). A number with an owner never reaches here.
//   * Never for a protected number (+254709221536, prod Aris), whatever the
//     pool says.
//   * Missing column (SQL not applied), any read error or a timeout means
//     "not held": today's <Reject/> path, unchanged.
//   * No call row, no minutes, no Stream: the caller returns XML before
//     upsertCall.

const { sameNumber } = require('./inactiveTenantGate');

const FLAG = 'VOICE_NUMBER_HOLD_CLIP';
const PROTECTED_NUMBERS = Object.freeze(['+254709221536']);
const POOL_COLUMNS = 'e164,status,winback_hold,quarantine_until,last_tenant_id';
const DEFAULT_TIMEOUT_MS = 1500;

function numberHoldClipEnabled(env = process.env) {
  return env[FLAG] === 'on';
}

function isProtectedNumber(number) {
  return PROTECTED_NUMBERS.some((p) => sameNumber(p, number));
}

/** +254 / 254 / 0 forms of a Kenyan number, for an exact `in` match on e164. */
function numberForms(number) {
  const d = String(number || '').replace(/\D/g, '');
  if (d.length < 9) return [];
  const nine = d.slice(-9);
  return Array.from(new Set([`+254${nine}`, `254${nine}`, `0${nine}`, String(number).trim()]));
}

/** Pure: is this pool row a running win-back hold? */
function poolRowOnHold(row, nowMs = Date.now()) {
  if (!row || row.status !== 'quarantine' || row.winback_hold !== true) return false;
  const until = Date.parse(row.quarantine_until || '');
  return Number.isFinite(until) && until > nowMs;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Pool hold status for a dialled number. Never throws.
 * @returns {Promise<{ held: boolean, reason: string, until?: string, lastTenantId?: string|null }>}
 */
async function numberHoldStatus(toNumber, { client, now = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!toNumber) return { held: false, reason: 'no_number' };
  if (isProtectedNumber(toNumber)) return { held: false, reason: 'protected' };
  const forms = numberForms(toNumber);
  if (!forms.length) return { held: false, reason: 'no_number' };
  try {
    const db = client || require('../lib/supabaseClient').supabase;
    const { data, error } = await withTimeout(
      db.from('sautikit_did_pool').select(POOL_COLUMNS).in('e164', forms),
      timeoutMs
    );
    if (error) {
      const msg = String(error.message || '');
      if (/column|schema cache|does not exist/i.test(msg)) return { held: false, reason: 'columns_missing' };
      return { held: false, reason: msg === 'timeout' ? 'timeout' : 'lookup_failed' };
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return { held: false, reason: 'not_in_pool' };
    const t = now();
    const row = rows.find((r) => poolRowOnHold(r, t));
    if (!row) return { held: false, reason: 'not_held' };
    return { held: true, reason: 'winback_hold', until: row.quarantine_until, lastTenantId: row.last_tenant_id || null };
  } catch {
    return { held: false, reason: 'lookup_failed' };
  }
}

/**
 * XML for a dialled number with no owning business: the line-unavailable
 * message when the flag is on and the number is held, else today's <Reject/>.
 * Never throws.
 */
const REJECT_XML = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

async function unownedNumberResponse(toNumber, {
  env = process.env,
  client,
  now,
  timeoutMs,
  lineUnavailable = () => require('./inactiveTenantGate').lineUnavailableResponse(),
  log = () => {},
} = {}) {
  if (!numberHoldClipEnabled(env)) return { held: false, reason: 'flag_off', xml: REJECT_XML };
  const status = await numberHoldStatus(toNumber, { client, now, timeoutMs });
  if (!status.held) {
    if (status.reason !== 'not_in_pool' && status.reason !== 'not_held') log(`[number-hold] ${status.reason} — reject`);
    return { ...status, xml: REJECT_XML };
  }
  try {
    return { ...status, xml: await lineUnavailable() };
  } catch {
    return { held: false, reason: 'clip_failed', xml: REJECT_XML };
  }
}

module.exports = {
  FLAG,
  PROTECTED_NUMBERS,
  POOL_COLUMNS,
  REJECT_XML,
  numberHoldClipEnabled,
  isProtectedNumber,
  numberForms,
  poolRowOnHold,
  numberHoldStatus,
  unownedNumberResponse,
};
