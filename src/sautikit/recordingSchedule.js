// Delayed provider-recording fetch after a call ends.
//
// Prod never fetched a recording: 0 of its calls in 21 days have
// recording_url (staging 159/581). Prod's webhooks all arrive as POST / and
// none at /voice/events, but scheduleRecordingFetch only ran from
// /voice/events. Now the hangup on any route and the media-socket close both
// schedule it. SautiKit may answer 202 while the file is still uploading, so
// retry on a short backoff and stop at the first attach.

const RECORDING_FETCH_DELAYS_MS = [8000, 30000, 90000];

/**
 * @param {{
 *   attach: (ids: string[], source: string) => Promise<unknown>,
 *   delaysMs?: number[],
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   log?: (msg: string) => void,
 * }} opts
 */
function createRecordingFetchScheduler(opts = {}) {
  const attach = opts.attach;
  const delays = Array.isArray(opts.delaysMs) && opts.delaysMs.length
    ? opts.delaysMs
    : RECORDING_FETCH_DELAYS_MS;
  const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const log = opts.log || (() => {});
  const scheduled = new Set();

  function schedule(callSids, source) {
    const ids = [...new Set((callSids || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return false;
    if (ids.some((id) => scheduled.has(id))) return false;
    for (const id of ids) scheduled.add(id);
    if (scheduled.size > 10000) {
      // Bounded: the oldest entries go first (Set keeps insertion order).
      const drop = scheduled.size - 5000;
      let i = 0;
      for (const id of scheduled) {
        if (i++ >= drop) break;
        scheduled.delete(id);
      }
    }
    const attempt = (n) => {
      setTimer(async () => {
        let ok = null;
        try {
          ok = await attach(ids, `${source}+retry${n + 1}`);
        } catch (err) {
          log(`[${source}] delayed recording fetch failed: ${err?.message || err}`);
        }
        if (ok) return;
        if (n + 1 < delays.length) attempt(n + 1);
        else log(`[${source}] recording not available after ${delays.length} tries callSids=${ids.join(',')}`);
      }, delays[n]);
    };
    attempt(0);
    return true;
  }

  return { schedule, has: (id) => scheduled.has(String(id || '').trim()) };
}

module.exports = {
  RECORDING_FETCH_DELAYS_MS,
  createRecordingFetchScheduler,
};
