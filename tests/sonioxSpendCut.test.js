// Soniox spend cut (Alvin GO via Chief 2026-10-24): silence gate, call limits,
// per-call meter, persistent PCM store, name splice. All flags default off.
// Run: node --test tests/sonioxSpendCut.test.js

const test = require('node:test');
const assert = require('node:assert');
const { createSttSilenceGate, sttSilenceGateOn, frameRms } = require('../src/speech/sttSilenceGate');
const { createCallLimits, deadAirHangupOn, maxCallOn, limitLine } = require('../src/speech/callLimits');
const { createCallMeter, dailyMeterTotals, resetDailyMeter } = require('../src/speech/callMeter');
const { createPcmStore, setSharedPcmStore, objectPath, warmAllowlist, pcmPersistOn } = require('../src/speech/pcmPersist');
const { evaluateBargeIn } = require('../src/speech/turnTaking');
const { isBackchannel } = require('../src/conversation/language');

const FRAME_MS = 20;
const silent = () => Buffer.alloc(FRAME_MS * 32);
function voiced(amp = 3000) {
  const b = Buffer.alloc(FRAME_MS * 32);
  for (let i = 0; i < b.length / 2; i += 1) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
}
function clock() {
  let t = 1_000_000;
  return { now: () => t, step: (ms = FRAME_MS) => (t += ms) };
}

test('flags: only the exact value "on" enables; default off', () => {
  for (const fn of [sttSilenceGateOn, deadAirHangupOn, maxCallOn, pcmPersistOn]) {
    assert.strictEqual(fn({}), false);
    assert.strictEqual(fn({ VOICE_STT_SILENCE_GATE: 'true', VOICE_DEAD_AIR_HANGUP: '1', VOICE_MAX_CALL: 'ON', VOICE_PCM_PERSIST: 'yes' }), false);
  }
  assert.strictEqual(sttSilenceGateOn({ VOICE_STT_SILENCE_GATE: 'on' }), true);
  assert.strictEqual(pcmPersistOn({ VOICE_PCM_PERSIST: 'on' }), true);
});

test('frameRms: silence 0, tone high', () => {
  assert.strictEqual(frameRms(silent()), 0);
  assert.ok(frameRms(voiced()) > 2000);
});

test('gate off: every frame is sent (today\'s behaviour)', () => {
  const g = createSttSilenceGate({ enabled: false });
  for (let i = 0; i < 100; i += 1) assert.strictEqual(g.admit(silent()).send.length, 1);
  assert.strictEqual(g.stats.bytesSent, g.stats.bytesIn);
});

test('gate on: caller silence is held back, keepalive sent instead', () => {
  const c = clock();
  const g = createSttSilenceGate({ enabled: true, now: c.now, config: { keepaliveMs: 8000, ttsTailMs: 800 } });
  let sent = 0;
  let keepalives = 0;
  for (let i = 0; i < 1000; i += 1) { // 20 s of silence
    c.step();
    const r = g.admit(silent(), { ttsSpeaking: false });
    sent += r.send.length;
    if (r.keepalive) keepalives += 1;
  }
  assert.strictEqual(sent, 0);
  assert.ok(keepalives >= 2 && keepalives <= 3, `keepalives=${keepalives}`);
});

test('gate on: pre-roll flushed with first voiced frame, hangover keeps tail', () => {
  const c = clock();
  const g = createSttSilenceGate({ enabled: true, now: c.now, config: { prerollMs: 300, hangoverMs: 1000, ttsTailMs: 0 } });
  for (let i = 0; i < 100; i += 1) { c.step(); g.admit(silent()); }
  c.step();
  const first = g.admit(voiced());
  // 300 ms pre-roll of 20 ms frames (15) + the voiced frame.
  assert.ok(first.send.length >= 15 && first.send.length <= 16, `len=${first.send.length}`);
  // Trailing silence forwarded for the hangover (endpoint detection needs it).
  let tail = 0;
  for (let i = 0; i < 100; i += 1) { c.step(); tail += g.admit(silent()).send.length; }
  assert.ok(tail >= 45 && tail <= 51, `tail=${tail}`);
});

test('barge-in sim: with gating on, every frame reaches STT while TTS speaks and barge fires', () => {
  const c = clock();
  const g = createSttSilenceGate({ enabled: true, now: c.now, config: { ttsTailMs: 800 } });
  const sttFeed = [];
  // Caller quiet while agent speaks 2 s, then talks over it.
  for (let i = 0; i < 100; i += 1) {
    c.step();
    sttFeed.push(...g.admit(silent(), { ttsSpeaking: true }).send);
  }
  assert.strictEqual(sttFeed.length, 100, 'full feed during TTS');
  for (let i = 0; i < 25; i += 1) {
    c.step();
    sttFeed.push(...g.admit(voiced(), { ttsSpeaking: true }).send);
  }
  assert.strictEqual(sttFeed.length, 125);
  // Soniox now transcribes the overlap; the barge decision is unchanged.
  const d = evaluateBargeIn({
    text: 'No wait, I need a plumber tomorrow',
    speaking: true,
    turnBusy: true,
    speakStartedAt: c.now() - 2500,
    lastAgentText: 'We can help tomorrow morning.',
    isBackchannel,
    now: c.now(),
  });
  assert.strictEqual(d.barge, true, `reason=${d.reason}`);
  // TTS tail: still forwarded right after playback stops.
  c.step();
  assert.strictEqual(g.admit(silent(), { ttsSpeaking: false }).send.length, 1);
});

test('call limits: dead air fires once after quiet, not while agent speaks', async () => {
  let t = 0;
  let speaking = true;
  const fired = [];
  const lim = createCallLimits({
    env: { VOICE_DEAD_AIR_HANGUP: 'on', VOICE_DEAD_AIR_HANGUP_SEC: '30' },
    now: () => t,
    canFire: () => !speaking,
    onLimit: (k) => fired.push(k),
    setInterval: () => 1, clearInterval: () => {},
  });
  assert.ok(lim.start());
  t = 31_000; lim.check();
  assert.deepStrictEqual(fired, []);
  speaking = false;
  t = 50_000; lim.check();
  assert.deepStrictEqual(fired, []); // reset when blocked
  t = 62_000; lim.check(); lim.check();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(fired, ['deadAir']);
});

test('call limits: max call length; voiced activity resets dead air; off = no timer', async () => {
  let t = 0;
  const fired = [];
  const lim = createCallLimits({
    env: { VOICE_MAX_CALL: 'on', VOICE_MAX_CALL_SEC: '600', VOICE_DEAD_AIR_HANGUP: 'on' },
    now: () => t, onLimit: (k) => fired.push(k), setInterval: () => 1, clearInterval: () => {},
  });
  for (t = 0; t < 600_000; t += 20_000) { lim.activity(); lim.check(); }
  t = 600_000; lim.check();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(fired, ['maxCall']);
  const off = createCallLimits({ env: {}, onLimit: () => {} });
  assert.strictEqual(off.start(), false);
  assert.match(limitLine('maxCall', 'sw'), /Kwaheri/);
});

test('call meter: per-call summary and daily rolling total', () => {
  resetDailyMeter();
  const m = createCallMeter();
  m.tts('Hello there.', 32000 * 2);
  m.cache(true); m.cache(false);
  const s = m.finish({ bytesIn: 32000 * 60, bytesSent: 32000 * 15, keepalives: 5 });
  assert.strictEqual(s.sttSecondsSent, 15);
  assert.strictEqual(s.sttSecondsGated, 45);
  assert.strictEqual(s.ttsChars, 12);
  assert.strictEqual(s.ttsRenderedSeconds, 2);
  createCallMeter().finish({ bytesIn: 32000, bytesSent: 32000 });
  const d = dailyMeterTotals();
  assert.strictEqual(d.calls, 2);
  assert.strictEqual(d.sttSecondsSent, 16);
});

function fakeSupabase({ fail = false } = {}) {
  const objects = new Map();
  return {
    objects,
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async (path, buf) => { if (fail) throw new Error('down'); objects.set(path, Buffer.from(buf)); return { error: null }; },
        download: async (path) => {
          if (fail) throw new Error('down');
          const b = objects.get(path);
          return b ? { data: { arrayBuffer: async () => b }, error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    },
  };
}

test('pcm store: off = no-op; on = round trip keyed by cache key; errors degrade to null', async () => {
  const sb = fakeSupabase();
  const off = createPcmStore({ enabled: false, client: sb });
  assert.strictEqual(await off.save('greeting', 'k', Buffer.from([1, 2])), false);
  assert.strictEqual(sb.objects.size, 0);
  const on = createPcmStore({ enabled: true, client: sb });
  assert.strictEqual(await on.save('greeting', 'voice|en|1|abc', Buffer.from([1, 2, 3])), true);
  assert.ok(sb.objects.has(objectPath('greeting', 'voice|en|1|abc')));
  assert.deepStrictEqual([...(await on.load('greeting', 'voice|en|1|abc'))], [1, 2, 3]);
  assert.strictEqual(await on.load('greeting', 'missing'), null);
  const broken = createPcmStore({ enabled: true, client: fakeSupabase({ fail: true }) });
  assert.strictEqual(await broken.load('greeting', 'x'), null);
  assert.strictEqual(await broken.save('greeting', 'x', Buffer.from([1])), false);
});

test('greeting warm restores persisted PCM after a restart without a Soniox render', async () => {
  const cache = require('../src/speech/greetingPcmCache');
  const { renderGreetingPcm } = require('../src/speech/greetingWarm');
  const sb = fakeSupabase();
  setSharedPcmStore(createPcmStore({ enabled: true, client: sb }));
  try {
    cache.resetGreetingPcmCache();
    const profile = { id: 't-dnd', businessName: 'Done and Dusted', agentName: 'Amina' };
    let renders = 0;
    const createSession = () => {
      renders += 1;
      return {
        ready: Promise.resolve(),
        beginSpeak: async () => ({ pushText() {}, end: async () => ({ pcm: Buffer.alloc(640, 1) }) }),
        close() {},
      };
    };
    const first = await renderGreetingPcm({ text: 'Done and Dusted, this is Amina.', profile, tenantId: 't-dnd', createSession });
    assert.strictEqual(first.rendered, true);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(sb.objects.size, 1);
    cache.resetGreetingPcmCache(); // "restart"
    const again = await renderGreetingPcm({ text: 'Done and Dusted, this is Amina.', profile, tenantId: 't-dnd', createSession });
    assert.strictEqual(again.restored, true);
    assert.strictEqual(renders, 1);
    assert.ok(cache.hasGreetingPcm(again.key));
  } finally {
    setSharedPcmStore(createPcmStore({ enabled: false }));
    cache.resetGreetingPcmCache();
  }
});

test('warm allowlist limits the sweep to listed tenants (staging DnD)', async () => {
  assert.strictEqual(warmAllowlist({}), null);
  const prev = process.env.VOICE_PCM_WARM_TENANTS;
  process.env.VOICE_PCM_WARM_TENANTS = 'dnd-id';
  try {
    const { createGreetingWarmer } = require('../src/speech/greetingWarm');
    const asked = [];
    const w = createGreetingWarmer({
      listTenantIds: async () => ['dnd-id', 'other-id'],
      getProfile: async (id) => { asked.push(id); return { id, businessName: 'Business' }; },
      createSession: () => { throw new Error('no render in test'); },
    });
    await w.warmAll();
    assert.deepStrictEqual(asked, ['dnd-id']);
  } finally {
    if (prev == null) delete process.env.VOICE_PCM_WARM_TENANTS;
    else process.env.VOICE_PCM_WARM_TENANTS = prev;
  }
});

test('name splice: segments only for returning + nameConfirmed; sharedLine never named', () => {
  const callOpening = require('../src/speech/callOpening');
  const base = { businessName: 'Done and Dusted', agentName: 'Amina', isOpen: true, recordingNotice: false };
  const named = callOpening.composeOpening({ ...base, isReturning: true, nameConfirmed: true, knownName: 'John' });
  assert.deepStrictEqual(named.segments, {
    head: 'Done and Dusted, this is Amina.',
    live: 'Welcome back, John.',
    tail: 'How can I help?',
  });
  assert.strictEqual([named.segments.head, named.segments.live, named.segments.tail].join(' '), named.text);
  assert.strictEqual(callOpening.composeOpening({ ...base, isReturning: true, knownName: 'John' }).segments, null);
  assert.strictEqual(callOpening.composeOpening(base).segments, null);
  const facts = callOpening.callerOpeningFacts
    ? callOpening.callerOpeningFacts({ name: 'John', nameConfirmed: true, sharedLine: true })
    : { nameConfirmed: false };
  assert.strictEqual(facts.nameConfirmed, false);
});

test('name splice: warm lines add cached head and tail only when flag is on', () => {
  const callOpening = require('../src/speech/callOpening');
  const profile = { businessName: 'Done and Dusted', agentName: 'Amina' };
  const before = callOpening.openingWarmLines(profile, { recordingNotice: false });
  const prev = process.env.VOICE_OPENING_NAME_SPLICE;
  process.env.VOICE_OPENING_NAME_SPLICE = 'on';
  try {
    const after = callOpening.openingWarmLines(profile, { recordingNotice: false });
    assert.ok(after.includes('Done and Dusted, this is Amina.'));
    assert.ok(!before.includes('Done and Dusted, this is Amina.'));
    assert.ok(!after.some((l) => /Name/.test(l)), 'placeholder name never warmed');
  } finally {
    if (prev == null) delete process.env.VOICE_OPENING_NAME_SPLICE;
    else process.env.VOICE_OPENING_NAME_SPLICE = prev;
  }
});
