// A saved request needs real caller content. HD_23445a4f780c saved a callback
// whose note was the agent's own offer ("Should I note it for the team?") and
// then spoke "Okay, I've saved your request." The offer line, closers, acks and
// filler are not a request.

const { offerActOf } = require('../speech/offerAct');
const { isBackchannelOrFragment } = require('./entityExtraction');
const { looksLikeNonConsentAck } = require('./callCorrectives');

const AGENT_CLOSER =
  /^(?:is there anything else(?: i can help (?:you )?with)?(?: today)?|anything else|how can i help(?: you)?(?: today)?|how may i help(?: you)?|kuna kitu kingine|naweza kukusaidia(?: na nini)?(?: tena)?|visit time to confirm)\s*[?.!]*$/i;

const GENERIC_ITEMS = new Set(['', 'message', 'callback', 'call back', 'request', 'note', 'enquiry', 'inquiry', 'other', 'ujumbe']);

function clean(value, max = 400) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function sentences(text) {
  return clean(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One sentence that carries no caller content. */
function fillerSentence(sentence) {
  const s = clean(sentence);
  if (!s) return true;
  if (offerActOf(s)) return true;
  if (AGENT_CLOSER.test(s)) return true;
  const bare = s.replace(/[?.!,]+$/g, '').trim();
  if (!bare) return true;
  if (isBackchannelOrFragment(bare) || looksLikeNonConsentAck(bare)) return true;
  return false;
}

/** The note with agent offers, closers and acks removed. '' when nothing is left. */
function substantiveNote(text) {
  return sentences(text)
    .filter((s) => !fillerSentence(s))
    .join(' ')
    .trim();
}

/** True when a request payload has no real content to act on. */
function isEmptyRequestContent({ item = '', notes = '' } = {}) {
  const it = clean(item, 200).toLowerCase();
  if (!GENERIC_ITEMS.has(it) && !fillerSentence(it)) return false;
  return !substantiveNote(notes);
}

/**
 * The caller's own words behind a yes to a note offer: the latest substantive
 * caller turn before the ack, from the last few turns. '' when there is none.
 */
function offerNoteFromCallerTurns(turns = [], askLine = '') {
  const rows = (Array.isArray(turns) ? turns : []).map((t) => clean(t)).filter(Boolean);
  const ask = clean(askLine).toLowerCase();
  // Last turn is the ack itself; look back at most three turns before it.
  for (const turn of rows.slice(-4).reverse()) {
    if (ask && turn.toLowerCase() === ask) continue;
    const body = substantiveNote(turn);
    if (body) return body;
  }
  return '';
}

module.exports = {
  fillerSentence,
  isEmptyRequestContent,
  offerNoteFromCallerTurns,
  substantiveNote,
};
