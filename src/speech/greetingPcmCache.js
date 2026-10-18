// Process-level tenant greeting PCM so answer-to-first-audio is not dead air.
// Keyed by catalog voice × TTS language × profile speed × spoken greeting text.
// Store raw PCM. sendPcmToMedia applies VOICE_TTS_GAIN, same as live replies.

//
// Bounded by entry count and total bytes (VOICE_GREETING_CACHE_MAX_BYTES,
// default 24 MB, about 190 greetings of 4 s). The text is hashed into the key
// so long greetings do not bloat it. greetingWarm.js fills it before calls
// ring and drops a tenant's old keys when its greeting text changes.

const crypto = require('crypto');
const { prepareForTts } = require('./ttsNormalize');
const { resolveSonioxVoice } = require('./sonioxVoice');
const { speedForLanguage } = require('./voiceProfile');
const { mergeIdentityLexicon } = require('./pronunciationLexicon');

const MAX_ENTRIES = 256;
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;

/** @type {Map<string, Buffer>} */
const cache = new Map();
let cachedBytes = 0;
/** @type {Map<string, Set<string>>} tenant id -> keys it owns */
const tenantKeys = new Map();

function maxCacheBytes(env = process.env) {
  const n = Number(env.VOICE_GREETING_CACHE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function textHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 32);
}

function isGreetingCacheEnabled() {
  const raw = String(process.env.VOICE_GREETING_CACHE || 'on').toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

function greetingPcmKey({ voiceId, language, spokenText, speed }) {
  const voice = resolveSonioxVoice(voiceId);
  const lang = language === 'sw' ? 'sw' : 'en';
  const text = String(spokenText || '').trim();
  const pace = String(speed ?? '');
  // Voice settings stay readable; the spoken text is hashed.
  return `${voice}|${lang}|${pace}|${textHash(text)}`;
}

function lookupGreetingPcm({
  voiceId,
  text,
  callLanguage,
  extraLexicon,
  businessName,
  agentName,
}) {
  const extras = mergeIdentityLexicon(extraLexicon, { businessName, agentName });
  const prepared = prepareForTts(text, {
    callLanguage,
    extraLexicon: extras,
  });
  const lang = prepared.language === 'sw' ? 'sw' : 'en';
  const key = greetingPcmKey({
    voiceId,
    language: lang,
    spokenText: prepared.text,
    speed: speedForLanguage(lang),
  });
  return { key, prepared, extraLexicon: extras, pcm: getGreetingPcm(key) };
}

function getGreetingPcm(key) {
  if (!key || !cache.has(key)) return null;
  const pcm = cache.get(key);
  cache.delete(key);
  cache.set(key, pcm);
  return pcm;
}

function dropKey(key) {
  const pcm = cache.get(key);
  if (!pcm) return false;
  cache.delete(key);
  cachedBytes -= pcm.length;
  for (const [tenantId, keys] of tenantKeys) {
    if (keys.delete(key) && !keys.size) tenantKeys.delete(tenantId);
  }
  return true;
}

/**
 * @param {string} key
 * @param {Buffer} pcm
 * @param {{ tenantId?: string|null }} [opts]
 */
function putGreetingPcm(key, pcm, opts = {}) {
  if (!key || !pcm || !pcm.length) return null;
  const budget = maxCacheBytes();
  if (pcm.length > budget) return null;
  if (cache.has(key)) dropKey(key);
  const stored = Buffer.from(pcm);
  cache.set(key, stored);
  cachedBytes += stored.length;
  if (opts.tenantId) {
    const id = String(opts.tenantId);
    if (!tenantKeys.has(id)) tenantKeys.set(id, new Set());
    tenantKeys.get(id).add(key);
  }
  while (cache.size > MAX_ENTRIES || cachedBytes > budget) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    dropKey(oldest);
  }
  return cache.get(key);
}

/**
 * Drop a tenant's cached greetings except `keep` (the keys for its current
 * greeting). Called when Identity / greeting / voice changes.
 * @param {string} tenantId
 * @param {{ keep?: Iterable<string> }} [opts]
 * @returns {number} entries dropped
 */
function invalidateTenantGreetings(tenantId, opts = {}) {
  const keys = tenantKeys.get(String(tenantId || ''));
  if (!keys) return 0;
  const keep = new Set(opts.keep || []);
  let dropped = 0;
  for (const key of [...keys]) {
    if (keep.has(key)) continue;
    if (dropKey(key)) dropped += 1;
    else keys.delete(key);
  }
  return dropped;
}

function hasGreetingPcm(key) {
  return Boolean(key && cache.has(key));
}

function greetingPcmCacheBytes() {
  return cachedBytes;
}

function resetGreetingPcmCache() {
  cache.clear();
  tenantKeys.clear();
  cachedBytes = 0;
}

function greetingPcmCacheSize() {
  return cache.size;
}

module.exports = {
  MAX_ENTRIES,
  DEFAULT_MAX_BYTES,
  maxCacheBytes,
  invalidateTenantGreetings,
  hasGreetingPcm,
  greetingPcmCacheBytes,
  isGreetingCacheEnabled,
  greetingPcmKey,
  lookupGreetingPcm,
  getGreetingPcm,
  putGreetingPcm,
  resetGreetingPcmCache,
  greetingPcmCacheSize,
};
