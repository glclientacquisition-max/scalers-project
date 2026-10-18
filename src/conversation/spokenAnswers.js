// What the call actually answered, read from the spoken transcript (HD_cd0c01f28b05).
//
// Staging call HD_cd0c01f28b05 saved "Answered: What time is it." with
// resolution=resolved. The caller never heard the time: the speech guard
// dropped "Right now in Kenya, it is 8:00 PM." The note came from Brain's goal
// text (what the caller wanted), not from anything that was spoken.
//
// This module reads only the transcript rows Voice spoke after the guard
// (callTranscript.pushAgent), and lists which caller questions an agent line
// answered. The resolution note and the summary's handled-question fields are
// built from that list.
//
// VOICE_SPOKEN_OUTCOME: on by default. Set it to off to restore the goal-text note.

const { callerClockAsk, sentenceReadsClock } = require('./trustedFacts');
const { looksLikeHoursAsk } = require('./knownFacts');
const { callerTurnKinds } = require('./messageOnly');
const { questionOwnsTurn, personalFileAsk } = require('./questionFirst');

function spokenOutcomeEnabled(env = process.env) {
  const raw = String(env.VOICE_SPOKEN_OUTCOME == null ? 'on' : env.VOICE_SPOKEN_OUTCOME)
    .trim()
    .toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

const PRICE_ASK = /\b(how much|price|prices|cost|costs|charge|charges|rate|rates|bei|gharama|pesa ngapi|pesa gani)\b/i;
const OFFER_ASK =
  /\b(what (?:do you (?:offer|do|sell|have)|services|can you do)|which services|what services|services (?:that |do )?you (?:have|offer)|huduma (?:gani|mnazo|mko))\b/i;
const LOCATION_ASK =
  /\b(where are you|where(?:'re| are) you (?:based|located)|where is (?:the |your )?(?:shop|store|office|studio)|your address|mko wapi|uko wapi)\b/i;

/** The topic of one caller turn, or '' when it asks nothing this module tracks. */
function callerQuestionTopic(text, opts = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (personalFileAsk(raw)) return '';
  const clock = callerClockAsk(raw);
  if (clock) return clock;
  if (looksLikeHoursAsk(raw)) return 'hours';
  // BRAIN_TRUSTED_HOURS (HD_49d726c3dc9b): "Tuesday at what time will you be
  // open?" and its "at what time?" follow-ups are the hours question.
  const trustedHours = require('./trustedHours');
  if (
    trustedHours.trustedHoursEnabled() &&
    trustedHours.hoursAskDay(raw, { previous: opts.previous, now: opts.now, looksLikeHoursAsk })
  ) {
    return 'hours';
  }
  if (PRICE_ASK.test(raw)) return 'price';
  if (OFFER_ASK.test(raw)) return 'services';
  if (LOCATION_ASK.test(raw)) return 'location';
  if (callerTurnKinds(raw).booking) return '';
  return questionOwnsTurn(raw) === 'question' ? 'question' : '';
}

// Agent lines that answer nothing: the name check, a re-ask, a help offer,
// fillers, an acknowledgement, "not on file", a hold line.
const NON_ANSWER = [
  /\bam i speaking with\b|\bnaongea na\b|\bninaongea na\b|\bmay i have your name\b|\bjina lako\b|\bunaitwa nani\b|\bwho am i speaking\b/i,
  /\bsay that again\b|\bcome again\b|\bsikuskia\b|\brudia\b|\bsorry\?\s*$|\bpardon\b/i,
  /\bhow can (?:i|we) help\b|\bnikusaidie\b|\btukusaidie\b|\banything else\b|\bkitu kingine\b/i,
  /^(?:mm+-?hmm+|mm+|okay|ok|sawa|alright|poa|sure|right|one moment|just a second|let me check|naangalia|nipe sekunde|sekunde moja|thank you(?: for [^.?!]{0,40})?)[.!,]?(?:\s+[A-Z][a-z]+[.!]?)?$/i,
  /don'?t have that on file|not on file|don'?t have that detail|sina hiyo|siko na hiyo|sina maelezo|i'?m not sure|sijui/i,
];

// BRAIN_TRUSTED_HOURS: "I'll have the team confirm." (hours_unknown) answers nothing.
const TEAM_CONFIRM = /\bhave the team confirm\b|\btimu ithibitishe\b|\bteam iconfirm\b/i;

function isNonAnswer(line) {
  const raw = String(line || '').trim();
  if (!raw) return true;
  const sentences = raw.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const extra = require('./trustedHours').trustedHoursEnabled() ? [TEAM_CONFIRM] : [];
  return sentences.every((s) => NON_ANSWER.some((re) => re.test(s)) || extra.some((re) => re.test(s)));
}

const DATE_WORD =
  /\b(today|tarehe|leo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili|january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|machi|aprili|mei|juni|julai|agosti|septemba|oktoba|novemba|desemba)\b/i;
const HOURS_WORD = /\b(open|opens|close|closes|closed|hours|fungua|funga|wazi|masaa)\b/i;
const MONEY = /\b(ksh|kes|shillings?|bob|elfu|mia)\b|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/i;

/** True when one spoken agent line answers a question of this topic. */
function lineAnswers(topic, line) {
  if (isNonAnswer(line)) return false;
  const raw = String(line || '');
  switch (topic) {
    case 'time':
      return sentenceReadsClock(raw) && !HOURS_WORD.test(raw);
    case 'date':
      return DATE_WORD.test(raw) && /\d|\b(today|leo)\b/i.test(raw);
    case 'hours':
      return HOURS_WORD.test(raw) || /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(raw);
    case 'price':
      return MONEY.test(raw);
    default:
      return true;
  }
}

const TOPIC_LABEL = {
  time: 'the time',
  date: 'the date',
  hours: 'hours',
  price: 'price',
  services: 'services',
  location: 'location',
};

function clip(text, max = 80) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max - 1).trim()}…` : raw;
}

/**
 * @param {{speaker: string, text: string}[]} turns  spoken transcript rows, in order
 * @returns {{ asked: object[], answered: string[], unanswered: string[] }}
 *   answered and unanswered hold owner labels ("the time", "price", or the question).
 */
function spokenQuestionLedger(turns = []) {
  const rows = (Array.isArray(turns) ? turns : []).filter(
    (row) => row && (row.speaker === 'agent' || row.speaker === 'caller') && String(row.text || '').trim()
  );
  const asked = [];
  const callerSoFar = [];
  rows.forEach((row, index) => {
    if (row.speaker !== 'caller') return;
    const topic = callerQuestionTopic(row.text, { previous: [...callerSoFar] });
    callerSoFar.push(row.text);
    if (!topic) return;
    const label = TOPIC_LABEL[topic] || clip(row.text);
    if (asked.some((q) => q.label === label)) return;
    asked.push({ topic, label, text: clip(row.text, 160), index });
  });
  for (const q of asked) {
    q.answered = rows.slice(q.index + 1).some((row) => row.speaker === 'agent' && lineAnswers(q.topic, row.text));
  }
  return {
    asked,
    answered: asked.filter((q) => q.answered).map((q) => q.label),
    unanswered: asked.filter((q) => !q.answered).map((q) => q.label),
  };
}

/** "Answered: hours. Not answered: the time." from the ledger, or '' when no question. */
function spokenOutcomeNote(ledger) {
  if (!ledger || !ledger.asked.length) return '';
  const parts = [];
  if (ledger.answered.length) parts.push(`Answered: ${ledger.answered.join(', ')}.`);
  if (ledger.unanswered.length) parts.push(`Not answered: ${ledger.unanswered.join(', ')}.`);
  return parts.join(' ');
}

module.exports = {
  spokenOutcomeEnabled,
  callerQuestionTopic,
  lineAnswers,
  isNonAnswer,
  spokenQuestionLedger,
  spokenOutcomeNote,
};
