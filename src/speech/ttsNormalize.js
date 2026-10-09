// Prepare spoken text for clearer Soniox TTS pronunciation on phone calls.

const {
  applyLexicon,
  envLexiconOverrides,
  parseLexiconOverrides,
} = require('./pronunciationLexicon');
const { expandPhones, expandSpokenForms } = require('./spokenForms');
const { shouldRewriteSheng, rewriteShengForTts } = require('./shengRewrite');
const { stripSpokenInstructionLeaks } = require('./spokenInstructionLeak');
const { reconcileSwahiliTimes } = require('../conversation/swahiliClock');

const SW_UTTERANCE_MARKERS =
  /\b(habari|sawa|asante|karibu|tafadhali|nina|nataka|ningependa|ndiyo|hapana|kwaheri|jina|msaada|kidogo|naweza|unaweza|ninaomba|naomba|pole|samahani|bei|huduma|nitakupigia|nakucheckia|shida|kesho|leo)\b/gi;

/**
 * Strip markup the model sometimes leaks + collapse whitespace.
 * @param {string} text
 */
function stripMarkup(text) {
  return stripSpokenInstructionLeaks(String(text || ''), { final: true })
    .replace(/###(?:ENDCALL|ENDTOOL|TOOL)###/gi, '')
    .replace(/[*_`#]+/g, '')
    .replace(/\bENDCALL\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LIST_ITEM = String.raw`\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*){0,5}`;
const OXFORD_LIST = new RegExp(
  String.raw`(?:${LIST_ITEM},\s+){1,}${LIST_ITEM},\s+(and|na)\s+${LIST_ITEM}`,
  'giu'
);
const BARE_LIST = new RegExp(String.raw`(?:${LIST_ITEM},\s+){2,}${LIST_ITEM}`, 'giu');

/**
 * Commas are pause cues and reach Soniox. A bare serial list of short names
 * ("sofa cleaning, carpet cleaning, window cleaning") gets the list's own
 * conjunction (and / na) before its last name, so every tenant's catalogue
 * is heard as one list with a beat between names.
 * @param {string} text
 * @param {'en'|'sw'|string} [language]
 */
function paceSpokenLists(text, language) {
  const fallback = language === 'sw' ? 'na' : 'and';
  let t = String(text || '');
  t = t.replace(OXFORD_LIST, (match) => speakSerialList(match, fallback, true));
  t = t.replace(BARE_LIST, (match) => speakSerialList(match, fallback, false));
  return t;
}

const LIST_CLOSER = /^(.*),\s+(na zingine|and more)$/i;
const LIST_HAS_CONJ = /,\s+(?:and|na)\b/i;
const LEADING_CONJ = /^(?:and|na)\s+/i;
const ITEM_HAS_CONJ = /\b(?:and|na)\b/i;

function speakSerialList(match, fallback, explicit) {
  const raw = String(match).trim();
  // ", na zingine" / ", and more" is the catalogue closer, not the list's
  // own conjunction. A list that already says ", and" or ", na" keeps that
  // join. Swallowing the closer leaves the English word inside an item
  // ("na and").
  const closer = raw.match(LIST_CLOSER);
  if (closer && LIST_HAS_CONJ.test(closer[1])) {
    return `${speakSerialList(closer[1], fallback, explicit)}, ${closer[2]}`;
  }

  const oxford = raw.match(/^(.*),\s+(and|na)\s+(\S.*)$/i);
  let conj = fallback;
  let parts;
  if (oxford) {
    conj = /^na$/i.test(oxford[2]) ? 'na' : 'and';
    parts = [...oxford[1].split(/\s*,\s+/), oxford[3]];
  } else {
    parts = raw.split(/\s*,\s+/);
  }
  const items = parts
    .map((item) => item.trim().replace(LEADING_CONJ, '').trim())
    .filter(Boolean);
  if (items.length < 3) return raw;
  if (items.some((item) => ITEM_HAS_CONJ.test(item))) return raw;
  if (items.some((item) => /\d/.test(item) || item.split(/\s+/).length > 6)) return raw;
  // A bare comma run is a list only when every piece is a short name
  // ("sofa cleaning, carpet cleaning"). A vocative or a parenthetical
  // aside has a one-word name or a longer clause and stays a pause.
  if (!explicit) {
    const counts = items.map((item) => item.split(/\s+/).length);
    if (counts.some((count) => count < 2 || count > 4)) return raw;
  }
  // Punctuation reaches Soniox, so each comma is a real pause. The list's
  // conjunction goes once, before the last name, not between every pair.
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')}, ${conj} ${last}`;
}

/**
 * Punctuation polish for phone TTS. Runs after money/time/day/phone
 * expanders, so a surviving dash or dot run is a leak. List commas become
 * spoken conjunctions. Sentence punctuation is kept: Soniox tts-rt-v2 does
 * not voice it, and it gives real comma and stop pauses and the yes/no
 * question rise (staging A/B, /workspace/punct-ab/results.md, 2026-10-08).
 * @param {string} text
 * @param {'en'|'sw'|string} [language]
 */
function polishPunctuation(text, language) {
  let t = String(text || '');
  // Abbreviations the model leaks get spoken forms, not spelled-out dots.
  t = t.replace(/\be\.g\./gi, 'for example');
  t = t.replace(/\bi\.e\./gi, 'that is');
  t = t.replace(/\band\/or\b/gi, 'and or');
  t = t.replace(/&/g, ' and ');
  // Numbered-list markers ("1. … 2. …") become commas so TTS does not say
  // full stop. Lookbehind keeps decimals (3.5) and thousands (15,000.) intact.
  t = t.replace(/(?<![\d,])(\d{1,2})\.\s+(?=\S)/g, '$1, ');
  t = t.replace(/\u2026/g, '.').replace(/\.\.\./g, '.');
  // Spaced dot chains (". . .") are one pause, not three full stops.
  t = t.replace(/\.(?:\s*\.)+/g, '.');
  // A floating period ("Wait . let me") attaches to the previous word.
  t = t.replace(/\s+\.(?=\s|$)/g, '.');
  // Em/en dash is a Gemini leak. Soniox may speak "dash" or restart the clause.
  t = t.replace(/\s*[\u2014\u2013]\s*/g, ', ');
  // Spaced ASCII hyphen is a list/range marker the expanders did not claim.
  // Intra-word hyphens (M-Pesa, West-lands) carry no spaces and must survive.
  t = t.replace(/\s+-\s*|\s*-\s+/g, ', ');
  // Parenthetical asides read as an aside, not "open parenthesis".
  t = t.replace(/\s*\(([^()]*)\)\s*/g, ', $1, ');
  t = t.replace(/([:;])\s*,\s*/g, '$1 ');
  t = t.replace(/,\s*,+/g, ',');
  t = t.replace(/^\s*,\s*/, '');
  t = t.replace(/\s+,/g, ',');
  t = t.replace(/,([A-Za-z])/g, ', $1');
  t = paceSpokenLists(t, language);
  // Stream leftover: first word glued to the next ("Ican", "Takeyour").
  t = t.replace(
    /\b(I|You|It|We|He|She|They)(can|have|is|am|are|will|would|do)\b/g,
    '$1 $2'
  );
  t = t.replace(/\b(Take)(your)\b/g, '$1 $2');
  t = t.replace(/\b(Thank)(you)\b/g, '$1 $2');
  t = t.replace(/([!?.,])\1+/g, '$1');
  // Exclamation makes Soniox punch / strain on the phone. Period keeps pace even.
  t = t.replace(/!+/g, '.');
  t = t.replace(/\.{2,}/g, '.');
  t = keepSpokenPunctuation(t);
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * A domain is spoken with "dot" ("scalers dot co dot ke"), so its dots are
 * never read as sentence stops.
 * @param {string} text
 */
function speakDomainDots(text) {
  return String(text || '').replace(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi, (host) =>
    host.replace(/\./g, ' dot ')
  );
}

/**
 * The TTS boundary keeps sentence punctuation (. , ?) so Soniox pauses and
 * lifts a question. Domains are spoken with "dot". A thousands separator
 * between digits is dropped ("15,000" -> "15000") so it is one number, not a
 * pause; a decimal point (3.5) and an intra-word hyphen (M-Pesa, 1-Bedroom)
 * stay. Semicolons and colons become a comma pause, quotes go, and a piece
 * never opens on a mark.
 * @param {string} text
 */
function keepSpokenPunctuation(text) {
  let t = speakDomainDots(text);
  while (/(\d),(\d{3})(?!\d)/.test(t)) t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  t = t.replace(/(?<!\d)\s*[;:]\s*|\s*[;:]\s*(?!\d)/g, ', ');
  t = t.replace(/[“”«»"]/g, ' ');
  t = t.replace(/\s+([.,?])/g, '$1');
  t = t.replace(/,\s*([.?])/g, '$1');
  t = t.replace(/([.?])\s*,/g, '$1');
  t = t.replace(/,(?:\s*,)+/g, ',');
  t = t.replace(/^[\s.,?;:]+/, '');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Legacy: every sentence mark removed. Not used on the call path since the
 * punctuation A/B; kept for offline comparisons and the listen harness.
 * @param {string} text
 */
function stripSpokenPunctuation(text) {
  let t = speakDomainDots(text);
  while (/(\d),(\d)/.test(t)) t = t.replace(/(\d),(\d)/g, '$1$2');
  t = t.replace(/(\d)\.(\d)/g, '$1\u0000$2');
  t = t.replace(/[.!?…,;:]+/g, ' ');
  t = t.replace(/[“”«»"]/g, ' ');
  t = t.replace(/\u0000/g, '.');
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
  let clockMismatches = [];
  if (language === 'sw') {
    // A Kiswahili time is checked against the stored visit times first
    // (HD_d199dbbf6b79), then the clock normaliser speaks the rest.
    const stored = typeof opts.storedClockMinutes === 'function' ? opts.storedClockMinutes() : opts.storedClockMinutes;
    if (Array.isArray(stored) && stored.length) {
      const checked = reconcileSwahiliTimes(spoken, stored);
      spoken = checked.text;
      clockMismatches = checked.mismatches;
    }
  }
  spoken = expandSpokenForms(spoken, language);
  spoken = expandPhones(spoken);
  spoken = polishPunctuation(spoken, language);

  return clockMismatches.length
    ? { original, text: spoken, language, clockMismatches }
    : { original, text: spoken, language };
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
  stripSpokenPunctuation,
  keepSpokenPunctuation,
  speakDomainDots,
  detectUtteranceTtsLang,
  resolveTtsLanguage,
  prepareForTts,
  normalizeForTts,
  pickTtsLanguage,
  mergeExtraLexicon,
};
