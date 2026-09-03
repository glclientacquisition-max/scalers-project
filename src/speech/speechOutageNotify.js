// One owner alert per business per speech-outage window.
// Platform Soniox failures hit every DID. Do not SMS on every abandoned call.

/** @type {Map<string, number>} */
const ownerNotifiedAt = new Map();
let platformNoticeAt = 0;
let dispatchOverride = null;

function ownerCooldownMs() {
  const n = Number(process.env.VOICE_OUTAGE_OWNER_COOLDOWN_MS || 30 * 60 * 1000);
  return Number.isFinite(n) && n >= 0 ? n : 30 * 60 * 1000;
}

function buildOwnerOutageBody(businessName) {
  const who = String(businessName || '').trim();
  if (who) {
    return `${who} line downtime. Callers heard a short message and were asked to call back.`;
  }
  return 'Your Scalers line is on downtime. Callers heard a short message and were asked to call back.';
}

function claimOwnerSlot(tenantId, now) {
  const last = ownerNotifiedAt.get(tenantId) || 0;
  if (now - last < ownerCooldownMs()) return false;
  ownerNotifiedAt.set(tenantId, now);
  return true;
}

/**
 * @param {{ profile?: object }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, channel?: string|null }>}
 */
async function noteSpeechOutage(opts = {}) {
  const profile = opts.profile || {};
  const tenantId = profile.id ? String(profile.id) : '';
  const now = Date.now();

  if (!platformNoticeAt) {
    platformNoticeAt = now;
    console.error(
      '[speech-outage] platform speech down. Callers hear the downtime clip. Owners get one alert per business per cooldown.'
    );
  }

  if (!tenantId) return { ok: false, reason: 'no_tenant' };
  if (!claimOwnerSlot(tenantId, now)) return { ok: false, reason: 'cooldown' };

  try {
    const dispatch =
      dispatchOverride || require('../notifications/dispatch').dispatchAlert;
    const sent = await dispatch({
      to: profile.whatsappNumber,
      email: profile.alertEmail,
      channels: profile.notifyChannels,
      body: buildOwnerOutageBody(profile.businessName),
      subject: 'Scalers line downtime',
      lead: { businessName: profile.businessName, reason: 'Speech downtime' },
    });
    if (!sent?.channel) {
      ownerNotifiedAt.delete(tenantId);
      return { ok: false, reason: sent?.reason || 'not_sent', channel: null };
    }
    console.warn(
      `[speech-outage] owner alert tenant=${tenantId} channel=${sent.channel}`
    );
    return { ok: true, channel: sent.channel };
  } catch (err) {
    ownerNotifiedAt.delete(tenantId);
    console.warn('[speech-outage] owner alert failed:', err?.message || err);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Tests only. */
function resetSpeechOutageNotify() {
  ownerNotifiedAt.clear();
  platformNoticeAt = 0;
  dispatchOverride = null;
}

/** Tests only. */
function setSpeechOutageDispatch(fn) {
  dispatchOverride = fn;
}

module.exports = {
  buildOwnerOutageBody,
  noteSpeechOutage,
  resetSpeechOutageNotify,
  setSpeechOutageDispatch,
  ownerCooldownMs,
};
