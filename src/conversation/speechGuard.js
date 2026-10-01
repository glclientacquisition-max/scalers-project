// Outbound speech contract. Every agent line, local or Gemini, streamed or
// final, passes here. The agent may only speak numbers the caller said, the
// business has on file, or a tool returned. It may only say saved, booked,
// noted, or "the team will call" after a tool succeeded this turn. It may not
// flip coverage or claim a live transfer. Playbooks cannot bypass this.

const { confirmationLanguage } = require('./language');
const { numbersIn } = require('./numberWords');
const { assessCoverage } = require('./visitLocation');
const { canonicalPlaceName } = require('./kenyaPlaces');
const { openSlotLine } = require('./callCorrectives');

const SAVED_CLAIM =
  /\b(i(?:'ve| have) (?:saved|noted|booked|logged|recorded|sent|passed|forwarded|escalated|scheduled|submitted|placed|reserved|held)\b|(?:is|has been|are) (?:saved|noted|booked|logged|recorded|scheduled|confirmed|reserved|on hold|submitted)\b|(?:the )?team will (?:call|contact|reach|get back)|(?:someone|we|they) will (?:call|contact|reach|get back to) you|nimehifadhi|nimeandika|nimetuma|imehifadhiwa|imeandikwa|tutakupigia|watakupigia|nime-?save)/i;

// Job is finished. Same rule as a saved claim: only after a tool succeeded.
const JOB_CLOSE =
  /\b(all set|all done|taken care of|(?:you(?:'re| are)|we(?:'re| are)|that(?:'s| is)|it(?:'s| is)) (?:all )?(?:set|sorted)|see you (?:then|tomorrow|there)|we(?:'ll| will) be there|(?:we(?:'re| are)|i(?:'m| am)) (?:coming|on our way))\b/i;

const BARE_CLOSER =
  /^(?:how else can i help(?: you)?(?: today)?|anything else(?: i can (?:help|do)(?: for you)?)?|have a (?:great|good) day|thank you for calling\b.*|goodbye)[.!?]?$/i;

const TRANSFER_CLAIM =
  /\b(stay on the line|hold the line|(?:i(?:'m| am|'ll| will) )?(?:transferring|connecting|putting) you (?:now|through|to)|i(?:'ve| have) transferred you|let me (?:transfer|connect) you|escalat(?:e|ing|ed)|nakuunganisha|nakuhamisha)\b/i;

// The model narrating its own send. Dropped even after the tool succeeds.
// The backend speaks one callback line. It does not describe the send.
const ACTION_NARRATION =
  /\b(?:i(?:\s*['’]?ve|\s+have|\s+just|\s+also)?\s+sent\b|(?:i(?:'ll| will)|(?:i'm|i am) going to)\s+(?:try to\s+)?send\b|sent (?:that|this|it|your name|your request|your message)\b|(?:passed|forwarded|escalated|notified|relayed) (?:that|this|it|your|them|him|her)\b|along with your request\b|already sent\b|note (?:that |this |it )?for (?:him|her|them)\b|nimeituma|nimetuma|nime-?tuma|tayari (?:lili)?tumwa)\b/i;

const COVERAGE_CLAIM =
  /\b(?:[Ww]e|[Tt]una|[Tt]unaweza|[Tt]uta)(?:\s+\w+){0,2}?\s+(?:cover|serve|reach|come(?:\s+out)?\s+to|kuja|kufika)\s+(?:to\s+)?([A-Z][\w'’]*(?:\s+[A-Z][\w'’]*){0,2})/;

// The caller asked for a number. A dropped invented number must be replaced by
// an honest line, not by silence.
const NUMBER_ASK =
  /\b(how much|how many|price|prices|cost|costs|charge|charges|rate|rates|bei|pesa ngapi|ngapi|what time|saa ngapi|when do you (?:open|close)|hours)\b/i;

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '';
  }
}

/** Profile hours are HH:MM. They do not authorize a spoken visit clock. */
function profileFacts(profile) {
  return safeJson(profile).replace(/\b\d{1,2}:\d{2}\b/g, ' ');
}

/** Numbers the agent may say: caller turns, business facts on file, tool results. */
function knownNumbers({ callerTurns = [], profile = {}, toolResults = [], extra = '' } = {}) {
  const known = numbersIn(
    [
      (Array.isArray(callerTurns) ? callerTurns : []).join(' '),
      profileFacts(profile),
      safeJson(toolResults),
      String(extra || ''),
    ].join(' ')
  );
  return known;
}

function clockKey(hourRaw, minuteRaw, apRaw) {
  const hour = String(Number(hourRaw));
  const minute = minuteRaw == null || minuteRaw === '' ? '' : String(Number(minuteRaw)).padStart(2, '0');
  const ap = String(apRaw || '').replace(/\./g, '').toLowerCase();
  if (!minute || minute === '00') return `${hour}${ap}`;
  return `${hour}:${minute}${ap}`;
}

/** AM/PM clocks in a text. "8 AM" and "8:00 AM" share one key. */
function clockKeys(text) {
  const keys = new Set();
  const raw = String(text || '');
  for (const hit of raw.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)) {
    keys.add(clockKey(hit[1], hit[2], hit[3]));
  }
  return keys;
}

function allowedClocks({ callerTurns = [], toolResults = [], extra = '' } = {}) {
  return clockKeys(
    [
      (Array.isArray(callerTurns) ? callerTurns : []).join(' '),
      safeJson(toolResults),
      String(extra || ''),
    ].join(' ')
  );
}

function sentenceHasUnsaidClock(sentence, allowed) {
  for (const key of clockKeys(sentence)) {
    if (!allowed.has(key)) return true;
  }
  return false;
}

function sentenceHasNewNumber(sentence, known) {
  for (const number of numbersIn(sentence)) {
    if (!known.has(number)) return true;
  }
  return false;
}

function toolSucceededThisTurn(toolResults = []) {
  return (Array.isArray(toolResults) ? toolResults : []).some(
    (result) =>
      result &&
      (result.status === 'succeeded' || result.status === 'updated' || result.status === 'duplicate')
  );
}

/** True when every sentence is the model describing its own send or handoff. */
function narratesInternalAction(text) {
  const sentences = splitSentences(text);
  return sentences.length > 0 && sentences.every((sentence) => ACTION_NARRATION.test(sentence));
}

function unknownFallback(language) {
  const lang = confirmationLanguage(language);
  if (lang === 'sw') return 'Sina hiyo kwenye rekodi. Naweza kuandika kwa timu.';
  if (lang === 'sheng') return 'Siko na hiyo kwenye file. Naweza note kwa team.';
  return "I don't have that on file. I can note it for the team.";
}

function ackFallback(language) {
  return confirmationLanguage(language) === 'en' ? 'Okay.' : 'Sawa.';
}

function placeNamesIn(text) {
  const found = new Set();
  for (const word of String(text || '').toLowerCase().split(/[^a-z]+/)) {
    const name = canonicalPlaceName(word);
    if (name) found.add(name);
  }
  return found;
}

/** A locality the slot, the caller, and the file do not hold. */
function sentenceNamesUnboundPlace(sentence, allowedText) {
  const allowed = placeNamesIn(allowedText);
  for (const name of placeNamesIn(sentence)) {
    if (!allowed.has(name)) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {object} ctx
 * @param {string[]} [ctx.callerTurns]
 * @param {object} [ctx.profile]
 * @param {object[]} [ctx.toolResults]  results from this turn; empty while streaming
 * @param {object} [ctx.capabilities]
 * @param {string} [ctx.language]
 * @param {boolean} [ctx.allowEmpty]  return '' instead of a fallback line
 */
function guardSpokenReply(text, ctx = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const known = knownNumbers(ctx);
  const clocks = allowedClocks(ctx);
  const saved = toolSucceededThisTurn(ctx.toolResults);
  const transferOk = Boolean(ctx.capabilities?.liveTransfer || ctx.capabilities?.transfer);
  const missing = Array.isArray(ctx.state?.goal?.missingSlots) ? ctx.state.goal.missingSlots : [];
  const holdOpenSlot = !saved && missing.length > 0;
  const allowedPlaces = [
    (Array.isArray(ctx.callerTurns) ? ctx.callerTurns : []).join(' '),
    safeJson(ctx.profile),
    safeJson(ctx.state?.entities || {}),
    String(ctx.extra || ''),
  ].join(' ');
  const kept = [];
  let droppedNumber = false;
  let droppedJob = false;
  for (const sentence of splitSentences(raw)) {
    if (ACTION_NARRATION.test(sentence)) continue;
    if (!saved && (SAVED_CLAIM.test(sentence) || JOB_CLOSE.test(sentence))) {
      droppedJob = true;
      continue;
    }
    if (!transferOk && TRANSFER_CLAIM.test(sentence)) continue;
    const coverage = COVERAGE_CLAIM.exec(sentence);
    if (coverage && assessCoverage(coverage[1], ctx.profile || {}) !== 'inside') continue;
    if (sentenceNamesUnboundPlace(sentence, allowedPlaces)) {
      droppedJob = true;
      continue;
    }
    if (sentenceHasUnsaidClock(sentence, clocks) || sentenceHasNewNumber(sentence, known)) {
      droppedNumber = true;
      continue;
    }
    kept.push(sentence);
  }
  let out = kept.join(' ').trim();
  if (holdOpenSlot && droppedJob && BARE_CLOSER.test(out)) out = '';
  const lastCallerTurn = String((ctx.callerTurns || []).slice(-1)[0] || '');
  const askedNumber = droppedNumber && NUMBER_ASK.test(lastCallerTurn);
  if (out) return askedNumber ? `${unknownFallback(ctx.language)} ${out}` : out;
  if (holdOpenSlot && droppedJob) {
    return ctx.allowEmpty ? '' : openSlotLine(ctx.state, ctx.language);
  }
  if (ctx.allowEmpty && !askedNumber) return '';
  return droppedNumber ? unknownFallback(ctx.language) : ackFallback(ctx.language);
}

module.exports = {
  SAVED_CLAIM,
  JOB_CLOSE,
  TRANSFER_CLAIM,
  ACTION_NARRATION,
  narratesInternalAction,
  guardSpokenReply,
  knownNumbers,
  numbersIn,
  splitSentences,
  toolSucceededThisTurn,
};
