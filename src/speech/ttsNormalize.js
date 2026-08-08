// Prepare spoken text for clearer Soniox TTS pronunciation on phone calls.

const {
  applyLexicon,
  envLexiconOverrides,
  parseLexiconOverrides,
} = require('./pronunciationLexicon');
const { expandPhones, expandSpokenForms } = require('./spokenForms');
const { shouldRewriteSheng, rewriteShengForTts } = require('./shengRewrite');

const SW_UTTERANCE_MARKERS =
  /\b(habari|sawa|asante|karibu|tafadhali|nina|nataka|ningependa|ndiyo|hapana|kwaheri|jina|msaada|kidogo|naweza|unaweza|ninaomba|naomba|pole|samahani|bei|huduma|nitakupigia|nakucheckia|shida|kesho|leo)\b/gi;

/**
 * Strip markup the model sometimes leaks + collapse whitespace.
 * @param {string} text
 */
function stripMarkup(text) {
  return String(text || '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Punctuation polish for phone TTS (avoid stretched ellipsis, etc.).
 * @param {string} text
 */
function polishPunctuation(text) {
  let t = String(text || '');
  t = t.replace(/\u2026/g, '.').replace(/\.\.\./g, '.');
  t = t.replace(/([!?.,])\1+/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Detect whether this utterance should use Swahili TTS (`sw`) or English (`en`).
 * Returns null when the line itself is inconclusive.
 * @param {string} text
 * @returns {'en'|'sw'|null}
 */
function detectUtteranceTtsLang(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw.trim()) return null;

  const swHits = (raw.match(SW_UTTERANCE_MARKERS) || []).length;
  if (swHits >= 2) return 'sw';
  if (swHits >= 1 && /^[\p{L}\s,'’\-?!.,]+$/u.test(raw.trim())) {
    const enCue =
      /\b(hello|hi|please|thanks|thank you|okay|call|name|need|want|service|price|how much|i will|i'll|we can|can you)\b/i.test(
        raw
      );
    if (!enCue) return 'sw';
  }
  return null;
}

/**
 * Single owner of Soniox TTS language selection.
 * Prefer forced → per-utterance → sticky call language → env default.
 * Sheng / mixed / unknown ride English TTS.
 *
 * @param {string} text
 * @param {'en'|'sw'|'sheng'|'mixed'|'unknown'|null|undefined} [callLanguage]
 * @param {string} [forcedLanguage] - optional override (`en` | `sw` only)
 * @returns {'en'|'sw'}
 */
function resolveTtsLanguage(text, callLanguage, forcedLanguage) {
  const forced = String(forcedLanguage || '').toLowerCase();
  if (forced === 'en' || forced === 'sw') return forced;

  const utterance = detectUtteranceTtsLang(text);
  if (utterance) return utterance;

  if (callLanguage === 'sw') {
    const raw = String(text || '').toLowerCase();
    const swHits = (raw.match(SW_UTTERANCE_MARKERS) || []).length;
    const enHeavy =
      /\b(hello|thanks|thank you|please|i will|i'll|we can|call you|your name|how can|what can)\b/i.test(
        raw
      );
    if (enHeavy && swHits === 0) return process.env.SONIOX_TTS_LANGUAGE || 'en';
    return 'sw';
  }

  // sheng, en, mixed, unknown → English TTS voice/lang code
  return process.env.SONIOX_TTS_LANGUAGE || 'en';
}

/**
 * Merge env + tenant/session lexicon overrides (tenant wins on same match).
 * @param {unknown} [extra]
 */
function mergeExtraLexicon(extra) {
  const fromEnv = envLexiconOverrides();
  const fromOpts = parseLexiconOverrides(extra);
  if (!fromEnv.length) return fromOpts;
  if (!fromOpts.length) return fromEnv;
  return [...fromOpts, ...fromEnv];
}

/**
 * Full TTS prep pipeline:
 * strip markup → Sheng rewrite → lexicon → money/time/days → phones → punctuation.
 *
 * @param {string} text
 * @param {{ callLanguage?: string, language?: string, extraLexicon?: unknown }} [opts]
 * @returns {{ original: string, text: string, language: 'en'|'sw' }}
 */
function prepareForTts(text, opts = {}) {
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  if (!original) {
    return { original: '', text: '', language: 'en' };
  }

  const language = resolveTtsLanguage(original, opts.callLanguage, opts.language);
  const extras = mergeExtraLexicon(opts.extraLexicon);

  let spoken = stripMarkup(original);
  if (shouldRewriteSheng(spoken, opts.callLanguage)) {
    spoken = rewriteShengForTts(spoken);
  }
  spoken = applyLexicon(spoken, language, extras);
  spoken = expandSpokenForms(spoken, language);
  spoken = expandPhones(spoken);
  spoken = polishPunctuation(spoken);

  return { original, text: spoken, language };
}

/**
 * Legacy helper — returns prepared spoken text only.
 * Prefer prepareForTts() for new call sites.
 */
function normalizeForTts(text, opts = {}) {
  return prepareForTts(text, opts).text;
}

/**
 * Legacy alias — prefer resolveTtsLanguage().
 */
function pickTtsLanguage(text, callLanguage) {
  return resolveTtsLanguage(text, callLanguage);
}

module.exports = {
  stripMarkup,
  expandPhones,
  polishPunctuation,
  detectUtteranceTtsLang,
  resolveTtsLanguage,
  prepareForTts,
  normalizeForTts,
  pickTtsLanguage,
  mergeExtraLexicon,
};
