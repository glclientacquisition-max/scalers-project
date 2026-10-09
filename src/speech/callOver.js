// Speech after the call is over.
//
// HD_ceba9d9b3f37 (staging, 2026-10-09 12:59 EAT): the caller hung up while a
// reply played. The "That's all." queued behind that reply then ran Brain END,
// and the goodbye met a closed socket. speakText read the missing TTS session
// as a provider outage: it played the downtime clip into a dead line and the
// owner got a "line downtime" alert. A closed call is not an outage.
//
// One verdict for every speech entry point (speakText, the Brain END
// goodbye, the outage handler, the timers): when the call is over nothing is
// spoken, nothing is classified as an outage, and nobody is alerted.

/**
 * @param {{ wsOpen?: boolean, terminal?: boolean, socketClosedAt?: number|null }} [opts]
 * @returns {boolean}
 */
function callIsOverFrom(opts = {}) {
  if (opts.wsOpen === false) return true;
  if (opts.terminal === true) return true;
  if (Number(opts.socketClosedAt) > 0) return true;
  return false;
}

/**
 * What to do when a line is about to be spoken.
 * - 'call_over': the line is dropped. No outage, no alert, no clip.
 * - 'outage': TTS is gone on a live call (billing / fatal / never opened).
 * - 'speak': go ahead.
 * @param {{ callOver?: boolean, ttsReady?: boolean, outageStarted?: boolean }} [opts]
 * @returns {'call_over'|'outage_started'|'outage'|'speak'}
 */
function speechVerdict(opts = {}) {
  if (opts.callOver === true) return 'call_over';
  if (opts.outageStarted === true) return 'outage_started';
  if (opts.ttsReady === false) return 'outage';
  return 'speak';
}

/**
 * The provider-outage path (downtime clip + owner alert) runs only on a live
 * call. A socket that already closed, or a carrier Completed webhook, means
 * the caller left; whatever failed after that is not a platform outage.
 * @param {{ callOver?: boolean }} [opts]
 */
function outageHandlingAllowed(opts = {}) {
  return opts.callOver !== true;
}

module.exports = {
  callIsOverFrom,
  speechVerdict,
  outageHandlingAllowed,
};
