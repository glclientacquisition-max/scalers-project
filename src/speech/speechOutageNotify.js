// One owner alert per business per incident window.
// Platform outages (speech or reasoning) hit every DID. Do not SMS per call.

/** @type {Map<string, number>} */
const ownerNotifiedAt = new Map();
/** @type {Set<string>} */
const platformNoticed = new Set();
let dispatchOverride = null;

function ownerCooldownMs() {
  const n = Number(process.env.VOICE_OUTAGE_OWNER_COOLDOWN_MS || 30 * 60 * 1000);
  return Number.isFinite(n) && n >= 0 ? n : 30 * 60 * 1000;
}

function buildOwnerOutageBody(businessName, kind = 'speech') {
  const who = String(businessName || '').trim();
  if (kind === 'llm') {
    if (who) {
      return `${who} line is taking names only. Callers are asked for a name so the team can call back.`;
    }
    return 'Your Scalers line is taking names only. Callers are asked for a name so the team can call back.';
  }
  if (who) {
    return `${who} line downtime. Callers heard a short message and were asked to call back.`;
  }
  return 'Your Scalers line is on downtime. Callers heard a short message and were asked to call back.';
}

function claimOwnerSlot(tenantId, kind, now) {
  const key = `${kind}:${tenantId}`;
  const last = ownerNotifiedAt.get(key) || 0;
  if (now - last < ownerCooldownMs()) return false;
  ownerNotifiedAt.set(key, now);
  return true;
}

/**
 * @param {{ profile?: object, kind?: 'speech'|'llm' }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, channel?: string|null }>}
 */
async function noteSpeechOutage(opts = {}) {
  const profile = opts.profile || {};
  const kind = opts.kind === 'llm' ? 'llm' : 'speech';
  const tenantId = profile.id ? String(profile.id) : '';
  const now = Date.now();

  if (!platformNoticed.has(kind)) {
    platformNoticed.add(kind);
    console.error(
      kind === 'llm'
        ? '[speech-outage] platform reasoning down. Callers hear the name ask. Owners get one alert per business per cooldown.'
        : '[speech-outage] platform speech down. Callers hear the downtime clip. Owners get one alert per business per cooldown.'
    );
  }

  if (!tenantId) return { ok: false, reason: 'no_tenant' };
  if (!claimOwnerSlot(tenantId, kind, now)) return { ok: false, reason: 'cooldown' };

  try {
    const dispatch =
      dispatchOverride || require('../notifications/dispatch').dispatchAlert;
    const sent = await dispatch({
      to: profile.whatsappNumber,
      email: profile.alertEmail,
      channels: profile.notifyChannels,
      body: buildOwnerOutageBody(profile.businessName, kind),
      subject:
        kind === 'llm' ? 'Scalers line taking names only' : 'Scalers line downtime',
      lead: {
        businessName: profile.businessName,
        reason: kind === 'llm' ? 'Reasoning downtime' : 'Speech downtime',
      },
    });
    if (!sent?.channel) {
      ownerNotifiedAt.delete(`${kind}:${tenantId}`);
      return { ok: false, reason: sent?.reason || 'not_sent', channel: null };
    }
    console.warn(
      `[speech-outage] owner alert kind=${kind} tenant=${tenantId} channel=${sent.channel}`
    );
    return { ok: true, channel: sent.channel };
  } catch (err) {
    ownerNotifiedAt.delete(`${kind}:${tenantId}`);
    console.warn('[speech-outage] owner alert failed:', err?.message || err);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Tests only. */
function resetSpeechOutageNotify() {
  ownerNotifiedAt.clear();
  platformNoticed.clear();
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
