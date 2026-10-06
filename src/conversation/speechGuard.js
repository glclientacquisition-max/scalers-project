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
const {
  callerTurnKinds,
  collectsBookingSpeech,
  isMessageOnlyMode,
  messageOnlyCallbackLine,
  shapeMessageOnlySpeech,
} = require('./messageOnly');
const {
  callbackPitchPattern,
  fillerBanPattern,
  fillerBanWhenAskedPattern,
} = require('../speech/languages');
const { isExactPlaceName, normalizePlaceKey } = require('./kenyaPlaces');

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

// Filler phrases live in the language packs. A real answer in the same turn stays.
const CALLER_CALLBACK_ASK =
  /\b(call(?:\s+me)?\s*back|callback|leave (?:me )?a message|take a message|have (?:the team|someone) call)\b/i;
const SPECIFIC_ASK_EXTRA =
  /\b(which service|what service|services? do you (?:offer|do|have)|list (?:for me )?(?:the )?services)\b/i;

// The caller asked for a number. A dropped invented number must be replaced by
// an honest line, not by silence.
const NUMBER_ASK =
  /\b(how much|how many|price|prices|cost|costs|charge|charges|rate|rates|bei|pesa ngapi|ngapi|what time|saa ngapi|when do you (?:open|close)|hours)\b/i;

function callerAskedSpecificQuestion(text) {
  const raw = String(text || '');
  return callerTurnKinds(raw).knowledge || SPECIFIC_ASK_EXTRA.test(raw);
}

function callerAskedForCallback(text) {
  return CALLER_CALLBACK_ASK.test(String(text || ''));
}

const NAME_ASK_SPEECH =
  /\b(?:may i have your name|what(?:'s| is) your name|tell me your name|could i (?:have|get) your name|can i (?:have|get) your name|who am i speaking (?:with|to)|your name,? please|name, please|jina lako|niambie jina|unaitwa nani|sina jina)\b/i;

const REMEMBERED_NAME_ASK =
  /\b(?:do you )?remember my name\b|\bwhat(?:'s| is) my name\b|\bdo you know my name\b/i;

function heldCallerName(state) {
  const confirmed =
    state?.caller?.nameConfirmed === true ? String(state?.caller?.name || '').trim() : '';
  if (confirmed) return confirmed;
  if (state?.caller?.fileNameAskSpoken === true) {
    const pending = String(state?.caller?.fileNameAsked || '').trim();
    if (pending) return pending;
  }
  return String(state?.caller?.name || '').trim();
}

function sentenceAsksForCallerName(sentence) {
  const raw = String(sentence || '').trim();
  if (!raw || /\bam i speaking with\b/i.test(raw)) return false;
  return NAME_ASK_SPEECH.test(raw);
}

function callerAsksRememberedName(text) {
  return REMEMBERED_NAME_ASK.test(String(text || ''));
}

/** The booking line and a name confirm are answers, not filler. */
function isProtectedSpeech(sentence) {
  const raw = String(sentence || '').trim();
  if (!raw) return false;
  if (/^i['’]?ll take a message and have the team call you[.!?]?$/i.test(raw)) return true;
  if (/^nitachukua ujumbe na timu itakupigia[.!?]?$/i.test(raw)) return true;
  if (/\bam i speaking with\b/i.test(raw)) return true;
  return false;
}

/**
 * One sentence of slop. "We can help with that" never answers.
 * "What do you need done" and an unasked callback pitch drop only when they
 * do not answer what the caller just said.
 */
function sentenceIsSpeechSlop(sentence, callerText) {
  const raw = String(sentence || '').trim();
  if (!raw || isProtectedSpeech(raw)) return false;
  if (fillerBanPattern().test(raw)) return true;
  if (callerAskedSpecificQuestion(callerText) && fillerBanWhenAskedPattern().test(raw)) return true;
  if (!callerAskedForCallback(callerText) && callbackPitchPattern().test(raw)) return true;
  return false;
}

/** Drop slop sentences. Keep every other sentence in the turn. */
function dropSpeechSlop(text, callerText) {
  const kept = [];
  for (const sentence of splitSentences(text)) {
    if (sentenceIsSpeechSlop(sentence, callerText)) continue;
    kept.push(sentence);
  }
  return kept.join(' ').trim();
}

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


function filePriceAnswer(profile, callerText) {
  const ask = String(callerText || '').toLowerCase();
  const rows = Array.isArray(profile?.servicesCatalog) ? profile.servicesCatalog : [];
  const hits = [];
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    const price = String(row?.price_range || row?.priceRange || '').trim();
    if (!name || !price || !/\d/.test(price)) continue;
    const generic = new Set(['cleaning', 'service', 'services', 'general']);
    const nameHit = name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length > 3 && !generic.has(word) && ask.includes(word));
    const seatHit = /\b(seats?|kiti|viti)\b/i.test(ask) && /\bper seat\b/i.test(price);
    if (nameHit || seatHit) hits.push({ name, price });
  }
  if (hits.length !== 1) return '';
  return `${hits[0].name} is ${hits[0].price}.`;
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

const ANSWER_LIST_NOUN =
  /\b(carpet|couch|sofa|mattress|airbnb|upholstery|fumigation|plumbing|cleaning|usafi|huduma)\b/gi;

/** A catalogue sentence. The pipeline must not drop it for a side-effect match. */
function isAnswerList(sentence) {
  const raw = String(sentence || '');
  const nouns = [...raw.matchAll(ANSWER_LIST_NOUN)].map((row) => String(row[0] || '').toLowerCase());
  const unique = new Set(nouns);
  if (unique.size >= 2) return true;
  return (raw.match(/,/g) || []).length >= 2 && unique.size >= 1;
}

function sentenceHasExactUnboundPlace(sentence, allowedText) {
  const allowed = new Set();
  for (const word of String(allowedText || '').toLowerCase().split(/[^a-z]+/)) {
    if (isExactPlaceName(word)) allowed.add(normalizePlaceKey(word));
  }
  for (const word of String(sentence || '').toLowerCase().split(/[^a-z]+/)) {
    if (!isExactPlaceName(word)) continue;
    if (!allowed.has(normalizePlaceKey(word))) return true;
  }
  return false;
}

/**
 * True when dropping this whole sentence is a clearly matched pattern
 * (narration, unsourced number, exact place, saved claim). A service list
 * is never a clear drop. A one-edit place guess is not either.
 */
function sentenceGuardDropIsClear(sentence, ctx = {}) {
  const raw = String(sentence || '').trim();
  if (!raw || isAnswerList(raw)) return false;
  const lastCallerTurn = String((ctx.callerTurns || []).slice(-1)[0] || '');
  if (sentenceIsSpeechSlop(raw, lastCallerTurn)) return true;
  if (ACTION_NARRATION.test(raw)) return true;
  const saved = toolSucceededThisTurn(ctx.toolResults);
  if (!saved && (SAVED_CLAIM.test(raw) || JOB_CLOSE.test(raw))) return true;
  const transferOk = Boolean(ctx.capabilities?.liveTransfer || ctx.capabilities?.transfer);
  if (!transferOk && TRANSFER_CLAIM.test(raw)) return true;
  if (messageOnlyOn(ctx) && collectsBookingSpeech(raw)) return true;
  if (heldCallerName(ctx.state) && sentenceAsksForCallerName(raw)) return true;
  const allowedPlaces = [
    (Array.isArray(ctx.callerTurns) ? ctx.callerTurns : []).join(' '),
    safeJson(ctx.profile),
    safeJson(ctx.state?.entities || {}),
    String(ctx.extra || ''),
  ].join(' ');
  if (sentenceHasExactUnboundPlace(raw, allowedPlaces)) return true;
  if (sentenceHasNewNumber(raw, knownNumbers(ctx))) return true;
  if (sentenceHasUnsaidClock(raw, allowedClocks(ctx))) return true;
  const coverage = COVERAGE_CLAIM.exec(raw);
  if (
    coverage &&
    assessCoverage(coverage[1], ctx.profile || {}) !== 'inside' &&
    coverage[0].length / raw.length >= 0.45
  ) {
    return true;
  }
  return false;
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
function messageOnlyOn(ctx) {
  return Boolean(
    ctx.state?.messageOnly ||
      ctx.capabilities?.messageOnly ||
      isMessageOnlyMode(ctx.profile?.afterHoursMode)
  );
}

function withMessageOnlyCallback(out, ctx, appendCallback) {
  if (!appendCallback) return out;
  const line = messageOnlyCallbackLine(ctx.language);
  const body = String(out || '').trim();
  if (!body) return line;
  if (/take a message|nitachukua ujumbe/i.test(body)) return body;
  return `${body} ${line}`;
}

function guardSpokenReply(text, ctx = {}) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const locked = messageOnlyOn(ctx);
  let appendCallback = false;
  if (locked) {
    const callerText = String((ctx.callerTurns || []).slice(-1)[0] || '');
    const shaped = shapeMessageOnlySpeech(raw, {
      callerText,
      nameAlreadyAsked: Boolean(
        ctx.state?.caller?.nameConfirmed ||
          ctx.state?.caller?.fileNameAskSpoken ||
          ctx.state?.caller?.messageNameAskSpoken ||
          ctx.state?.caller?.name
      ),
    });
    raw = shaped.text;
    appendCallback = shaped.appendCallback;
    if (!raw && appendCallback) return messageOnlyCallbackLine(ctx.language);
    if (!raw) return '';
  }
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
  const lastCallerTurn = String((ctx.callerTurns || []).slice(-1)[0] || '');
  const heldName = heldCallerName(ctx.state);
  let droppedNameAsk = false;
  for (const sentence of splitSentences(raw)) {
    if (heldName && sentenceAsksForCallerName(sentence)) {
      droppedNameAsk = true;
      continue;
    }
    if (sentenceIsSpeechSlop(sentence, lastCallerTurn)) continue;
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
  const askedNumber = droppedNumber && NUMBER_ASK.test(lastCallerTurn);
  const priced = askedNumber ? filePriceAnswer(ctx.profile, lastCallerTurn) : '';
  if (out) {
    const lead = priced || (askedNumber ? unknownFallback(ctx.language) : '');
    return withMessageOnlyCallback(lead ? `${lead} ${out}` : out, ctx, appendCallback);
  }
  if (priced) return withMessageOnlyCallback(priced, ctx, appendCallback);
  if (locked && appendCallback) return messageOnlyCallbackLine(ctx.language);
  if (!out && heldName && callerAsksRememberedName(lastCallerTurn)) {
    return `Yes, you are ${heldName}.`;
  }
  if (!out && droppedNameAsk) {
    if (holdOpenSlot && droppedJob) {
      const slotLine = openSlotLine(ctx.state, ctx.language);
      if (slotLine && !sentenceAsksForCallerName(slotLine)) return slotLine;
    }
    return ctx.allowEmpty ? '' : ackFallback(ctx.language);
  }
  if (holdOpenSlot && droppedJob) {
    const slotLine = openSlotLine(ctx.state, ctx.language);
    if (heldName && sentenceAsksForCallerName(slotLine)) {
      return ctx.allowEmpty ? '' : ackFallback(ctx.language);
    }
    return ctx.allowEmpty ? '' : slotLine;
  }
  if (ctx.allowEmpty && !askedNumber) return '';
  if (droppedNumber && NUMBER_ASK.test(lastCallerTurn)) {
    const priced = filePriceAnswer(ctx.profile, lastCallerTurn);
    if (priced) return withMessageOnlyCallback(priced, ctx, appendCallback);
  }
  return droppedNumber ? unknownFallback(ctx.language) : ackFallback(ctx.language);
}

module.exports = {
  SAVED_CLAIM,
  JOB_CLOSE,
  TRANSFER_CLAIM,
  ACTION_NARRATION,
  narratesInternalAction,
  guardSpokenReply,
  dropSpeechSlop,
  sentenceIsSpeechSlop,
  sentenceGuardDropIsClear,
  isAnswerList,
  knownNumbers,
  numbersIn,
  splitSentences,
  toolSucceededThisTurn,
};
