'use strict';

// A caller final that lands while the model is still thinking.
//
// HD_ceba9d9b3f37 t5/t6: "Okay, thank you." went to the model at
// 10:01:03.14Z. "That's all." was final at 10:01:04.48Z and queued behind it.
// The model's answer (a re-read of both visits and the service list) began
// playing about 10:01:06Z, ran ~6 s, and only then did "That's all." get a
// turn; the caller had hung up. The reply was stale before a word of it
// played: the caller had already said more.
//
// Rule: while the model turn is pending and none of its reply has gone to
// TTS, a caller final with content (or a closing cue) supersedes it. The
// stale answer is dropped like a barge (its tool outcomes stay owed) and the
// queued words run as the next turn, with both caller lines in the history,
// so the answer is regenerated for what the caller said last. Once reply
// text has gone to TTS the barge rules own it. Bare backchannels ("okay",
// "mm") do not supersede.

const { classifyClosingCue } = require('./closingCue');

const BACKCHANNEL =
  /^(?:ok(?:ay)?|okey|aha|aah|alright|all right|right|yes|yeah|yep|ya|no|sawa|poa|ndio|ndiyo|eh|ehe|mm+|mhm+|hmm+|uh+|um+|ah+|oh|sure|fine|good|great)$/i;

/**
 * @param {string} text
 * @returns {boolean} the final says something beyond a backchannel
 */
function finalHasContent(text) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  if (/\?\s*$/.test(clean)) return true;
  const words = clean
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1) // "A-a", "M-m" hesitation
    .filter((w) => !BACKCHANNEL.test(w));
  return words.length >= 2;
}

/**
 * @param {{
 *   modelPending?: boolean,   // a model call for the current turn is in flight
 *   replyStarted?: boolean,   // reply text of that turn already went to TTS
 *   superseded?: boolean,     // already superseded
 *   text?: string,            // the caller final that just landed
 *   echo?: boolean,           // the final looks like the agent's own audio
 * }} opts
 * @returns {{ supersede: boolean, reason: string, cue: string }}
 */
function supersedeDecision(opts = {}) {
  const { cue } = classifyClosingCue(opts.text);
  if (!opts.modelPending) return { supersede: false, reason: 'no_model_turn', cue };
  if (opts.superseded) return { supersede: false, reason: 'already_superseded', cue };
  if (opts.replyStarted) return { supersede: false, reason: 'reply_started', cue };
  if (opts.echo) return { supersede: false, reason: 'echo', cue };
  if (cue === 'end' || cue === 'soft') return { supersede: true, reason: 'closing_cue', cue };
  if (finalHasContent(opts.text)) return { supersede: true, reason: 'content', cue };
  return { supersede: false, reason: 'backchannel', cue };
}

module.exports = {
  finalHasContent,
  supersedeDecision,
};
