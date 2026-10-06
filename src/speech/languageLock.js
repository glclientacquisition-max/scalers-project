// Per-turn caller language. Wraps keyword detection with Soniox lang_id
// tokens, then keeps a sticky call language. A single job-word loan
// ("services", "cleaning") does not flip the call. A clear turn still
// gets a reply in that turn's language.

const { analyzeCallerLanguage, createLanguageState, resolveLanguageState } = require('../conversation/language');

const LOANWORDS = new Set([
  'cleaning',
  'plumber',
  'plumbing',
  'electrical',
  'appointment',
  'booking',
  'service',
  'services',
  'price',
  'cost',
  'available',
  'carpet',
  'couch',
  'mattress',
  'sofa',
  'airbnb',
  'visit',
  'emergency',
  'offer',
  'ofa',
]);

const FILLERS = new Set([
  'ah',
  'eh',
  'eeh',
  'yeah',
  'yep',
  'yup',
  'ok',
  'okay',
  'um',
  'uh',
  'like',
  'just',
  'please',
  'man',
  'bwana',
]);

const SW_FUNCTION = [
  'je',
  'mna',
  'mnayo',
  'mnaofa',
  'mnafanya',
  'mnayofanya',
  'una',
  'tuna',
  'niko',
  'upo',
  'hii',
  'hiyo',
  'ile',
  'aje',
  'kwanza',
  'kuhusu',
  'pesa',
  'ngapi',
  'nani',
  'naye',
  'nao',
  'nini',
  'nilikuwa',
  'naomba',
  'niambie',
  'unaongea',
  'ninaongea',
  'mnafika',
  'tunafika',
  'gani',
];

function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function countWords(text, list) {
  const words = new Set(wordsOf(text));
  return list.reduce((count, word) => count + (words.has(word) ? 1 : 0), 0);
}

function isLoanwordOnly(text) {
  const words = wordsOf(text).filter((word) => !FILLERS.has(word));
  if (!words.length) return false;
  return words.every((word) => LOANWORDS.has(word) || word.length <= 2);
}

function tokenVotes(tokens) {
  let en = 0;
  let sw = 0;
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const raw = String(token?.text || '')
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
    if (raw.length < 3 || LOANWORDS.has(raw) || FILLERS.has(raw)) continue;
    const lang = String(token?.language || token?.language_code || '').toLowerCase();
    const weight = Math.min(raw.length, 8);
    if (lang.startsWith('en')) en += weight;
    else if (lang.startsWith('sw') || lang === 'swh') sw += weight;
  }
  const total = en + sw;
  return {
    en,
    sw,
    total,
    enShare: total ? en / total : 0,
    swShare: total ? sw / total : 0,
  };
}

/**
 * @param {{ text?: string, tokens?: Array<{ text?: string, language?: string }> }} [input]
 */
function detectTurnLanguage({ text = '', tokens = [] } = {}) {
  const textEv = analyzeCallerLanguage(text);
  const scores = { ...textEv.scores, tokenEn: 0, tokenSw: 0 };
  const extraSw = countWords(text, SW_FUNCTION);
  let language = textEv.language;
  let confidence = textEv.confidence;

  if (extraSw && language !== 'en' && language !== 'sheng') {
    scores.sw += extraSw;
    if (language === 'unknown' || language === 'mixed') {
      language = scores.en > scores.sw + 1 ? 'en' : 'sw';
      confidence = Math.max(confidence, extraSw >= 2 ? 0.84 : 0.72);
    }
  }

  const votes = tokenVotes(tokens);
  scores.tokenEn = votes.en;
  scores.tokenSw = votes.sw;
  if ((language === 'unknown' || language === 'mixed') && votes.total >= 4) {
    if (votes.swShare >= 0.75) {
      language = 'sw';
      confidence = Math.max(confidence, 0.84);
    } else if (votes.enShare >= 0.75 && extraSw === 0) {
      language = 'en';
      confidence = Math.max(confidence, 0.84);
    }
  }

  const loanOnly = isLoanwordOnly(text);
  if (loanOnly) {
    language = 'unknown';
    confidence = 0.2;
  }

  return {
    language,
    confidence,
    scores,
    loanOnly,
    text: textEv,
  };
}

/**
 * Sticky call language plus the reply language for this turn.
 * Sticky ignores loanword-only turns and weak backchannels.
 * A clear en / sw / sheng turn is answered in that language.
 */
function lockReplyLanguage(previous, evidence) {
  const safe = evidence || { language: 'unknown', confidence: 0, scores: {}, loanOnly: false };
  const forSticky = safe.loanOnly
    ? { language: 'unknown', confidence: 0, scores: safe.scores || {} }
    : {
        language: safe.language,
        confidence: safe.confidence,
        scores: safe.scores || {},
      };
  const state = resolveLanguageState(previous || createLanguageState(), forSticky);
  const clear =
    !safe.loanOnly &&
    (safe.language === 'en' || safe.language === 'sw' || safe.language === 'sheng');
  let reply = 'en';
  if (clear) reply = safe.language;
  else if (state.current === 'en' || state.current === 'sw' || state.current === 'sheng') {
    reply = state.current;
  } else if (safe.language === 'mixed' && Number(safe.scores?.en || 0) > Number(safe.scores?.sw || 0)) {
    reply = 'en';
  } else {
    reply = 'sw';
  }
  state.reply = reply;
  state.detected = safe.language || 'unknown';
  return state;
}

module.exports = {
  detectTurnLanguage,
  lockReplyLanguage,
  isLoanwordOnly,
  tokenVotes,
};
