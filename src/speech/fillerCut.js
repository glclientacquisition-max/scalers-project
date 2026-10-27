'use strict';
// BRAIN_V1_DRAFT_PHASE_A filler cut (Voice review of #927). Pure decisions; server.js applies them.

const FILLER_MIN_MS = 450;

/**
 * What to do with the thinking filler when the reply is ready.
 * - cut: a filler stream is playing; wait until it has played minMs from ITS OWN start, then cut.
 * - abort_pending: the filler timer fired but its audio has not bound yet; tell it to stand down.
 * - none: no filler.
 */
function planFillerCut({ fillerStreamId = null, fillerStartedAt = 0, fillerPending = false, now = Date.now(), minMs = FILLER_MIN_MS } = {}) {
  if (fillerStreamId) {
    const started = fillerStartedAt > 0 ? fillerStartedAt : now;
    return { action: 'cut', waitMs: Math.max(0, minMs - (now - started)) };
  }
  if (fillerPending) return { action: 'abort_pending', waitMs: 0 };
  return { action: 'none', waitMs: 0 };
}

/** Caller speech held during the cut filler moves to the reply's generation (released at reply end). */
function carryHeldSpeech(overlapHold, fromGeneration, toGeneration) {
  if (!overlapHold || !fromGeneration || !toGeneration) return 0;
  return overlapHold.reassignPending(fromGeneration, toGeneration);
}

module.exports = { planFillerCut, carryHeldSpeech, FILLER_MIN_MS };
