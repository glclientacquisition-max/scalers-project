// One rule for "the caller has not finished yet" (ported from #609 4e6abe8f).
//
// A real fragment ("Nilikuwa nauliza,", "Let's say", "Nilikuwa nataka", a
// trailing "na" or "and") holds the reply, including the file-name ask.
// Trailing punctuation alone does not, when the words already make a whole
// answer or a whole ask: "Sawa," to a pending question, "What services do
// you offer,", "Do you cover Kitengela,", "Carpet ni bei gani,". Voice adds a
// fallback timer on top of the hold (src/speech/unfinishedHold.js), so a hold
// is never silence for the rest of the call.

const SHORT_REPLY =
  /^(?:sawa|sawa sawa|ndio|ndiyo|ndio ndio|yes|yeah|yep|okay|ok|hapana|no|la|sure|poa)$/i;

const PRICE_ASK =
  /\b(?:how much|prices?|costs?|charges?|rates?|bei|gharama|pesa ngapi|pesa gani|ngapi)\b/i;

function wordsOf(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:…—–-]+$/g, '')
    .trim();
}

function agentQuestionPending(ctx = {}) {
  if (ctx.agentAwaitingReply === true) return true;
  const conversation = ctx.state?.conversation || {};
  return Boolean(conversation.pendingAsk && conversation.pendingAsk.kind);
}

function priceAskHasService(words, ctx = {}) {
  if (!PRICE_ASK.test(words)) return false;
  const { extractConversationEntities } = require('./entityExtraction');
  const heard = extractConversationEntities(words, {
    profile: ctx.profile || {},
    state: ctx.state,
  });
  const value = (row) => String((row && typeof row === 'object' ? row.value : row) || '').trim();
  if (value(heard?.service)) return true;
  return value(ctx.state?.entities?.service) !== '';
}

function coverageAskIsResolved(words, ctx = {}) {
  const { coverageAskPlace, coverageStatus, foldCanonicalPlace } = require('./visitLocation');
  const profile = ctx.profile || {};
  const place = coverageAskPlace(words);
  if (!place) return false;
  const folded = foldCanonicalPlace(place, profile) || place;
  // Flag off: same as assessCoverage. Flag on: 'unconfirmed' is answered too
  // ("I'll have the team confirm {place}"), so the turn is whole.
  return coverageStatus(folded, profile) !== 'unknown';
}

/**
 * Why a turn that ends like a fragment is still a whole turn.
 * Returns '' for a real fragment.
 * @param {string} text
 * @param {{ state?: object, profile?: object, agentAwaitingReply?: boolean }} [ctx]
 */
function completeTurnReason(text, ctx = {}) {
  const words = wordsOf(text);
  if (!words) return '';
  if (SHORT_REPLY.test(words)) return agentQuestionPending(ctx) ? 'short_reply' : '';
  const { looksLikeOfferAsk } = require('./fileRead');
  if (looksLikeOfferAsk(words)) return 'catalogue_ask';
  if (coverageAskIsResolved(words, ctx)) return 'coverage_ask';
  if (priceAskHasService(words, ctx)) return 'price_ask';
  return '';
}

/**
 * The hold decision for the latest caller turn. null means reply now.
 * holdTimedOut: Voice already held this text and the caller stayed quiet.
 * @param {object} state
 * @param {{ text?: string, profile?: object, agentAwaitingReply?: boolean, holdTimedOut?: boolean }} [opts]
 */
function unfinishedTurnHold(state, opts = {}) {
  if (opts.holdTimedOut === true) return null;
  const latest = String(
    opts.text != null ? opts.text : (state?.conversation?.answersReceived || []).slice(-1)[0] || ''
  );
  const { callerTurnStillOpen } = require('./entityExtraction');
  if (!callerTurnStillOpen(latest)) return null;
  if (completeTurnReason(latest, { ...opts, state })) return null;
  return { hold: 'unfinished', text: latest };
}

module.exports = {
  completeTurnReason,
  unfinishedTurnHold,
};
