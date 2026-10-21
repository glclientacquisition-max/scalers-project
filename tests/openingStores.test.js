'use strict';

// VOICE_OPENING_V2 rulings 2 + 3, unit level: the shared opening store
// (memory adapter, Platform #844 db helpers MOCKED: no database is touched),
// the claim -> greet / resume decision, the webhook prefetch cache and the
// greeting latency report script.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createMemorySessionStore,
  createDbSessionStore,
  createOpeningSessionStore,
  dbHasOpeningHelpers,
  RECHECK_MS,
} = require('../src/speech/openingSessionStore');
const callOpening = require('../src/speech/callOpening');
const { createCallPrefetch } = require('../src/speech/callPrefetch');
const latency = require('../scripts/greeting-latency-report');

const tick = () => new Promise((r) => setImmediate(r));

function quietLog() {
  const lines = { warn: [], log: [] };
  return { lines, warn: (m) => lines.warn.push(String(m)), log: (m) => lines.log.push(String(m)) };
}

/**
 * Mock of Platform's #844 helpers on a shared in-test "calls" table, same
 * return shapes as src/db.js (none throw). Two mocks over one table = two
 * replicas over one database. `push` picks the helper set:
 *   'next'    - #844 @d4609435: probeGreetingSchema, markCallNoticeGiven
 *               -> {ok, updated}, last_line_cut via
 *               updateLastAgentLine(sid, line, {cut}) / markLastLineCut(sid, cut=true)
 *   'current' - #844 @962fb6e6: no probe, no notice helper, no cut column
 * Every call is recorded; WRITES lists the helpers that write.
 */
const WRITES = new Set(['markCallGreeted', 'updateLastAgentLine', 'bumpStreamSeq', 'markCallNoticeGiven', 'markLastLineCut']);
function mockDb(table = new Map(), { push = 'next', probe = { calls: true, contacts: true }, probeThrows = false, failClaim = false } = {}) {
  const calls = [];
  const row = (sid) => table.get(sid);
  const db = {
    table,
    calls,
    writes: () => calls.filter(([f]) => WRITES.has(f)),
    async markCallGreeted({ callSid, lastAgentLine, noticeGiven } = {}) {
      calls.push(['markCallGreeted', callSid]);
      if (failClaim) return { ok: false, won: null, error: 'boom' };
      const r = row(callSid);
      if (!r) return { ok: true, won: false, missing: true };
      if (r.greeted_at) return { ok: true, won: false, greetedAt: r.greeted_at };
      r.greeted_at = new Date(1700000000000).toISOString();
      if (lastAgentLine) r.last_agent_line = String(lastAgentLine).slice(0, 500);
      if (noticeGiven === true) r.notice_given = true;
      return { ok: true, won: true, greetedAt: r.greeted_at };
    },
    async getCallResumeState(callSid) {
      calls.push(['getCallResumeState', callSid]);
      const r = row(callSid);
      if (!r) return null;
      const out = {
        greetedAt: r.greeted_at || null,
        lastAgentLine: r.last_agent_line || null,
        noticeGiven: r.notice_given === true,
        streamSeq: r.stream_seq || 0,
      };
      if (push === 'next') out.lastLineCut = r.last_line_cut === true;
      return out;
    },
    async updateLastAgentLine(callSid, line, opts) {
      calls.push(['updateLastAgentLine', callSid, opts]);
      const r = row(callSid);
      if (r) {
        r.last_agent_line = String(line).slice(0, 500);
        if (push === 'next') r.last_line_cut = Boolean(opts && opts.cut === true);
      }
      return { ok: true, updated: r ? 1 : 0 };
    },
    async bumpStreamSeq(callSid) {
      calls.push(['bumpStreamSeq', callSid]);
      const r = row(callSid);
      if (!r) return { ok: true, missing: true, streamSeq: null };
      r.stream_seq = (r.stream_seq || 0) + 1;
      return { ok: true, streamSeq: r.stream_seq };
    },
  };
  if (push === 'next') {
    db.probeGreetingSchema = async () => {
      calls.push(['probeGreetingSchema']);
      if (probeThrows) throw new Error('fetch failed');
      return probe;
    };
    db.markCallNoticeGiven = async (callSid) => {
      calls.push(['markCallNoticeGiven', callSid]);
      const r = row(callSid);
      if (r) r.notice_given = true;
      return { ok: true, updated: r ? 1 : 0 };
    };
  }
  return db;
}

describe('openingSessionStore: memory adapter', () => {
  it('claim: exactly one winner per call; get/noteLine(cut)/bumpStream/markNoticeGiven', async () => {
    const m = createMemorySessionStore({ now: () => 5000 });
    assert.deepEqual(await m.claim('CA1', { lastAgentLine: 'Hello' }), { won: true, greetedAt: 5000 });
    assert.deepEqual(await m.claim('CA1'), { won: false, greetedAt: 5000 });
    assert.equal(await m.bumpStream('CA1'), 1);
    assert.equal(await m.bumpStream('CA1'), 2);
    await m.noteLine('CA1', 'Tukusaidie vipi?', { cut: true });
    await m.markNoticeGiven('CA1');
    assert.deepEqual(await m.get('CA1'), {
      greetedAt: 5000,
      lastAgentLine: 'Tukusaidie vipi?',
      lastLineCut: true,
      noticeGiven: true,
      streamSeq: 2,
    });
    await m.noteLine('CA1', 'Sawa.');
    assert.equal((await m.get('CA1')).lastLineCut, false);
    assert.equal(await m.get('nope'), null);
    assert.equal(m.contactsOn(), false);
  });
});

describe('openingSessionStore: db adapter on #844 helpers (mocked, no DB)', () => {
  it('probe false -> memory, one warning, nothing written', async () => {
    const log = quietLog();
    const db = mockDb(new Map([['CA1', {}]]), { probe: { calls: false, contacts: false } });
    const s = createDbSessionStore({ db, log });
    assert.equal(await s.detect(), 'missing');
    assert.equal((await s.claim('CA1')).won, true, 'memory decides');
    await s.noteLine('CA1', 'x', { cut: true });
    await s.markNoticeGiven('CA1');
    await s.bumpStream('CA1');
    assert.equal(s.kind(), 'memory');
    assert.equal(s.contactsOn(), false);
    assert.deepEqual(db.writes(), [], 'no helper that writes was called');
    assert.deepEqual(db.calls.map(([f]) => f), ['probeGreetingSchema'], 'probed once');
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /migration/);
  });

  it('probe false is re-probed (read-only); a later true turns db on, still one warning', async () => {
    let t = 0;
    const log = quietLog();
    const db = mockDb(new Map([['CA1', {}]]), { probe: { calls: false, contacts: false } });
    const s = createDbSessionStore({ db, log, now: () => t });
    assert.equal(await s.detect(), 'missing');
    t = RECHECK_MS - 1;
    assert.equal(await s.detect(), 'missing');
    db.probeGreetingSchema = async () => {
      db.calls.push(['probeGreetingSchema']);
      return { calls: true, contacts: true };
    };
    t = RECHECK_MS + 1;
    assert.equal(await s.detect(), 'ready');
    assert.equal(s.contactsOn(), true);
    assert.deepEqual(db.writes(), []);
    assert.equal(log.lines.warn.length, 1);
  });

  it('probe true -> db; contacts gated separately from calls', async () => {
    const both = createDbSessionStore({ db: mockDb(), log: quietLog() });
    assert.equal(await both.detect(), 'ready');
    assert.equal(both.kind(), 'db');
    assert.equal(both.contactsOn(), true);
    const callsOnly = createDbSessionStore({ db: mockDb(new Map(), { probe: { calls: true, contacts: false } }), log: quietLog() });
    await callsOnly.detect();
    assert.equal(callsOnly.kind(), 'db');
    assert.equal(callsOnly.contactsOn(), false);
    const contactsOnly = createDbSessionStore({ db: mockDb(new Map(), { probe: { calls: false, contacts: true } }), log: quietLog() });
    await contactsOnly.detect();
    assert.equal(contactsOnly.kind(), 'memory');
    assert.equal(contactsOnly.contactsOn(), true);
  });

  it('detection never writes: the probe is the only call before the first claim', async () => {
    const db = mockDb(new Map());
    const s = createDbSessionStore({ db, log: quietLog() });
    await s.detect();
    await s.detect();
    assert.deepEqual(db.calls, [['probeGreetingSchema']]);
  });

  it('current #844 (no probeGreetingSchema) -> memory, one warning naming it, nothing called', async () => {
    const log = quietLog();
    const db = mockDb(new Map([['CA1', {}]]), { push: 'current' });
    assert.equal(dbHasOpeningHelpers(db), false);
    const s = createDbSessionStore({ db, log });
    assert.equal(s.mode(), 'no_helpers');
    assert.equal((await s.claim('CA1')).won, true);
    assert.deepEqual(db.calls, []);
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /probeGreetingSchema/);
  });

  it('main (no helpers at all) -> memory, one warning', () => {
    const log = quietLog();
    const s = createDbSessionStore({ db: { getCall() {} }, log });
    assert.equal(s.kind(), 'memory');
    assert.equal(log.lines.warn.length, 1);
  });

  it('probe error -> memory, re-probed (read-only) after RECHECK_MS, one warning', async () => {
    let t = 0;
    const log = quietLog();
    const db = mockDb(new Map(), { probeThrows: true });
    const s = createDbSessionStore({ db, log, now: () => t });
    assert.equal(await s.detect(), 'down');
    assert.equal(await s.detect(), 'down');
    assert.equal(db.calls.length, 1);
    t = RECHECK_MS + 1;
    await s.detect();
    assert.deepEqual(db.calls.map(([f]) => f), ['probeGreetingSchema', 'probeGreetingSchema']);
    assert.equal(log.lines.warn.length, 1);
  });

  it('helpers are detected one by one: a probe-only db still works without the optional ones', async () => {
    const table = new Map([['CA1', {}]]);
    const db = mockDb(table);
    delete db.markCallNoticeGiven;
    delete db.bumpStreamSeq;
    delete db.updateLastAgentLine;
    const s = createDbSessionStore({ db, log: quietLog() });
    assert.equal((await s.claim('CA1')).won, true);
    assert.equal(await s.markNoticeGiven('CA1'), false);
    assert.equal(await s.noteLine('CA1', 'x', { cut: true }), false);
    assert.equal(await s.bumpStream('CA1'), 1, 'no bumpStreamSeq: own count on this replica');
    db.markLastLineCut = async (sid, cut = true) => {
      table.get(sid).last_line_cut = cut === true;
      return { ok: true, updated: 1 };
    };
    assert.equal(await s.noteLine('CA1', 'x', { cut: true }), true, 'markLastLineCut when updateLastAgentLine is absent');
    assert.equal((await s.get('CA1')).lastLineCut, true);
  });

  it('two replicas, one table: the first claim wins, the second loses and reads the row', async () => {
    const table = new Map([['CA9', {}]]);
    const a = createDbSessionStore({ db: mockDb(table), log: quietLog() });
    const b = createDbSessionStore({ db: mockDb(table), log: quietLog() });
    const ca = await a.claim('CA9', { lastAgentLine: 'Hapa ni Aris. Tukusaidie vipi?' });
    assert.equal(ca.won, true);
    assert.equal(ca.greetedAt, 1700000000000);
    assert.equal((await b.claim('CA9')).won, false);
    assert.equal(await b.bumpStream('CA9'), 1);
    assert.deepEqual(await b.get('CA9'), {
      greetedAt: 1700000000000,
      lastAgentLine: 'Hapa ni Aris. Tukusaidie vipi?',
      lastLineCut: false,
      noticeGiven: false,
      streamSeq: 1,
    });
  });

  it('no calls row / helper error -> won:null (caller fails open and greets)', async () => {
    const s = createDbSessionStore({ db: mockDb(new Map()), log: quietLog() });
    assert.deepEqual(await s.claim('CA_none'), { won: null, greetedAt: null, missing: true });
    const bad = createDbSessionStore({ db: mockDb(new Map([['CA1', {}]]), { failClaim: true }), log: quietLog() });
    assert.equal((await bad.claim('CA1')).won, null);
  });

  it('createOpeningSessionStore: no db or VOICE_OPENING_STORE=memory -> memory', () => {
    assert.equal(createOpeningSessionStore({ db: null, env: {} }).kind(), 'memory');
    const forced = createOpeningSessionStore({ db: mockDb(), env: { VOICE_OPENING_STORE: 'memory' }, log: quietLog() });
    assert.equal(forced.kind(), 'memory');
    assert.equal(forced.mode, undefined);
  });
});

describe('createOpeningStore across replicas (who greets, notice, cut line)', () => {
  const GREETING = 'Hapa ni Esga, naitwa Lucy. Simu hii inaweza kurekodiwa. Nikusaidie vipi?';
  function replica(table, opts) {
    return callOpening.createOpeningStore({
      shared: createDbSessionStore({ db: mockDb(table, opts), log: quietLog() }),
      setTimeout: () => null,
      clearTimeout: () => {},
    });
  }
  async function greetOnA(A, sid) {
    const a = await A.attachShared(sid);
    assert.equal((await A.claimGreeting(sid, { line: GREETING })).won, true);
    A.noteGreeted(a.session, { text: GREETING, at: 1 });
    return a;
  }

  it('reconnect on replica B: claim lost -> resumed session, action listen, no greet', async () => {
    const table = new Map([['CA7', {}]]);
    const A = replica(table);
    const B = replica(table);
    await greetOnA(A, 'CA7');
    const b = await B.attachShared('CA7');
    assert.equal(b.needsClaim, true);
    await tick();
    const c = await B.claimGreeting('CA7', { line: GREETING });
    assert.equal(c.won, false);
    assert.equal(c.attach.resumed, true);
    assert.equal(c.attach.action, 'listen');
    assert.equal(c.attach.source, 'shared');
    assert.equal(c.attach.session.streamSeq, 2);
    assert.equal(c.attach.session.notice, null, 'notice_given false on the row: the stream treats it as owed');
  });

  it('notice given on A (markCallNoticeGiven) -> B restores it as given, owes nothing', async () => {
    const table = new Map([['CA10', {}]]);
    const A = replica(table);
    const B = replica(table);
    const a = await greetOnA(A, 'CA10');
    A.noteNoticeGiven(a.session);
    A.noteNoticeGiven(a.session);
    await tick();
    assert.equal(table.get('CA10').notice_given, true);
    await B.attachShared('CA10');
    const c = await B.claimGreeting('CA10', { line: GREETING });
    assert.equal(c.attach.session.notice.given, true);
    const t = callOpening.createNoticeTracker({ required: true, startedAt: 0 });
    t.restore(c.attach.session.notice);
    assert.equal(t.owed(), false, 'B owes no notice');
    B.noteNoticeGiven(c.attach.session);
    await tick();
  });

  it('cut line on A -> re-said once on B, then listen', async () => {
    const table = new Map([['CA11', {}]]);
    const A = replica(table);
    const B = replica(table);
    const a = await greetOnA(A, 'CA11');
    A.noteLine(a.session, 'Deep clean ya vyumba viwili ni shilingi elfu nane.');
    A.noteLineCut(a.session, 'Tunaweza kuja Jumamosi asubuhi, inakufaa?');
    await tick();
    assert.equal(table.get('CA11').last_line_cut, true);
    // Replica A dies (no detach). B resumes.
    await B.attachShared('CA11');
    const c = await B.claimGreeting('CA11', { line: GREETING });
    assert.equal(c.attach.action, 'respeak');
    assert.equal(c.attach.session.lastAgentLine, 'Tunaweza kuja Jumamosi asubuhi, inakufaa?');
    // B re-says it (speakText -> noteLine): the cut is cleared on the row.
    B.noteLine(c.attach.session, c.attach.session.lastAgentLine);
    await tick();
    assert.equal(table.get('CA11').last_line_cut, false);
    // Another drop on B with nothing playing: listen, not a second re-say.
    B.detach('CA11', { speaking: false });
    const again = await B.attachShared('CA11');
    assert.equal(again.action, 'listen');
  });

  it('greeting cut on A by a socket loss -> B re-asks only the question (reinvite)', async () => {
    const table = new Map([['CA12', {}]]);
    const A = replica(table);
    const B = replica(table);
    await greetOnA(A, 'CA12');
    A.detach('CA12', { speaking: true, line: GREETING });
    await tick();
    assert.equal(table.get('CA12').last_line_cut, true);
    await B.attachShared('CA12');
    const c = await B.claimGreeting('CA12', { line: GREETING });
    assert.equal(c.attach.action, 'reinvite');
  });

  it('current #844 (no cut column): a cut is not visible across replicas -> listen', async () => {
    const table = new Map([['CA13', {}]]);
    const opts = { push: 'current' };
    const A = replica(table, opts);
    const B = replica(table, opts);
    // Current push has no probe: both replicas stay in memory, so B (another
    // process) cannot see A's claim at all and greets: the documented gap.
    await greetOnA(A, 'CA13');
    await B.attachShared('CA13');
    assert.equal((await B.claimGreeting('CA13', { line: GREETING })).won, true);
  });

  it('local barge cut then drop on the same replica: re-said once', async () => {
    const A = replica(new Map([['CA14', {}]]));
    const a = await A.attachShared('CA14', { fresh: true });
    A.noteGreeted(a.session, { text: GREETING, at: 1 });
    A.noteLineCut(a.session, 'Naomba jina lako?');
    A.detach('CA14', { speaking: false });
    const r = await A.attachShared('CA14');
    assert.equal(r.action, 'respeak');
    A.detach('CA14', { speaking: false });
    assert.equal((await A.attachShared('CA14')).action, 'listen');
  });

  it('webhook ran on this replica (fresh): no awaited claim needed', async () => {
    const A = replica(new Map([['CA8', {}]]));
    const a = await A.attachShared('CA8', { fresh: true });
    assert.equal(a.needsClaim, false);
    assert.equal(a.action, 'greet');
  });

  it('claim timeout fails open (won null -> greet)', async () => {
    const slow = {
      kind: () => 'db',
      claim: () => new Promise(() => {}),
      get: async () => null,
      noteLine: async () => true,
      bumpStream: async () => null,
      markNoticeGiven: async () => false,
    };
    const S = callOpening.createOpeningStore({ shared: slow });
    await S.attachShared('CA5');
    const keepAlive = setTimeout(() => {}, 1000); // the store's timer is unref'd
    const c = await S.claimGreeting('CA5', { timeoutMs: 20 });
    clearTimeout(keepAlive);
    assert.equal(c.won, null);
    assert.equal(c.timeout, true);
  });
});

describe('returning caller language (contacts.last_language)', () => {
  it('openingLanguageFor: returning + last_language wins over the shop; new callers get the shop', () => {
    const sw = { languageMode: 'sw', supportedLanguages: ['sw', 'en'] };
    const shop = callOpening.shopLanguage(sw);
    const ret = callOpening.callerOpeningFacts({ name: 'Alvin', lastLanguage: shop === 'sw' ? 'en' : 'sw' });
    assert.equal(ret.lastLanguage, shop === 'sw' ? 'en' : 'sw');
    const pick = callOpening.openingLanguageFor(sw, ret);
    assert.equal(pick.language, ret.lastLanguage);
    assert.equal(pick.source, 'caller_last');
    assert.equal(callOpening.openingLanguageFor(sw, callOpening.callerOpeningFacts(null)).language, shop);
    assert.equal(callOpening.callerOpeningFacts({ name: 'A', lastLanguage: 'mixed' }).lastLanguage, null);
  });

  it("owner's greeting text is used only in the shop language", () => {
    const base = { businessName: 'Esga', agentName: 'Lucy', greetingText: 'Karibu Esga, tunauza simu.', isOpen: true, isReturning: true, recordingNotice: true };
    const inShop = callOpening.composeOpening({ ...base, language: 'sw', shopLanguage: 'sw' });
    const other = callOpening.composeOpening({ ...base, language: 'en', shopLanguage: 'sw' });
    assert.notEqual(inShop.text, other.text);
    assert.doesNotMatch(other.text, /tunauza|Karibu/);
    assert.match(other.text, /This call may be recorded\./);
  });
});

describe('callPrefetch (webhook -> stream, keyed by callSid)', () => {
  it('start once, take once; a failed loader resolves null with one warning', async () => {
    const log = quietLog();
    const p = createCallPrefetch({ log });
    let loads = 0;
    p.start('CA1', async () => {
      loads += 1;
      return { profile: { id: 't1' } };
    });
    p.start('CA1', async () => {
      loads += 1;
      return null;
    });
    assert.equal(p.has('CA1'), true);
    const e = p.take('CA1');
    assert.deepEqual(await e.promise, { profile: { id: 't1' } });
    assert.equal(loads, 1);
    assert.equal(p.take('CA1'), null, 'a reconnect does not get it again');
    const f = p.start('CA2', async () => {
      throw new Error('db down');
    });
    assert.equal(await f.promise, null);
    assert.equal(log.lines.warn.length, 1);
  });

  it('expires after ttl', () => {
    let t = 0;
    const p = createCallPrefetch({ ttlMs: 1000, now: () => t, log: quietLog() });
    p.start('CA1', async () => ({}));
    t = 1001;
    assert.equal(p.has('CA1'), false);
    assert.equal(p.take('CA1'), null);
  });
});

describe('scripts/greeting-latency-report.js', () => {
  const logs = [
    '2026-10-21T10:00:00Z [voice-timing][CA1] greeting.first_pcm_ms=210 from=stream_start prefetch=hit cached=1 first_media_ms=none kind=new_open lang=sw',
    '2026-10-21T10:00:01Z [voice-timing][CA2] greeting.first_pcm_ms=380 from=stream_start prefetch=hit cached=1 first_media_ms=12 kind=new_open lang=sw',
    '2026-10-21T10:00:02Z [voice-timing][CA3] greeting.first_pcm_ms=2600 from=stream_start prefetch=miss cached=1 first_media_ms=none kind=new_open lang=en',
    '2026-10-21T10:00:03Z [voice-timing][CA4] greeting.first_pcm_ms=900 from=stream_start prefetch=inflight cached=0 first_media_ms=none kind=returning_open lang=sw',
    'noise line',
    JSON.stringify({ callSid: 'CA1', stages: [{ stage: 'opening', firstPcmMs: 210, prefetch: 'hit', cached: true, streamSeq: 1 }] }),
    JSON.stringify({ callSid: 'CA5', call: { stages: [{ stage: 'opening', firstPcmMs: 450, prefetch: 'hit', cached: true }] } }),
  ].join('\n');

  it('parses log lines and trace JSON, one sample per stream', () => {
    const s = latency.parseSamples(logs);
    assert.deepEqual(s.map((x) => [x.callSid, x.ms, x.prefetch, x.cached]), [
      ['CA1', 210, 'hit', 1],
      ['CA2', 380, 'hit', 1],
      ['CA3', 2600, 'miss', 1],
      ['CA4', 900, 'inflight', 0],
      ['CA5', 450, 'hit', 1],
    ]);
  });

  it('p50 / p95 overall and by prefetch / cached', () => {
    const r = latency.report(latency.parseSamples(logs));
    assert.deepEqual(r.all, { n: 5, p50: 450, p95: 2600, max: 2600 });
    assert.deepEqual(r.byPrefetch.hit, { n: 3, p50: 380, p95: 450, max: 450 });
    assert.deepEqual(r.byPrefetch.miss, { n: 1, p50: 2600, p95: 2600, max: 2600 });
    assert.equal(r.byCached.live_tts.n, 1);
    assert.equal(r.under600, 0.6);
    assert.match(latency.formatReport(r), /hit\s+n=\s+3\s+p50=\s+380 ms\s+p95=\s+450 ms/);
  });
});
