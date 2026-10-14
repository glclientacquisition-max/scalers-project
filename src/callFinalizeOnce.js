'use strict';
// Run-once guard for call completion (staging HD_4ec204aafa93, 2026-10-14):
// voice/events, ws/media and incoming-setup-terminal each marked the call
// complete and voice/events + ws/media each re-derived and re-wrote the
// resolution. With CALL_FINALIZE_ONCE=1 the terminal status flip is a
// conditional update (only from a non-terminal status) and only the webhook
// that wins it runs resolution, first-forward and missed text-back. A loser
// that holds the live turns still hands them to the (already debounced)
// transcript review, without writing the resolution again.
const ON = /^(1|true|on|yes)$/i;

function finalizeOnceEnabled(env = process.env) {
  return ON.test(String(env.CALL_FINALIZE_ONCE || ''));
}

const TERMINAL = ['complete', 'completed', 'failed', 'no_answer'];

/** @returns {'run'|'review_only'|'skip'} */
function finalizeDecision({ enabled, won, hasTurns } = {}) {
  if (!enabled || won !== false) return 'run';
  return hasTurns ? 'review_only' : 'skip';
}

module.exports = { finalizeOnceEnabled, finalizeDecision, TERMINAL };
