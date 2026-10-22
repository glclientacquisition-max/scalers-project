// VOICE_TRANSCRIPT_INCREMENTAL (22 Oct 2026). Prod HD_e75a669780d4: a deploy
// killed the process mid-call, the close-time transcript write never ran, and
// the reconnect session replaced the transcript with a re-greeting.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const {
  transcriptIncrementalEnabled,
  stableRowId,
  createIncrementalTranscriptWriter,
  createSessionRegistry,
  installSigtermFlush,
  resumePlan,
} = require('../src/speech/transcriptIncremental');
const { createCallTranscript } = require('../src/speech/voiceTiming');

function fakeTable() {
  const rows = new Map();
  let deletes = 0;
  return {
    rows,
    deletes: () => deletes,
    upsert: async ({ callSid, rows: batch }) => {
      for (const r of batch) rows.set(r.id, { ...r, callSid });
    },
  };
}

describe('flag', () => {
  it('only the exact value on enables it', () => {
    assert.equal(transcriptIncrementalEnabled({}), false);
    assert.equal(transcriptIncrementalEnabled({ VOICE_TRANSCRIPT_INCREMENTAL: 'true' }), false);
    assert.equal(transcriptIncrementalEnabled({ VOICE_TRANSCRIPT_INCREMENTAL: 'on' }), true);
  });
});

describe('stable row ids', () => {
  it('are deterministic uuids, distinct per session and index', () => {
    const a = stableRowId('HD_1', 's1', 0);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(a, stableRowId('HD_1', 's1', 0));
    assert.notEqual(a, stableRowId('HD_1', 's1', 1));
    assert.notEqual(a, stableRowId('HD_1', 's2', 0));
  });
});

describe('incremental writer', () => {
  it('each pushed turn is durable before close, in spoken order', async () => {
    const table = fakeTable();
    let t = 1000;
    const w = createIncrementalTranscriptWriter({ callSid: () => 'HD_e75a', sessionKey: 's1', upsert: table.upsert, now: () => (t += 10) });
    const tr = createCallTranscript({ onChange: w.onChange });
    tr.pushAgent('Aris, this is Lynn. Tukusaidie vipi.');
    tr.pushCaller('Nataka exercise books');
    await w.onChange(-1, null); // wait for the chain
    assert.equal(table.rows.size, 2, 'rows durable without any close');
    const sorted = [...table.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    assert.deepEqual(sorted.map((r) => r.speaker), ['agent', 'caller']);
  });
  it('a latency stamp and the close flush update the same rows (no duplicates, no delete)', async () => {
    const table = fakeTable();
    const w = createIncrementalTranscriptWriter({ callSid: () => 'HD_x', sessionKey: 's1', upsert: table.upsert });
    const tr = createCallTranscript({ onChange: w.onChange });
    tr.pushCaller('Hello');
    tr.pushAgent('Hi, how can I help?');
    tr.stampFirstAgentSince(0, 640);
    await w.flushAll(tr.turns());
    await w.flushAll(tr.turns());
    assert.equal(table.rows.size, 2);
    assert.equal([...table.rows.values()].find((r) => r.speaker === 'agent').latencyMs, 640);
    assert.equal(table.deletes(), 0);
  });
  it('rows pushed before the callSid is known are written once it is', async () => {
    const table = fakeTable();
    let sid = null;
    const w = createIncrementalTranscriptWriter({ callSid: () => sid, sessionKey: 's1', upsert: table.upsert });
    const tr = createCallTranscript({ onChange: w.onChange });
    tr.pushAgent('Greeting');
    await w.flushAll();
    assert.equal(table.rows.size, 0);
    sid = 'HD_late';
    await w.flushAll(tr.turns());
    assert.equal(table.rows.size, 1);
  });
  it('a failed write stays dirty and is retried', async () => {
    const table = fakeTable();
    let fail = true;
    const w = createIncrementalTranscriptWriter({
      callSid: () => 'HD_r',
      sessionKey: 's1',
      upsert: async (a) => {
        if (fail) throw new Error('db down');
        return table.upsert(a);
      },
      log: () => {},
    });
    const tr = createCallTranscript({ onChange: w.onChange });
    tr.pushCaller('Hello');
    await w.flushAll();
    assert.equal(table.rows.size, 0);
    assert.ok(w.stats().failures >= 1);
    fail = false;
    await w.flushAll();
    assert.equal(table.rows.size, 1);
  });
  it('a reconnect session never overwrites the first session (HD_e75a669780d4)', async () => {
    const table = fakeTable();
    const w1 = createIncrementalTranscriptWriter({ callSid: () => 'HD_e75a', sessionKey: 'old', upsert: table.upsert });
    const t1 = createCallTranscript({ onChange: w1.onChange });
    t1.pushAgent('Greeting');
    for (let i = 0; i < 19; i += 1) t1.pushCaller(`caller turn ${i}`);
    await w1.flushAll();
    // old process killed: no close. New process, new session:
    const w2 = createIncrementalTranscriptWriter({ callSid: () => 'HD_e75a', sessionKey: 'new', upsert: table.upsert });
    const t2 = createCallTranscript({ onChange: w2.onChange });
    t2.pushAgent('Sorry, the line dropped for a moment.');
    await w2.flushAll(t2.turns());
    assert.equal(table.rows.size, 21);
    assert.equal([...table.rows.values()].filter((r) => r.speaker === 'caller').length, 19);
  });
});

describe('SIGTERM flush', () => {
  it('flushes every open session, then exits 0', async () => {
    const registry = createSessionRegistry();
    const flushed = [];
    registry.add('a', async () => flushed.push('a'));
    const off = registry.add('b', async () => flushed.push('b'));
    registry.add('c', async () => flushed.push('c'));
    off();
    const proc = new EventEmitter();
    let code = null;
    const handler = installSigtermFlush({ registry, proc, log: () => {}, exit: (c) => { code = c; } });
    await handler('SIGTERM');
    assert.deepEqual(flushed.sort(), ['a', 'c']);
    assert.equal(code, 0);
    assert.equal(proc.listenerCount('SIGTERM'), 1);
  });
  it('with a graceful drain owning SIGTERM it flushes but does not exit', async () => {
    const registry = createSessionRegistry();
    const flushed = [];
    registry.add('a', async () => flushed.push('a'));
    let code = null;
    const handler = installSigtermFlush({ registry, proc: new EventEmitter(), exitAfter: false, log: () => {}, exit: (c) => { code = c; } });
    await handler('SIGTERM');
    assert.deepEqual(flushed, ['a']);
    assert.equal(code, null);
  });
  it('a hung session cannot block exit past the timeout', async () => {
    const registry = createSessionRegistry();
    registry.add('hang', () => new Promise(() => {}));
    let code = null;
    const handler = installSigtermFlush({ registry, proc: new EventEmitter(), timeoutMs: 50, log: () => {}, exit: (c) => { code = c; } });
    await handler('SIGTERM');
    assert.equal(code, 0);
  });
  it('a throwing session does not stop the others', async () => {
    const registry = createSessionRegistry();
    const flushed = [];
    registry.add('x', async () => { throw new Error('boom'); });
    registry.add('y', async () => flushed.push('y'));
    const out = await registry.flushAll({ timeoutMs: 200 });
    assert.equal(out.result, 'done');
    assert.deepEqual(flushed, ['y']);
  });
});

describe('reconnect resume plan', () => {
  it('no prior rows: greet as today', () => {
    assert.equal(resumePlan([]).resume, false);
    assert.equal(resumePlan([{ speaker: 'caller', text: 'hi' }]).resume, false);
  });
  it('prior rows: resume without re-greeting, in the caller\'s language', () => {
    const p = resumePlan([
      { speaker: 'agent', text: 'Aris, this is Lynn. Tukusaidie vipi.' },
      { speaker: 'caller', text: 'Nataka kalamu, bei ngapi?' },
    ]);
    assert.equal(p.resume, true);
    assert.equal(p.heardCaller, true);
    assert.equal(p.language, 'sw');
    assert.doesNotMatch(p.line, /this is|Aris|recorded/i, 'not a greeting');
    const en = resumePlan([{ speaker: 'agent', text: 'Hello' }, { speaker: 'caller', text: 'I need a plumber' }]);
    assert.equal(en.language, 'en');
  });
});

describe('server wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('flag off keeps the close-time full replace; on never calls appendTranscript for media', () => {
    assert.match(src, /if \(transcriptWriter\) \{[\s\S]{0,300}flushAll\(callTranscript\.turns\(\)\)[\s\S]{0,80}\} else if \(sessionCallSid && callTranscript\.size\(\)\) \{\s*db\.appendTranscript/);
  });
  it('SIGTERM handler only when the flag is on', () => {
    assert.match(src, /if \(transcriptIncrementalOn\) \{\s*installSigtermFlush\(\{ registry: openMediaSessions, exitAfter: !gracefulDrainOn\(\) \}\)/);
  });
  it('resume fails open (unknown prior rows greet as today)', () => {
    assert.match(src, /if \(!Array\.isArray\(prior\)\) return false;/);
  });
  it('db upsert never deletes', () => {
    const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
    const fn = db.slice(db.indexOf('async function upsertTranscriptRows'), db.indexOf('async function listTranscriptTurns'));
    assert.match(fn, /\.upsert\(payload, \{ onConflict: 'id'/);
    assert.doesNotMatch(fn, /\.delete\(/);
  });
});
