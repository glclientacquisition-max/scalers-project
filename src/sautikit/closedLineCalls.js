'use strict';

// Calls the inactive-tenant gate (#639) answered with "line unavailable".
//
// Those calls have no call row, so the later lifecycle webhooks (Completed on
// /voice/incoming, hangup / recording on /voice/events) already find nothing
// to update: no minutes, no missed-call text-back, no owner alert. This memo
// makes that explicit and also skips the provider recording fetch for them.
// In memory, bounded, short TTL: a restart only loses the shortcut, never the
// "no call row" guarantee.

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5000;

function createClosedLineCalls({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now(), max = MAX_ENTRIES } = {}) {
  const until = new Map();

  function prune(t) {
    for (const [sid, exp] of until) {
      if (exp > t && until.size <= max) break;
      until.delete(sid);
    }
  }

  function remember(...sids) {
    const t = now();
    for (const sid of sids.flat()) {
      const key = String(sid || '').trim();
      if (!key) continue;
      until.delete(key);
      until.set(key, t + ttlMs);
    }
    prune(t);
  }

  function has(...sids) {
    const t = now();
    for (const sid of sids.flat()) {
      const key = String(sid || '').trim();
      if (!key) continue;
      const exp = until.get(key);
      if (exp && exp > t) return true;
      if (exp) until.delete(key);
    }
    return false;
  }

  return { remember, has, get size() { return until.size; } };
}

module.exports = { createClosedLineCalls, DEFAULT_TTL_MS };
