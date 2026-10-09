// Platform-wide ops alerts (speech | reasoning | telephony). Not per-tenant owner SMS.
// Separate cooldown and recipient list from speechOutageNotify.js.

const { dispatchToStaff } = require('./recipients');
const { platformOpsDegradeBody } = require('./templates');
const {
  platformOpsRecipients,
  resetPlatformOpsRecipientsCache,
} = require('./platformOpsRecipients');

/** @type {Map<string, boolean>} */
const degraded = new Map();
/** @type {Map<string, number>} */
const alertedAt = new Map();
let dispatchOverride = null;

const KINDS = new Set(['speech', 'reasoning', 'telephony']);

function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  if (k === 'llm') return 'reasoning';
  return KINDS.has(k) ? k : 'speech';
}

function opsCooldownMs() {
  const n = Number(process.env.VOICE_PLATFORM_OPS_COOLDOWN_MS || 30 * 60 * 1000);
  return Number.isFinite(n) && n >= 0 ? n : 30 * 60 * 1000;
}

function ledgerKind(kind) {
  const k = normalizeKind(kind);
  return `platform_ops_${k}`;
}

function claimAlertSlot(kind, now) {
  const key = normalizeKind(kind);
  const last = alertedAt.get(key) || 0;
  if (now - last < opsCooldownMs()) return false;
  alertedAt.set(key, now);
  return true;
}

function buildPlatformOpsBody(kind, detail = {}) {
  return platformOpsDegradeBody(kind, detail);
}

/**
 * Fire when a platform lane newly degrades. One ping per kind until recovery.
 *
 * @param {'speech'|'reasoning'|'telephony'|'llm'} kind
 * @param {{ channel?: string, message?: string, balanceMinor?: number, currency?: string }} [detail]
 */
async function notePlatformOpsDegrade(kind, detail = {}) {
  const key = normalizeKind(kind);
  const now = Date.now();

  if (degraded.get(key)) {
    return { ok: false, reason: 'already_degraded' };
  }
  if (!claimAlertSlot(key, now)) {
    return { ok: false, reason: 'cooldown' };
  }

  const { recipients, source } = await platformOpsRecipients();
  if (!recipients.length) {
    alertedAt.delete(key);
    console.error(
      `[platform-ops] ${key} degraded but no ops list (add an email in Super Admin > Escalate, or set SCALERS_OPS_ALERT_EMAILS)`
    );
    return { ok: false, reason: 'no_ops_recipients', source };
  }

  const body = buildPlatformOpsBody(key, detail);
  const subject =
    key === 'speech'
      ? 'Scalers platform speech down'
      : key === 'reasoning'
        ? 'Scalers platform reasoning down'
        : 'Scalers platform phone line down';

  if (String(process.env.VOICE_PLATFORM_OPS_DRY_RUN || '').toLowerCase() === 'true') {
    degraded.set(key, true);
    console.warn(
      `[platform-ops] DRY_RUN kind=${key} recipients=${recipients.length} body=${JSON.stringify(body)}`
    );
    return { ok: true, channel: 'dry_run', recipients: recipients.length };
  }

  try {
    const dispatch = dispatchOverride || dispatchToStaff;
    const { sent, errors } = await dispatch({
      recipients,
      body,
      subject,
      lead: { reason: `Platform ${key} degraded`, businessName: null },
      // Email only for now. No SMS or WhatsApp for platform ops alerts.
      channels: { sms: false, whatsapp: false, email: true },
      // Recorded as a platform row (tenant null) under one key per incident:
      // ops:<kind>:<incident start ms>:<person>. Was dropped as invalid before.
      ledger: { kind: ledgerKind(key), keyBase: `ops:${ledgerKind(key)}:${now}` },
    });
    const hit = sent.find((row) => row.channel);
    if (!hit) {
      alertedAt.delete(key);
      degraded.delete(key);
      console.warn(`[platform-ops] alert not sent kind=${key} errors=${errors.join(';')}`);
      return { ok: false, reason: 'not_sent', errors };
    }
    degraded.set(key, true);
    console.error(
      `[platform-ops] alerted kind=${key} channel=${hit.channel} dest=${hit.to || hit.email || '?'}`
    );
    return { ok: true, channel: hit.channel, sent: sent.length };
  } catch (err) {
    alertedAt.delete(key);
    console.warn('[platform-ops] alert failed:', err?.message || err);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Clear degraded latch when health recovers so a later incident can alert again. */
function notePlatformOpsRecovered(kind) {
  const key = normalizeKind(kind);
  degraded.delete(key);
  alertedAt.delete(key);
}

function isPlatformOpsDegraded(kind) {
  return Boolean(degraded.get(normalizeKind(kind)));
}

/** Tests only. */
function resetPlatformOpsAlert() {
  degraded.clear();
  alertedAt.clear();
  dispatchOverride = null;
  resetPlatformOpsRecipientsCache();
}

/** Tests only. */
function setPlatformOpsDispatch(fn) {
  dispatchOverride = fn;
}

module.exports = {
  notePlatformOpsDegrade,
  notePlatformOpsRecovered,
  isPlatformOpsDegraded,
  buildPlatformOpsBody,
  resetPlatformOpsAlert,
  setPlatformOpsDispatch,
  opsCooldownMs,
  ledgerKind,
};
