const { isNameAffirmation, isPlausibleCallerName } = require('./entityExtraction');
const { namesLikelySame } = require('./callerNameMatch');

// Message only is a lock, not a suggestion.
// tenants.after_hours_mode === 'message' may ask for a name, take a message,
// and save a callback. Booking, cancel, and visit reads stay off.
// 'serve' is unchanged.

function isMessageOnlyMode(mode) {
  return String(mode || '').trim().toLowerCase() === 'message';
}

function applyMessageOnlyCapabilities(capabilities = {}, mode) {
  if (!isMessageOnlyMode(mode)) return capabilities;
  return {
    ...capabilities,
    messageOnly: true,
    createAppointment: false,
    updateAppointment: false,
  };
}

/** Drop visit rows so a message-only prompt cannot read them aloud. */
function callerCardWithoutVisits(card) {
  if (!card || typeof card !== 'object') return card;
  return {
    ...card,
    openVisits: [],
    nextVisit: null,
    nextAppointment: null,
    nextVisitService: null,
    nextVisitWhen: null,
    nextVisitStatus: null,
    nextVisitLandmark: null,
    recentBookings: [],
  };
}

function messageOnlyNoVisitLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') {
    return 'Naweza kuchukua ujumbe. Siwezi kusoma ziara.';
  }
  return "I can take a message. I can't read a visit from here.";
}

function messageOnlyCallbackLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return 'Nitachukua ujumbe na timu itakupigia.';
  return "I'll take a message and have the team call you.";
}

const OFFER_ASK_RE =
  /\b(what (?:do you (?:offer|do|sell|have)|services|can you do)|which services|what services|services (?:that |do )?you (?:have|offer)|tell me the services|uniambie (?:the )?services|huduma (?:gani|mnazo|mko))\b/i;
const HOURS_ASK_RE =
  /\b(are you open|you open now|opening hours|your hours|what are your hours|what time do you (?:open|close)|when do you (?:open|close)|mko wazi|mnafungua|mnafunga|saa ngapi mna(?:fungua|funga))\b/i;
const PRICE_ASK_RE =
  /\b(how much|how many|price|prices|cost|costs|charge|charges|rate|rates|bei|pesa ngapi)\b/i;
const SHOP_LOCATION_ASK_RE =
  /\b(where are you|where(?:'re| are) you (?:based|located)|where is (?:the |your )?(?:shop|store|office|studio)|your address|shop address|mko wapi|uko wapi)\b/i;
const CALLER_BOOK_RE =
  /\b(book(?:ing)?|schedule|appointment|reschedul|cancel|come (?:over|by|tomorrow|today)|can you come|could you come|when can you come|reserve|kuja|nataka (?:cleaning|kuweka|booking)|naomba (?:booking|kuja|cleaning))\b/i;

const BOOKING_COLLECT_RE =
  /\b(which (?:service|one|job) (?:would you like|do you want|should (?:i|we))|what would you like to book|would you like to book|do you want (?:me )?to book|shall i book|when (?:should|can|shall|would) (?:we|i) come|where should we|what time (?:works|should|would|tomorrow|that day)|what day (?:works|should|would)|morning or afternoon|which area|where (?:can|should) (?:we|i) (?:come|meet)|which service do you need|which one do you need|niambie siku|siku gani|saa ngapi tuje|tuje wapi|huduma gani)\b/i;
const VISIT_TAKE_RE =
  /\b(i(?:'ll| will) (?:book|schedule|come)|let me book|book you|we(?:'ll| will) (?:come|be there)|see you (?:then|tomorrow)|tomorrow at\b|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) at \d|for tomorrow\b)\b/i;

function isNameAsk(sentence) {
  return /\b(your name|jina lako|may i have your name|what(?:'s| is) your name|who am i speaking (?:with|to))\b/i.test(
    sentence
  );
}

function isShopFact(sentence) {
  if (BOOKING_COLLECT_RE.test(sentence)) return false;
  if (
    /\b(we(?:'re| are) (?:in|at|based|located)|our (?:shop|store|office|address) (?:is|in)|find us|you(?:'ll| will) find us)\b/i.test(
      sentence
    ) &&
    !/\?/.test(sentence)
  ) {
    return true;
  }
  if (
    /\b(open|closed|hours|until|wazi|fungwa|fungua|funga)\b/i.test(sentence) &&
    !VISIT_TAKE_RE.test(sentence)
  ) {
    return true;
  }
  if (
    /\b(we (?:offer|do|clean)|costs?|shillings|\bkes\b|price is|bei ni)\b/i.test(sentence) &&
    !/\?/.test(sentence)
  ) {
    return true;
  }
  return false;
}

function collectsBookingSpeech(sentence) {
  const raw = String(sentence || '').trim();
  if (!raw || isNameAsk(raw)) return false;
  if (isShopFact(raw)) return false;
  if (BOOKING_COLLECT_RE.test(raw) || VISIT_TAKE_RE.test(raw)) return true;
  if (
    /\?\s*$/.test(raw) &&
    /\b(where|when|what time|what day|which service|which one)\b/i.test(raw) &&
    !/\b(open|close|hours|cost|price|charge|bei)\b/i.test(raw)
  ) {
    return true;
  }
  return false;
}

function callerTurnKinds(text) {
  const raw = String(text || '');
  return {
    knowledge:
      OFFER_ASK_RE.test(raw) ||
      HOURS_ASK_RE.test(raw) ||
      PRICE_ASK_RE.test(raw) ||
      SHOP_LOCATION_ASK_RE.test(raw),
    booking: CALLER_BOOK_RE.test(raw),
  };
}

/**
 * Drop booking collection. Keep a name ask and a file answer.
 * A booking ask, with no fact question, becomes only the callback line.
 * @returns {{ text: string, appendCallback: boolean }}
 */
function shapeMessageOnlySpeech(text, { callerText = '', nameAlreadyAsked = false } = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const { knowledge, booking } = callerTurnKinds(callerText);
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = [];
  let dropped = false;
  for (const sentence of sentences) {
    if (isNameAsk(sentence)) {
      if (nameAlreadyAsked) {
        dropped = true;
        continue;
      }
      kept.push(sentence);
      continue;
    }
    if (booking && !knowledge) {
      dropped = true;
      continue;
    }
    if (collectsBookingSpeech(sentence)) {
      dropped = true;
      continue;
    }
    kept.push(sentence);
  }
  const body = kept.join(' ').trim();
  return { text: body, appendCallback: booking || (dropped && !body) };
}



function looksLikeCompliment(text) {
  return /\b(?:i'?m|i am)\s+(?:so\s+|very\s+|really\s+|quite\s+|just\s+)?(?:impressed|happy|glad|pleased|grateful|thankful|amazed|delighted)\b/i.test(
    String(text || '')
  );
}

const IM_NAME_STOP =
  /^(and|na|calling|looking|speaking|here|from|in|at|to|for|who|that|by|your|with|about|of|work)$/i;

function earlierExplicitName(raw) {
  if (
    /(?:\bmy name is\b|\bi am called\b|\bi'm called\b|\bthis is\b|\bnaitwa\b|\bninaitwa\b|\bjina langu ni\b|\bjina ni\b)\s+[\p{L}'’\-]/iu.test(
      raw
    )
  ) {
    return true;
  }
  if (/\b[\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,2}\s+is(?:\s+(?:the|my))?\s+name\b/iu.test(raw)) {
    return true;
  }
  return false;
}

function imIntroductionName(text) {
  const raw = String(text || '');
  if (!raw || looksLikeCompliment(raw) || earlierExplicitName(raw)) return null;
  const im =
    /\b(?:i'?m|i am)\s+([\p{L}'’\-]+)(?:\s+([\p{L}'’\-]+))?(?:\s+([\p{L}'’\-]+))?/iu.exec(
      raw
    );
  if (!im) return null;
  const collected = [];
  for (const word of [im[1], im[2], im[3]].filter(Boolean)) {
    if (IM_NAME_STOP.test(word)) break;
    collected.push(word);
  }
  return collected.join(' ') || null;
}

function messageNamePlausible(name) {
  const value = String(name || '').trim();
  if (!isPlausibleCallerName(value)) return false;
  if (/\b(?:impressed|amazed|delighted|grateful|thankful|pleased|glad)\b/i.test(value)) {
    return false;
  }
  return true;
}

function messageFileOwnerName(profile, returning) {
  if (returning?.sharedLine || profile?.callerMemory?.sharedLine) return '';
  const card = profile?.callerMemory || {};
  return String(
    card.fileOwnerName || card.name || returning?.fileOwnerName || ''
  ).trim();
}

function sameMessagePerson(a, b) {
  return Boolean(a && b && namesLikelySame(a, b));
}

function messageNameEntity(name, source, confirmed) {
  if (!name) return null;
  return {
    value: name,
    source: source || 'caller_explicit',
    confidence: confirmed ? 0.95 : 0.9,
    confirmed: Boolean(confirmed),
  };
}

/**
 * Message-only name lock. Serve is not this function.
 * The opener already asked. Yes binds only the file name that ask named.
 * An "I'm …" span is stored only when it is plausible, and confirmed only
 * when it is the file name. A compliment is not a name.
 */
function reconcileMessageOnlyName({
  previousCaller = {},
  text = '',
  resolution = {},
  profile = {},
  returning = null,
} = {}) {
  const owner = messageFileOwnerName(profile, returning);
  const prevAsked = String(previousCaller.fileNameAsked || '').trim();
  const fileAskSpoken = previousCaller.fileNameAskSpoken === true;
  const bareAskSpoken = previousCaller.messageNameAskSpoken === true;
  const pendingFile = prevAsked || (fileAskSpoken ? owner : '');
  const compliment = looksLikeCompliment(text);
  const im = imIntroductionName(text);
  const explicit = earlierExplicitName(text);
  const resolvedName = messageNamePlausible(resolution.name) ? String(resolution.name).trim() : '';
  const prevName = messageNamePlausible(previousCaller.name)
    ? String(previousCaller.name).trim()
    : '';
  const prevConfirmed = previousCaller.nameConfirmed === true;

  function pack(name, confirmed, source, fileAsked) {
    const locked = Boolean(confirmed && name);
    const asked = locked ? null : fileAsked || (owner && !locked ? owner : null);
    return {
      name: name || null,
      nameConfirmed: locked,
      fileNameAsked: asked || null,
      // Do not mark the ask spoken just because the file has a name.
      // That flag is only for a line the caller could have heard.
      fileNameAskSpoken: fileAskSpoken === true,
      messageNameAskSpoken: Boolean(bareAskSpoken || (!owner && !asked)),
      entitiesName: messageNameEntity(name, source, locked),
    };
  }

  if (prevConfirmed && prevName && !explicit) {
    return pack(prevName, true, 'caller_explicit', null);
  }

  if (compliment || (im && !messageNamePlausible(im))) {
    return pack(prevName || null, prevConfirmed && Boolean(prevName), 'caller_explicit', pendingFile || owner);
  }

  if (!prevConfirmed && isNameAffirmation(text) && !explicit && !im) {
    if (fileAskSpoken && pendingFile && messageNamePlausible(pendingFile)) {
      const locked = owner && sameMessagePerson(pendingFile, owner) ? owner : pendingFile;
      return pack(locked, true, 'caller_file', null);
    }
    return pack(prevName || null, false, 'caller_explicit', pendingFile || owner);
  }

  if (im && !explicit) {
    if (owner && sameMessagePerson(im, owner)) {
      return pack(owner, true, 'caller_file', null);
    }
    if (owner) return pack(null, false, '', owner);
    if (messageNamePlausible(im)) return pack(im, false, 'caller_im', null);
    return pack(null, false, '', null);
  }

  if (explicit && resolvedName) {
    if (owner && sameMessagePerson(resolvedName, owner)) {
      return pack(owner, true, 'caller_file', null);
    }
    return pack(resolvedName, true, 'caller_explicit', null);
  }

  if (resolution.entities?.name?.source === 'caller_spelled' && resolvedName) {
    return pack(resolvedName, true, 'caller_spelled', null);
  }

  if (!prevConfirmed && prevName && String(text || '').trim() && !isNameAffirmation(text)) {
    return pack(prevName, true, 'caller_explicit', null);
  }

  if (resolvedName && !owner) {
    return pack(resolvedName, false, resolution.entities?.name?.source || 'caller_explicit', null);
  }

  return pack(null, false, '', pendingFile || owner);
}

function heldMessageCallerName(caller = {}) {
  if (caller.nameConfirmed && messageNamePlausible(caller.name)) return String(caller.name).trim();
  if (caller.fileNameAskSpoken === true && messageNamePlausible(caller.fileNameAsked)) {
    return String(caller.fileNameAsked).trim();
  }
  if (messageNamePlausible(caller.name)) return String(caller.name).trim();
  return '';
}

function messageNameAlreadyAsked(caller = {}) {
  return Boolean(
    caller.nameConfirmed ||
      caller.fileNameAskSpoken ||
      caller.messageNameAskSpoken ||
      messageNamePlausible(caller.name) ||
      messageNamePlausible(caller.fileNameAsked)
  );
}

const STORED_CLOCK_RE =
  /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\bo['’]?clock\b|\bsaa\s+\S+/gi;

const DAY_ONLY_RE =
  /^(?:tomorrow|today|tonight|kesho|leo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?$/i;

/** A callback may keep the message. It must not keep a clock. */
function callbackNotesWithoutClock(notes, whenText, item) {
  const primary = String(notes || '').trim();
  const fallback =
    !primary && !String(item || '').trim() ? String(whenText || '').trim() : '';
  const body = String(primary || fallback)
    .replace(STORED_CLOCK_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
  if (!body || DAY_ONLY_RE.test(body)) return '';
  return body;
}

module.exports = {
  isMessageOnlyMode,
  applyMessageOnlyCapabilities,
  callerCardWithoutVisits,
  messageOnlyNoVisitLine,
  messageOnlyCallbackLine,
  callerTurnKinds,
  collectsBookingSpeech,
  shapeMessageOnlySpeech,
  callbackNotesWithoutClock,
  looksLikeCompliment,
  messageNamePlausible,
  messageFileOwnerName,
  reconcileMessageOnlyName,
  heldMessageCallerName,
  messageNameAlreadyAsked,
};
