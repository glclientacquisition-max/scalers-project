// VOICE_TIME_ANSWER_ENFORCE (default off): a time or date question always
// gets the current time or date.
//
// HD_60e56c6acc88 (prod Aris, 17 Oct 2026 21:52:29 EAT): "Are you doing— Ni
// saa ngapi, Shai?" got "Tuko closed kwa sasa. Siku za kazi ni Jumatatu hadi
// Ijumaa kuanzia saa tatu na kalahu asubuhi hadi saa kumi na mbili jioni.
// Nawezaje kukusaidia mtandaoni?": opening hours, never the time. #734's
// code-made time line only fires when the guard blocks a time answer; here the
// model never tried, so nothing fired.
//
// With the flag on, on a turn whose caller text is a time or date question
// (trustedFacts.callerClockAsk), when no sentence spoken this turn states the
// correct current time or date (sentenceStatesTrustedFact), the code speaks
// the trusted fact line in the caller's language (timeFactLine/dateFactLine,
// askLanguage: en / sw / sheng). Once per turn; never when the reply already
// said it (the guard's own fact line included).
//
// Unset or off (process.env.VOICE_TIME_ANSWER_ENFORCE) keeps 8ee9b161.

const {
  trustedFactsFor,
  callerClockAsk,
  askLanguage,
  sentenceStatesTrustedFact,
  timeFactLine,
  dateFactLine,
} = require('./trustedFacts');

const ON = /^(1|true|on|yes)$/i;

function timeAnswerEnforceEnabled(env = process.env) {
  return ON.test(String(env.VOICE_TIME_ANSWER_ENFORCE || '').trim());
}

// A range ("from 9 to 6", "kuanzia saa tatu hadi saa kumi na mbili") is an
// hours line, never the current time, even when a number happens to match.
const RANGE_WORDS =
  /\b(from|until|till|to\s+\d|between|open(?:s|ing)?|clos(?:e|es|ing)|hadi|mpaka|kuanzia|tangu|tunafungua|tunafunga|fungua|funga|jumatatu\s+hadi|monday\s+to)\b/i;

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Did the spoken text answer the clock ask with the trusted fact?
 * @param {string} spokenText
 * @param {object} facts trustedFactsFor(...)
 * @param {'time'|'date'} ask
 */
function spokenAnswersClock(spokenText, facts, ask) {
  for (const sentence of splitSentences(spokenText)) {
    if (RANGE_WORDS.test(sentence)) continue;
    const kind = sentenceStatesTrustedFact(sentence, facts, { ask });
    if (kind === ask) return true;
  }
  return false;
}

/**
 * @param {{
 *   callerText: string,
 *   spokenText: string,
 *   state?: object,
 *   profile?: object,
 *   language?: string,
 *   now?: number,
 *   enabled?: boolean,
 * }} opts
 * @returns {{ speak: boolean, line: string, ask: string, language: string, reason: string }}
 */
function planTimeAnswer(opts = {}) {
  const enabled = opts.enabled != null ? Boolean(opts.enabled) : timeAnswerEnforceEnabled();
  const none = (reason, extra = {}) => ({ speak: false, line: '', ask: '', language: '', reason, ...extra });
  if (!enabled) return none('disabled');
  const ask = callerClockAsk(opts.callerText);
  if (!ask) return none('no_clock_ask');
  const state = opts.state && typeof opts.state === 'object' ? opts.state : null;
  const conv = state ? (state.conversation ||= {}) : null;
  const turn = Number(conv?.turnCount || 0);
  if (conv && conv.timeAnswerTurn === turn) return none('already_spoken', { ask });
  const facts = trustedFactsFor({
    state,
    profile: opts.profile || {},
    ...(opts.now != null ? { now: opts.now } : {}),
  });
  if (spokenAnswersClock(opts.spokenText, facts, ask)) return none('answered', { ask });
  const language = askLanguage(opts.callerText, opts.language || 'en');
  const line = ask === 'date' ? dateFactLine(facts, language) : timeFactLine(facts, language);
  if (!line) return none('no_fact', { ask });
  if (conv) conv.timeAnswerTurn = turn;
  return { speak: true, line, ask, language, reason: 'missing_answer' };
}

module.exports = {
  timeAnswerEnforceEnabled,
  spokenAnswersClock,
  planTimeAnswer,
};
