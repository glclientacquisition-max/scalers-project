// Process-level thinking-ack PCM so a slow Gemini turn can speak instantly.
// Keyed by catalog voice × TTS language × spoken text × speed.

const { randomUUID } = require('crypto');
const { pickContextualAck } = require('../conversation/dynamicSpeech');
const { prepareForTts } = require('./ttsNormalize');
const { speedForLanguage } = require('./sonioxTts');
const { resolveSonioxVoice } = require('./sonioxVoice');
const { evenOutPcmS16le } = require('./pcmUtil');

const MAX_ENTRIES = 48;
const CACHED_FILLER_STREAM_PREFIX = 'cached-filler-';

/** @type {Map<string, Buffer>} */
const cache = new Map();

function isFillerCacheEnabled() {
  const raw = String(process.env.VOICE_FILLER_CACHE || 'on').toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

function fillerPcmKey({ voiceId, language, spokenText, speed }) {
  const voice = resolveSonioxVoice(voiceId);
  const lang = language === 'sw' ? 'sw' : 'en';
  const text = String(spokenText || '').trim();
  const pace = String(speed ?? '');
  return `${voice}|${lang}|${pace}|${text}`;
}

function lookupFillerPcm({ voiceId, text, callLanguage, extraLexicon }) {
  const prepared = prepareForTts(text, {
    callLanguage,
    extraLexicon,
  });
  const lang = prepared.language === 'sw' ? 'sw' : 'en';
  const speed = speedForLanguage(lang);
  const key = fillerPcmKey({
    voiceId,
    language: lang,
    spokenText: prepared.text,
    speed,
  });
  return { key, prepared, pcm: getFillerPcm(key) };
}

function getFillerPcm(key) {
  if (!key || !cache.has(key)) return null;
  const pcm = cache.get(key);
  cache.delete(key);
  cache.set(key, pcm);
  return pcm;
}

function putFillerPcm(key, pcm) {
  if (!key || !pcm || !pcm.length) return null;
  if (cache.has(key)) cache.delete(key);
  // Even-out full clips only (≥100 ms). 20 ms frames would pump.
  let stored = Buffer.from(pcm);
  if (stored.length >= 3200) stored = evenOutPcmS16le(stored);
  cache.set(key, stored);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return cache.get(key);
}

function isCancelableTtsStreamId(streamId) {
  return String(streamId || '').startsWith('tts-');
}

function newCachedFillerStreamId() {
  return `${CACHED_FILLER_STREAM_PREFIX}${randomUUID()}`;
}

function commonAckPhrases() {
  const langs = ['en', 'sw', 'sheng'];
  const samples = ['okay thanks', 'What time do you close?'];
  const set = new Set();
  for (const lang of langs) {
    for (const sample of samples) {
      const line = pickContextualAck(sample, lang);
      if (line) set.add(line);
    }
  }
  return [...set];
}

/**
 * Render common acks into the cache without sending PCM to the caller.
 * @param {{ tts: object, voiceId?: string, extraLexicon?: unknown, shouldAbort?: () => boolean }} opts
 */
async function warmFillerAckPcm(opts = {}) {
  const tts = opts.tts;
  if (!isFillerCacheEnabled() || !tts) return { warmed: 0 };
  let warmed = 0;
  for (const text of commonAckPhrases()) {
    if (opts.shouldAbort?.()) break;
    const found = lookupFillerPcm({
      voiceId: opts.voiceId,
      text,
      extraLexicon: opts.extraLexicon,
    });
    if (found.pcm) continue;
    try {
      const session = await tts.beginSpeak({
        language: found.prepared.language,
        alreadyPrepared: true,
        capture: true,
        silent: true,
        extraLexicon: opts.extraLexicon,
      });
      const pushed = session.pushText(found.prepared.text);
      if (!pushed.pushed) {
        session.cancel();
        continue;
      }
      const result = await session.end();
      if (!result?.cancelled && result?.pcm?.length) {
        putFillerPcm(found.key, result.pcm);
        warmed += 1;
      }
    } catch {
      break;
    }
  }
  return { warmed };
}

function resetFillerPcmCache() {
  cache.clear();
}

function fillerPcmCacheSize() {
  return cache.size;
}

module.exports = {
  CACHED_FILLER_STREAM_PREFIX,
  MAX_ENTRIES,
  isFillerCacheEnabled,
  fillerPcmKey,
  lookupFillerPcm,
  getFillerPcm,
  putFillerPcm,
  isCancelableTtsStreamId,
  newCachedFillerStreamId,
  commonAckPhrases,
  warmFillerAckPcm,
  resetFillerPcmCache,
  fillerPcmCacheSize,
};
