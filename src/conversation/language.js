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

/**
 * @param {string} text
 * @returns {'en'|'sw'|'sheng'|'mixed'|'unknown'}
 */
function detectCallerLanguage(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'unknown';

  let swHits = 0;
  let enHits = 0;
  let shengHits = 0;
  for (const w of SWAHILI_MARKERS) {
    if (raw.includes(w)) swHits += 1;
  }
  for (const w of ENGLISH_MARKERS) {
    if (raw.includes(w)) enHits += 1;
  }
  for (const w of SHENG_MARKERS) {
    if (raw.includes(w)) shengHits += 1;
  }

  if (
    !swHits &&
    !shengHits &&
    /\b(i|my|you|we|the|a|an|is|are|can|do|what|how|when|where)\b/.test(raw)
  ) {
    enHits += 2;
  }

  // Need a clear Sheng signal — avoid flipping on a single slang word.
  if (shengHits >= 2) return 'sheng';

  if (swHits === 0 && enHits === 0) return 'unknown';
  if (swHits > 0 && enHits > 0) {
    if (swHits >= enHits + 2) return 'sw';
    if (enHits >= swHits + 2) return 'en';
    return 'mixed';
  }
  return swHits > enHits ? 'sw' : 'en';
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
    return 'Language cue: caller is using English — reply in clear English.';
  }
  if (lang === 'sw') {
    return 'Language cue: caller is using Kiswahili — reply in natural Kiswahili.';
  }
  if (lang === 'sheng') {
    return 'Language cue: caller is using Sheng — reply in light natural Sheng, short and clear.';
  }
  if (lang === 'mixed') {
    return 'Language cue: caller is mixing English/Kiswahili — mirror lightly; stay clear.';
  }
  return 'Language cue: match the caller in English, Kiswahili, or light Sheng.';
}

module.exports = {
  detectCallerLanguage,
  resolveCallLanguage,
  pickFillerText,
  ttsLanguageFor,
  isBackchannel,
  languageDirective,
};
