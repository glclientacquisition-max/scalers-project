// Process-level tenant greeting PCM so answer-to-first-audio is not dead air.
// Keyed by catalog voice × TTS language × spoken greeting text.

const { prepareForTts } = require('./ttsNormalize');
const { resolveSonioxVoice } = require('./sonioxVoice');
const { evenOutPcmS16le } = require('./pcmUtil');
const { mergeIdentityLexicon } = require('./pronunciationLexicon');

const MAX_ENTRIES = 32;

/** @type {Map<string, Buffer>} */
const cache = new Map();

function isGreetingCacheEnabled() {
  const raw = String(process.env.VOICE_GREETING_CACHE || 'on').toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

function greetingPcmKey({ voiceId, language, spokenText }) {
  const voice = resolveSonioxVoice(voiceId);
  const lang = language === 'sw' ? 'sw' : 'en';
  const text = String(spokenText || '').trim();
  return `${voice}|${lang}|${text}`;
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

function putGreetingPcm(key, pcm) {
  if (!key || !pcm || !pcm.length) return null;
  if (cache.has(key)) cache.delete(key);
  let stored = Buffer.from(pcm);
  if (stored.length >= 3200) stored = evenOutPcmS16le(stored);
  cache.set(key, stored);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return cache.get(key);
}

function resetGreetingPcmCache() {
  cache.clear();
}

function greetingPcmCacheSize() {
  return cache.size;
}

module.exports = {
  MAX_ENTRIES,
  isGreetingCacheEnabled,
  greetingPcmKey,
  lookupGreetingPcm,
  getGreetingPcm,
  putGreetingPcm,
  resetGreetingPcmCache,
  greetingPcmCacheSize,
};
