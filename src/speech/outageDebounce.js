'use strict';
// VOICE_OUTAGE_DEBOUNCE (off by default): one missing or failed TTS stream is not a speech outage.
// Live miss HD_30a3970034a4 (prod, 15 Oct 21:40 EAT): the caller hung up, ws close set tts=null,
// the Gemini reply landed 1.5 s later, and speakText read "tts null" as a provider outage. The downtime
// clip played into a closed call and the Aris owner got an outage SMS.
//
// Per call, one gate decides:
//   - call already closed            -> ignore (never an outage, never an SMS)
//   - provider-classified billing/auth (402/401/403) -> confirmed outage at once
//   - anything else                  -> reconnect TTS once and re-speak the line; a declared outage needs
//                                       N consecutive failures inside the window, or a failed reconnect probe.
// The owner SMS goes out only for a confirmed outage (speechOutageNotify still dedupes per tenant by cooldown).

function outageDebounceEnabled() {
  return /^(1|true|on|yes)$/i.test(String(process.env.VOICE_OUTAGE_DEBOUNCE || '').trim());
}
function num(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function createOutageGate(opts = {}) {
  const threshold = opts.threshold || num('VOICE_OUTAGE_FAILS', 2);
  const windowMs = opts.windowMs || num('VOICE_OUTAGE_WINDOW_MS', 20000);
  const now = opts.now || Date.now;
  let fails = [];
  let closed = false;
  let confirmed = null;
  return {
    threshold,
    windowMs,
    markClosed() { closed = true; },
    isClosed() { return closed; },
    ok() { fails = []; },
    confirmed() { return confirmed; },
    /**
     * @param {string} reason
     * @param {{ billing?: boolean, fatal?: boolean, probeFailed?: boolean, closed?: boolean }} [c]
     * @returns {{ action: 'ignore_closed'|'retry'|'outage', confirmed: boolean, fails: number, why: string }}
     */
    fail(reason, c = {}) {
      if (closed || c.closed) return { action: 'ignore_closed', confirmed: false, fails: fails.length, why: 'call_closed' };
      const t = now();
      fails = fails.filter((x) => t - x <= windowMs);
      fails.push(t);
      let why = '';
      if (c.billing || c.fatal) why = 'provider_fatal';
      else if (c.probeFailed) why = 'probe_failed';
      else if (fails.length >= threshold) why = `consecutive_${fails.length}`;
      if (why) { confirmed = { reason, why, at: t }; return { action: 'outage', confirmed: true, fails: fails.length, why }; }
      return { action: 'retry', confirmed: false, fails: fails.length, why: 'single_failure' };
    },
  };
}

/** Race a session's ready promise against a timeout; resolves true when TTS is usable. */
async function probeReady(session, timeoutMs = num('VOICE_OUTAGE_PROBE_MS', 2500)) {
  if (!session?.ready) return false;
  let timer;
  try {
    return await Promise.race([
      session.ready.then(() => true, () => false),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

module.exports = { outageDebounceEnabled, createOutageGate, probeReady };
