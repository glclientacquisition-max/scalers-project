'use strict';
// Per-tenant SMS backoff after a provider billing refusal.
// Staging HD_4ec204aafa93 (2026-10-14): TextSMS answered
// "http=402 code=1008 Transaction Declined: Insufficient credits" on all
// three caller notifies of one call. Retrying each event cannot succeed until
// the account is topped up, so back off per tenant and log the low-credit
// notice once per window. No existing platform-ops alert kind fits SMS credit
// (speech|reasoning|telephony|audio), so this is log-only by design.

const DEFAULT_BACKOFF_MS = 15 * 60 * 1000;
const until = new Map();
let lastNoticeAt = 0;

function backoffMs(env = process.env) {
  const n = Number(env.SMS_CREDIT_BACKOFF_MS);
  return Number.isFinite(n) && n >= 0 && String(env.SMS_CREDIT_BACKOFF_MS || '') !== '' ? n : DEFAULT_BACKOFF_MS;
}

/** TextSMS insufficient credits: HTTP 402 or provider code 1008. */
function isCreditExhausted(err) {
  if (!err) return false;
  return Number(err.status) === 402 || Number(err.code) === 1008;
}

function smsBackoffActive(tenantId, now = Date.now()) {
  const key = String(tenantId || 'none');
  const t = until.get(key) || 0;
  if (t > now) return true;
  if (t) until.delete(key);
  return false;
}

/** Start the window. Returns true when this call logged the ops notice. */
function noteCreditExhausted(tenantId, now = Date.now(), env = process.env) {
  const ms = backoffMs(env);
  until.set(String(tenantId || 'none'), now + ms);
  if (now - lastNoticeAt >= ms) {
    lastNoticeAt = now;
    console.error(
      `[sms] OPS: SMS provider credits exhausted (402/1008). Caller/staff SMS paused ${Math.round(ms / 60000)} min per tenant; top up the TextSMS account.`
    );
    return true;
  }
  return false;
}

function resetSmsBackoff() {
  until.clear();
  lastNoticeAt = 0;
}

module.exports = { isCreditExhausted, smsBackoffActive, noteCreditExhausted, resetSmsBackoff, DEFAULT_BACKOFF_MS };
