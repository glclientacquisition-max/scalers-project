// Platform-wide ops alerts (speech | reasoning | telephony | wallet). Not per-tenant owner SMS.
// Separate cooldown and recipient list from speechOutageNotify.js.

const { dispatchToStaff } = require('./recipients');
const { platformOpsDegradeBody, platformOpsWalletLowBody } = require('./templates');
const {
  platformOpsRecipients,
  resetPlatformOpsRecipientsCache,
} = require('./platformOpsRecipients');

/** @type {Map<string, boolean>} */
const degraded = new Map();
/** @type {Map<string, number>} */
const alertedAt = new Map();
let dispatchOverride = null;

const KINDS = new Set(['speech', 'reasoning', 'telephony', 'wallet']);

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
  if (normalizeKind(kind) === 'wallet') return platformOpsWalletLowBody(detail);
  return platformOpsDegradeBody(kind, detail);
}

function subjectFor(key) {
  if (key === 'speech') return 'Scalers platform speech down';
  if (key === 'reasoning') return 'Scalers platform reasoning down';
  if (key === 'wallet') return 'Scalers platform phone wallet low';
  return 'Scalers platform phone line down';
}

function isDryRun() {
  return String(process.env.VOICE_PLATFORM_OPS_DRY_RUN || '').toLowerCase() === 'true';
}

/**
 * Send one ops mail (or DRY_RUN log). No latch or cooldown here.
 * @returns {Promise<{ ok: boolean, channel?: string, reason?: string, recipients?: number, sent?: number, errors?: string[], source?: string }>}
 */
async function deliverPlatformOps(key, detail, reasonText) {
  const { recipients, source } = await platformOpsRecipients();
  if (!recipients.length) {
    console.error(
      `[platform-ops] ${key} alert but no ops list (add an email in Super Admin > Escalate, or set SCALERS_OPS_ALERT_EMAILS)`
    );
    return { ok: false, reason: 'no_ops_recipients', source };
  }

  const body = buildPlatformOpsBody(key, detail);
  const subject = subjectFor(key);

  if (isDryRun()) {
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
      lead: { reason: reasonText || `Platform ${key} degraded`, businessName: null },
      // Email only for now. No SMS or WhatsApp for platform ops alerts.
      channels: { sms: false, whatsapp: false, email: true },
      ledger: { kind: ledgerKind(key) },
    });
    const hit = sent.find((row) => row.channel);
    if (!hit) {
      console.warn(`[platform-ops] alert not sent kind=${key} errors=${errors.join(';')}`);
      return { ok: false, reason: 'not_sent', errors };
    }
    console.error(
      `[platform-ops] alerted kind=${key} channel=${hit.channel} dest=${hit.to || hit.email || '?'}`
    );
    return { ok: true, channel: hit.channel, sent: sent.length };
  } catch (err) {
    console.warn('[platform-ops] alert failed:', err?.message || err);
    return { ok: false, reason: 'send_failed' };
  }
}

/**
 * One-shot ops notice whose dedupe lives with the caller (for example the
 * wallet low-balance crossing latch). Skips the per-kind degraded latch and
 * cooldown so a second, lower threshold can still alert.
 *
 * @param {'wallet'} kind
 * @param {object} [detail]
 */
async function sendPlatformOpsNotice(kind, detail = {}) {
  const key = normalizeKind(kind);
  return deliverPlatformOps(key, detail, key === 'wallet' ? 'Platform phone wallet low' : undefined);
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

  const out = await deliverPlatformOps(key, detail);
  if (out.ok) {
    degraded.set(key, true);
  } else {
    alertedAt.delete(key);
    degraded.delete(key);
  }
  return out;
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
  sendPlatformOpsNotice,
  notePlatformOpsRecovered,
  isPlatformOpsDegraded,
  buildPlatformOpsBody,
  resetPlatformOpsAlert,
  setPlatformOpsDispatch,
  opsCooldownMs,
  ledgerKind,
};
