'use strict';

// Honour the brain's end-of-call signal (VOICE_FAREWELL_HANGUP, OFF by default).
//
// Plan C3 (v2-greeting-and-path-plan, approved 21 Oct 2026): when the brain
// says the call is over (v1 end_call tool / ###ENDCALL### marker, the v1
// END next-best-action farewell, or the v2 `end` / `end_call` action), Voice
// hangs up the SautiKit call AFTER the final audio has played, once.
//
// Before this, the media loop closed /ws/media on a fixed 800 ms timer
// (shouldEndCall) or a byte estimate (brain END). Closing the media socket
// alone does not end the PSTN leg (LIVE_CALL_FINDINGS: dead air until the
// caller hangs up; HD_49d726c3dc9b: SautiKit re-opened /ws/media 1.2 s after
// our close). And a reply that finished after the socket closed read
// `tts=null` as a speech outage: HD_2ccfbf6e1fa4 (prod, 20 Oct 12:32 EAT,
// owner SMS) and HD_5c9056d78d02 (staging, owner email).
//
// With the flag on:
// - One controller per media session. request() is idempotent: the first
//   signal schedules the hangup; later signals return the same promise.
// - The hangup waits for the outbound audio still queued on the bridge
//   (a playout clock fed by every PCM send, reset on barge-in clear) plus a
//   short grace, re-checking once the timer fires in case more audio was
//   queued (the last sentence of a streamed reply). Capped by maxWaitMs.
// - Then: mark the call ended, ask SautiKit to hang up
//   (POST /v1/calls/{id}/hangup, idempotent on their side), close /ws/media
//   with 1000 'end_call'. A REST failure still closes the socket.
// - callEnded() is the guard: no downtime clip, owner SMS or email once it
//   is true (see outageSuppressed()).
//
// Flag off: none of this is created; server.js keeps today's timers.

const ON = /^(1|true|on|yes)$/i;

/** VOICE_FAREWELL_HANGUP=on|1|true|yes enables it. Unset or anything else: off. */
function farewellHangupEnabled(env = process.env) {
  return ON.test(String(env.VOICE_FAREWELL_HANGUP ?? '').trim());
}

function boundedMs(raw, { def, min, max }) {
  const n = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Grace after the last audio frame should have played (ms). */
function endGraceMs(env = process.env) {
  return boundedMs(env.VOICE_END_CALL_GRACE_MS, { def: 600, min: 200, max: 5000 });
}

/** Never hold a call open longer than this after the end signal (ms). */
function endMaxWaitMs(env = process.env) {
  return boundedMs(env.VOICE_END_CALL_MAX_WAIT_MS, { def: 12000, min: 2000, max: 30000 });
}

const BYTES_PER_MS_16K = 32; // 16 kHz mono s16le

/**
 * When the far end finishes playing what we have sent. Sends are assumed to
 * play back to back in real time from the first send after idle.
 */
function createPlayoutClock({ now = Date.now, bytesPerMs = BYTES_PER_MS_16K } = {}) {
  let until = 0;
  return {
    note(bytes) {
      const ms = Math.ceil(Math.max(0, Number(bytes) || 0) / bytesPerMs);
      if (!ms) return;
      const t = now();
      until = Math.max(until, t) + ms;
    },
    clear() {
      until = 0;
    },
    remainingMs() {
      return Math.max(0, until - now());
    },
  };
}

/**
 * Normalise every shape the brain uses to say "end the call".
 * - v1 Gemini result: { shouldEndCall: true } (end_call tool / ###ENDCALL###)
 * - v1 next best action: { action: 'END' } or 'END'
 * - v2 liveTurn result: { end: true }
 * - v2 action: { action: 'end' | 'end_call' } or { type: 'end' | 'end_call' }
 * - v2 tool call: { name: 'end_call' } or actions: [ ...any of the above ]
 * @returns {{ end: boolean, source: string, reason: string }}
 */
function endSignalFromBrain(signal) {
  const no = { end: false, source: '', reason: '' };
  if (signal == null || signal === false) return no;
  if (typeof signal === 'string') {
    const s = signal.trim().toLowerCase();
    if (s === 'end' || s === 'end_call') return { end: true, source: s === 'end' ? 'nba_end' : 'end_call', reason: '' };
    return no;
  }
  if (typeof signal !== 'object') return no;
  const reason = String(signal.reason || signal.endReason || '').slice(0, 120);
  if (signal.shouldEndCall === true) return { end: true, source: 'v1_end_call', reason };
  if (signal.end === true) return { end: true, source: 'v2_end', reason };
  for (const k of ['action', 'type', 'name', 'tool']) {
    const v = String(signal[k] || '').trim().toLowerCase();
    if (v === 'end' || v === 'end_call') return { end: true, source: k === 'action' && v === 'end' ? 'action_end' : `${k}_${v}`, reason };
  }
  if (Array.isArray(signal.actions)) {
    for (const a of signal.actions) {
      const hit = endSignalFromBrain(a);
      if (hit.end) return hit;
    }
  }
  return no;
}

/**
 * One per media session.
 * @param {{
 *   playoutRemainingMs?: () => number,
 *   hangupRest?: (reason: string) => Promise<unknown>,
 *   closeMedia?: (reason: string) => void,
 *   onEnded?: (info: { source: string, reason: string }) => void,
 *   graceMs?: number,
 *   maxWaitMs?: number,
 *   restTimeoutMs?: number,
 *   setTimer?: typeof setTimeout,
 *   now?: () => number,
 *   log?: (line: string) => void,
 * }} deps
 */
function createEndCallController(deps = {}) {
  const remaining = typeof deps.playoutRemainingMs === 'function' ? deps.playoutRemainingMs : () => 0;
  const graceMs = Number.isFinite(deps.graceMs) ? deps.graceMs : endGraceMs();
  const maxWaitMs = Number.isFinite(deps.maxWaitMs) ? deps.maxWaitMs : endMaxWaitMs();
  const restTimeoutMs = Number.isFinite(deps.restTimeoutMs) ? deps.restTimeoutMs : 2500;
  const setTimer = deps.setTimer || setTimeout;
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});
  let state = 'idle'; // idle -> pending -> ended
  let requestedAt = 0;
  let info = null;
  let done = null;
  let hangups = 0;

  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const t = setTimer(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, timedOut: true });
      }, ms);
      if (t && typeof t.unref === 'function') t.unref();
      Promise.resolve(promise).then(
        (v) => {
          if (settled) return;
          settled = true;
          resolve(v);
        },
        (err) => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, error: String(err?.message || err) });
        }
      );
    });
  }

  async function fire() {
    if (state === 'ended') return info;
    state = 'ended';
    hangups += 1;
    try {
      if (typeof deps.onEnded === 'function') deps.onEnded(info);
    } catch {
      /* ignore */
    }
    let rest = null;
    if (typeof deps.hangupRest === 'function') {
      rest = await withTimeout(deps.hangupRest(info.source), restTimeoutMs);
    }
    log(
      `end_call hangup source=${info.source} waited_ms=${now() - requestedAt} rest=${
        rest == null ? 'skipped' : rest.ok ? `ok:${rest.status ?? ''}` : `fail:${rest.status ?? rest.reason ?? (rest.timedOut ? 'timeout' : rest.error || '')}`
      }`
    );
    try {
      if (typeof deps.closeMedia === 'function') deps.closeMedia('end_call');
    } catch {
      /* ignore */
    }
    return { ...info, rest };
  }

  /**
   * The brain said the call is over. Idempotent: later calls return the first promise.
   * @param {{ source?: string, reason?: string }} [opts]
   */
  function request(opts = {}) {
    if (done) return done;
    state = 'pending';
    requestedAt = now();
    info = { source: String(opts.source || 'end'), reason: String(opts.reason || '') };
    done = new Promise((resolve) => {
      const check = () => {
        const waited = now() - requestedAt;
        const left = Math.max(0, Number(remaining()) || 0);
        if (left > 0 && waited < maxWaitMs) {
          // More audio was queued after we scheduled (last streamed sentence): wait for it.
          const t = setTimer(check, Math.min(left + graceMs, Math.max(1, maxWaitMs - waited)));
          if (t && typeof t.unref === 'function') t.unref();
          return;
        }
        fire().then(resolve, () => resolve(info));
      };
      const first = Math.min(maxWaitMs, Math.max(0, Number(remaining()) || 0) + graceMs);
      log(`end_call scheduled source=${info.source} in ${first}ms`);
      const t = setTimer(check, first);
      if (t && typeof t.unref === 'function') t.unref();
    });
    return done;
  }

  return {
    request,
    /** The brain asked to end (hangup pending or done). */
    ending: () => state !== 'idle',
    /** The hangup ran. */
    ended: () => state === 'ended',
    hangupCount: () => hangups,
    source: () => (info ? info.source : ''),
  };
}

/**
 * Outage guard: a TTS/STT failure once the call is over (or being hung up
 * by us) is not a speech outage. No downtime clip, no owner SMS / email.
 * @param {{ wsOpen?: boolean, callEnding?: boolean, endRequested?: boolean, terminal?: boolean }} s
 * @returns {string} '' when an outage may proceed, else why it is suppressed
 */
function outageSuppressed(s = {}) {
  if (s.endRequested) return 'end_call';
  if (s.callEnding) return 'call_ending';
  if (s.wsOpen === false) return 'media_closed';
  if (s.terminal) return 'terminal_webhook';
  return '';
}

module.exports = {
  farewellHangupEnabled,
  endGraceMs,
  endMaxWaitMs,
  createPlayoutClock,
  endSignalFromBrain,
  createEndCallController,
  outageSuppressed,
};
