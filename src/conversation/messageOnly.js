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
function shapeMessageOnlySpeech(text, { callerText = '' } = {}) {
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

module.exports = {
  isMessageOnlyMode,
  applyMessageOnlyCapabilities,
  callerCardWithoutVisits,
  messageOnlyNoVisitLine,
  messageOnlyCallbackLine,
  callerTurnKinds,
  collectsBookingSpeech,
  shapeMessageOnlySpeech,
};
