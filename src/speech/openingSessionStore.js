'use strict';

// Shared call-opening state (VOICE_OPENING_V2), keyed by callSid, so a
// SautiKit reconnect that lands on another replica, or comes after a restart,
// does not greet again.
//
// Adapters, same interface (async; never throws):
//   claim(callSid, { lastAgentLine, noticeGiven }) -> { won: true|false|null, greetedAt }
//       Exactly one stream per call wins the greeting. won:null = unknown
//       (error, timeout, no calls row): the caller fails open and greets.
//   get(callSid)            -> { greetedAt, lastAgentLine, noticeGiven, streamSeq } | null
//   noteLine(callSid, line) -> last line spoken (re-spoken after a cut)
//   bumpStream(callSid)     -> new stream_seq | null
//   markNoticeGiven(callSid)-> recording notice heard (needs a Platform helper)
//   kind()                  -> 'memory' | 'db'
//
//   memory - this process only (one replica, tests).
//   db     - Platform's helpers from #844 (docs/supabase/greeting_language.sql,
//            src/db.js): markCallGreeted (atomic claim: update ... where
//            greeted_at is null), getCallResumeState, updateLastAgentLine,
//            bumpStreamSeq (RPC bump_call_stream_seq) on calls.greeted_at,
//            last_agent_line, notice_given, stream_seq, last_stream_at.
//            Feature-detected: the helpers must exist (main has none until
//            #844 merges) and a one-time probe must not report missing
//            columns; otherwise memory with one warning.
//            notice_given is only written by markCallGreeted at the claim;
//            a later "notice heard" needs db.markCallNoticeGiven (Platform
//            ask). It is used when present.

const RECHECK_MS = 60000;
const MEMORY_TTL_MS = 10 * 60 * 1000;
const PROBE_SID = '__voice_opening_probe__';
const MIGRATION_HINT = /greeted_at|last_agent_line|notice_given|stream_seq|last_stream_at|bump_call_stream_seq|apply greeting_language\.sql/i;

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
      r = { greetedAt: null, lastAgentLine: '', noticeGiven: false, streamSeq: 0, touchedAt: now() };
      rows.set(sid, r);
    }
    r.touchedAt = now();
    return r;
  }
  return {
    kind: () => 'memory',
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
      return { greetedAt: r.greetedAt, lastAgentLine: r.lastAgentLine, noticeGiven: r.noticeGiven, streamSeq: r.streamSeq };
    },
    async noteLine(callSid, line) {
      const sid = clean(callSid);
      if (!sid || !clean(line)) return false;
      row(sid).lastAgentLine = clean(line).slice(0, 500);
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

/** Does db carry Platform's #844 opening helpers? */
function dbHasOpeningHelpers(db) {
  return Boolean(
    db &&
      typeof db.markCallGreeted === 'function' &&
      typeof db.getCallResumeState === 'function' &&
      typeof db.updateLastAgentLine === 'function' &&
      typeof db.bumpStreamSeq === 'function'
  );
}

/**
 * @param {{ db: object, log?: object, now?: () => number, memory?: object }} o
 */
function createDbSessionStore(o = {}) {
  const db = o.db;
  const log = o.log || console;
  const now = o.now || (() => Date.now());
  const memory = o.memory || createMemorySessionStore({ now });
  let mode = dbHasOpeningHelpers(db) ? 'unknown' : 'no_helpers'; // unknown | ready | missing | down | no_helpers
  let checkedAt = 0;
  let detecting = null;
  let warned = '';

  function warnOnce(kind, msg) {
    if (warned === kind) return;
    warned = kind;
    log.warn(msg);
  }
  if (mode === 'no_helpers') {
    warnOnce(
      'no_helpers',
      '[opening-store] db.markCallGreeted/getCallResumeState/updateLastAgentLine/bumpStreamSeq not found (Platform #844 not merged); resume state stays in this replica\'s memory'
    );
  }

  /**
   * One probe: a claim on a sid no calls row has. It updates nothing; an
   * unmigrated database answers with the missing-column error.
   */
  async function detect() {
    if (mode === 'ready' || mode === 'missing' || mode === 'no_helpers') return mode;
    if (mode === 'down' && now() - checkedAt < RECHECK_MS) return mode;
    if (detecting) return detecting;
    detecting = (async () => {
      try {
        const r = await db.markCallGreeted({ callSid: PROBE_SID });
        checkedAt = now();
        if (r && r.ok) {
          mode = 'ready';
          log.log?.('[opening-store] calls.greeted_at/last_agent_line/notice_given/stream_seq present: shared resume on');
        } else if (MIGRATION_HINT.test(String(r?.error || ''))) {
          mode = 'missing';
          warnOnce('missing', '[opening-store] calls opening columns missing (apply greeting_language.sql, Platform #844); memory');
        } else {
          mode = 'down';
          warnOnce('down', `[opening-store] opening helpers failed (${r?.error || 'unknown'}); memory until they answer`);
        }
      } catch (err) {
        checkedAt = now();
        mode = 'down';
        warnOnce('down', `[opening-store] opening helpers failed (${err?.message || err}); memory until they answer`);
      } finally {
        detecting = null;
      }
      return mode;
    })();
    return detecting;
  }

  const ready = async () => (await detect()) === 'ready';

  return {
    kind: () => (mode === 'ready' ? 'db' : 'memory'),
    mode: () => mode,
    detect,
    async claim(callSid, opts = {}) {
      const sid = clean(callSid);
      const mem = await memory.claim(sid, opts);
      if (!(await ready())) return mem;
      const r = await db.markCallGreeted({ callSid: sid, lastAgentLine: opts.lastAgentLine, noticeGiven: opts.noticeGiven });
      if (!r || !r.ok) return { won: null, greetedAt: null, error: r?.error || 'unknown' };
      if (r.missing) return { won: null, greetedAt: null, missing: true };
      return { won: r.won === true, greetedAt: toMs(r.greetedAt) };
    },
    async get(callSid) {
      const sid = clean(callSid);
      if (!(await ready())) return memory.get(sid);
      const s = await db.getCallResumeState(sid);
      if (!s) return memory.get(sid);
      return {
        greetedAt: toMs(s.greetedAt),
        lastAgentLine: clean(s.lastAgentLine),
        noticeGiven: s.noticeGiven === true,
        streamSeq: Number(s.streamSeq) || 0,
      };
    },
    async noteLine(callSid, line) {
      await memory.noteLine(callSid, line);
      if (!(await ready())) return true;
      const r = await db.updateLastAgentLine(clean(callSid), line);
      return Boolean(r && r.ok);
    },
    async bumpStream(callSid) {
      const local = await memory.bumpStream(callSid);
      if (!(await ready())) return local;
      const r = await db.bumpStreamSeq(clean(callSid));
      return r && r.ok && r.streamSeq != null ? r.streamSeq : null;
    },
    async markNoticeGiven(callSid) {
      await memory.markNoticeGiven(callSid);
      if (!(await ready()) || typeof db.markCallNoticeGiven !== 'function') return false;
      const r = await db.markCallNoticeGiven(clean(callSid));
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
  PROBE_SID,
  createMemorySessionStore,
  createDbSessionStore,
  createOpeningSessionStore,
  dbHasOpeningHelpers,
};
