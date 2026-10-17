// VOICE_TTS_RESPEAK line fallback: the per-line chain the Soniox TTS session
// uses when a re-speak cannot reconnect. See src/speech/sonioxTts.js.
// Order: local clip of this exact line (cached filler / greeting PCM at the
// same voice, language and speed), then espeak-ng, then Gemini TTS.

const { fillerPcmKey, getFillerPcm } = require('./fillerPcmCache');
const { greetingPcmKey, getGreetingPcm } = require('./greetingPcmCache');
const { synthesizeLinePcm } = require('./emergencyTts');

/**
 * Cached PCM for exactly this prepared line, if any.
 * @param {{ voiceId?: string, text: string, language?: string, speed?: number|null }} input
 * @returns {Buffer|null}
 */
function localLinePcm({ voiceId, text, language, speed }) {
  const spokenText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spokenText) return null;
  const lang = language === 'sw' ? 'sw' : 'en';
  const keyInput = { voiceId, language: lang, spokenText, speed: speed ?? '' };
  return getFillerPcm(fillerPcmKey(keyInput)) || getGreetingPcm(greetingPcmKey(keyInput)) || null;
}

/**
 * Build the fallbackPcm hook for createSonioxTtsSession.
 * @param {{ voiceId?: () => string|undefined, synthesize?: typeof synthesizeLinePcm }} [deps]
 */
function createLineFallback(deps = {}) {
  const synthesize = deps.synthesize || synthesizeLinePcm;
  return async function lineFallbackPcm(text, meta = {}) {
    const voiceId = typeof deps.voiceId === 'function' ? deps.voiceId() : deps.voiceId;
    return synthesize(text, {
      language: meta.language,
      localPcm: () => localLinePcm({ voiceId, text, language: meta.language, speed: meta.speed }),
    });
  };
}

module.exports = {
  createLineFallback,
  localLinePcm,
};
