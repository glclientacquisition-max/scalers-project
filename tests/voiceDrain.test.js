'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createVoiceDrain, drainMaxMs, BUSY_XML, DEFAULT_MAX_MS } = require('../src/voiceDrain');

const quiet = { warn() {} };

describe('voiceDrain', () => {
  it('defaults to ~120s and honours VOICE_DRAIN_MAX_MS', () => {
    assert.equal(drainMaxMs({}), DEFAULT_MAX_MS);
    assert.equal(DEFAULT_MAX_MS, 120000);
    assert.equal(drainMaxMs({ VOICE_DRAIN_MAX_MS: '5000' }), 5000);
  });

  it('counts active calls and pending work for /healthz', () => {
    const d = createVoiceDrain({ exit() {}, log: quiet });
    const a = {}; const b = {};
    d.trackSession(a, 'HD_a'); d.trackSession(b);
    let release; d.trackWork(new Promise((r) => { release = r; }));
    assert.deepEqual({ ...d.stats(), drainMaxMs: 0 }, { draining: false, activeCalls: 2, pendingWork: 1, drainStartedAt: null, drainMaxMs: 0 });
    d.untrackSession(a);
    assert.equal(d.stats().activeCalls, 1);
    release();
  });

  it('waits for sessions and call-end work, then exits 0 (idle)', async () => {
    const exits = [];
    const d = createVoiceDrain({ maxMs: 2000, pollMs: 5, exit: (c) => exits.push(c), log: quiet, unref: false });
    const s = {}; d.trackSession(s, 'HD_live');
    let finish; d.trackWork(new Promise((r) => { finish = r; }));
    const p = d.start('test');
    assert.equal(d.isDraining(), true);
    assert.equal(d.isActiveCall(['HD_live']), true, 'live call can still re-hit webhooks');
    assert.equal(d.isActiveCall(['HD_new']), false, 'new call is refused');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(exits, [], 'not before the call ends');
    d.untrackSession(s);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(exits, [], 'not before call-end work finishes');
    finish();
    assert.equal(await p, 'idle');
    assert.deepEqual(exits, [0]);
  });

  it('exits on VOICE_DRAIN_MAX_MS even with a stuck call (timeout)', async () => {
    const exits = [];
    const d = createVoiceDrain({ maxMs: 30, pollMs: 5, exit: (c) => exits.push(c), log: quiet, unref: false });
    d.trackSession({}, 'HD_stuck');
    assert.equal(await d.start(), 'timeout');
    assert.deepEqual(exits, [0]);
  });

  it('start is idempotent (second SIGTERM)', () => {
    const d = createVoiceDrain({ maxMs: 0, exit() {}, log: quiet });
    assert.equal(d.start(), d.start());
  });

  it('busy XML is a polite reject, not a hangup mid-call', () => {
    assert.match(BUSY_XML, /<Reject reason="busy"\/>/);
  });

  it('server wiring: SIGTERM, gate on /voice/incoming, /ws/media 503, healthz draining+activeCalls', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /if \(gracefulDrainEnabled\(\)\) \{\n  process\.once\('SIGTERM'[\s\S]{0,80}voiceDrain\.start/);
    assert.match(src, /async function handleVoiceIncoming\(req, res\) \{\n(?:[^\n]*\n){1,3}  if \(drainRefusesNewCall\(req, res\)\) return;/);
    assert.match(src, /503 Service Unavailable/);
    assert.match(src, /status: drain\.draining \? 'draining' : 'ok'/);
    assert.match(src, /activeCalls: drain\.activeCalls/);
    assert.match(src, /voiceDrain\.trackSession\(ws/);
    assert.match(src, /voiceDrain\.trackWork\(/);
  });

  it('VOICE_GRACEFUL_DRAIN is off by default; only on/1/true/yes turns it on', () => {
    const { gracefulDrainEnabled } = require('../src/voiceDrain');
    assert.equal(gracefulDrainEnabled({}), false);
    assert.equal(gracefulDrainEnabled({ VOICE_GRACEFUL_DRAIN: '' }), false);
    assert.equal(gracefulDrainEnabled({ VOICE_GRACEFUL_DRAIN: 'off' }), false);
    assert.equal(gracefulDrainEnabled({ VOICE_GRACEFUL_DRAIN: '0' }), false);
    for (const v of ['on', '1', 'true', 'yes', 'ON']) assert.equal(gracefulDrainEnabled({ VOICE_GRACEFUL_DRAIN: v }), true, v);
  });

  it('flag off: a drain that never started refuses nothing and healthz stays ok', () => {
    const d = createVoiceDrain({ maxMs: 0, exit() { throw new Error('must not exit'); }, log: quiet });
    const ws = {};
    d.trackSession(ws, 'CA1');
    assert.equal(d.isDraining(), false);
    assert.equal(d.stats().activeCalls, 1);
    assert.equal(d.stats().draining, false);
  });
});

