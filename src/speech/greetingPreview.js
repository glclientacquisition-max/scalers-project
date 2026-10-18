// Desk Test preview of the exact greeting a call speaks (POST /api/tts/preview
// with greeting=1). One source of truth: the same profile load, greeting
// builder (generateDynamicGreeting via greetingWarm.greetingInputs: spoken
// name, time of day, open/closed, bulletin), the same prepareForTts + tenant
// lexicon + identity lexicon (lookupGreetingPcm), and the cached PCM when the
// warmer already rendered it. Desk shows X-Spoken-Text instead of building
// its own text (Esga "E-SGA" vs "Esga", 18 Oct owner review).
//
// Side-effect free: a cache miss renders with a standalone Soniox session and
// does not write the greeting cache (the warmer owns that).

const { generateDynamicGreeting } = require('../conversation/dynamicSpeech');
const { isDefaultShopName } = require('../conversation/businessAssistantIntro');
const { greetingInputs } = require('./greetingWarm');
const { lookupGreetingPcm } = require('./greetingPcmCache');
const { pcmToBrowserWav } = require('./wavPack');

const SAMPLE_RATE = Number(process.env.SONIOX_SAMPLE_RATE || 16000);

class GreetingPreviewError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * True when the request asks for the greeting preview (query or body).
 * @param {{ query?: object, body?: object }} req
 */
function wantsGreetingPreview(req = {}) {
  const raw = req.query?.greeting ?? req.body?.greeting;
  return /^(1|true|on|yes)$/i.test(String(raw ?? '').trim());
}

function previewTenantId(req = {}) {
  const raw = req.body?.tenant_id ?? req.body?.tenantId ?? req.query?.tenant_id ?? req.query?.tenantId;
  return String(raw ?? '').trim();
}

/**
 * @param {{
 *   tenantId: string,
 *   getProfile: (tenantId: string) => Promise<object|null>,
 *   createSession: (opts: { voiceId?: string|null }) => object,
 *   now?: Date,
 * }} opts
 * @returns {Promise<{ wav: Buffer, pcm: Buffer, text: string, spokenText: string, language: 'en'|'sw', source: 'cache'|'tts', voiceId: string|null }>}
 */
async function synthesizeGreetingPreview({ tenantId, getProfile, createSession, now = new Date() }) {
  const id = String(tenantId || '').trim();
  // Never fall back to a default tenant: an empty id is a client error.
  if (!id) throw new GreetingPreviewError('tenant_id required', 400);
  if (id.length > 64 || !/^[A-Za-z0-9-]+$/.test(id)) {
    throw new GreetingPreviewError('invalid tenant_id', 400);
  }

  const profile = await getProfile(id);
  if (!profile || (profile.id && String(profile.id) !== id) || isDefaultShopName(profile.businessName)) {
    throw new GreetingPreviewError('tenant not found', 404);
  }

  const text = await generateDynamicGreeting(greetingInputs(profile, { now }));
  if (!text) throw new GreetingPreviewError('no greeting for this tenant', 422);

  // Same lookup the live greeting uses (server.js greeting block).
  const voiceId = profile.sonioxVoiceId || null;
  const found = lookupGreetingPcm({
    voiceId,
    text,
    extraLexicon: Array.isArray(profile.ttsLexicon) ? profile.ttsLexicon : [],
    businessName: profile.businessName,
    agentName: profile.agentName,
  });
  const base = { text, spokenText: found.prepared.text, language: found.prepared.language, voiceId };
  if (found.pcm) return { ...base, pcm: found.pcm, wav: pcmToBrowserWav(found.pcm, SAMPLE_RATE), source: 'cache' };

  const session = createSession({ voiceId });
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
    if (result?.cancelled || !result?.pcm?.length) {
      throw new GreetingPreviewError('TTS returned no audio', 502);
    }
    return { ...base, pcm: result.pcm, wav: pcmToBrowserWav(result.pcm, SAMPLE_RATE), source: 'tts' };
  } finally {
    try {
      session.close();
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  GreetingPreviewError,
  wantsGreetingPreview,
  previewTenantId,
  synthesizeGreetingPreview,
};
