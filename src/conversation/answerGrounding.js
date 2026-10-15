'use strict';

// VOICE_NO_ANSWER_DELETE (default off). A post-filter may not delete a grounded
// answer because of how the caller worded the question. A spoken service list is
// allowed whenever every service it names is in the tenant catalogue, for any
// caller phrasing ("Mnafanya nini", "mnasafisha nini", "what exactly... which").
// Filters still step in for ungrounded facts (invented service, wrong price,
// unbound place); their replacement follows the reply's own language.

function noAnswerDeleteEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_NO_ANSWER_DELETE || '').trim());
}

// Spoken job word -> catalogue stems it may stand for (EN + SW + Sheng).
const JOB_WORDS = [
  [/\b(sofas?|couch(?:es)?|kochi|viti)\b/gi, ['sofa', 'couch', 'upholster', 'seat']],
  [/\b(carpets?|rugs?|zulia|mazulia|kapeti?|kapet)\b/gi, ['carpet', 'rug']],
  [/\b(mattress(?:es)?|matress|godoro|magodoro)\b/gi, ['mattress']],
  [/\b(windows?|madirisha|dirisha)\b/gi, ['window']],
  [/\b(house|home|nyumba|houses)\b/gi, ['house', 'home', 'residential', 'move', 'deep']],
  [/\b(offices?|ofisi)\b/gi, ['office', 'commercial']],
  [/\b(move-?in|move-?out|kuhamia|kuhama)\b/gi, ['move']],
  [/\b(deep clean(?:ing)?)\b/gi, ['deep']],
  [/\b(airbnb)\b/gi, ['airbnb', 'short']],
  [/\b(upholstery)\b/gi, ['upholster', 'sofa']],
  [/\b(fumigation|fumigate|pest)\b/gi, ['fumigat', 'pest']],
  [/\b(plumbing|plumber|fundi wa maji)\b/gi, ['plumb']],
  [/\b(laundry|nguo|dobi)\b/gi, ['laundry', 'cloth']],
  [/\b(car wash|magari|gari)\b/gi, ['car']],
];

function catalogueNames(profile = {}, state = null) {
  const rows = Array.isArray(profile?.servicesCatalog) ? profile.servicesCatalog : [];
  const names = rows.map((r) => String((r && (r.name || r.title)) || r || '').trim()).filter(Boolean);
  if (names.length) return names;
  return Array.isArray(state?.catalogueItems) ? state.catalogueItems.map(String) : [];
}

/** Job words the text names: [{ word, stems }]. */
function spokenJobs(text) {
  const out = [];
  for (const [re, stems] of JOB_WORDS) {
    for (const m of String(text || '').matchAll(re)) out.push({ word: m[0].toLowerCase(), stems });
  }
  return out;
}

/**
 * { grounded, jobs, ungrounded[] }. Grounded = names >= 2 services and every one
 * maps to a catalogue row. One invented service makes it ungrounded.
 */
function serviceListGrounding(text, { profile, state } = {}) {
  const names = catalogueNames(profile, state).map((n) => n.toLowerCase());
  const lower = String(text || '').toLowerCase();
  // Exact catalogue names ("Tuna Apartment na House Cleaning, Deep Cleaning, ...")
  // are grounded by definition; strip them before looking for other job words.
  let rest = lower;
  let direct = 0;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const core = n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (core && rest.includes(core)) { direct += 1; rest = rest.split(core).join(' '); }
  }
  const jobs = [...Array(direct).fill({ word: '(catalogue)', stems: [''] }), ...spokenJobs(rest)];
  if (!names.length || jobs.length < 2) return { grounded: false, jobs: jobs.length, ungrounded: [] };
  const ungrounded = jobs.filter((j) => !names.some((n) => j.stems.some((s) => n.includes(s)))).map((j) => j.word);
  return { grounded: ungrounded.length === 0, jobs: jobs.length, ungrounded };
}

const SW_WORDS =
  /\b(sawa|tuna|tunasafisha|tunafanya|tuje|wapi|kesho|leo|saa|ni|na|kwa|ya|wa|za|unahitaji|ungependa|huduma|usafi|eneo|gani|asante|karibu|pia|kama|hizi|ipi|nyumba|godoro|madirisha|ofisi)\b/gi;

/** Reply language lock: the reply's own words win over the caller turn's detection. */
function replyLanguage(text, fallback = 'en') {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  const sw = (String(text || '').match(SW_WORDS) || []).length;
  if (words && sw >= 2 && sw / words >= 0.25) return 'sw';
  if (words >= 3 && sw === 0) return 'en';
  return fallback;
}

/**
 * Turn-scoped mouth memory (context, not wording): what this turn already said and
 * whether a list was deleted, so a later streamed chunk cannot repeat a sentence
 * ("Unahitaji gani?" twice, HD_923e63f8a72b T7) or point at a list the caller
 * never heard ("kati ya hizo", HD_923e63f8a72b).
 */
function turnMemory(state, callerTurns) {
  const conv = state && state.conversation;
  if (!conv || typeof conv !== 'object') return null;
  const turns = Array.isArray(callerTurns) ? callerTurns : conv.answersReceived || [];
  const key = `${turns.length}|${String(turns[turns.length - 1] || '')}`;
  if (!conv.__mouthTurn || conv.__mouthTurn.key !== key) {
    Object.defineProperty(conv, '__mouthTurn', { value: { key, sentences: [], listDeleted: false }, writable: true, enumerable: false, configurable: true });
  }
  return conv.__mouthTurn;
}
const DANGLING_REF = /\b(kati ya (?:hizo|hizi)|ipi kati|of (?:those|these)|from (?:those|these)|which of them)\b/i;
const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();

/** Drop repeats within the turn and dangling list references after a deleted list. */
function applyTurnContext(text, mem, splitSentences) {
  if (!mem) return String(text || '');
  const kept = [];
  for (const sentence of splitSentences(String(text || ''))) {
    const k = norm(sentence);
    if (!k) continue;
    if (mem.sentences.includes(k)) continue;
    if (mem.listDeleted && DANGLING_REF.test(sentence)) continue;
    kept.push(sentence);
    mem.sentences.push(k);
  }
  return kept.join(' ').trim();
}

module.exports = { turnMemory, applyTurnContext, noAnswerDeleteEnabled, serviceListGrounding, replyLanguage, spokenJobs, catalogueNames };
