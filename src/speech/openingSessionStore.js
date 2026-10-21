'use strict';

// Shared call-opening state (VOICE_OPENING_V2), keyed by callSid, so a
// SautiKit reconnect that lands on another replica, or comes after a restart,
// does not greet again.
//
// Adapters, same interface (async; never throws):
//   claim(callSid, { lastAgentLine, noticeGiven }) -> { won: true|false|null, greetedAt }
//       Exactly one stream per call wins the greeting. won:null = unknown
//       (error, timeout, no calls row): the caller fails open and greets.
//   get(callSid)  -> { greetedAt, lastAgentLine, lastLineCut, noticeGiven, streamSeq } | null
//   noteLine(callSid, line, { cut }) -> last line spoken; cut = a barge or a
//       socket loss stopped it mid-way (re-said once on a resume)
//   bumpStream(callSid)     -> new stream_seq | null
//   markNoticeGiven(callSid)-> the recording notice was spoken
//   kind()                  -> 'memory' | 'db'
//   contactsOn()            -> contacts.last_language usable (read + write)
//
//   memory - this process only (one replica, tests).
//   db     - Platform's helpers from #844 (src/db.js) on calls.greeted_at,
//            last_agent_line, last_line_cut, notice_given, stream_seq,
//            last_stream_at: markCallGreeted (atomic claim), getCallResumeState,
//            updateLastAgentLine(callSid, line, { cut }), markLastLineCut,
//            bumpStreamSeq, markCallNoticeGiven.
//            Feature detection never writes: db.probeGreetingSchema() (a
//            read-only limit-0 select of all 6 calls columns, and of
//            contacts.last_language/last_language_at/name_confirmed) ->
//            { calls, contacts }; no column-error parsing here. Missing
//            probe, calls false or a throw -> memory with one warning; false
//            and throws are re-probed every RECHECK_MS (read-only). contacts gates last_language reads
//            and writes on its own. Every other helper is checked one by one
//            (typeof db.x === 'function'), so both #844 pushes work.

const RECHECK_MS = 60000;
const MEMORY_TTL_MS = 10 * 60 * 1000;

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function createMemorySessionStore({ now = () => Date.now(), ttlMs = MEMORY_TTL_MS } = {}) {
  const rows = new Map();
  function row(sid) {
    let r = rows.get(sid);
    if (!r) {
      if (rows.size > 5000) {
        const cutoff = now() - ttlMs;
        for (const [k, v] of rows) if (v.touchedAt < cutoff) rows.delete(k);
      }
      r = { greetedAt: null, lastAgentLine: '', lastLineCut: false, noticeGiven: false, streamSeq: 0, touchedAt: now() };
      rows.set(sid, r);
    }
    r.touchedAt = now();
    return r;
  }
  return {
    kind: () => 'memory',
    contactsOn: () => false,
    async claim(callSid, { lastAgentLine, noticeGiven } = {}) {
      const sid = clean(callSid);
      if (!sid) return { won: null, greetedAt: null };
      const r = row(sid);
      if (r.greetedAt != null) return { won: false, greetedAt: r.greetedAt };
      r.greetedAt = now();
      if (clean(lastAgentLine)) r.lastAgentLine = clean(lastAgentLine).slice(0, 500);
      if (noticeGiven === true) r.noticeGiven = true;
      return { won: true, greetedAt: r.greetedAt };
    },
    async get(callSid) {
      const r = rows.get(clean(callSid));
      if (!r) return null;
      return {
        greetedAt: r.greetedAt,
        lastAgentLine: r.lastAgentLine,
        lastLineCut: r.lastLineCut,
        noticeGiven: r.noticeGiven,
        streamSeq: r.streamSeq,
      };
    },
    async noteLine(callSid, line, { cut = false } = {}) {
      const sid = clean(callSid);
      if (!sid || !clean(line)) return false;
      const r = row(sid);
      r.lastAgentLine = clean(line).slice(0, 500);
      r.lastLineCut = cut === true;
      return true;
    },
    async bumpStream(callSid) {
      const sid = clean(callSid);
      if (!sid) return null;
      const r = row(sid);
      r.streamSeq += 1;
      return r.streamSeq;
    },
    async markNoticeGiven(callSid) {
      const sid = clean(callSid);
      if (!sid) return false;
      row(sid).noticeGiven = true;
      return true;
    },
    size: () => rows.size,
  };
}

const has = (db, name) => Boolean(db) && typeof db[name] === 'function';

/** Does db carry what shared resume needs (#844)? The rest is optional. */
function dbHasOpeningHelpers(db) {
  return has(db, 'probeGreetingSchema') && has(db, 'markCallGreeted') && has(db, 'getCallResumeState');
}

/**
 * @param {{ db: object, log?: object, now?: () => number, memory?: object }} o
 */
function createDbSessionStore(o = {}) {
  const db = o.db;
  const log = o.log || console;
  const now = o.now || (() => Date.now());
  const memory = o.memory || createMemorySessionStore({ now });
  // calls: unknown | ready | missing | down | no_helpers
  let mode = dbHasOpeningHelpers(db) ? 'unknown' : 'no_helpers';
  let contacts = false;
  let checkedAt = 0;
  let detecting = null;
  let warned = '';

  function warnOnce(kind, msg) {
    if (warned === kind) return;
    warned = kind;
    log.warn(msg);
  }
  if (mode === 'no_helpers') {
    const missing = ['probeGreetingSchema', 'markCallGreeted', 'getCallResumeState'].filter((n) => !has(db, n));
    warnOnce('no_helpers', `[opening-store] db.${missing.join('/db.')} not found (Platform #844); resume state stays in this replica's memory`);
  }

  /** One read-only probe (limit-0 selects). Never writes. */
  async function detect() {
    if (mode === 'ready' || mode === 'no_helpers') return mode;
    // #844's probe answers false on a missing column *or* any error, so a
    // false is re-probed (read-only) every RECHECK_MS: a blip at boot or a
    // migration applied later turns shared resume on without a restart.
    if ((mode === 'down' || mode === 'missing') && now() - checkedAt < RECHECK_MS) return mode;
    if (detecting) return detecting;
    detecting = (async () => {
      try {
        const r = await db.probeGreetingSchema();
        checkedAt = now();
        contacts = Boolean(r && r.contacts === true);
        if (r && r.calls === true) {
          mode = 'ready';
          log.log?.(
            `[opening-store] calls opening columns present: shared resume on (contacts.last_language ${contacts ? 'on' : 'off'})`
          );
        } else if (r && r.calls === false) {
          mode = 'missing';
          warnOnce(
            'missing',
            `[opening-store] probeGreetingSchema: calls opening columns not readable (migration missing or DB error); memory, re-probing every ${RECHECK_MS / 1000}s (contacts.last_language ${contacts ? 'on' : 'off'})`
          );
        } else {
          mode = 'down';
          warnOnce('down', `[opening-store] probeGreetingSchema failed (${r?.error || 'no answer'}); memory until it answers`);
        }
      } catch (err) {
        checkedAt = now();
        mode = 'down';
        contacts = false;
        warnOnce('down', `[opening-store] probeGreetingSchema failed (${err?.message || err}); memory until it answers`);
      } finally {
        detecting = null;
      }
      return mode;
    })();
    return detecting;
  }

  const ready = async () => (await detect()) === 'ready';
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  return {
    kind: () => (mode === 'ready' ? 'db' : 'memory'),
    mode: () => mode,
    contactsOn: () => contacts,
    detect,
    async claim(callSid, opts = {}) {
      const sid = clean(callSid);
      const mem = await memory.claim(sid, opts);
      if (!(await ready())) return mem;
      const r = await safe(() => db.markCallGreeted({ callSid: sid, lastAgentLine: opts.lastAgentLine, noticeGiven: opts.noticeGiven }));
      if (!r || !r.ok) return { won: null, greetedAt: null, error: r?.error || 'unknown' };
      if (r.missing) return { won: null, greetedAt: null, missing: true };
      return { won: r.won === true, greetedAt: toMs(r.greetedAt) };
    },
    async get(callSid) {
      const sid = clean(callSid);
      if (!(await ready())) return memory.get(sid);
      const st = await safe(() => db.getCallResumeState(sid));
      if (!st) return memory.get(sid);
      return {
        greetedAt: toMs(st.greetedAt),
        lastAgentLine: clean(st.lastAgentLine),
        // Absent on the first #844 push: never cut (listen).
        lastLineCut: st.lastLineCut === true,
        noticeGiven: st.noticeGiven === true,
        streamSeq: Number(st.streamSeq) || 0,
      };
    },
    async noteLine(callSid, line, { cut = false } = {}) {
      const sid = clean(callSid);
      await memory.noteLine(sid, line, { cut });
      if (!(await ready())) return true;
      if (has(db, 'updateLastAgentLine')) {
        // The first #844 push ignores the third argument; the next stores
        // calls.last_line_cut from it.
        const r = await safe(() => db.updateLastAgentLine(sid, line, { cut: cut === true }));
        return Boolean(r && r.ok);
      }
      if (cut && has(db, 'markLastLineCut')) {
        const r = await safe(() => db.markLastLineCut(sid));
        return Boolean(r && r.ok);
      }
      return false;
    },
    async bumpStream(callSid) {
      const local = await memory.bumpStream(callSid);
      if (!(await ready()) || !has(db, 'bumpStreamSeq')) return local;
      const r = await safe(() => db.bumpStreamSeq(clean(callSid)));
      return r && r.ok && r.streamSeq != null ? r.streamSeq : null;
    },
    async markNoticeGiven(callSid) {
      await memory.markNoticeGiven(callSid);
      if (!(await ready()) || !has(db, 'markCallNoticeGiven')) return false;
      const r = await safe(() => db.markCallNoticeGiven(clean(callSid)));
      return Boolean(r && r.ok);
    },
  };
}

/**
 * The store server.js uses: Platform's db helpers when present and migrated,
 * else memory. VOICE_OPENING_STORE=memory forces memory.
 */
function createOpeningSessionStore({ db = null, env = process.env, log = console, now } = {}) {
  const forced = clean(env.VOICE_OPENING_STORE).toLowerCase();
  if (forced === 'memory' || !db) return createMemorySessionStore({ now });
  return createDbSessionStore({ db, log, now });
}

module.exports = {
  RECHECK_MS,
  createMemorySessionStore,
  createDbSessionStore,
  createOpeningSessionStore,
  dbHasOpeningHelpers,
};
