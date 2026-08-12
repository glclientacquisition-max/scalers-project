// src/conversation/language.js
// Automatic caller-language detection for Kenya phone calls (EN / SW / Sheng).

const SWAHILI_MARKERS = [
  'habari',
  'sasa',
  'sawa',
  'asante',
  'tafadhali',
  'ninaomba',
  'nataka',
  'ningependa',
  'naomba',
  'karibu',
  'pole',
  'samahani',
  'ndiyo',
  'hapana',
  'kwaheri',
  'jina',
  'bei',
  'huduma',
  'leo',
  'kesho',
  'saa',
  'wapi',
  'gani',
  'nina',
  'nime',
  'tuko',
  'unaweza',
  'naweza',
  'nitakupigia',
  'nakucheckia',
  'nakuangalia',
  'shida',
  'msaada',
  'bei gani',
  'nina hitaji',
  'nataka msaada',
];

const SHENG_MARKERS = [
  'niaje',
  'maze',
  'msee',
  'manze',
  'poa sana',
  'niko poa',
  'nko poa',
  'faro',
  'soft life',
  'nimechill',
  'nimebamba',
  'tuko spot',
  'udae',
  'msee wangu',
];

const ENGLISH_MARKERS = [
  'hello',
  'hi',
  'hey',
  'thanks',
  'thank you',
  'please',
  'need',
  'want',
  'looking for',
  'how much',
  'price',
  'cost',
  'available',
  'appointment',
  'booking',
  'service',
  'plumber',
  'plumbing',
  'electrical',
  'cleaning',
  'my name',
  'i am',
  "i'm",
  'can you',
  'could you',
  'what do you',
  'do you offer',
  'call me',
  'call back',
  'yes',
  'no',
  'okay',
  'ok',
];

const BACKCHANNELS = new Set([
  'ok',
  'okay',
  'oke',
  'sawa',
  'yeah',
  'yep',
  'yup',
  'mm',
  'mmm',
  'mhm',
  'uh huh',
  'uh-huh',
  'uh yeah',
  'um yeah',
  'aha',
  'ah',
  'oh',
  'hmm',
  'right',
  'sure',
  'true',
  'hello',
  'hello?',
  'hi',
  'hey',
  'yes',
  'yeah?',
  'ndiyo',
  'eh',
  'eeh',
  'poa',
  'gemini',
]);

function markerAppears(raw, marker) {
  const escaped = String(marker)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(
    raw
  );
}

function countMarkers(raw, markers) {
  return markers.reduce(
    (count, marker) => count + (markerAppears(raw, marker) ? 1 : 0),
    0
  );
}

/**
 * Evidence-bearing detection for stateful language policy.
 * @param {string} text
 */
function analyzeCallerLanguage(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return {
      language: 'unknown',
      confidence: 0,
      scores: { en: 0, sw: 0, sheng: 0 },
    };
  }

  let swHits = countMarkers(raw, SWAHILI_MARKERS);
  let enHits = countMarkers(raw, ENGLISH_MARKERS);
  const shengHits = countMarkers(raw, SHENG_MARKERS);

  if (
    !swHits &&
    !shengHits &&
    /\b(i|my|you|we|the|a|an|is|are|can|do|what|how|when|where)\b/.test(raw)
  ) {
    enHits += 2;
  }

  let language = 'unknown';
  if (shengHits >= 2 && shengHits >= swHits && shengHits >= enHits) {
    language = 'sheng';
  } else if (swHits === 0 && enHits === 0) {
    language = 'unknown';
  } else if (swHits > 0 && enHits > 0) {
    if (swHits >= enHits + 2) language = 'sw';
    else if (enHits >= swHits + 2) language = 'en';
    else language = 'mixed';
  } else {
    language = swHits > enHits ? 'sw' : 'en';
  }

  const scores = { en: enHits, sw: swHits, sheng: shengHits };
  const ranked = Object.values(scores).sort((a, b) => b - a);
  const top = ranked[0] || 0;
  const margin = top - (ranked[1] || 0);
  const confidence =
    language === 'unknown'
      ? 0
      : language === 'mixed'
        ? 0.55
        : Math.min(0.98, top === 1 ? 0.58 : 0.55 + top * 0.12 + margin * 0.08);
  return { language, confidence, scores };
}

/**
 * @param {string} text
 * @returns {'en'|'sw'|'sheng'|'mixed'|'unknown'}
 */
function detectCallerLanguage(text) {
  return analyzeCallerLanguage(text).language;
}

function createLanguageState() {
  return {
    current: 'unknown',
    detected: 'unknown',
    confidence: 0,
    pending: null,
    pendingCount: 0,
    switchCount: 0,
  };
}

function resolveLanguageState(previous, evidence) {
  const state = { ...createLanguageState(), ...(previous || {}) };
  const detected = evidence?.language || 'unknown';
  const confidence = Number(evidence?.confidence || 0);
  state.detected = detected;

  if (detected === 'unknown' || detected === 'mixed') {
    if (state.current === 'unknown' && detected === 'mixed') {
      state.current = 'mixed';
      state.confidence = confidence;
    } else {
      state.confidence = Math.max(0.4, Number(state.confidence || 0) - 0.05);
    }
    state.pending = null;
    state.pendingCount = 0;
    return state;
  }

  if (state.current === 'unknown' || state.current === 'mixed') {
    state.current = detected;
    state.confidence = confidence;
    state.pending = null;
    state.pendingCount = 0;
    return state;
  }

  if (detected === state.current) {
    state.confidence = Math.max(Number(state.confidence || 0), confidence);
    state.pending = null;
    state.pendingCount = 0;
    return state;
  }

  const pendingCount = state.pending === detected ? Number(state.pendingCount || 0) + 1 : 1;
  if (confidence >= 0.82 || pendingCount >= 2) {
    state.current = detected;
    state.confidence = confidence;
    state.switchCount = Number(state.switchCount || 0) + 1;
    state.pending = null;
    state.pendingCount = 0;
    return state;
  }

  state.pending = detected;
  state.pendingCount = pendingCount;
  state.confidence = Math.max(0.4, Number(state.confidence || 0) - 0.08);
  return state;
}

/**
 * Sticky session language: prefer a clear new signal, else keep prior.
 * @param {'en'|'sw'|'sheng'|'mixed'|'unknown'|null} previous
 * @param {'en'|'sw'|'sheng'|'mixed'|'unknown'} detected
 */
function resolveCallLanguage(previous, detected) {
  if (detected === 'en' || detected === 'sw' || detected === 'sheng') return detected;
  if (detected === 'mixed') {
    if (previous === 'en' || previous === 'sw' || previous === 'sheng') return previous;
    return 'mixed';
  }
  return previous || 'unknown';
}

/**
 * Short hold phrase while Gemini thinks. Language-matched.
 * @param {'en'|'sw'|'sheng'|'mixed'|'unknown'|null} lang
 */
function pickFillerText(lang) {
  const env = process.env.VOICE_FILLER;
  if (env && env !== 'auto' && env !== 'off') return env;
  if (lang === 'sw') return 'Kidogo…';
  if (lang === 'sheng') return 'One sec…';
  if (lang === 'en') return 'One moment…';
  return 'One moment…';
}

/**
 * Sticky call-language → Soniox TTS code (no utterance inspection).
 * Prefer src/speech/ttsNormalize.resolveTtsLanguage for speak paths.
 */
function ttsLanguageFor(lang) {
  if (lang === 'sw') return 'sw';
  // Sheng rides English TTS + prompt style.
  return process.env.SONIOX_TTS_LANGUAGE || 'en';
}

/**
 * Short acknowledgments should not cancel TTS / Gemini mid-reply.
 * @param {string} text
 */
function isBackchannel(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  if (BACKCHANNELS.has(t)) return true;
  if (t.split(' ').length === 1 && t.length <= 4) return true;
  return false;
}

/**
 * Light per-turn language hint — keep soft so Gemini stays fluent.
 * @param {'en'|'sw'|'sheng'|'mixed'|'unknown'|null} lang
 */
function languageDirective(lang) {
  if (lang === 'en') {
    return 'Language cue: caller is using English — reply in clear Kenyan English that is easy to say on a phone.';
  }
  if (lang === 'sw') {
    return 'Language cue: caller is using Kiswahili — reply in natural Kiswahili with short, easy-to-pronounce sentences.';
  }
  if (lang === 'sheng') {
    return 'Language cue: caller is using Sheng — reply in light natural Sheng, short and clear; keep slang sparse so it stays easy to pronounce.';
  }
  if (lang === 'mixed') {
    return 'Language cue: caller is mixing English/Kiswahili — mirror lightly; stay clear and pronounceable.';
  }
  return 'Language cue: match the caller in English, Kiswahili, or light Sheng; keep every reply easy to say on a phone.';
}

module.exports = {
  analyzeCallerLanguage,
  detectCallerLanguage,
  createLanguageState,
  resolveLanguageState,
  resolveCallLanguage,
  pickFillerText,
  ttsLanguageFor,
  isBackchannel,
  languageDirective,
};
