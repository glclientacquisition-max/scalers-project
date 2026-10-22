'use strict';

// Ended-call registry: refuse a media reconnect for a call that is over, and
// finalize each call once (VOICE_ENDED_CALL_GUARD, OFF by default: only the
// exact value 'on' enables it; unset or anything else keeps today's path).
//
// HD_49d726c3dc9b (prod Aris, 18 Oct 2026 13:14 EAT, build ae8508ea): 1.2 s
// after our end_call closed /ws/media with code 1000, SautiKit opened a second
// /ws/media for the same call. It loaded the prompt, played the cached
// greeting and finalized the call again (duration 1, resolution abandoned).
// Completed was processed four times (media close, POST /, /voice/events,
// the reconnect session) and the first-forward judge ran four times.
//
// Rules:
// - A media session that ends a call (our end_call, a clean close, or a
//   terminal webhook seen while it was open) marks the sid ended. A later
//   /ws/media for that sid is closed at once: no prompt load, no greeting, no
//   finalize.
// - After a restart the memory is gone, so a sid this process never streamed
//   is read from the call row: terminal status plus the finalized_at marker
//   (written by the finalizer) means ended. A set-up webhook that already
//   says Completed never sets finalized_at, so a first session is not refused.
// - Finalize work (resolution, summary, first-forward judge, text-back) runs
//   once per sid. While a media session for the sid is open here, webhooks
//   update status and duration only and leave finalize to the media close,
//   which holds the live turns. An abnormal media close (no end evidence)
//   finalizes provisionally, so a resumed session can still finalize last.

const TTL_MS = 15 * 60 * 1000;
const TERMINAL = new Set(['complete', 'completed', 'failed', 'no_answer']);
const FINALIZED_META_KEY = 'finalized_at';
const FINALIZED_PROVISIONAL_META_KEY = 'finalized_provisional';

/** Only VOICE_ENDED_CALL_GUARD=on enables the guard. Unset = today's path. */
function endedCallGuardEnabled(env = process.env) {
  return env.VOICE_ENDED_CALL_GUARD === 'on';
}

function key(callSid) {
  return String(callSid || '').trim();
}

function ttlMap() {
  const map = new Map();
  return {
    get: (sid) => map.get(sid)?.value,
    has: (sid) => map.has(sid),
    set(sid, value, ttlMs = TTL_MS) {
      const prev = map.get(sid);
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => map.delete(sid), ttlMs);
      if (typeof timer.unref === 'function') timer.unref();
      map.set(sid, { value, timer });
    },
    delete(sid) {
      const prev = map.get(sid);
      if (prev?.timer) clearTimeout(prev.timer);
      map.delete(sid);
    },
    clear() {
      for (const row of map.values()) if (row.timer) clearTimeout(row.timer);
      map.clear();
    },
  };
}

const ended = ttlMap(); // sid -> { at, reason }
const opened = ttlMap(); // sid -> first media open ms
const finalized = ttlMap(); // sid -> { at, source, provisional }
const live = new Map(); // sid -> open media sessions in this process
const deferred = ttlMap(); // sid -> { status, durationSeconds, source }

function noteMediaOpen(callSid, at = Date.now()) {
  const sid = key(callSid);
  if (!sid) return;
  if (!opened.has(sid)) opened.set(sid, at);
  live.set(sid, (live.get(sid) || 0) + 1);
}

/**
 * @param {string} callSid
 * @param {{ ended?: boolean, reason?: string, at?: number }} [info]
 */
function noteMediaClose(callSid, info = {}) {
  const sid = key(callSid);
  if (!sid) return;
  const n = (live.get(sid) || 0) - 1;
  if (n > 0) live.set(sid, n);
  else live.delete(sid);
  if (info.ended) noteCallEnded(sid, { reason: info.reason || 'media_close', at: info.at });
}

function mediaLive(callSid) {
  return (live.get(key(callSid)) || 0) > 0;
}

function mediaOpenedAt(callSid) {
  const at = opened.get(key(callSid));
  return Number.isFinite(at) ? at : null;
}

function noteCallEnded(callSid, info = {}) {
  const sid = key(callSid);
  if (!sid) return null;
  const row = { at: Number.isFinite(info.at) ? info.at : Date.now(), reason: String(info.reason || 'ended') };
  ended.set(sid, row);
  return row;
}

/**
 * Why this sid is over, from memory only, or ''.
 * opts.terminalSince: callLifecycle.callTerminalSince, so a Completed webhook
 * that arrived after a media session opened counts. One before any session
 * (the set-up quirk) does not.
 */
function endedReason(callSid, opts = {}) {
  const sid = key(callSid);
  if (!sid) return '';
  const row = ended.get(sid);
  if (row) return row.reason;
  const openedAt = mediaOpenedAt(sid);
  if (openedAt != null && typeof opts.terminalSince === 'function') {
    const t = opts.terminalSince(sid, openedAt);
    if (t) return `terminal_webhook:${t.source || 'webhook'}`;
  }
  return '';
}

function parseMeta(summary) {
  if (summary && typeof summary === 'object') return summary;
  try {
    const parsed = JSON.parse(String(summary || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** True when a call row says a finalizer already ran (definitively). */
function rowFinalized(row, { allowProvisional = false } = {}) {
  if (!row) return false;
  const meta = parseMeta(row.summary);
  if (!meta[FINALIZED_META_KEY]) return false;
  if (meta[FINALIZED_PROVISIONAL_META_KEY] && !allowProvisional) return false;
  return true;
}

function rowTerminal(row) {
  return Boolean(row && TERMINAL.has(String(row.status || '').toLowerCase()));
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      // Not unref'd: it is short and always cleared below.
      timer = setTimeout(() => resolve({ timedOut: true }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Decide whether a new /ws/media for callSid must be refused.
 * Memory first. The call row is read only when this process has no record
 * of the sid (no Stream issued here, no media session seen), which is the
 * after-restart case, so a normal first connect adds no round trip.
 * Lookup errors and timeouts fail open (the call is answered).
 * @returns {Promise<{ refuse: boolean, reason: string, source: string }>}
 */
async function checkMediaConnect(callSid, opts = {}) {
  const sid = key(callSid);
  const env = opts.env || process.env;
  if (!sid || !endedCallGuardEnabled(env)) return { refuse: false, reason: '', source: '' };
  const reason = endedReason(sid, opts);
  if (reason) return { refuse: true, reason, source: 'memory' };
  const known = mediaOpenedAt(sid) != null || (typeof opts.streamIssued === 'function' && opts.streamIssued(sid));
  if (known || typeof opts.getCall !== 'function') return { refuse: false, reason: '', source: '' };
  try {
    const row = await withTimeout(Promise.resolve(opts.getCall(sid)), Number(opts.timeoutMs) || 400);
    if (row && row.timedOut) return { refuse: false, reason: '', source: 'db_timeout' };
    if (rowTerminal(row) && rowFinalized(row)) {
      noteCallEnded(sid, { reason: `db_${String(row.status).toLowerCase()}` });
      return { refuse: true, reason: `db_${String(row.status).toLowerCase()}`, source: 'db' };
    }
  } catch {
    return { refuse: false, reason: '', source: 'db_error' };
  }
  return { refuse: false, reason: '', source: 'db' };
}

/**
 * Who finalizes now: 'run', 'defer' (a media session for the sid is open
 * here; its close finalizes with the live turns) or 'skip' (already done in
 * this process). Synchronous, so two closers racing in this process cannot
 * both win. opts.provisional: an abnormal media close with no end evidence.
 */
function finalizeTurn(callSid, opts = {}) {
  const sid = key(callSid);
  if (!sid) return 'run';
  const source = String(opts.source || '');
  const fromMedia = source === 'ws/media';
  if (!fromMedia && mediaLive(sid)) {
    deferred.set(sid, {
      status: String(opts.status || 'complete'),
      durationSeconds: opts.durationSeconds ?? null,
      source,
    });
    return 'defer';
  }
  const prev = finalized.get(sid);
  if (prev && !(prev.provisional && fromMedia)) return 'skip';
  finalized.set(sid, { at: Date.now(), source, provisional: Boolean(opts.provisional) });
  return 'run';
}

/**
 * The terminal webhook that deferred to the media close, if any (taken once).
 * A media close that would otherwise skip finalize (a live transfer still
 * pending) finalizes with it, so a deferred call is never left unfinalized.
 */
function takeDeferred(callSid) {
  const sid = key(callSid);
  const row = deferred.get(sid);
  if (row) deferred.delete(sid);
  return row || null;
}

/**
 * Cross-process check after the status update: the call row already carries
 * the finalized marker (another replica, or before a restart). A provisional
 * marker may still be replaced by a media close.
 */
function rowAlreadyFinalized(row, { source = '' } = {}) {
  if (!rowFinalized(row, { allowProvisional: true })) return false;
  const meta = parseMeta(row.summary);
  if (meta[FINALIZED_PROVISIONAL_META_KEY] && String(source) === 'ws/media') return false;
  return true;
}

/** The meta patch the finalizer writes once it has run. */
function finalizedMetaPatch({ source = '', provisional = false, at = new Date() } = {}) {
  return {
    [FINALIZED_META_KEY]: new Date(at).toISOString(),
    finalized_by: String(source || ''),
    [FINALIZED_PROVISIONAL_META_KEY]: Boolean(provisional),
  };
}

function resetEndedCalls() {
  ended.clear();
  opened.clear();
  finalized.clear();
  deferred.clear();
  live.clear();
}

module.exports = {
  endedCallGuardEnabled,
  noteMediaOpen,
  noteMediaClose,
  mediaLive,
  noteCallEnded,
  endedReason,
  checkMediaConnect,
  finalizeTurn,
  rowAlreadyFinalized,
  takeDeferred,
  finalizedMetaPatch,
  rowFinalized,
  resetEndedCalls,
  FINALIZED_META_KEY,
};
