'use strict';

// A rejected create's re-ask ("Saa ngapi leo?", reask_slot) that never
// reached the caller stays pending; it is not lost and not counted.
//
// HD_1677e57f73f9 (staging 2026-10-09): the guard rejected the create ("Visit
// has a day but no time."); the turn's confirmation was the re-ask, the caller
// talked over it and the reply was discarded. Two things then went wrong:
//   - Brain counts a re-ask from lastAgentText, which Voice sets when a line
//     starts, not when it is heard. The discarded "Saa ngapi leo?" counted as
//     asked, so the next turn saved a callback instead of asking.
//   - The barged confirmation was queued as an owed tool outcome and replayed
//     word for word at the top of the next turn, even when the caller's own
//     words had just answered it, and Brain's re-ask could follow it.
// Voice owns whether a line reached the caller, so Voice keeps the re-ask
// pending: an unheard re-ask is not counted, the owed outcome carries only the
// non-question part, and Brain's planRejectedCreate (retry when the slot came
// in, re-ask, or callback on a closing) decides what is said next.

const REASK_ASK =
  /\b(?:saa ngapi|what time|which time|morning or|in the morning or|asubuhi au|asubuhi ama|mchana au|usiku au|jioni au|am or pm|ni time gani|tuje wapi|tukuje wapi|where should we come)\b|\bsaa \p{L}+(?: na \p{L}+)? (?:asubuhi|mchana|jioni|usiku) (?:au|ama)\b/iu;

function held(state) {
  const pending = state?.conversation?.rejectedCreate;
  return pending && typeof pending === 'object' ? pending : null;
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The line carries the held create's re-ask question. */
function lineHasReask(line, state) {
  if (!held(state)) return false;
  return sentences(line).some((s) => /\?$/.test(s) && REASK_ASK.test(s));
}

/**
 * Split an owed tool outcome while a create is held: the re-ask question is
 * not replayed from the queue (Brain's re-ask path owns it).
 * @returns {{ outcome: string, reask: string }}
 */
function splitOwedOutcome(line, state) {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text || !held(state)) return { outcome: text, reask: '' };
  const keep = [];
  const ask = [];
  for (const s of sentences(text)) {
    if (/\?$/.test(s) && REASK_ASK.test(s)) ask.push(s);
    else keep.push(s);
  }
  return { outcome: keep.join(' '), reask: ask.join(' ') };
}

/** After speakText for a line with the re-ask: did it reach the caller? */
function noteReaskResult(state, line, spoken) {
  const pending = held(state);
  if (!pending || !lineHasReask(line, state)) return false;
  pending.reaskUnheard = !(spoken && spoken.ok === true);
  return pending.reaskUnheard;
}

/** The previous turn ended with the re-ask unheard (barged, discarded, queued). */
function reaskUnheard(state) {
  const pending = held(state);
  if (!pending) return false;
  if (pending.reaskUnheard === true) return true;
  return lineHasReask(state?.conversation?.pendingToolOutcome, state);
}

/**
 * Before Brain's observeCallerTurn: was the last re-ask unheard, and how many
 * re-asks were counted. A snapshot, because Brain may update the held create
 * in place.
 */
function reaskSnapshot(state) {
  const pending = held(state);
  return { unheard: reaskUnheard(state), reasks: Number(pending?.reasks) || 0 };
}

/**
 * After Brain's observeCallerTurn. An unheard re-ask is not counted as
 * asked: the re-ask count goes back to the snapshot, so Brain re-asks (or
 * retries when the caller's words filled the slot) instead of saving a
 * callback.
 * @returns {boolean} true when a count was undone
 */
function keepUnheardReask(snapshot, nextState) {
  if (!snapshot || snapshot.unheard !== true) return false;
  const after = held(nextState);
  if (!after) return false;
  after.reaskUnheard = true;
  if ((Number(after.reasks) || 0) > snapshot.reasks) {
    after.reasks = snapshot.reasks;
    return true;
  }
  return false;
}

module.exports = {
  REASK_ASK,
  lineHasReask,
  splitOwedOutcome,
  noteReaskResult,
  reaskUnheard,
  reaskSnapshot,
  keepUnheardReask,
};
