// src/conversation/language.js
// Lightweight caller-language detection for Kenya phone calls (EN / SW).

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
  'bro',
  'manze',
  'poa',
  'wazi',
  'niko poa',
  'nko poa',
  'farojes',
  'faro',
  'soft life',
  'nimechill',
  'nimebamba',
  'tuko spot',
  'nimefika',
  'udae',
  'rade',
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
  'i\'m',
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
]);

/**
 * @param {string} text
 * @returns {'en'|'sw'|'sheng'|'mixed'|'unknown'}
 */
function detectCallerLanguage(text) {
  const raw = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
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

  // Latin-only short English questions with no SW markers → English.
  if (!swHits && !shengHits && /\b(i|my|you|we|the|a|an|is|are|can|do|what|how|when|where)\b/.test(raw)) {
    enHits += 2;
  }

  if (shengHits >= 2 || (shengHits >= 1 && (enHits > 0 || swHits > 0))) {
    return 'sheng';
  }

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
  // Mixed / unknown — keep neutral English (Kenya callers often expect EN hold).
  return 'One moment…';
}

/** Soniox TTS language code. */
function ttsLanguageFor(lang) {
  if (lang === 'sw') return 'sw';
  // Sheng rides English TTS + prompt style; locals also fall back to EN/SW TTS.
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
  // Very short single-token noises.
  if (t.split(' ').length === 1 && t.length <= 4) return true;
  return false;
}

/**
 * Strong per-turn instruction appended to the system prompt.
 * @param {'en'|'sw'|'sheng'|'mixed'|'unknown'|null} lang
 * @param {string[]} [allowedLanguages]
 */
function languageDirective(lang, allowedLanguages) {
  const allowed = Array.isArray(allowedLanguages) ? allowedLanguages : [];
  const shengOk = !allowed.length || allowed.includes('sheng');
  const allowNote = allowed.length
    ? ` Stay inside the business-enabled languages: ${allowed.join(', ')}.`
    : '';

  if (lang === 'en') {
    return `LANGUAGE LOCK (this call): The caller is speaking English. Reply ONLY in clear conversational English. Do not use Kiswahili words, fillers, or code-switch unless the caller does first.${allowNote}`;
  }
  if (lang === 'sw') {
    return `LANGUAGE LOCK (this call): The caller is speaking Kiswahili. Reply mainly in natural Kiswahili (light English loanwords OK). Stay consistent — do not suddenly switch to full English.${allowNote}`;
  }
  if (lang === 'sheng') {
    if (!shengOk) {
      return `LANGUAGE LOCK (this call): Caller used Sheng-like mix, but Sheng is not enabled for this business. Reply in clear English or Kiswahili (whichever fits best).${allowNote}`;
    }
    return `LANGUAGE LOCK (this call): The caller is using Sheng. Reply in natural light Sheng — warm Kenyan street mix, short and clear, not exaggerated slang.${allowNote}`;
  }
  if (lang === 'mixed') {
    return `LANGUAGE LOCK (this call): The caller is mixing English and Kiswahili. Mirror their mix naturally; prefer the language of their latest sentence.${allowNote}`;
  }
  return `LANGUAGE: Match the caller's latest utterance within the business-enabled languages. If they speak English, reply in English. If Kiswahili, reply in Kiswahili. Never answer English with a Kiswahili-only holding phrase.${allowNote}`;
}

module.exports = {
  detectCallerLanguage,
  resolveCallLanguage,
  pickFillerText,
  ttsLanguageFor,
  isBackchannel,
  languageDirective,
};
