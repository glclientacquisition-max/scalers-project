// VOICE_LANG_HYSTERESIS: turn-level language lock with 2-of-3 hysteresis,
// explicit pin, and loanword/mixed immunity. Default off — main keeps
// resolveLanguageState / resolveCallLanguage.
//
// Exposes lockReplyLanguage() with the same { lang, source } shape as #614's
// languageLock.js so Phase 2 can consume this decision without editing #614.

const {
  analyzeCallerLanguage,
  ENGLISH_JOB_LOANWORDS,
  confirmationLanguage,
} = require('./language');

const ON = new Set(['on', '1', 'true', 'yes']);
const LOCKABLE = new Set(['en', 'sw', 'sheng']);

const FILLERS = new Set([
  'ah', 'eh', 'eeh', 'yeah', 'yep', 'ok', 'okay', 'um', 'uh', 'like', 'just',
  'please', 'man', 'bwana', 'sawa', 'mm', 'mhm', 'hmm',
]);

const LOANWORDS = new Set(
  [...ENGLISH_JOB_LOANWORDS, 'service', 'services', 'price', 'cost', 'booking', 'visit', 'offer', 'ofa', 'delivery']
    .map((w) => String(w).toLowerCase())
);

const EXPLICIT_SW =
  /\b(?:(?:ongea|zungumza|sema)\s+kiswahili|kwa\s+kiswahili|in\s+kiswahili|speak\s+kiswahili|kiswahili\s+please)\b/i;
const EXPLICIT_EN =
  /\b(?:(?:speak|talk)\s+(?:in\s+)?english|in\s+english(?:\s+please)?|english\s+please|ongea\s+english)\b/i;

function langHysteresisEnabled(env = process.env) {
  return ON.has(String(env.VOICE_LANG_HYSTERESIS || 'off').trim().toLowerCase());
}

function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isLoanwordOnly(text) {
  const words = wordsOf(text).filter((w) => !FILLERS.has(w));
  if (!words.length) return false;
  return words.every((w) => LOANWORDS.has(w) || w.length <= 2);
}

function detectExplicitRequest(text) {
  const raw = String(text || '');
  if (EXPLICIT_SW.test(raw)) return 'sw';
  if (EXPLICIT_EN.test(raw)) return 'en';
  return null;
}

/**
 * Letter-share turn language from Soniox tags + content words.
 * @returns {{ turnLang: string, share: { en: number, sw: number }, contentWords: number }}
 */
function scoreTurnLanguage(text, tokenLanguages = []) {
  const tags = Array.isArray(tokenLanguages) ? tokenLanguages : [];
  const words = wordsOf(text).filter((w) => !FILLERS.has(w) && !/^\d/.test(w) && !LOANWORDS.has(w));
  const contentWords = words.length;

  // Letter share from tags when present: each tag counts by letter length of
  // matching content words; fall back to equal weight per tag.
  let enLetters = 0;
  let swLetters = 0;
  if (tags.length && contentWords) {
    // Without per-token text alignment, weight tags equally by count, then
    // blend with keyword evidence.
    for (const tag of tags) {
      const t = String(tag || '').toLowerCase();
      if (t === 'sw' || t.startsWith('sw')) swLetters += 1;
      else if (t === 'en' || t.startsWith('en')) enLetters += 1;
    }
  }
  const evidence = analyzeCallerLanguage(text, { tokenLanguages: tags });
  enLetters += Number(evidence.scores?.en || 0);
  swLetters += Number(evidence.scores?.sw || 0);
  const shengHits = Number(evidence.scores?.sheng || 0);

  const total = enLetters + swLetters;
  const share = {
    en: total ? enLetters / total : 0,
    sw: total ? swLetters / total : 0,
  };

  if (contentWords < 3 && total < 2) {
    return { turnLang: 'unknown', share, contentWords, shengHits };
  }
  if (isLoanwordOnly(text)) {
    return { turnLang: 'mixed', share, contentWords, shengHits, loanwordOnly: true };
  }
  if (shengHits >= 2 && share.en > 0.2 && share.sw > 0.2) {
    return { turnLang: 'sheng', share, contentWords, shengHits };
  }
  const top = share.en >= share.sw ? 'en' : 'sw';
  const topShare = Math.max(share.en, share.sw);
  // v2 (bug 5, 13 Oct): a turn is only "clear" when one language carries it
  // (≥ 0.85 share, ≥ 3 content words) AND the other language has no keyword
  // evidence at all. Any code-switched turn is "mixed" and never counts.
  const minorityHits = top === 'en' ? Number(evidence.scores?.sw || 0) : Number(evidence.scores?.en || 0);
  if (topShare < 0.85 || contentWords < 3 || minorityHits > 0) {
    return { turnLang: 'mixed', share, contentWords, shengHits };
  }
  return { turnLang: top, share, contentWords, shengHits };
}

function createLanguageLock(opts = {}) {
  return {
    lang: LOCKABLE.has(opts.lang) ? opts.lang : 'unknown',
    votes: [],
    lockedAt: 0,
    source: opts.source || 'init',
    pinned: Boolean(opts.pinned),
  };
}

/**
 * Advance the lock from one caller turn.
 * @returns {{ lock: object, decision: object }}
 */
function observeTurn(lock, { text = '', tokenLanguages = [] } = {}) {
  const state = { ...createLanguageLock(), ...(lock || {}) };
  const explicit = detectExplicitRequest(text);
  if (explicit) {
    state.lang = explicit;
    state.pinned = true;
    state.source = 'explicit';
    state.lockedAt = Date.now();
    state.votes = [];
    return {
      lock: state,
      decision: {
        turnLang: explicit,
        share: explicit === 'sw' ? { en: 0, sw: 1 } : { en: 1, sw: 0 },
        lock: state.lang,
        source: 'explicit',
        switched: true,
        pinned: true,
      },
    };
  }

  if (state.pinned && LOCKABLE.has(state.lang)) {
    const scored = scoreTurnLanguage(text, tokenLanguages);
    return {
      lock: state,
      decision: {
        ...scored,
        lock: state.lang,
        source: 'pinned',
        switched: false,
        pinned: true,
      },
    };
  }

  const scored = scoreTurnLanguage(text, tokenLanguages);
  let { turnLang } = scored;
  if (turnLang === 'mixed' || turnLang === 'unknown' || scored.loanwordOnly) {
    if (turnLang === 'mixed') state.votes = []; // a mixed turn breaks a switch streak
    return {
      lock: state,
      decision: {
        ...scored,
        lock: state.lang,
        source: state.lang === 'unknown' ? 'hold' : 'sticky',
        switched: false,
      },
    };
  }

  // v2 (bug 5): no single-turn switch. Switch only on an explicit request
  // (above) or two clear turns in a row in the other language.
  const votes = Array.isArray(state.votes) ? state.votes.slice(-1) : [];
  votes.push(turnLang);
  state.votes = votes;

  let switched = false;
  if (state.lang === 'unknown' || state.lang === 'mixed') {
    state.lang = turnLang;
    state.source = 'first';
    state.lockedAt = Date.now();
    switched = true;
  } else if (turnLang !== state.lang) {
    if (state.votes.length === 2 && state.votes.every((v) => v === turnLang)) {
      state.lang = turnLang;
      state.source = 'two_clear_turns';
      state.lockedAt = Date.now();
      switched = true;
    } else {
      state.source = 'sticky';
    }
  } else {
    state.source = 'confirm';
  }

  return {
    lock: state,
    decision: {
      ...scored,
      lock: state.lang,
      source: state.source,
      switched,
      pinned: Boolean(state.pinned),
    },
  };
}

/**
 * #614-compatible lock. Prefer the hysteresis lock; fall back to sticky.
 * @param {{ text?: string, tokenLanguages?: string[], state?: { current?: string, lang?: string } }} input
 * @returns {{ lang: 'en'|'sw'|'sheng', source: string }}
 */
function lockReplyLanguage({ text = '', tokenLanguages = [], state = null } = {}) {
  const sticky = LOCKABLE.has(state?.lang)
    ? state.lang
    : LOCKABLE.has(state?.current)
      ? state.current
      : null;
  if (isLoanwordOnly(text) && sticky) {
    return { lang: sticky, source: 'sticky_loanword_turn' };
  }
  const { decision } = observeTurn(
    createLanguageLock({ lang: sticky || 'unknown', source: 'sticky' }),
    { text, tokenLanguages }
  );
  const lang = LOCKABLE.has(decision.lock) ? decision.lock : sticky || 'en';
  return { lang, source: decision.source || 'default' };
}

/**
 * Guess TTS language for one greeting sentence (en vs sw).
 * @param {string} sentence
 * @returns {'en'|'sw'}
 */
function sentenceTtsLanguage(sentence) {
  const evidence = analyzeCallerLanguage(sentence);
  if (evidence.language === 'sw' || evidence.language === 'sheng') return 'sw';
  if (evidence.language === 'en') return 'en';
  // Kiswahili invite tails that keyword list may miss.
  if (/\b(nikusaidie|tukusaidie|unanisikia|habari|asante|karibu)\b/i.test(sentence)) {
    return 'sw';
  }
  return 'en';
}

/**
 * Split text into sentences for per-sentence TTS language.
 * @param {string} text
 * @returns {string[]}
 */
function splitGreetingSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Map hysteresis lock → confirmationLanguage / callLanguage current. */
function lockToCallLanguage(lock) {
  const lang = lock?.lang || 'unknown';
  if (lang === 'sheng') return 'sheng';
  if (lang === 'sw') return 'sw';
  if (lang === 'en') return 'en';
  return 'unknown';
}

module.exports = {
  langHysteresisEnabled,
  createLanguageLock,
  observeTurn,
  scoreTurnLanguage,
  lockReplyLanguage,
  isLoanwordOnly,
  detectExplicitRequest,
  sentenceTtsLanguage,
  splitGreetingSentences,
  lockToCallLanguage,
  confirmationLanguage,
};
