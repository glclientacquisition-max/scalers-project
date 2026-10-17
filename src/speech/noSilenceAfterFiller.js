// VOICE_NO_SILENCE_AFTER_FILLER (default off): a filler or hold is always
// followed by speech in the caller's language, and a succeeded tool is always
// acknowledged.
//
// HD_c427511e5773 (prod Aris, 17 Oct 2026):
//   t10 "Let me escalate this to our team, and someone will contact you back
//       with the details." was dropped as saved_claim (no tool ran) and nothing
//       replaced it.
//   t11 a tool-only reply saved the enquiry, the fold branch stripped
//       "Okay, I've saved your request." (nothing was owed), the once-per-call
//       repair was already spent on t4, and the caller heard "Mm-hmm." +
//       "Let me check." then silence until they hung up.
//
// Unset or off (process.env.VOICE_NO_SILENCE_AFTER_FILLER) keeps 8ee9b161.

const ON = /^(1|true|on|yes)$/i;

function noSilenceAfterFillerEnabled(env = process.env) {
  return ON.test(String(env.VOICE_NO_SILENCE_AFTER_FILLER || '').trim());
}

// A live transfer: the caller is put through now. Stays a transfer_claim.
const LIVE_TRANSFER =
  /\b(stay on the line|hold the line|(?:i(?:'m| am|'ll| will) )?(?:transferring|connecting|putting) you (?:now|through|to)|i(?:'ve| have) transferred you|let me (?:transfer|connect) you|nakuunganisha|nakuhamisha)\b/i;

// A callback escalation: the team gets the question and comes back later.
const CALLBACK_CLAIM =
  /\b(?:(?:let me|i(?:'ll| will)|i(?:'ve| have)|we(?:'ll| will))\s+escalat(?:e|ed|ing)|escalat(?:e|ed|ing)\s+(?:this|that|it|your\s+\w+)(?:\s+\w+){0,3}\s+to\s+(?:the|our)\s+(?:team|owner|manager)|(?:pass|forward|send)(?:ed|ing)?\s+(?:this|that|it|your\s+\w+)(?:\s+on)?\s+to\s+(?:the|our)\s+(?:team|owner|manager)|(?:someone|we|they|the team|our team)\s+will\s+(?:call|contact|reach|get back))/i;

function isCallbackClaim(sentence) {
  const text = String(sentence || '');
  return CALLBACK_CLAIM.test(text) && !LIVE_TRANSFER.test(text);
}

const CALLBACK_ACTIONS = new Set(['escalate', 'create_service_request']);

function callbackToolSucceeded(results = []) {
  return (Array.isArray(results) ? results : []).some(
    (r) =>
      r &&
      CALLBACK_ACTIONS.has(r.action) &&
      (r.status === 'succeeded' || r.status === 'updated' || r.status === 'duplicate')
  );
}

function langKey(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sheng') return 'sheng';
  if (lang.startsWith('sw')) return 'sw';
  return 'en';
}

/** Honest offer in place of a promise no tool backed (t10). */
function callbackOfferLine(language) {
  const lang = langKey(language);
  if (lang === 'sw') return 'Ungependa nipeleke swali lako kwa timu?';
  if (lang === 'sheng') return 'Ungependa ni-pass swali yako kwa team?';
  return 'Would you like me to pass your question to the team?';
}

/** Neutral line after a filler when nothing else applies. No ETA, no promise. */
function gapNeutralLine(language) {
  const lang = langKey(language);
  if (lang === 'sw') return 'Sawa, nimeandika. Kuna kingine nikusaidie?';
  if (lang === 'sheng') return 'Poa, nime-note. Kuna kingine?';
  return 'Okay, noted. Anything else I can help with?';
}

/**
 * The one line spoken when a filler or hold played and nothing followed.
 * Tool receipt first, then the open slot question, then the neutral line.
 * @param {{ toolResults?: object[], language?: string, slotLine?: string }} opts
 * @returns {{ line: string, kind: 'tool_receipt'|'open_slot'|'neutral' }}
 */
function gapFallbackLine({ toolResults = [], language = 'en', slotLine = '' } = {}) {
  const { formatToolConfirmation, toolOutcomeLine } = require('../conversation/toolExecution');
  const rows = Array.isArray(toolResults) ? toolResults : [];
  if (rows.length) {
    const receipt = String(formatToolConfirmation(rows, language) || toolOutcomeLine(rows, language) || '').trim();
    if (receipt) return { line: receipt, kind: 'tool_receipt' };
  }
  const slot = String(slotLine || '').trim();
  if (slot) return { line: slot, kind: 'open_slot' };
  return { line: gapNeutralLine(language), kind: 'neutral' };
}

/**
 * What to do with claims the streaming guard held back (dropped only as
 * saved_claim while tools had not run yet), once the tool results are in.
 * @param {{ held: string[], toolResults?: object[], confirmationSpoken?: boolean, language?: string, regard?: (text: string) => string }} opts
 * @returns {{ line: string, kind: 'claim'|'offer'|'none', reason: string }}
 */
function planHeldClaims({ held = [], toolResults = [], confirmationSpoken = false, language = 'en', regard } = {}) {
  const claims = (Array.isArray(held) ? held : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!claims.length) return { line: '', kind: 'none', reason: 'no_claims' };
  const rows = Array.isArray(toolResults) ? toolResults : [];
  if (callbackToolSucceeded(rows)) {
    // The receipt already said it: one save line per turn.
    if (confirmationSpoken) return { line: '', kind: 'none', reason: 'receipt_spoken' };
    const again = typeof regard === 'function' ? String(regard(claims.join(' ')) || '').trim() : '';
    return again ? { line: again, kind: 'claim', reason: 'tool_succeeded' } : { line: '', kind: 'none', reason: 'guard_dropped' };
  }
  // A tool ran and failed: its failure line speaks; the claim stays dropped.
  if (rows.length) return { line: '', kind: 'none', reason: 'tool_failed' };
  return { line: callbackOfferLine(language), kind: 'offer', reason: 'no_tool' };
}

/**
 * VOICE_OWED_CONFIRM_FOLD branch: strip the saved claim from this turn's tool
 * receipt? 8ee9b161 stripped whenever nothing was owed (owedReceipt empty),
 * which also deleted a fresh receipt with nothing owed (HD_c427511e5773 t11).
 * With the flag on, strip only when an owed receipt was folded this turn.
 */
function stripFreshReceipt({ foldEnabled = false, owedReceipt = '', owedFolded = false, enabled = noSilenceAfterFillerEnabled() } = {}) {
  if (!foldEnabled) return false;
  if (owedReceipt) return false; // the fold path handles an owed receipt
  return enabled ? Boolean(owedFolded) : true;
}

module.exports = {
  stripFreshReceipt,
  noSilenceAfterFillerEnabled,
  isCallbackClaim,
  callbackToolSucceeded,
  callbackOfferLine,
  gapNeutralLine,
  gapFallbackLine,
  planHeldClaims,
  LIVE_TRANSFER,
  CALLBACK_CLAIM,
};
