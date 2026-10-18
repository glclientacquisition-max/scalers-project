'use strict';

/**
 * BRAIN_NAME_FOLD: first-call spelling read-back (Alvin GO 15:09, 18 Oct).
 *
 * A number with no name on file: once a name is captured and before the
 * first save (booking, hold, order, message, escalation), the turn gate
 * holds one read-back of that name. Code holds the slot; Prompt owns the
 * words. Only an explicit yes to the read-back, or the caller's correction,
 * binds the name. "Okay" / "Sawa" / a yes to some other question does not.
 * On a bound read-back the post-call write sets
 * metadata.name_locked = { at, by: 'caller' } (callSummary.nameLock ->
 * callTranscriptReview.persistCompletedCallContact).
 *
 * At most once per number: never on a file that already has a name (a
 * locked name is always a known name), and once the read-back has been
 * spoken it is never asked again on this call.
 *
 * state.caller.nameReadBack:
 *   { status, name, offered }
 *   status: 'pending'   name captured, read-back not yet spoken
 *           'asked'     spoken; the next caller turn answers it
 *           'confirmed' explicit yes or a correction; name is bound
 *           'declined'  "no" without a new name; nothing locked
 *           'unanswered' the caller talked about something else
 *           'skipped'   offered twice and never spoken; save goes ahead
 */

const SLOT = 'name_readback';
const MAX_OFFERS = 2;

const SAVE_INTENTS = new Set([
  'hold',
  'hold_or_pickup',
  'order',
  'booking',
  'cancellation',
  'reschedule',
  'escalation',
  'handoff',
  'message',
  'callback',
]);

const EXPLICIT_YES =
  /^(?:yes|yeah|yah|yep|yup|ndio|ndiyo|eeh|correct|that'?s (?:right|correct|it|me)|it'?s right|right|exactly|spot on|ni (?:hiyo|mimi|sawa kabisa)|sahihi|kabisa)\b/i;
const EXPLICIT_NO = /^(?:no|nope|hapana|la|si hivyo|not (?:quite|really|right)|wrong)\b/i;

function readBackEnabled() {
  return require('./nameFold').nameFoldEnabled();
}

function compact(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** The number already has a name (or a lock): never read back. */
function fileHasName(state, profile) {
  const card = profile?.callerMemory || null;
  if (card && String(card.fileOwnerName || card.name || '').trim()) return true;
  const r = state?.returning;
  return Boolean(r && String(r.fileOwnerName || r.name || r.boundName || '').trim());
}

/** "B R Y A N", "B-R-Y-A-N" -> "Bryan". Null when the turn is not spelled. */
function spelledName(text) {
  const m = String(text || '').match(/(?:^|[\s,:])((?:[A-Za-z][\s.\-]+){2,}[A-Za-z])(?=$|[\s,.!?])/);
  if (!m) return null;
  const letters = m[1].replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return null;
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

/** The agent's last line was the read-back of this name, as a question. */
function agentReadBack(lastAgentText, name) {
  const said = String(lastAgentText || '');
  const key = compact(name);
  if (!key || !/\?/.test(said)) return false;
  const words = said.split(/[^A-Za-z'’]+/).map(compact).filter(Boolean);
  if (words.includes(key)) return true;
  // A spelled read-back: "B-R-I-A-N?"
  const spelled = spelledName(said);
  return Boolean(spelled && compact(spelled) === key);
}

/**
 * The next step is a save: a message-only call, an escalation, or a save
 * intent with every fact but the name collected (the confirm/commit turn).
 * The read-back waits until then so it does not break up slot collection.
 */
function isSaveNear(state) {
  if (state?.messageOnly === true) return true;
  if (state?.escalation?.requested || state?.conversation?.escalationAsked) return true;
  const intent = String(state?.intent || '');
  if (!SAVE_INTENTS.has(intent)) return false;
  const missing = Array.isArray(state?.goal?.missingSlots) ? state.goal.missingSlots : [];
  return missing.filter((slot) => slot !== 'name').length === 0;
}

/**
 * The turn gate's speech act: return { slot, name } when this turn must be
 * the read-back, else null. Pure.
 */
function readBackSlot(state) {
  if (!readBackEnabled()) return null;
  const rb = state?.caller?.nameReadBack;
  if (!rb || rb.status !== 'pending' || !rb.name) return null;
  if (!isSaveNear(state)) return null;
  return { slot: SLOT, name: rb.name };
}

/** A save is still held by an unspoken or unanswered read-back. */
function readBackHoldsSave(state) {
  if (!readBackEnabled()) return false;
  const status = state?.caller?.nameReadBack?.status;
  return status === 'pending' || status === 'asked';
}

/**
 * Advance the read-back after a caller turn. Called from observeCallerTurn
 * once caller.name for this turn is resolved. Mutates next.caller.
 * prevState is the state before the turn (its NBA chose what was spoken).
 */
function advanceReadBack(prevState, next, { text = '', lastAgentText = '', profile = null } = {}) {
  if (!readBackEnabled() || !next?.caller) return next;
  const prev = prevState?.caller?.nameReadBack || null;
  let rb = prev ? { ...prev } : null;

  if (rb && (rb.status === 'pending' || rb.status === 'asked')) {
    const spokenNow = agentReadBack(lastAgentText, rb.name);
    if (rb.status === 'pending' && spokenNow) rb.status = 'asked';
    if (rb.status === 'asked') {
      const said = String(text || '').trim();
      const spelled = spelledName(said);
      const heard = String(next.caller.name || '').trim();
      const strict = require('./callerNameMatch').namesLikelySame;
      const correction =
        (spelled && compact(spelled) !== compact(rb.name) && spelled) ||
        (heard && compact(heard) !== compact(rb.name) && !strict(heard, rb.name, { fold: false }) && heard) ||
        null;
      if (correction) {
        rb = { ...rb, status: 'confirmed', name: correction, via: 'correction' };
      } else if ((spelled && compact(spelled) === compact(rb.name)) || EXPLICIT_YES.test(said)) {
        rb = { ...rb, status: 'confirmed', via: 'yes' };
      } else if (EXPLICIT_NO.test(said)) {
        rb = { ...rb, status: 'declined' };
      } else {
        rb = { ...rb, status: 'unanswered' };
      }
      if (rb.status === 'confirmed') {
        next.caller.name = rb.name;
        next.caller.nameConfirmed = true;
        next.entities = {
          ...(next.entities || {}),
          name: {
            value: rb.name,
            source: 'caller_readback',
            confidence: 0.98,
            confirmed: true,
          },
        };
      }
    } else if (rb.status === 'pending') {
      // Offered last turn (a save was near) but the model did not speak it.
      if (isSaveNear(prevState)) rb.offered = Number(rb.offered || 0) + 1;
      if (rb.offered >= MAX_OFFERS) rb.status = 'skipped';
      // The pending name follows the caller's latest spelling.
      const heard = String(next.caller.name || '').trim();
      if (heard && rb.status === 'pending') rb.name = heard;
    }
  } else if (!rb) {
    const heard = String(next.caller.name || '').trim();
    if (heard && !fileHasName(prevState, profile)) {
      rb = { status: 'pending', name: heard, offered: 0 };
    }
  }

  if (rb) next.caller.nameReadBack = rb;
  return next;
}

/** For the post-call write: the lock to set, or null. */
function nameLockFromState(state) {
  if (!readBackEnabled()) return null;
  const rb = state?.caller?.nameReadBack;
  if (!rb || rb.status !== 'confirmed' || !String(rb.name || '').trim()) return null;
  return { name: String(rb.name).trim(), by: 'caller' };
}

/**
 * Criteria for Prompt (not copy). The slot text the model sees until Prompt
 * ships the words. Keep it an instruction, never a script.
 */
function readBackInstruction(name) {
  return `Speech act: name_readback. Before saving, read the name ${name} back once and ask if that is right. One short question, nothing else in the turn. Do not save yet.`;
}

module.exports = {
  SLOT,
  MAX_OFFERS,
  advanceReadBack,
  agentReadBack,
  nameLockFromState,
  readBackEnabled,
  readBackHoldsSave,
  readBackInstruction,
  readBackSlot,
  spelledName,
};
