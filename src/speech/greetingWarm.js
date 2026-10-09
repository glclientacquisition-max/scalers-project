// Render each tenant's greeting PCM before the phone rings.
//
// Prod HD_d3900cbf2b2d (2026-10-09 20:18 EAT): the greeting was rendered live
// (connect_to_greeting_pcm_ms=1356, cached=0). The process-local cache only
// stored a greeting after one call had played it to the end, lost it on every
// deploy, and the line changes with daypart and open/closed status, so most
// calls missed. This warmer renders the exact line a call would speak now
// (and the next daypart's when a boundary is near), keyed by
// greetingPcmCache (voice x language x speed x hashed spoken text). A sweep
// re-renders when Identity, greeting, voice, hours, or bulletin change the
// line and drops that tenant's old keys. Live TTS stays the fallback.

const { generateDynamicGreeting } = require('../conversation/dynamicSpeech');
const { openClosedStatus } = require('../conversation/businessHours');
const { bulletinClosureNotice } = require('../conversation/dailyBulletin');
const { messageFileOwnerName } = require('../conversation/messageOnly');
const { isDefaultShopName, eatTimeOfDay } = require('../conversation/businessAssistantIntro');
const {
  lookupGreetingPcm,
  putGreetingPcm,
  hasGreetingPcm,
  invalidateTenantGreetings,
  isGreetingCacheEnabled,
} = require('./greetingPcmCache');

const DEFAULT_SWEEP_MS = 5 * 60 * 1000;
const LOOKAHEAD_MS = 15 * 60 * 1000;

function greetingWarmEnabled(env = process.env) {
  const raw = String(env.VOICE_GREETING_WARM ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  return isGreetingCacheEnabled();
}

/**
 * The same fields the live call passes to generateDynamicGreeting
 * (server.js ensureTenantPrompt + greeting block), for a caller with no file.
 * @param {object} profile db.getTenantProfile() shape
 * @param {{ now?: Date }} [opts]
 */
function greetingInputs(profile = {}, { now = new Date() } = {}) {
  const businessName = profile.businessName || process.env.BUSINESS_NAME || 'the business';
  const agentName = profile.agentName || process.env.AGENT_NAME || 'Receptionist';
  const openStatus = openClosedStatus(profile.hoursSchedule || null, now);
  const afterHoursMode = profile.afterHoursMode || 'serve';
  return {
    businessName,
    agentName,
    spokenName: profile.spokenName || '',
    greetingInvite: profile.greetingInvite || '',
    vertical: profile.vertical || '',
    servicesCatalog: profile.servicesCatalog,
    servicesOffered: profile.servicesOffered,
    isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
    afterHoursMode,
    closureNotice: bulletinClosureNotice(profile.dailyBulletin, now),
    callerFileName: afterHoursMode === 'message' ? messageFileOwnerName(profile) : '',
    mode: 'instant',
    now,
  };
}

/** Instants to render for: now, plus just past the next daypart edge if near. */
function warmInstants(now = new Date(), lookaheadMs = LOOKAHEAD_MS) {
  const out = [now];
  const ahead = new Date(now.getTime() + lookaheadMs);
  if (eatTimeOfDay(ahead) !== eatTimeOfDay(now)) out.push(ahead);
  return out;
}

/**
 * Render one greeting line into the cache with a standalone Soniox session.
 * @param {{ createSession: Function }} deps
 */
async function renderGreetingPcm({ text, profile, tenantId, createSession }) {
  const found = lookupGreetingPcm({
    voiceId: profile.sonioxVoiceId || null,
    text,
    extraLexicon: Array.isArray(profile.ttsLexicon) ? profile.ttsLexicon : [],
    businessName: profile.businessName,
    agentName: profile.agentName,
  });
  if (found.pcm) return { key: found.key, rendered: false };
  const session = createSession({ voiceId: profile.sonioxVoiceId || null });
  try {
    await session.ready;
    const speak = await session.beginSpeak({
      language: found.prepared.language,
      alreadyPrepared: true,
      speedScale: 1,
      capture: true,
      silent: true,
      extraLexicon: found.extraLexicon,
    });
    const { splitSpeakableChunks } = require('./spokenStreamBuffer');
    const { chunks } = splitSpeakableChunks(found.prepared.text, { final: true });
    for (const sentence of chunks) speak.pushText(sentence);
    const result = await speak.end();
    if (result?.cancelled || !result?.pcm?.length) return { key: found.key, rendered: false };
    putGreetingPcm(found.key, result.pcm, { tenantId });
    return { key: found.key, rendered: true, bytes: result.pcm.length };
  } finally {
    try {
      session.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {{
 *   listTenantIds: () => Promise<string[]>,
 *   getProfile: (tenantId: string) => Promise<object>,
 *   createSession: (opts: { voiceId?: string|null }) => object,
 *   now?: () => Date,
 *   sweepMs?: number,
 *   log?: (msg: string) => void,
 * }} deps
 */
function createGreetingWarmer(deps) {
  const now = deps.now || (() => new Date());
  const log = deps.log || (() => {});
  const sweepMs = Number.isFinite(deps.sweepMs) ? deps.sweepMs : DEFAULT_SWEEP_MS;
  let chain = Promise.resolve();
  let timer = null;
  /** @type {Map<string, Promise<unknown>>} */
  const pending = new Map();

  async function warmTenantNow(tenantId, profileIn) {
    const profile = profileIn || (await deps.getProfile(tenantId));
    if (!profile || isDefaultShopName(profile.businessName)) return { tenantId, keys: [], rendered: 0 };
    const keys = [];
    let rendered = 0;
    const lines = new Set();
    for (const at of warmInstants(now())) {
      lines.add(await generateDynamicGreeting(greetingInputs(profile, { now: at })));
    }
    for (const text of lines) {
      if (!text) continue;
      const r = await renderGreetingPcm({
        text,
        profile,
        tenantId: profile.id || tenantId,
        createSession: deps.createSession,
      });
      keys.push(r.key);
      if (r.rendered) rendered += 1;
    }
    const dropped = invalidateTenantGreetings(profile.id || tenantId, { keep: keys });
    if (rendered || dropped) {
      log(`[greeting-warm] tenant=${tenantId} rendered=${rendered} dropped=${dropped} lines=${lines.size}`);
    }
    return { tenantId, keys, rendered, dropped };
  }

  /** Queue one tenant (serialised; one Soniox render at a time). */
  function warmTenant(tenantId, profile) {
    const id = String(tenantId || '').trim();
    if (!id) return Promise.resolve(null);
    if (pending.has(id) && !profile) return pending.get(id);
    const job = (chain = chain
      .catch(() => {})
      .then(() => warmTenantNow(id, profile))
      .catch((err) => {
        log(`[greeting-warm] tenant=${id} failed: ${err?.message || err}`);
        return null;
      })
      .finally(() => {
        if (pending.get(id) === job) pending.delete(id);
      }));
    pending.set(id, job);
    return job;
  }

  async function warmAll() {
    let ids = [];
    try {
      ids = await deps.listTenantIds();
    } catch (err) {
      log(`[greeting-warm] tenant list failed: ${err?.message || err}`);
      return [];
    }
    return Promise.all(ids.map((id) => warmTenant(id)));
  }

  function start() {
    if (timer) return;
    void warmAll();
    timer = setInterval(() => void warmAll(), sweepMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { warmTenant, warmAll, start, stop, keyCached: hasGreetingPcm };
}

module.exports = {
  DEFAULT_SWEEP_MS,
  LOOKAHEAD_MS,
  greetingWarmEnabled,
  greetingInputs,
  warmInstants,
  renderGreetingPcm,
  createGreetingWarmer,
};
