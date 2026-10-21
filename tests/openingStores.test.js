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
  PROBE_SID,
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
 * return shapes as src/db.js @962fb6e6 (none throw). Two mocks over one
 * table = two replicas over one database.
 */
function mockDb(table = new Map(), { probeError = null, failClaim = false } = {}) {
  const calls = [];
  const row = (sid) => table.get(sid);
  return {
    table,
    calls,
    async markCallGreeted({ callSid, lastAgentLine, noticeGiven } = {}) {
      calls.push(['markCallGreeted', callSid]);
      if (callSid === PROBE_SID && probeError) return { ok: false, won: null, error: probeError };
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
      return { greetedAt: r.greeted_at || null, lastAgentLine: r.last_agent_line || null, noticeGiven: r.notice_given === true, streamSeq: r.stream_seq || 0 };
    },
    async updateLastAgentLine(callSid, line) {
      calls.push(['updateLastAgentLine', callSid]);
      const r = row(callSid);
      if (r) r.last_agent_line = String(line).slice(0, 500);
      return { ok: true };
    },
    async bumpStreamSeq(callSid) {
      calls.push(['bumpStreamSeq', callSid]);
      const r = row(callSid);
      if (!r) return { ok: true, missing: true, streamSeq: null };
      r.stream_seq = (r.stream_seq || 0) + 1;
      return { ok: true, streamSeq: r.stream_seq };
    },
  };
}

describe('openingSessionStore: memory adapter', () => {
  it('claim: exactly one winner per call; get/noteLine/bumpStream/markNoticeGiven', async () => {
    const m = createMemorySessionStore({ now: () => 5000 });
    assert.deepEqual(await m.claim('CA1', { lastAgentLine: 'Hello' }), { won: true, greetedAt: 5000 });
    assert.deepEqual(await m.claim('CA1'), { won: false, greetedAt: 5000 });
    assert.equal(await m.bumpStream('CA1'), 1);
    assert.equal(await m.bumpStream('CA1'), 2);
    await m.noteLine('CA1', 'Tukusaidie vipi?');
    await m.markNoticeGiven('CA1');
    assert.deepEqual(await m.get('CA1'), { greetedAt: 5000, lastAgentLine: 'Tukusaidie vipi?', noticeGiven: true, streamSeq: 2 });
    assert.equal(await m.get('nope'), null);
    assert.deepEqual(await m.claim(''), { won: null, greetedAt: null });
  });
});

describe('openingSessionStore: db adapter on #844 helpers (mocked)', () => {
  it('feature-detect: main has no helpers -> memory, one warning', async () => {
    const log = quietLog();
    assert.equal(dbHasOpeningHelpers({ getCall() {} }), false);
    const s = createDbSessionStore({ db: { getCall() {} }, log });
    assert.equal(s.kind(), 'memory');
    assert.equal(s.mode(), 'no_helpers');
    assert.equal((await s.claim('CA1')).won, true);
    assert.equal((await s.claim('CA1')).won, false, 'memory still decides on one replica');
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /Platform #844 not merged/);
  });

  it('feature-detect: helpers present but columns missing -> memory, one warning, no retry', async () => {
    const log = quietLog();
    const db = mockDb(new Map(), { probeError: 'column calls.greeted_at does not exist' });
    const s = createDbSessionStore({ db, log });
    assert.equal(await s.detect(), 'missing');
    await s.claim('CA1');
    await s.claim('CA2');
    assert.equal(s.kind(), 'memory');
    assert.equal(db.calls.filter(([f]) => f === 'markCallGreeted').length, 1, 'only the probe');
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /greeting_language\.sql/);
  });

  it('feature-detect: helper error -> memory, rechecks after RECHECK_MS, one warning', async () => {
    let t = 0;
    const log = quietLog();
    const db = mockDb(new Map(), { probeError: 'fetch failed' });
    const s = createDbSessionStore({ db, log, now: () => t });
    assert.equal(await s.detect(), 'down');
    assert.equal(await s.detect(), 'down');
    assert.equal(db.calls.length, 1);
    t = RECHECK_MS + 1;
    await s.detect();
    assert.equal(db.calls.length, 2, 'rechecked');
    assert.equal(log.lines.warn.length, 1);
  });

  it('probe ok -> db; the probe sid matches no calls row (nothing written)', async () => {
    const table = new Map();
    const db = mockDb(table);
    const s = createDbSessionStore({ db, log: quietLog() });
    assert.equal(await s.detect(), 'ready');
    assert.equal(s.kind(), 'db');
    assert.equal(table.size, 0);
    assert.deepEqual(db.calls[0], ['markCallGreeted', PROBE_SID]);
  });

  it('two replicas, one table: the first claim wins, the second loses and reads the row', async () => {
    const table = new Map([['CA9', {}]]);
    const a = createDbSessionStore({ db: mockDb(table), log: quietLog() });
    const b = createDbSessionStore({ db: mockDb(table), log: quietLog() });
    const ca = await a.claim('CA9', { lastAgentLine: 'Hapa ni Aris. Tukusaidie vipi?' });
    assert.equal(ca.won, true);
    assert.equal(ca.greetedAt, 1700000000000);
    const cb = await b.claim('CA9');
    assert.equal(cb.won, false);
    assert.equal(await b.bumpStream('CA9'), 1);
    assert.deepEqual(await b.get('CA9'), {
      greetedAt: 1700000000000,
      lastAgentLine: 'Hapa ni Aris. Tukusaidie vipi?',
      noticeGiven: false,
      streamSeq: 1,
    });
  });

  it('no calls row / helper error -> won:null (caller fails open and greets)', async () => {
    const s = createDbSessionStore({ db: mockDb(new Map()), log: quietLog() });
    assert.deepEqual(await s.claim('CA_none'), { won: null, greetedAt: null, missing: true });
    const bad = createDbSessionStore({ db: mockDb(new Map([['CA1', {}]]), { failClaim: true }), log: quietLog() });
    // The probe also fails (failClaim) -> down -> memory decides.
    assert.equal((await bad.claim('CA1')).won, true);
  });

  it('markNoticeGiven: needs db.markCallNoticeGiven (Platform ask); used when present', async () => {
    const table = new Map([['CA1', {}]]);
    const db = mockDb(table);
    const s = createDbSessionStore({ db, log: quietLog() });
    assert.equal(await s.markNoticeGiven('CA1'), false);
    db.markCallNoticeGiven = async (sid) => {
      table.get(sid).notice_given = true;
      return { ok: true };
    };
    assert.equal(await s.markNoticeGiven('CA1'), true);
    assert.equal((await s.get('CA1')).noticeGiven, true);
  });

  it('createOpeningSessionStore: no db or VOICE_OPENING_STORE=memory -> memory', () => {
    assert.equal(createOpeningSessionStore({ db: null, env: {} }).kind(), 'memory');
    const forced = createOpeningSessionStore({ db: mockDb(), env: { VOICE_OPENING_STORE: 'memory' }, log: quietLog() });
    assert.equal(forced.kind(), 'memory');
    assert.equal(forced.mode, undefined);
  });
});

describe('createOpeningStore + shared claim (who greets)', () => {
  function replica(table) {
    return callOpening.createOpeningStore({
      shared: createDbSessionStore({ db: mockDb(table), log: quietLog() }),
      setTimeout: () => null,
      clearTimeout: () => {},
    });
  }

  it('reconnect on replica B: claim lost -> resumed session, action listen, no greet', async () => {
    const table = new Map([['CA7', {}]]);
    const A = replica(table);
    const B = replica(table);
    const a = await A.attachShared('CA7');
    assert.equal(a.needsClaim, true);
    assert.equal((await A.claimGreeting('CA7', { line: 'Hapa ni Esga. Simu hii inaweza kurekodiwa. Nikusaidie vipi?' })).won, true);
    A.noteGreeted(a.session, { text: 'Hapa ni Esga. Simu hii inaweza kurekodiwa. Nikusaidie vipi?', at: 1 });
    const b = await B.attachShared('CA7');
    assert.equal(b.resumed, false);
    assert.equal(b.needsClaim, true);
    await tick();
    const c = await B.claimGreeting('CA7', { line: 'x' });
    assert.equal(c.won, false);
    assert.equal(c.attach.resumed, true);
    assert.equal(c.attach.action, 'listen');
    assert.equal(c.attach.source, 'shared');
    assert.equal(c.attach.session.resumedFrom, 'shared');
    assert.equal(c.attach.session.streamSeq, 2);
    assert.equal(c.attach.session.notice, null, 'notice_given false on the row: the stream treats it as owed');
  });

  it('webhook ran on this replica (fresh): no awaited claim needed', async () => {
    const A = replica(new Map([['CA8', {}]]));
    const a = await A.attachShared('CA8', { fresh: true });
    assert.equal(a.needsClaim, false);
    assert.equal(a.action, 'greet');
  });

  it('local reconnect on the same replica resumes from memory without a claim', async () => {
    const A = replica(new Map([['CA6', {}]]));
    const a = await A.attachShared('CA6', { fresh: true });
    A.noteGreeted(a.session, { text: 'Hi', at: 1 });
    A.detach(a.session, {});
    const again = await A.attachShared('CA6');
    assert.equal(again.source, 'local');
    assert.equal(again.needsClaim, false);
    assert.equal(again.resumed, true);
  });

  it('claim timeout or error fails open (won null -> greet)', async () => {
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
