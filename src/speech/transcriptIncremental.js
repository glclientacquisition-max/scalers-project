'use strict';

// VOICE_TRANSCRIPT_INCREMENTAL (default off; only the exact value 'on').
//
// Prod HD_e75a669780d4 (Aris, 20 Oct 2026): 19 caller turns were held in
// memory and written only at socket close (delete-then-insert). A deploy
// killed the process mid-call, so close never ran; the reconnect session on
// the new process then replaced the transcript with its own re-greeting.
//
// On: every caller/agent row is upserted as it is pushed. Each row has a
// deterministic id (hash of callSid, media session key, row index), so a
// retry, a latency stamp, or the close-time flush updates the same row and
// never duplicates or deletes. A second media session (reconnect, other
// process) has its own session key, so it adds rows and never overwrites
// the first session's rows. Writes are serialized per session; created_at is
// the time the row was first pushed, so order by created_at is spoken order.

const crypto = require('crypto');

function transcriptIncrementalEnabled(env = process.env) {
  return String(env.VOICE_TRANSCRIPT_INCREMENTAL || '').trim() === 'on';
}

/** RFC 4122-shaped (v5-style, SHA-1) uuid from a name. Deterministic. */
function stableRowId(callSid, sessionKey, index) {
  const h = crypto
    .createHash('sha1')
    .update(`scalers-transcript:${callSid}:${sessionKey}:${index}`)
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param {{
 *   callSid: () => (string|null),
 *   sessionKey: string,
 *   upsert: (args: { callSid: string, rows: Array<object> }) => Promise<unknown>,
 *   now?: () => number,
 *   log?: (msg: string) => void,
 * }} opts
 */
function createIncrementalTranscriptWriter(opts) {
  const now = opts.now || (() => Date.now());
  const sessionKey = String(opts.sessionKey || crypto.randomUUID());
  /** index -> { speaker, text, latencyMs, firstAt } */
  const rows = new Map();
  const dirty = new Set();
  let chain = Promise.resolve();
  let writes = 0;
  let failures = 0;
  let closed = false;

  function note(index, row) {
    if (!row || !String(row.text || '').trim()) return;
    const prev = rows.get(index);
    rows.set(index, {
      speaker: row.speaker,
      text: String(row.text),
      latencyMs: row.latencyMs ?? null,
      firstAt: prev ? prev.firstAt : now(),
    });
    dirty.add(index);
  }

  function payloadFor(sid, indexes) {
    return indexes
      .sort((a, b) => a - b)
      .map((i) => {
        const r = rows.get(i);
        return {
          id: stableRowId(sid, sessionKey, i),
          speaker: r.speaker,
          text: r.text,
          latencyMs: r.latencyMs,
          createdAt: new Date(r.firstAt).toISOString(),
        };
      });
  }

  function flush() {
    chain = chain.then(async () => {
      const sid = typeof opts.callSid === 'function' ? opts.callSid() : null;
      if (!sid || !dirty.size) return;
      const batch = [...dirty];
      dirty.clear();
      try {
        await opts.upsert({ callSid: sid, rows: payloadFor(sid, batch) });
        writes += 1;
      } catch (err) {
        failures += 1;
        // Keep them dirty: the next push or the close flush retries.
        for (const i of batch) dirty.add(i);
        if (typeof opts.log === 'function') opts.log(`transcript upsert failed: ${err?.message || err}`);
      }
    });
    return chain;
  }

  /** A row was pushed or changed (latency stamp). */
  function onChange(index, row) {
    if (closed) return chain;
    note(index, row);
    return flush();
  }

  /**
   * Close / SIGTERM: make every known row durable. `turns` (optional) is the
   * full in-memory list, so rows pushed before this writer saw them land too.
   */
  function flushAll(turns) {
    if (Array.isArray(turns)) turns.forEach((row, i) => note(i, row));
    else for (const i of rows.keys()) dirty.add(i);
    return flush();
  }

  function close() {
    closed = true;
  }

  return {
    sessionKey,
    onChange,
    flushAll,
    close,
    stats: () => ({ rows: rows.size, dirty: dirty.size, writes, failures }),
  };
}

/**
 * Process-wide registry of open media sessions so a SIGTERM (deploy) can make
 * them durable before exit. Bounded wait; never blocks exit for long.
 */
function createSessionRegistry() {
  const open = new Map();
  return {
    add(key, flushFn) {
      open.set(key, flushFn);
      return () => open.delete(key);
    },
    size: () => open.size,
    async flushAll({ timeoutMs = 4000 } = {}) {
      const jobs = [...open.values()].map((fn) =>
        Promise.resolve()
          .then(fn)
          .catch(() => null)
      );
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const result = await Promise.race([Promise.all(jobs).then(() => 'done'), timeout]);
      clearTimeout(timer);
      return { sessions: jobs.length, result };
    },
  };
}

/**
 * Install one SIGTERM handler: flush open sessions, then exit. Only when
 * the flag is on; off keeps Node's default (immediate exit).
 */
function installSigtermFlush({
  registry,
  proc = process,
  timeoutMs = 4000,
  log = console.log,
  exit,
  exitAfter = true,
} = {}) {
  let fired = false;
  const handler = async (signal) => {
    if (fired) return;
    fired = true;
    const started = Date.now();
    const out = await registry.flushAll({ timeoutMs });
    log(`[shutdown] ${signal || 'SIGTERM'}: flushed ${out.sessions} open media session(s) result=${out.result} in ${Date.now() - started}ms`);
    // With a graceful drain owning SIGTERM (#841 VOICE_GRACEFUL_DRAIN), only
    // flush; the drain decides when the process exits.
    if (exitAfter) (exit || ((code) => proc.exit(code)))(0);
  };
  proc.on('SIGTERM', handler);
  return handler;
}

/**
 * Prior transcript rows from another media session for this call mean this
 * session is a reconnect: resume, do not greet again.
 * @param {Array<{speaker?: string, text?: string}>} priorTurns
 */
function resumePlan(priorTurns, { lastLanguage = '' } = {}) {
  const turns = (Array.isArray(priorTurns) ? priorTurns : []).filter(
    (t) => t && (t.speaker === 'agent' || t.speaker === 'caller') && String(t.text || '').trim()
  );
  if (!turns.some((t) => t.speaker === 'agent')) return { resume: false, turns: [] };
  const lang = lastLanguage === 'sw' ? 'sw' : lastLanguage === 'en' ? 'en' : guessLanguage(turns);
  const line =
    lang === 'sw'
      ? 'Samahani, laini ilikatika kidogo. Niko hapa, endelea.'
      : "Sorry, the line dropped for a moment. I'm here, please go on.";
  return {
    resume: true,
    turns,
    heardCaller: turns.some((t) => t.speaker === 'caller'),
    language: lang,
    line,
  };
}

const SW_HINT = /\b(nikusaidie|tukusaidie|vipi|karibu|asante|sawa|ndio|naomba|nataka|habari|jina|bei|ngapi|aje)\b/i;
function guessLanguage(turns) {
  const callerText = turns
    .filter((t) => t.speaker === 'caller')
    .map((t) => t.text)
    .join(' ');
  const text = callerText || turns.map((t) => t.text).join(' ');
  return SW_HINT.test(text) ? 'sw' : 'en';
}

/** #841's VOICE_GRACEFUL_DRAIN parse (on/1/true/yes), so the two never fight. */
function gracefulDrainOn(env = process.env) {
  return /^(on|1|true|yes)$/i.test(String(env.VOICE_GRACEFUL_DRAIN || '').trim());
}

module.exports = {
  gracefulDrainOn,
  transcriptIncrementalEnabled,
  stableRowId,
  createIncrementalTranscriptWriter,
  createSessionRegistry,
  installSigtermFlush,
  resumePlan,
};
