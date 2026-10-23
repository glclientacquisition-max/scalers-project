'use strict';

// VOICE_OPENING_V2 latency: tenant profile + caller card start loading when
// the incoming-call webhook answers, keyed by callSid, before SautiKit opens
// /ws/media. Greeting PCM warms async (void) so media is not gated on Soniox
// (D1). The stream take()s the profile; a miss loads as today.

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

/**
 * Opening prefetch load body (D1): settle with `{ profile }` as soon as
 * profile+card resolve; warm greeting PCM without awaiting it.
 * `/ws/media` awaits the prefetch promise — awaiting Soniox render here
 * serialized firstPcm ~8–14s when prefetch=inflight (HD_0be4).
 *
 * @param {{ loadProfile: () => Promise<object>, warmGreeting?: (profile: object) => Promise<unknown> }} opts
 * @returns {Promise<{ profile: object }>}
 */
async function loadOpeningForPrefetch({ loadProfile, warmGreeting }) {
  const profile = await loadProfile();
  if (typeof warmGreeting === 'function') {
    void Promise.resolve()
      .then(() => warmGreeting(profile))
      .catch(() => {});
  }
  return { profile };
}

module.exports = { createCallPrefetch, loadOpeningForPrefetch, TTL_MS };

