// Per-call memory for the inbound webhook: which sids already got Stream
// XML, the background call-row write, and the tenant the webhook resolved.
//
// Prod HD_d3900cbf2b2d (2026-10-09 20:19:34 EAT): the hangup arrived as POST /
// with callSessionState=Completed plus durationInSeconds/isActive/direction.
// The "first callback already Completed" rule read that as call set-up, ran the
// package gate and upsertCall again, returned Stream XML to a finished call,
// and scheduled voice/incoming-setup-terminal, so the call was closed twice
// (ws/media 76 s and setup-terminal 73 s) and no recording fetch ever ran.
// A Completed for a sid that already got Stream (or already has a call row)
// is the hangup.

const STREAM_TTL_MS = 3 * 60 * 60 * 1000;

function createInboundCalls({ now = () => Date.now(), ttlMs = STREAM_TTL_MS } = {}) {
  /** @type {Map<string, number>} */
  const streamIssued = new Map();
  /** @type {Map<string, { promise: Promise<unknown>, tenantId: string|null, at: number }>} */
  const rows = new Map();

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [sid, at] of streamIssued) if (at < cutoff) streamIssued.delete(sid);
    for (const [sid, row] of rows) if (row.at < cutoff) rows.delete(sid);
  }

  function markStreamIssued(callSid) {
    const sid = String(callSid || '').trim();
    if (!sid) return;
    if (streamIssued.size > 5000) prune();
    streamIssued.set(sid, now());
  }

  function streamIssuedFor(callSid) {
    const at = streamIssued.get(String(callSid || '').trim());
    return Boolean(at && now() - at < ttlMs);
  }

  /**
   * @param {string} callSid
   * @param {Promise<unknown>} promise
   * @param {string|null} tenantId
   */
  function trackRow(callSid, promise, tenantId = null) {
    const sid = String(callSid || '').trim();
    if (!sid) return;
    if (rows.size > 5000) prune();
    const settled = Promise.resolve(promise).then(
      (value) => value,
      () => null
    );
    rows.set(sid, { promise: settled, tenantId: tenantId || null, at: now() });
  }

  function tenantIdFor(callSid) {
    return rows.get(String(callSid || '').trim())?.tenantId || null;
  }

  /** Wait (bounded) for the background call-row write, if any. */
  async function awaitRow(callSid, timeoutMs = 2500) {
    const row = rows.get(String(callSid || '').trim());
    if (!row) return null;
    let timer;
    try {
      return await Promise.race([
        row.promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { markStreamIssued, streamIssuedFor, trackRow, tenantIdFor, awaitRow, prune };
}

/**
 * Completed + call-set-up fields is set-up only for a sid we have never
 * answered. Once Stream went out (or a call row exists) it is the hangup.
 * @param {{ state?: string, hasCallSetupFields?: boolean, streamIssued?: boolean }} opts
 */
function completedIsCallSetup({ state = '', hasCallSetupFields = false, streamIssued = false } = {}) {
  return String(state).toLowerCase() === 'completed' && hasCallSetupFields && !streamIssued;
}

module.exports = {
  STREAM_TTL_MS,
  createInboundCalls,
  completedIsCallSetup,
};
