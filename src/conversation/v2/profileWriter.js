'use strict';
// Post-call ProfileWriter stub (#871). Writes caller_* tables only after the call ends.
// Live commits (book/cancel/reschedule) stay on C1. Flag off → no-op, never throws into the call path.
const {
  FLAG_NAME,
  callerProfileEnabled,
  callerProfileMode,
} = require('./callerProfile');

/**
 * Apply confirmed receipts to the caller profile. Stub: no DB writes yet.
 * Idempotent on (tenant_id, call_id, receipt_id, fact_key) once SQL + real writer land.
 * @returns {{ ok: boolean, skipped?: string, mode?: string, written?: number }}
 */
async function writeCallerProfile({
  env = process.env,
  tenantId,
  callId,
  receipts = [],
  profileConsent = true,
} = {}) {
  try {
    if (!callerProfileEnabled(env)) return { ok: true, skipped: 'flag_off', mode: 'off', written: 0 };
    if (!profileConsent) return { ok: true, skipped: 'no_consent', mode: callerProfileMode(env), written: 0 };
    if (!tenantId || !callId) return { ok: true, skipped: 'missing_ids', mode: callerProfileMode(env), written: 0 };
    // Shadow and on: log-shaped no-op until the real receipt→row mapping ships.
    const n = Array.isArray(receipts) ? receipts.length : 0;
    return {
      ok: true,
      mode: callerProfileMode(env),
      written: 0,
      pending_receipts: n,
      note: 'stub: no DB write',
    };
  } catch {
    // Never throw into the call / summary path.
    return { ok: false, skipped: 'error', written: 0 };
  }
}

function registerProfileWriter(_onCallSummaryReady) {
  // Later: onCallSummaryReady(async (evt) => writeCallerProfile(...))
  return { registered: false, reason: 'stub' };
}

module.exports = {
  FLAG_NAME,
  writeCallerProfile,
  registerProfileWriter,
};
