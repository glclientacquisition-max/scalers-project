'use strict';

// VOICE_ENDED_CALL_GUARD (default on). HD_49d726c3dc9b (prod Aris, 18 Oct
// 2026 13:14 EAT, build ae8508ea): 1.2 s after our end_call closed /ws/media
// with code 1000, SautiKit opened a second /ws/media for the same call. It
// loaded the prompt, played the cached greeting and finalized again (duration
// 1, resolution abandoned). Completed ran four times (media close, POST /,
// /voice/events, the reconnect) and the first-forward judge ran four times.

const { describe, it, beforeEach, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const endedCalls = require('../src/speech/endedCalls');
const lifecycle = require('../src/speech/callLifecycle');
const { createCallFinalizer } = require('../src/callFinalize');
const { finalizeOnceEnabled, finalizeDecision } = require('../src/callFinalizeOnce');

const SID = 'HD_49d726c3dc9b';
const OPEN_AT = Date.parse('2026-10-18T10:14:34.165Z');
const END_AT = Date.parse('2026-10-18T10:17:20.184Z');

function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  const restore = () => {
    if (before == null) delete process.env[name];
    else process.env[name] = before;
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

const quietLog = { log() {}, warn() {}, error() {} };

/** Fake call row store with the real "never shorten a duration" rule. */
function fakeDb(initial = {}) {
  const row = { sautikit_call_sid: SID, status: 'in_progress', duration_seconds: null, summary: '{}', ...initial };
  const writes = [];
  return {
    row,
    writes,
    async getCall() {
      return { ...row };
    },
    async updateCallStatus({ status, durationSeconds }) {
      const terminal = ['complete', 'completed', 'failed', 'no_answer'];
      if (!terminal.includes(row.status)) row.status = /complete/.test(status) ? 'complete' : status;
      const next = Math.round(Number(durationSeconds));
      if (Number.isFinite(next) && (!row.duration_seconds || next >= row.duration_seconds)) {
        row.duration_seconds = next;
      }
      writes.push({ status, durationSeconds, kept: row.duration_seconds });
      return { ...row };
    },
    async mergeCallSummaryMeta({ patch }) {
      const meta = JSON.parse(row.summary || '{}');
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) meta[k] = v;
      row.summary = JSON.stringify(meta);
      return { summary: row.summary };
    },
  };
}

function finalizerFor(db) {
  const calls = { resolution: [], judge: [], textback: 0 };
  const mark = createCallFinalizer({
    db,
    endedCalls,
    persistCallResolution: async (sid, source, opts) => {
      calls.resolution.push({ source, turns: opts.turns ? opts.turns.length : 0, write: opts.writeResolution !== false });
    },
    persistFirstForwardAcceptance: async (sid, seconds) => {
      calls.judge.push(seconds);
    },
    maybeSendMissedTextback: async () => {
      calls.textback += 1;
    },
    finalizeOnceEnabled,
    finalizeDecision,
    log: quietLog,
  });
  return { mark, calls };
}

const TURNS = Array.from({ length: 14 }, (_, i) => ({ role: 'caller', text: `turn ${i + 1}` }));

beforeEach(() => {
  endedCalls.resetEndedCalls();
  lifecycle.forgetCallTerminal(SID);
});

describe('media reconnect after the call ended', () => {
  it('HD_49d726c3dc9b: the reconnect 1.2 s after our end_call is refused (memory)', async () => {
    endedCalls.noteMediaOpen(SID, OPEN_AT);
    endedCalls.noteMediaClose(SID, { ended: true, reason: 'end_call', at: END_AT });
    let dbRead = 0;
    const verdict = await endedCalls.checkMediaConnect(SID, {
      terminalSince: lifecycle.callTerminalSince,
      streamIssued: () => true,
      getCall: async () => {
        dbRead += 1;
        return null;
      },
    });
    assert.equal(verdict.refuse, true);
    assert.equal(verdict.reason, 'end_call');
    assert.equal(verdict.source, 'memory');
    assert.equal(dbRead, 0);
  });

  it('a terminal webhook seen after the session opened ends the call too', async () => {
    endedCalls.noteMediaOpen(SID, Date.now() - 5000);
    lifecycle.noteCallTerminal(SID, { source: 'voice/events', status: 'completed' });
    // The socket dropped abnormally (no end evidence of its own).
    endedCalls.noteMediaClose(SID, { ended: false });
    const verdict = await endedCalls.checkMediaConnect(SID, { terminalSince: lifecycle.callTerminalSince });
    assert.equal(verdict.refuse, true);
    assert.match(verdict.reason, /terminal_webhook:voice\/events/);
  });

  it('a set-up webhook that already says Completed does not refuse the first session', async () => {
    lifecycle.noteCallTerminal(SID, { source: 'voice/incoming', status: 'completed', at: Date.now() - 1000 });
    const verdict = await endedCalls.checkMediaConnect(SID, {
      terminalSince: lifecycle.callTerminalSince,
      streamIssued: () => true,
    });
    assert.equal(verdict.refuse, false);
  });

  it('an abnormal drop with no end evidence lets a resumed session in', async () => {
    endedCalls.noteMediaOpen(SID, Date.now() - 5000);
    endedCalls.noteMediaClose(SID, { ended: false });
    const verdict = await endedCalls.checkMediaConnect(SID, { terminalSince: lifecycle.callTerminalSince });
    assert.equal(verdict.refuse, false);
  });

  it('after a restart the call row decides: terminal + finalized marker refuses', async () => {
    const db = fakeDb({ status: 'complete', duration_seconds: 167, summary: JSON.stringify({ finalized_at: '2026-10-18T10:17:21Z' }) });
    const verdict = await endedCalls.checkMediaConnect(SID, { streamIssued: () => false, getCall: db.getCall });
    assert.equal(verdict.refuse, true);
    assert.equal(verdict.source, 'db');
    assert.equal(verdict.reason, 'db_complete');
    // Remembered: the next attempt needs no DB read.
    const again = await endedCalls.checkMediaConnect(SID, { getCall: async () => { throw new Error('no read'); } });
    assert.equal(again.source, 'memory');
  });

  it('a terminal row without the marker (set-up Completed quirk) is answered', async () => {
    const db = fakeDb({ status: 'complete' });
    const verdict = await endedCalls.checkMediaConnect(SID, { streamIssued: () => false, getCall: db.getCall });
    assert.equal(verdict.refuse, false);
  });

  it('a new call streamed by this process adds no DB round trip', async () => {
    let reads = 0;
    const verdict = await endedCalls.checkMediaConnect(SID, {
      streamIssued: () => true,
      getCall: async () => {
        reads += 1;
        return null;
      },
    });
    assert.equal(verdict.refuse, false);
    assert.equal(reads, 0);
  });

  it('DB errors and slow reads fail open', async () => {
    const err = await endedCalls.checkMediaConnect(SID, { getCall: async () => { throw new Error('down'); } });
    assert.equal(err.refuse, false);
    const slow = await endedCalls.checkMediaConnect(SID, {
      timeoutMs: 20,
      getCall: () => new Promise((r) => setTimeout(() => r({ status: 'complete', summary: '{"finalized_at":"x"}' }), 60)),
    });
    assert.equal(slow.refuse, false);
    assert.equal(slow.source, 'db_timeout');
  });

  it('VOICE_ENDED_CALL_GUARD=off never refuses', async () => {
    endedCalls.noteMediaOpen(SID, OPEN_AT);
    endedCalls.noteMediaClose(SID, { ended: true, reason: 'end_call' });
    const verdict = await withEnv('VOICE_ENDED_CALL_GUARD', 'off', () => endedCalls.checkMediaConnect(SID));
    assert.equal(verdict.refuse, false);
    assert.equal(endedCalls.endedCallGuardEnabled({}), true);
    assert.equal(endedCalls.endedCallGuardEnabled({ VOICE_ENDED_CALL_GUARD: '0' }), false);
  });
});

describe('finalize once per call', () => {
  it('HD_49d726c3dc9b order: media close, POST /, /voice/events, reconnect: one finalize, duration 167', async () => {
    const db = fakeDb();
    const { mark, calls } = finalizerFor(db);
    endedCalls.noteMediaOpen(SID, OPEN_AT);
    // 1. Our end_call closes the socket (1000) after 165 s, with the turns.
    endedCalls.noteMediaClose(SID, { ended: true, reason: 'end_call' });
    await mark({ callSid: SID, status: 'complete', durationSeconds: 165, source: 'ws/media', turns: TURNS });
    // 2 and 3. SautiKit's Completed on POST / and on /voice/events.
    await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/incoming' });
    await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/events' });
    // 4. The reconnect is refused, so it never finalizes. Had it got
    // through, its 1-second close is skipped and cannot shorten the row.
    const verdict = await endedCalls.checkMediaConnect(SID, { terminalSince: lifecycle.callTerminalSince });
    assert.equal(verdict.refuse, true);
    await mark({ callSid: SID, status: 'complete', durationSeconds: 1, source: 'ws/media', turns: [] });

    assert.equal(calls.resolution.length, 1, 'resolution and summary written once');
    assert.equal(calls.resolution[0].source, 'ws/media');
    assert.equal(calls.resolution[0].turns, 14);
    assert.equal(calls.judge.length, 1, 'first-forward judge once');
    assert.deepEqual(db.writes.map((w) => w.kept), [165, 167, 167, 167]);
    assert.equal(db.row.duration_seconds, 167);
    assert.equal(db.row.status, 'complete');
    const meta = JSON.parse(db.row.summary);
    assert.ok(meta.finalized_at);
    assert.equal(meta.finalized_by, 'ws/media');
    assert.equal(meta.finalized_provisional, false);
  });

  it('triple Completed while the caller is still on the socket: deferred, then one finalize at close', async () => {
    const db = fakeDb();
    const { mark, calls } = finalizerFor(db);
    endedCalls.noteMediaOpen(SID, OPEN_AT);
    await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/incoming' });
    await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/events' });
    await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/incoming-setup-terminal' });
    assert.equal(calls.resolution.length, 0);
    assert.equal(calls.judge.length, 0);
    assert.equal(db.row.status, 'complete');
    endedCalls.noteMediaClose(SID, { ended: true, reason: 'media_close_1000' });
    await mark({ callSid: SID, status: 'complete', durationSeconds: 166, source: 'ws/media', turns: TURNS });
    assert.equal(calls.resolution.length, 1);
    assert.equal(calls.resolution[0].turns, 14);
    assert.deepEqual(calls.judge, [167], 'judge reads the longest duration');
    assert.equal(db.row.duration_seconds, 167);
  });

  it('two closers racing in one process: only one runs', async () => {
    const db = fakeDb();
    const { mark, calls } = finalizerFor(db);
    await Promise.all([
      mark({ callSid: SID, status: 'completed', durationSeconds: 10, source: 'voice/incoming' }),
      mark({ callSid: SID, status: 'completed', durationSeconds: 10, source: 'voice/events' }),
      mark({ callSid: SID, status: 'completed', durationSeconds: 10, source: 'voice/events' }),
    ]);
    assert.equal(calls.resolution.length, 1);
    assert.equal(calls.judge.length, 1);
  });

  it('a row already finalized by another replica is not finalized again', async () => {
    const db = fakeDb({ status: 'complete', duration_seconds: 167, summary: JSON.stringify({ finalized_at: 'x', finalized_provisional: false }) });
    const { mark, calls } = finalizerFor(db);
    await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/events' });
    assert.equal(calls.resolution.length, 0);
    assert.equal(calls.judge.length, 0);
  });

  it('an abnormal drop finalizes provisionally; the resumed session finalizes last; later webhooks skip', async () => {
    const db = fakeDb();
    const { mark, calls } = finalizerFor(db);
    endedCalls.noteMediaOpen(SID, OPEN_AT);
    endedCalls.noteMediaClose(SID, { ended: false });
    await mark({ callSid: SID, status: 'complete', durationSeconds: 40, source: 'ws/media', turns: TURNS.slice(0, 4), provisional: true });
    endedCalls.noteMediaOpen(SID, OPEN_AT + 41000);
    endedCalls.noteMediaClose(SID, { ended: true, reason: 'media_close_1000' });
    await mark({ callSid: SID, status: 'complete', durationSeconds: 90, source: 'ws/media', turns: TURNS });
    await mark({ callSid: SID, status: 'completed', durationSeconds: 91, source: 'voice/events' });
    assert.deepEqual(calls.resolution.map((r) => r.turns), [4, 14]);
    assert.equal(JSON.parse(db.row.summary).finalized_provisional, false);
    assert.equal(db.row.duration_seconds, 91);
  });

  it('a deferred end is handed to the media close even with a live transfer pending', () => {
    endedCalls.noteMediaOpen(SID, OPEN_AT);
    assert.equal(endedCalls.finalizeTurn(SID, { source: 'voice/events', status: 'completed', durationSeconds: 30 }), 'defer');
    endedCalls.noteMediaClose(SID, { ended: true });
    assert.deepEqual(endedCalls.takeDeferred(SID), { status: 'completed', durationSeconds: 30, source: 'voice/events' });
    assert.equal(endedCalls.takeDeferred(SID), null);
  });

  it('a later failed/no_answer flip still gets the text-back check when finalize is skipped', async () => {
    const db = fakeDb();
    const { mark, calls } = finalizerFor(db);
    await mark({ callSid: SID, status: 'completed', durationSeconds: 0, source: 'voice/incoming' });
    await mark({ callSid: SID, status: 'no_answer', durationSeconds: 0, source: 'voice/events' });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.resolution.length, 1);
    assert.equal(calls.textback, 2);
  });

  it('VOICE_ENDED_CALL_GUARD=off restores the #692 behaviour (every event finalizes)', async () => {
    const db = fakeDb();
    const { mark, calls } = finalizerFor(db);
    await withEnv('VOICE_ENDED_CALL_GUARD', 'off', async () => {
      await mark({ callSid: SID, status: 'complete', durationSeconds: 165, source: 'ws/media', turns: TURNS });
      await mark({ callSid: SID, status: 'completed', durationSeconds: 167, source: 'voice/incoming' });
    });
    assert.equal(calls.resolution.length, 2);
    assert.deepEqual(calls.judge, [165, 167]);
  });
});

describe('db.updateCallStatus never shortens a longer duration', () => {
  const rows = [];
  let db;
  function builder() {
    const st = { op: 'select', patch: null, eq: [], notIn: null };
    const run = () => {
      const match = (r) => st.eq.every(([k, v]) => r[k] === v) && (!st.notIn || !st.notIn.includes(r.status));
      const hit = rows.filter(match);
      if (st.op === 'update') hit.forEach((r) => Object.assign(r, st.patch));
      return { data: hit[0] ? { ...hit[0] } : null, error: null };
    };
    const b = {
      select() { return b; },
      update(p) { st.op = 'update'; st.patch = p; return b; },
      eq(k, v) { st.eq.push([k, v]); return b; },
      not(col, op, list) { st.notIn = String(list).replace(/[()]/g, '').split(','); return b; },
      in() { return b; }, order() { return b; }, limit() { return b; }, gte() { return b; },
      maybeSingle() { return Promise.resolve(run()); },
      single() { return Promise.resolve(run()); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }
  before(() => {
    const clientPath = require.resolve('../src/lib/supabaseClient');
    require.cache[clientPath] = {
      id: clientPath,
      filename: clientPath,
      loaded: true,
      exports: { supabase: { from: builder, rpc: async () => ({ data: null, error: null }) } },
    };
    db = require('../src/db');
  });
  it('165 → 167 → 1 → 167 keeps 167', async () => {
    rows.length = 0;
    rows.push({ id: '4ef395b4-5780-4819-a0e3-72faf9fa7b98', sautikit_call_sid: SID, status: 'in_progress', duration_seconds: null, summary: '{}', tenant_id: 't' });
    for (const seconds of [165, 167, 1, 167]) {
      await db.updateCallStatus({ callSid: SID, status: 'complete', durationSeconds: seconds });
    }
    assert.equal(rows[0].duration_seconds, 167);
    assert.equal(rows[0].status, 'complete');
  });
});

describe('server.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('the /ws/media upgrade checks for an ended call before any session starts', () => {
    const at = src.indexOf("if (pathname === '/ws/media') {");
    const block = src.slice(at, at + 1600);
    assert.match(block, /endedCalls\s*\.checkMediaConnect\(mediaSid/);
    assert.ok(block.indexOf('refuseEndedMedia(ws') < block.indexOf("mediaWss.emit('connection'"));
    assert.match(src, /ws\.close\(1000, 'call_already_ended'\)/);
    assert.match(src, /refused media reconnect for ended call/);
  });
  it('the media close marks the end and a refused session finalizes nothing', () => {
    assert.match(src, /endedCalls\.noteMediaClose\(sessionCallSid/);
    assert.match(src, /if \(endedRefused\) \{\s*console\.log\(`\[ws\/media\] refused session closed/);
    assert.match(src, /provisional: !endedByThisSession && !deferredEnd/);
    assert.match(src, /if \(endedRefused\) return;\s*\/\/ Every answered call starts at profile pace/);
  });
  it('every terminal path goes through the shared finalizer', () => {
    assert.match(src, /const markCallTerminal = createCallFinalizer\(/);
    assert.match(src, /async function markCallTerminalFromWebhook\(args\) \{\s*return markCallTerminal\(args\);/);
  });
});
