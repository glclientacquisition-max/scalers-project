// Outbound speech contract. Every agent line, local or Gemini, streamed or
// final, passes here. The agent may only speak numbers the caller said, the
// business has on file, or a tool returned. It may only say saved, booked,
// noted, or "the team will call" after a tool succeeded this turn. It may not
// flip coverage or claim a live transfer. Playbooks cannot bypass this.

const { confirmationLanguage } = require('./language');
const { factServices, factProducts, speechFactText } = require('./provenance');
const { entityValue } = require('./entityExtraction');
const { looksLikeOfferAsk } = require('./fileRead');
const { numbersIn } = require('./numberWords');
const { assessCoverage } = require('./visitLocation');
const { canonicalPlaceName } = require('./kenyaPlaces');
const { openSlotLine } = require('./callCorrectives');
const {
  callerTurnKinds,
  isMessageOnlyMode,
  messageOnlyCallbackLine,
  shapeMessageOnlySpeech,
} = require('./messageOnly');

const SAVED_CLAIM =
  /\b(i(?:'ve| have) (?:saved|noted|booked|logged|recorded|sent|passed|forwarded|escalated|scheduled|submitted|placed|reserved|held)\b|(?:is|has been|are) (?:saved|noted|booked|logged|recorded|scheduled|confirmed|reserved|on hold|submitted)\b|(?:the )?team will (?:call|contact|reach|get back)|(?:someone|we|they) will (?:call|contact|reach|get back to) you|nimehifadhi|nimeandika|nimetuma|imehifadhiwa|imeandikwa|tutakupigia|watakupigia|nime-?save)/i;

/** Hold or reserve claims. A saved enquiry does not authorize these. Bare "a hold" does not match. */
const HOLD_PROMISE =
  /\b(i(?:'ve| have|'ll| will) (?:held|reserved|hold)\b|we(?:'ve| have|'ll| will) (?:held|reserved|hold)\b|(?:is|are|been) (?:held|reserved|on hold)\b)/i;

/** Deposit amount or payment number. Spoken only outside a hold until §10.3. */
const HOLD_PAYMENT_LEAK =
  /\bdeposit\b[^.]{0,48}\d|\d[^.]{0,32}\bdeposit\b|\b(till|pay\s*bill|paybill|business number|account number)\b[^.]{0,40}\d|\b(m-?pesa|mpesa)\b[^.]{0,24}\d{3,}/i;

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

// Filler that does not answer the caller. Dropped in the mouth, not by a
// prompt line, so a later prompt cannot speak it. A real answer in the same
// turn stays.
const HELP_FILLER = /\bwe can help with that\b/i;
const ALREADY_ANSWERED_FILLER =
  /\bwhat do you need done\b|\bhow can (?:we|i) help you today\b|\bnote (?:it|that|this) down for the team\b/i;
const CALLBACK_PITCH =
  /\bwould you like me to leave a message\b|\bleave a message for the team\b/i;
const CALLER_CALLBACK_ASK =
  /\b(call(?:\s+me)?\s*back|callback|leave (?:me )?a message|take a message|have (?:the team|someone) call)\b/i;
const SPECIFIC_ASK_EXTRA =
  /\b(which service|what service|services? do you (?:offer|do|have)|list (?:for me )?(?:the )?services)\b/i;

// The caller asked for a number. A dropped invented number must be replaced by
// an honest line, not by silence.
const NUMBER_ASK =
  /\b(how much|how many|price|prices|cost|costs|charge|charges|rate|rates|bei|pesa ngapi|ngapi|what time|saa ngapi|when do you (?:open|close)|hours)\b/i;
const PRICE_ASK =
  /\b(how much|price|prices|cost|costs|charge|charges|rate|rates|bei|gharama|pesa ngapi|pesa gani)\b/i;

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
  if (/\b(?:je,?\s*)?(?:naongea na|unaongea na|niongee na|ni wewe)\b/i.test(raw)) return true;
  return false;
}

function pendingUnboundName(state) {
  if (!state || state.caller?.nameConfirmed === true) return '';
  return String(
    state.caller?.fileNameAsked || state.returning?.fileOwnerName || ''
  ).trim();
}

const UNBOUND_FILE_ROW =
  /\b(?:open (?:requests?|visits?|bookings?|holds?)|(?:you have|una) (?:an |a )?(?:\d+|two|three|several)|previous (?:request|booking|visit)|on (?:your|this) file|on this number|carpet cleaning requests?)\b/i;

function isPackIdentityAsk(sentence, name) {
  const raw = String(sentence || '').trim();
  if (!raw || UNBOUND_FILE_ROW.test(raw)) return false;
  if (/^am i speaking with\b/i.test(raw)) return true;
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^(?:je,?\\s*)?(?:naongea na|unaongea na|unazungumza na|niongee na|ni wewe)\\s+${escaped}\\b`,
    'i'
  ).test(raw);
}

/**
 * Drop vocative file name and file-row claims until nameConfirmed.
 * TODO(Voice speak-gate): consume the same flag before TTS. This is the Brain mouth filter until that PR.
 */
function sentenceLeaksUnboundFile(sentence, state) {
  const name = pendingUnboundName(state);
  if (!name) return false;
  if (isPackIdentityAsk(sentence, name)) return false;
  if (UNBOUND_FILE_ROW.test(sentence)) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^(?:yes|yeah|sawa|eeh|okay|ok)[, ]+${escaped}\\b`, 'i').test(sentence)) {
    return true;
  }
  if (new RegExp(`^${escaped}[,!]`, 'i').test(sentence)) return true;
  return false;
}

function unboundFileFallback(language) {
  const lang = confirmationLanguage(language);
  if (lang === 'sw' || lang === 'sheng') return 'Nahitaji kuthibitisha ninazungumza na nani.';
  return 'I need to confirm who I am speaking with.';
}

/**
 * One sentence of slop. "We can help with that" never answers.
 * "What do you need done" and an unasked callback pitch drop only when they
 * do not answer what the caller just said.
 */
function sentenceIsSpeechSlop(sentence, callerText) {
  const raw = String(sentence || '').trim();
  if (!raw || isProtectedSpeech(raw)) return false;
  if (HELP_FILLER.test(raw)) return true;
  if (callerAskedSpecificQuestion(callerText) && ALREADY_ANSWERED_FILLER.test(raw)) return true;
  if (!callerAskedForCallback(callerText) && CALLBACK_PITCH.test(raw)) return true;
  return false;
}

/** Drop slop sentences. Keep every other sentence in the turn. */
function dropSpeechSlop(text, callerText) {
  const kept = [];
  for (const sentence of splitSentences(text)) {
    if (sentenceIsSpeechSlop(sentence, callerText)) {
      logSpokenFilterDrop('slop', sentence);
      continue;
    }
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

/** Owner-fact text only. Seed prices and payment numbers are not speakable. */
function profileFacts(profile) {
  return speechFactText(profile).replace(/\b\d{1,2}:\d{2}\b/g, ' ');
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

function holdOrOrderSucceeded(toolResults = []) {
  return (Array.isArray(toolResults) ? toolResults : []).some((result) => {
    if (!result || result.action !== 'create_service_request') return false;
    if (result.status !== 'succeeded' && result.status !== 'updated') return false;
    const type = String(result.requestType || result.value?.type || '').toLowerCase();
    return type === 'hold' || type === 'order';
  });
}

/** True when every sentence is the model describing its own send or handoff. */
function narratesInternalAction(text) {
  const sentences = splitSentences(text);
  return sentences.length > 0 && sentences.every((sentence) => ACTION_NARRATION.test(sentence));
}


const PRICE_NAME_SKIP = new Set([
  'cleaning',
  'service',
  'services',
  'general',
  'house',
  'houses',
]);

function pricedRows(profile) {
  const fieldMeta = profile?.fieldMeta || null;
  const rows = [];
  for (const row of factServices(profile?.servicesCatalog, fieldMeta)) {
    const name = String(row?.name || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const price = String(row?.price_range || row?.priceRange || '').trim();
    if (name && price && /\d/.test(price)) rows.push({ name, price });
  }
  for (const row of factProducts(profile?.productCatalog, fieldMeta)) {
    const name = String(row?.name || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const price = String(row?.price || row?.price_range || row?.priceRange || '').trim();
    if (name && price && /\d/.test(price)) rows.push({ name, price });
  }
  return rows;
}

function priceHits(profile, ask) {
  const blob = String(ask || '').toLowerCase();
  if (!blob.trim()) return [];
  const hits = [];
  for (const row of pricedRows(profile)) {
    const nameHit = row.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length > 3 && !PRICE_NAME_SKIP.has(word) && blob.includes(word));
    const seatHit = /\b(seats?|kiti|viti)\b/i.test(blob) && /\bper seat\b/i.test(row.price);
    if (nameHit || seatHit) hits.push(row);
  }
  return hits;
}

function formatFilePrice(hit, language) {
  const lang = confirmationLanguage(language);
  if (lang === 'sw' || lang === 'sheng') return `${hit.name} ni ${hit.price}.`;
  return `${hit.name} is ${hit.price}.`;
}

function filePriceAnswer(profile, callerText, language = 'en') {
  const hits = priceHits(profile, callerText);
  if (hits.length !== 1) return '';
  return formatFilePrice(hits[0], language);
}

/**
 * On-file price for this ask. A bare "how much" / "pesa ngapi" uses the one
 * service already named in an earlier caller turn or in Brain's entity.
 * More than one match stays quiet. Nothing here is invented.
 * @param {{
 *   profile?: object,
 *   text?: string,
 *   callerTurns?: string[],
 *   state?: object,
 *   language?: string,
 * }} [opts]
 * @returns {string}
 */
function groundFilePriceLine(opts = {}) {
  const text = String(opts.text || '').replace(/\s+/g, ' ').trim();
  if (!text || !PRICE_ASK.test(text) || looksLikeOfferAsk(text)) return '';
  const profile = opts.profile || {};
  const language = opts.language || opts.state?.language?.current || 'en';
  const direct = filePriceAnswer(profile, text, language);
  if (direct) return direct;
  const turns = Array.isArray(opts.callerTurns) ? opts.callerTurns : [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = String(turns[i] || '').trim();
    if (!turn || turn.toLowerCase() === text.toLowerCase()) continue;
    const hits = priceHits(profile, turn);
    if (hits.length === 1) return formatFilePrice(hits[0], language);
  }
  const named = [
    entityValue(opts.state?.entities?.service),
    entityValue(opts.state?.entities?.product),
    entityValue(opts.state?.entities?.requestedItem),
  ]
    .filter(Boolean)
    .join(' ');
  const fromEntity = priceHits(profile, named);
  if (fromEntity.length === 1) return formatFilePrice(fromEntity[0], language);
  return '';
}

const NOT_ON_FILE =
  /don't have that on file|sina hiyo kwenye rekodi|siko na hiyo kwenye file/i;

function unknownFallback(language) {
  const lang = confirmationLanguage(language);
  if (lang === 'sw') return 'Sina hiyo kwenye rekodi. Naweza kuandika kwa timu.';
  if (lang === 'sheng') return 'Siko na hiyo kwenye file. Naweza note kwa team.';
  return "I don't have that on file. I can note it for the team.";
}

function ackFallback(language) {
  return confirmationLanguage(language) === 'en' ? 'Okay.' : 'Sawa.';
}

/** One line when a spoken filter removes text, so a silent drop shows up in call logs. */
function logSpokenFilterDrop(reason, dropped) {
  const text = String(dropped || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  console.warn(
    `[speech-filter] drop reason=${reason} chars=${text.length} text=${JSON.stringify(text.slice(0, 180))}`
  );
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
  const holdOk = holdOrOrderSucceeded(ctx.toolResults);
  let droppedHoldPayment = false;
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
  let droppedUnboundFile = false;
  const lastCallerTurn = String((ctx.callerTurns || []).slice(-1)[0] || '');
  const heldName = heldCallerName(ctx.state);
  let droppedNameAsk = false;
  for (const sentence of splitSentences(raw)) {
    if (heldName && sentenceAsksForCallerName(sentence)) {
      droppedNameAsk = true;
      logSpokenFilterDrop('name_ask', sentence);
      continue;
    }
    if (sentenceLeaksUnboundFile(sentence, ctx.state)) {
      droppedUnboundFile = true;
      logSpokenFilterDrop('unbound_file', sentence);
      continue;
    }
    if (sentenceIsSpeechSlop(sentence, lastCallerTurn)) {
      logSpokenFilterDrop('slop', sentence);
      continue;
    }
    if (ACTION_NARRATION.test(sentence)) {
      logSpokenFilterDrop('action_narration', sentence);
      continue;
    }
    if (!holdOk && HOLD_PROMISE.test(sentence)) {
      droppedJob = true;
      logSpokenFilterDrop('hold_promise', sentence);
      continue;
    }
    if (holdOk && HOLD_PAYMENT_LEAK.test(sentence)) {
      droppedHoldPayment = true;
      logSpokenFilterDrop('hold_payment', sentence);
      continue;
    }
    if (!saved && (SAVED_CLAIM.test(sentence) || JOB_CLOSE.test(sentence))) {
      droppedJob = true;
      logSpokenFilterDrop('saved_claim', sentence);
      continue;
    }
    if (!transferOk && TRANSFER_CLAIM.test(sentence)) {
      logSpokenFilterDrop('transfer_claim', sentence);
      continue;
    }
    const coverage = COVERAGE_CLAIM.exec(sentence);
    if (coverage && assessCoverage(coverage[1], ctx.profile || {}) !== 'inside') {
      logSpokenFilterDrop('coverage', sentence);
      continue;
    }
    if (sentenceNamesUnboundPlace(sentence, allowedPlaces)) {
      droppedJob = true;
      logSpokenFilterDrop('unbound_place', sentence);
      continue;
    }
    if (sentenceHasUnsaidClock(sentence, clocks) || sentenceHasNewNumber(sentence, known)) {
      droppedNumber = true;
      logSpokenFilterDrop('unsaid_number', sentence);
      continue;
    }
    kept.push(sentence);
  }
  let out = kept.join(' ').trim();
  if (holdOpenSlot && droppedJob && BARE_CLOSER.test(out)) out = '';
  const askedNumber = NUMBER_ASK.test(lastCallerTurn);
  const priced = askedNumber
    ? groundFilePriceLine({
        profile: ctx.profile,
        text: lastCallerTurn,
        callerTurns: ctx.callerTurns,
        state: ctx.state,
        language: ctx.language,
      })
    : '';
  if (out && priced && (NOT_ON_FILE.test(out) || !/\d/.test(out))) {
    const rest = NOT_ON_FILE.test(out) ? '' : ` ${out}`;
    return withMessageOnlyCallback(`${priced}${rest}`.trim(), ctx, appendCallback);
  }
  if (out) {
    const lead = priced && droppedNumber ? priced : askedNumber && droppedNumber ? unknownFallback(ctx.language) : '';
    return withMessageOnlyCallback(lead ? `${lead} ${out}` : out, ctx, appendCallback);
  }
  if (priced) return withMessageOnlyCallback(priced, ctx, appendCallback);
  if (locked && appendCallback) return messageOnlyCallbackLine(ctx.language);
  if (!out && heldName && callerAsksRememberedName(lastCallerTurn)) {
    return `Yes, you are ${heldName}.`;
  }
  if (!out && droppedUnboundFile) return unboundFileFallback(ctx.language);
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
  if (!out && droppedHoldPayment) return 'The owner will follow up.';
  if (ctx.allowEmpty && !askedNumber) return '';
  if (askedNumber && priced) return withMessageOnlyCallback(priced, ctx, appendCallback);
  return droppedNumber ? unknownFallback(ctx.language) : ackFallback(ctx.language);
}

module.exports = {
  SAVED_CLAIM,
  JOB_CLOSE,
  TRANSFER_CLAIM,
  ACTION_NARRATION,
  narratesInternalAction,
  logSpokenFilterDrop,
  guardSpokenReply,
  groundFilePriceLine,
  dropSpeechSlop,
  sentenceIsSpeechSlop,
  knownNumbers,
  numbersIn,
  splitSentences,
  toolSucceededThisTurn,
};
