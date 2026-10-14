'use strict';
// Graceful SIGTERM drain for the voice server.
// On SIGTERM: refuse NEW calls (/voice/incoming -> <Reject reason="busy"/>,
// /ws/media upgrades -> 503), /healthz reports draining, then wait for live
// media sessions and call-end work (resolution, summary, review writes) to
// finish, up to VOICE_DRAIN_MAX_MS (default 120000), then exit.
// Off by default: only VOICE_GRACEFUL_DRAIN=on installs the SIGTERM handler (server.js).
// /healthz reports activeCalls either way (read-only counters).
// Railway: see docs/runbooks/voice-graceful-drain.md.

const DEFAULT_MAX_MS = 120000;
const BUSY_XML = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>';

/** VOICE_GRACEFUL_DRAIN=on|1|true|yes installs the SIGTERM drain. Unset/other = off (today's exit). */
function gracefulDrainEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_GRACEFUL_DRAIN ?? '').trim());
}

function drainMaxMs(env = process.env) {
  const n = Number(env.VOICE_DRAIN_MAX_MS);
  return Number.isFinite(n) && n >= 0 && String(env.VOICE_DRAIN_MAX_MS ?? '') !== '' ? n : DEFAULT_MAX_MS;
}

function createVoiceDrain({ maxMs = drainMaxMs(), exit = (code) => process.exit(code), pollMs = 250, log = console, unref = true } = {}) {
  const sessions = new Set();
  const sessionCalls = new Map(); // session -> callSid
  const work = new Set();
  let draining = false;
  let startedAt = null;
  let done = null;

  function trackSession(session, callSid = null) {
    sessions.add(session);
    if (callSid) sessionCalls.set(session, String(callSid));
    return () => untrackSession(session);
  }
  function bindCall(session, callSid) {
    if (sessions.has(session) && callSid) sessionCalls.set(session, String(callSid));
  }
  function untrackSession(session) {
    sessions.delete(session);
    sessionCalls.delete(session);
  }
  function isActiveCall(ids = []) {
    const want = new Set((Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '').trim()).filter(Boolean));
    for (const sid of sessionCalls.values()) if (want.has(sid)) return true;
    return false;
  }
  /** Track call-end work so drain waits for it. Returns the same promise. */
  function trackWork(promise) {
    if (!promise || typeof promise.then !== 'function') return promise;
    work.add(promise);
    const clear = () => work.delete(promise);
    promise.then(clear, clear);
    return promise;
  }
  function stats() {
    return {
      draining,
      activeCalls: sessions.size,
      pendingWork: work.size,
      drainStartedAt: startedAt ? new Date(startedAt).toISOString() : null,
      drainMaxMs: maxMs,
    };
  }
  function isDraining() {
    return draining;
  }

  /** Start draining. Resolves with 'idle' or 'timeout' just before exit(0). */
  function start(reason = 'SIGTERM') {
    if (done) return done;
    draining = true;
    startedAt = Date.now();
    log.warn?.(`[drain] ${reason}: refusing new calls; waiting activeCalls=${sessions.size} pendingWork=${work.size} max=${maxMs}ms`);
    done = new Promise((resolve) => {
      const tick = () => {
        const idle = sessions.size === 0 && work.size === 0;
        const timedOut = Date.now() - startedAt >= maxMs;
        if (idle || timedOut) {
          const outcome = idle ? 'idle' : 'timeout';
          log.warn?.(`[drain] exit outcome=${outcome} activeCalls=${sessions.size} pendingWork=${work.size} after=${Date.now() - startedAt}ms`);
          resolve(outcome);
          exit(0);
          return;
        }
        const t = setTimeout(tick, pollMs);
        if (unref) t.unref?.();
      };
      tick();
    });
    return done;
  }

  return { trackSession, bindCall, untrackSession, trackWork, isActiveCall, isDraining, stats, start };
}

module.exports = { createVoiceDrain, gracefulDrainEnabled, drainMaxMs, BUSY_XML, DEFAULT_MAX_MS };
