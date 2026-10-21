'use strict';

// VOICE_OPENING_V2 latency: what the greeting needs (tenant profile + caller
// card, cached greeting PCM) starts loading when the incoming-call webhook
// answers, keyed by callSid, before SautiKit opens /ws/media. The stream
// take()s it; a miss (other replica, expired, failed) loads as today.

const TTL_MS = 60000;

function createCallPrefetch({ ttlMs = TTL_MS, now = () => Date.now(), log = console } = {}) {
  const entries = new Map();

  function sweep() {
    const cutoff = now() - ttlMs;
    for (const [sid, e] of entries) if (e.startedAt < cutoff) entries.delete(sid);
  }

  return {
    /**
     * Start loading for callSid (once). loader: () => Promise<{ profile }>.
     * Never rejects: a failure resolves null and the stream loads as today.
     */
    start(callSid, loader) {
      const sid = String(callSid || '');
      if (!sid || entries.has(sid)) return entries.get(sid) || null;
      sweep();
      const entry = { startedAt: now(), settledAt: 0, ok: false, promise: null };
      entry.promise = Promise.resolve()
        .then(loader)
        .then((v) => {
          entry.settledAt = now();
          entry.ok = Boolean(v);
          return v || null;
        })
        .catch((err) => {
          entry.settledAt = now();
          log.warn(`[voice/incoming][${sid}] opening_prefetch failed (stream loads as today): ${err?.message || err}`);
          return null;
        });
      entries.set(sid, entry);
      return entry;
    },
    has(callSid) {
      const e = entries.get(String(callSid || ''));
      return Boolean(e) && now() - e.startedAt < ttlMs;
    },
    /** One stream per call takes it; a reconnect does not need it (no greeting). */
    take(callSid) {
      const sid = String(callSid || '');
      const e = entries.get(sid);
      if (!e) return null;
      entries.delete(sid);
      if (now() - e.startedAt >= ttlMs) return null;
      return e;
    },
    size: () => entries.size,
  };
}

module.exports = { createCallPrefetch, TTL_MS };
