'use strict';
// VOICE_END_CALL_HONOUR (default off): honour the brain's end signal once, after
// the final audio, with a call-ended outage guard. Unit tests (no network).
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  endCallHonourEnabled,
  endGraceMs,
  endMaxWaitMs,
  createPlayoutClock,
  endSignalFromBrain,
  createEndCallController,
  outageSuppressed,
} = require('../src/speech/endCallHonour');
const { hangupSautikitCall, resetHangupScopeLatch } = require('../src/sautikit/callHangup');

/** Manual clock + timer queue so waits are exact and instant. */
function fakeTime(start = 1000) {
  let t = start;
  const q = [];
  return {
    now: () => t,
    setTimer(fn, ms) {
      const row = { at: t + Math.max(0, Number(ms) || 0), fn };
      q.push(row);
      return { unref() {} };
    },
    async advance(ms) {
      const until = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        const next = q[0];
        if (!next || next.at > until) break;
        q.shift();
        t = next.at;
        next.fn();
        await new Promise((r) => setImmediate(r));
      }
      t = until;
      await new Promise((r) => setImmediate(r));
    },
    pending: () => q.length,
  };
}

describe('flag', () => {
  it('off by default; only on/1/true/yes enable', () => {
    assert.equal(endCallHonourEnabled({}), false);
    for (const v of ['', 'off', '0', 'false', 'no', 'enabled']) assert.equal(endCallHonourEnabled({ VOICE_END_CALL_HONOUR: v }), false, v);
    for (const v of ['on', '1', 'true', 'yes', 'ON', ' on ']) assert.equal(endCallHonourEnabled({ VOICE_END_CALL_HONOUR: v }), true, v);
  });
  it('reads process.env.VOICE_END_CALL_HONOUR when no env is passed; the old name does nothing', () => {
    const saved = { a: process.env.VOICE_END_CALL_HONOUR, b: process.env.VOICE_FAREWELL_HANGUP };
    try {
      delete process.env.VOICE_END_CALL_HONOUR;
      process.env.VOICE_FAREWELL_HANGUP = 'on';
      assert.equal(endCallHonourEnabled(), false);
      process.env.VOICE_END_CALL_HONOUR = 'on';
      assert.equal(endCallHonourEnabled(), true);
    } finally {
      if (saved.a === undefined) delete process.env.VOICE_END_CALL_HONOUR; else process.env.VOICE_END_CALL_HONOUR = saved.a;
      if (saved.b === undefined) delete process.env.VOICE_FAREWELL_HANGUP; else process.env.VOICE_FAREWELL_HANGUP = saved.b;
    }
  });
  it('grace and max wait are bounded', () => {
    assert.equal(endGraceMs({}), 600);
    assert.equal(endGraceMs({ VOICE_END_CALL_GRACE_MS: '50' }), 200);
    assert.equal(endMaxWaitMs({}), 12000);
    assert.equal(endMaxWaitMs({ VOICE_END_CALL_MAX_WAIT_MS: '999999' }), 30000);
  });
});

describe('endSignalFromBrain: every shape Brain may emit', () => {
  const yes = [
    [{ shouldEndCall: true }, 'v1_end_call'],
    ['END', 'nba_end'],
    [{ action: 'END' }, 'action_end'],
    [{ end: true }, 'v2_end'],
    [{ action: 'end' }, 'action_end'],
    [{ action: 'end_call' }, 'action_end_call'],
    [{ type: 'end_call' }, 'type_end_call'],
    [{ name: 'end_call', args: {} }, 'name_end_call'],
    [{ actions: [{ type: 'say', text: 'Bye' }, { type: 'end' }] }, 'type_end'],
  ];
  for (const [sig, source] of yes) {
    it(`ends on ${JSON.stringify(sig)}`, () => {
      const r = endSignalFromBrain(sig);
      assert.equal(r.end, true);
      assert.equal(r.source, source);
    });
  }
  const no = [null, undefined, false, '', 'ANSWER', {}, { shouldEndCall: false }, { end: false }, { action: 'ANSWER' },
    { end: 'yes' }, { actions: [{ type: 'say' }] }, { spokenText: 'Goodbye.' }];
  for (const sig of no) {
    it(`does not end on ${JSON.stringify(sig)}`, () => assert.equal(endSignalFromBrain(sig).end, false));
  }
  it('carries a reason', () => {
    assert.equal(endSignalFromBrain({ action: 'end', reason: 'caller_done' }).reason, 'caller_done');
  });
});

describe('playout clock', () => {
  it('sends play back to back from now; clear resets (barge-in)', () => {
    const ft = fakeTime();
    const c = createPlayoutClock({ now: ft.now });
    c.note(32000); // 1000 ms
    c.note(16000); // +500 ms
    assert.equal(c.remainingMs(), 1500);
    ft.advance(400);
    assert.equal(c.remainingMs(), 1100);
    c.clear();
    assert.equal(c.remainingMs(), 0);
  });
});

function harness(over = {}) {
  const ft = fakeTime();
  const clock = createPlayoutClock({ now: ft.now });
  const calls = { rest: 0, close: [], ended: [] };
  const ctl = createEndCallController({
    playoutRemainingMs: () => clock.remainingMs(),
    hangupRest: async () => {
      calls.rest += 1;
      return over.rest || { ok: true, status: 200 };
    },
    closeMedia: (r) => calls.close.push({ r, at: ft.now() }),
    onEnded: (i) => calls.ended.push(i),
    graceMs: 600,
    maxWaitMs: 12000,
    restTimeoutMs: 2500,
    setTimer: ft.setTimer,
    now: ft.now,
    ...over.deps,
  });
  return { ft, clock, calls, ctl };
}

describe('createEndCallController', () => {
  it('hangs up only after the queued final audio has played, plus grace', async () => {
    const { ft, clock, calls, ctl } = harness();
    clock.note(32 * 2000); // 2 s of farewell still queued on the bridge
    void ctl.request({ source: 'brain_end' });
    assert.equal(ctl.ending(), true);
    await ft.advance(2500);
    assert.equal(calls.close.length, 0, 'not before audio + grace');
    await ft.advance(200);
    assert.equal(calls.rest, 1);
    assert.deepEqual(calls.close.map((c) => c.r), ['end_call']);
    assert.equal(calls.close[0].at, 3600);
    assert.equal(ctl.ended(), true);
  });

  it('re-checks: audio queued after the request (last streamed sentence) is waited for', async () => {
    const { ft, clock, calls, ctl } = harness();
    clock.note(32 * 500);
    void ctl.request({ source: 'v1_end_call' });
    await ft.advance(300);
    clock.note(32 * 1500); // the final sentence arrives late
    await ft.advance(900); // first timer (500+600) fires at 1100: 1400 ms still to play
    assert.equal(calls.close.length, 0);
    await ft.advance(3000);
    assert.equal(calls.close.length, 1);
    assert.ok(calls.close[0].at - 1000 >= 2000, `closed at +${calls.close[0].at - 1000} ms, after 2000 ms of audio`);
  });

  it('idempotent: many signals, one hangup, one close, same promise', async () => {
    const { ft, calls, ctl } = harness();
    const p1 = ctl.request({ source: 'brain_end' });
    const p2 = ctl.request({ source: 'v1_end_call' });
    const p3 = ctl.request({ source: 'turn_error_while_ending' });
    assert.equal(p1, p2);
    assert.equal(p2, p3);
    await ft.advance(5000);
    await p1;
    assert.equal(calls.rest, 1);
    assert.equal(calls.close.length, 1);
    assert.equal(calls.ended.length, 1);
    assert.equal(ctl.hangupCount(), 1);
    assert.equal(ctl.source(), 'brain_end');
  });

  it('caps the wait: a stuck playout never holds the call past maxWait', async () => {
    const { ft, clock, calls, ctl } = harness();
    clock.note(32 * 60000);
    void ctl.request({ source: 'v2_end' });
    await ft.advance(11999);
    assert.equal(calls.close.length, 0);
    await ft.advance(2);
    assert.equal(calls.close.length, 1);
  });

  it('REST failure or timeout still closes the media socket', async () => {
    const { ft, calls, ctl } = harness({ rest: { ok: false, status: 403, reason: 'scope_denied' } });
    void ctl.request({ source: 'brain_end' });
    await ft.advance(1000);
    assert.equal(calls.close.length, 1);

    const ft2 = fakeTime();
    const closes = [];
    const hung = createEndCallController({
      hangupRest: () => new Promise(() => {}), // never answers
      closeMedia: (r) => closes.push(r),
      graceMs: 600,
      restTimeoutMs: 2500,
      setTimer: ft2.setTimer,
      now: ft2.now,
    });
    void hung.request({ source: 'brain_end' });
    await ft2.advance(600);
    assert.equal(closes.length, 0, 'waiting on REST');
    await ft2.advance(2500);
    assert.deepEqual(closes, ['end_call']);
  });

  it('onEnded runs before the REST hangup and the close (guard is up first)', async () => {
    const order = [];
    const ft = fakeTime();
    const ctl = createEndCallController({
      onEnded: () => order.push('ended'),
      hangupRest: async () => order.push('rest'),
      closeMedia: () => order.push('close'),
      graceMs: 200,
      setTimer: ft.setTimer,
      now: ft.now,
    });
    void ctl.request({ source: 'brain_end' });
    await ft.advance(300);
    assert.deepEqual(order, ['ended', 'rest', 'close']);
  });
});

describe('outageSuppressed: the call-ended guard', () => {
  it('suppresses once we are ending or the call is over', () => {
    assert.equal(outageSuppressed({ endRequested: true, wsOpen: true }), 'end_call');
    assert.equal(outageSuppressed({ callEnding: true, wsOpen: true }), 'call_ending');
    // HD_2ccfbf6e1fa4 / HD_5c9056d78d02: caller hung up, ws closed, reply found tts=null.
    assert.equal(outageSuppressed({ wsOpen: false }), 'media_closed');
    assert.equal(outageSuppressed({ wsOpen: true, terminal: true }), 'terminal_webhook');
  });
  it('a live call with a dead TTS is still an outage', () => {
    assert.equal(outageSuppressed({ wsOpen: true }), '');
    assert.equal(outageSuppressed({}), '');
  });
});

describe('hangupSautikitCall (POST /v1/calls/{id}/hangup)', () => {
  beforeEach(() => resetHangupScopeLatch());
  it('posts to the documented endpoint with the bearer key', async () => {
    const seen = [];
    const r = await hangupSautikitCall('HD_abc123', {
      apiKey: 'k-test',
      apiBase: 'https://api.example.test/',
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return { status: 200 };
      },
    });
    assert.deepEqual(r, { ok: true, status: 200 });
    assert.equal(seen[0].url, 'https://api.example.test/v1/calls/HD_abc123/hangup');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer k-test');
  });
  it('skips without a sid or key, never throws on network errors', async () => {
    assert.equal((await hangupSautikitCall('', { apiKey: 'k' })).reason, 'no_call_sid');
    assert.equal((await hangupSautikitCall('unknown', { apiKey: 'k' })).reason, 'no_call_sid');
    assert.equal((await hangupSautikitCall('HD_1', { apiKey: '', fetchImpl: async () => ({ status: 200 }) })).reason, process.env.SAUTIKIT_API_KEY ? undefined : 'no_api_key');
    const r = await hangupSautikitCall('HD_1', { apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.deepEqual(r, { ok: false, status: 'error', reason: 'network' });
  });
  it('401/403 latches (no call-control scope): one try, then skipped', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return { status: 403 };
    };
    const a = await hangupSautikitCall('HD_1', { apiKey: 'k', fetchImpl });
    const b = await hangupSautikitCall('HD_2', { apiKey: 'k', fetchImpl });
    assert.equal(a.reason, 'scope_denied');
    assert.equal(b.reason, 'scope_denied');
    assert.equal(b.status, 'skipped');
    assert.equal(n, 1);
  });
  it('404 and 5xx are reported, not thrown', async () => {
    assert.equal((await hangupSautikitCall('HD_1', { apiKey: 'k', fetchImpl: async () => ({ status: 404 }) })).reason, 'not_found');
    assert.equal((await hangupSautikitCall('HD_1', { apiKey: 'k', fetchImpl: async () => ({ status: 502 }) })).reason, 'http_error');
  });
});

describe('server.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('controller exists only with the flag on; flag off keeps the old timers', () => {
    assert.match(src, /const endHonour = endCallHonourEnabled\(\)\s*\?/);
    assert.match(src, /: null;\n  \/\*\* Brain said the call is over/);
    // Old paths still present for flag off.
    assert.match(src, /else if \(result\?\.shouldEndCall && !bargeInActive\) \{\n\s*console\.log\(`\[ws\/media\]\[\$\{sidLabel\(\)\}\] end-call marker/);
    assert.match(src, /if \(requestEndCall\('brain_end'\)\) return;\n\s*const delay = farewellHangupDelayMs/);
  });
  it('the playout clock is fed by every PCM send and cleared on barge-in', () => {
    assert.match(src, /const playout = PLAYOUT_CLOCKS\.get\(ws\);\n  if \(playout\) playout\.note\(pcm\.length\);/);
    assert.match(src, /const playout = PLAYOUT_CLOCKS\.get\(ws\);\n  if \(playout\) playout\.clear\(\);/);
  });
  it('outage handler checks the call-ended guard before any clip or owner alert', () => {
    const i = src.indexOf('async function handleSpeechProviderOutage(reason) {');
    const body = src.slice(i, i + 2500);
    const guard = body.indexOf('outageSuppressed(');
    const alert = body.indexOf('noteSpeechOutage(');
    const flag = body.indexOf('speechOutageStarted = true');
    assert.ok(guard > 0 && guard < flag && flag < alert, 'guard runs first');
  });
});
