'use strict';
// Voice BA v2 SHADOW hook (BRAIN_V2_SHADOW): off = inert; on = log-only,
// never awaited on the live path, never speaks, never writes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/conversation/v2Shadow');
const { createVoiceTrace } = require('../src/speech/voiceTrace');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

// A weekday two days out (Nairobi time), so the slot is never "already passed". A fixed "Friday at 10am"
// failed every Friday after 10:00 EAT (CI on #712, 16 Oct 2026 23:17 EAT: "That time has already passed").
const BOOK_DAY = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi' });
const BOOK = [`Hi, I'd like to book interior window cleaning for ${BOOK_DAY} at 10am.`, 'My name is Alvin', 'Kitengela, near Naivas', 'Yes'];
const memSink = () => { const writes = []; const updates = []; return { writes, updates, write: async (r) => { writes.push(JSON.parse(JSON.stringify(r))); }, update: async (r) => { updates.push(JSON.parse(JSON.stringify(r))); } }; };

test('flag: off by default and for falsy values; on for on/1/true; tenant allowlist', () => {
  assert.equal(S.brainV2ShadowEnabled({ env: {} }), false);
  for (const v of ['', 'off', '0', 'false', 'no']) assert.equal(S.brainV2ShadowEnabled({ env: { BRAIN_V2_SHADOW: v } }), false);
  for (const v of ['on', '1', 'true', 'ON']) assert.equal(S.brainV2ShadowEnabled({ env: { BRAIN_V2_SHADOW: v } }), true);
  assert.equal(S.brainV2ShadowEnabled({ env: { BRAIN_V2_SHADOW: 'on', BRAIN_V2_TENANTS: 'a,b' }, tenantId: 'c' }), false);
  assert.equal(S.brainV2ShadowEnabled({ env: { BRAIN_V2_SHADOW: 'on', BRAIN_V2_TENANTS: 'a,b' }, tenantId: 'b' }), true);
  // BRAIN_V2 / BRAIN_V2_MODE=live alone never arm the Voice hook
  assert.equal(S.brainV2ShadowEnabled({ env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' } }), false);
  assert.equal(S.shadowTimeoutMs({}), 2500);
});

test('flag off: server.js hook is fully guarded and lazy (no v2 load, no runner)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = src.indexOf('if (brainV2ShadowEnabled({ tenantId: brainProfile?.id }))');
  assert.ok(i > 0, 'hook guarded by flag');
  const hook = src.slice(i, src.indexOf('const turnMatches', i));
  assert.match(hook, /void brainV2Shadow/);
  assert.doesNotMatch(hook, /await /, 'never awaited on the live path');
  assert.doesNotMatch(hook, /speakText|pushText|beginSpeak|sendPcmToMedia|onSpokenChunk|speakToolHold/, 'never speaks');
  assert.equal((src.match(/brainV2Shadow\b/g) || []).length >= 3, true);
  // shadow module does not require Brain v2 at load
  delete require.cache[require.resolve('../src/conversation/v2')];
  delete require.cache[require.resolve('../src/conversation/v2Shadow')];
  require('../src/conversation/v2Shadow');
  assert.equal(require.cache[require.resolve('../src/conversation/v2')], undefined);
});

test('flag off: voiceTrace turn records are unchanged (no shadow stage/key)', () => {
  const sink = memSink();
  const tr = createVoiceTrace({ enabled: true, sink, callId: 'HD_x', tenantId: null });
  tr.beginTurn({ callerText: 'hi' }); tr.noteTts({ text: 'Hello.' });
  const rec = tr.commitTurn({ outcome: 'ok' });
  assert.equal(rec.shadow, undefined);
  assert.equal(rec.stages.some((s) => s.stage === 'brain_v2_shadow'), false);
});

test('timing: fire() returns synchronously and the live path is not delayed', async () => {
  let started = 0;
  const loadV2 = () => ({
    createState: () => ({}), createDryRunHandlers: () => ({}), createGeminiModel: () => null,
    async *runTurnStream() { started = Date.now(); const t = Date.now(); while (Date.now() - t < 80); yield { type: 'done', line: '', toolResults: [] }; },
  });
  const sh = S.createBrainV2Shadow({ env: {}, loadV2, log: () => {} });
  const t0 = process.hrtime.bigint();
  const p = sh.fire({ text: 'hi', profile: {}, langLock: 'en', turnIndex: 1 });
  const fireMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(fireMs < 5, `fire() sync cost ${fireMs}ms`);
  // live path continues: a zero-delay timer + microtasks complete before shadow starts its CPU work
  const liveDone = await new Promise((r) => setImmediate(() => r(Date.now())));
  assert.equal(started === 0 || started >= liveDone, true, 'shadow ran after live work yielded');
  const stage = await p;
  assert.equal(stage.stage, 'brain_v2_shadow');
});

test('timing: real v2 shadow on a booking call adds < 5ms sync to each live turn', async () => {
  const sh = S.createBrainV2Shadow({ env: {}, log: () => {} });
  const stages = []; let maxMs = 0;
  for (let i = 0; i < BOOK.length; i++) {
    const t0 = process.hrtime.bigint();
    sh.fire({ text: BOOK[i], profile: DD, langLock: 'en', turnIndex: i + 1, onResult: (s) => stages.push(s) });
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(maxMs < 5, `max sync ${maxMs}ms`);
  await new Promise((r) => setTimeout(r, 300));
  await sh.fire({ text: 'ok thanks', profile: DD, langLock: 'en', turnIndex: 5, onResult: (s) => stages.push(s) });
  assert.ok(stages.length >= 4, `got ${stages.length}`);
  const book = stages.flatMap((s) => s.toolIntents).find((t) => t.name === 'createAppointment');
  assert.ok(book, 'booking intent logged'); assert.equal(book.write, true); assert.equal(book.dryRun, true); assert.ok(book.args);
  for (const s of stages) { assert.equal(s.mode, 'shadow'); assert.equal(typeof s.totalMs, 'number'); assert.equal(s.timedOut, false); }
});

test('no writes: only dry-run handlers reach Brain; no db/supabase module is loaded', async () => {
  const before = new Set(Object.keys(require.cache));
  let seenHandlers = null;
  const real = require('../src/conversation/v2');
  const loadV2 = () => ({ ...real, runTurnStream: (st, o) => { seenHandlers = o.handlers; return real.runTurnStream(st, o); } });
  const sh = S.createBrainV2Shadow({ env: {}, loadV2, log: () => {} });
  for (let i = 0; i < BOOK.length; i++) await sh.fire({ text: BOOK[i], profile: DD, langLock: 'en', turnIndex: i + 1 });
  assert.deepEqual(Object.keys(seenHandlers).sort(), ['createAppointment', 'createServiceRequest', 'escalate', 'saveCallerInfo', 'updateAppointment']);
  for (const [k, fn] of Object.entries(seenHandlers)) {
    const r = await fn({ probe: 1 });
    assert.equal(r.dryRun, true, `${k} is dry-run`);
  }
  const loaded = Object.keys(require.cache).filter((k) => !before.has(k));
  assert.deepEqual(loaded.filter((k) => /src[\\/](db|lib[\\/]supabase)/.test(k)), []);
});

test('no speech: dry-run "booked" line is logged, never sent anywhere else', async () => {
  const sh = S.createBrainV2Shadow({ env: {}, log: () => {} });
  let last;
  for (let i = 0; i < BOOK.length; i++) last = await sh.fire({ text: BOOK[i], profile: DD, langLock: 'en', turnIndex: i + 1 });
  assert.ok(last.v2Text.length > 0);
  assert.ok(last.toolIntents.some((t) => t.write));
  // module exposes no speech surface at all
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/conversation/v2Shadow.js'), 'utf8');
  assert.doesNotMatch(src, /require\([^)]*(tts|soniox|speech\/|media|db|supabase)/i);
});

test('timeout: a hung v2 turn is cut at BRAIN_V2_SHADOW_TIMEOUT_MS and logged as timedOut', async () => {
  const loadV2 = () => ({ createState: () => ({}), createDryRunHandlers: () => ({}), async *runTurnStream() { await new Promise(() => {}); } });
  const sh = S.createBrainV2Shadow({ env: { BRAIN_V2_SHADOW_TIMEOUT_MS: '50' }, loadV2, log: () => {} });
  const s = await sh.fire({ text: 'hi', turnIndex: 1 });
  assert.equal(s.timedOut, true); assert.equal(s.aborted, true); assert.ok(s.totalMs >= 45 && s.totalMs < 500);
});

test('errors are caught: throwing loader / stream never reject fire()', async () => {
  const logs = [];
  const a = S.createBrainV2Shadow({ env: {}, loadV2: () => { throw new Error('boom'); }, log: (m) => logs.push(m) });
  assert.equal(await a.fire({ text: 'hi', turnIndex: 1 }), null);
  assert.equal(await a.fire({ text: 'hi', turnIndex: 2 }), null); // disabled for call
  const b = S.createBrainV2Shadow({ env: {}, log: () => {}, loadV2: () => ({ createState: () => ({}), createDryRunHandlers: () => ({}), async *runTurnStream() { throw new Error('x'); } }) });
  const s = await b.fire({ text: 'hi', turnIndex: 1 });
  assert.equal(s.error, 'x');
  const c = S.createBrainV2Shadow({ env: {}, log: () => {}, loadV2: () => ({ createState: () => ({}), createDryRunHandlers: () => ({}), async *runTurnStream() { yield { type: 'done', line: '' }; } }) });
  assert.ok(await c.fire({ text: 'hi', turnIndex: 1, onResult: () => { throw new Error('trace'); } }));
});

test('trace: shadow landing before commit is diffed against live tts/tools at commit', async () => {
  const sink = memSink();
  const tr = createVoiceTrace({ enabled: true, sink, callId: 'HD_abc', tenantId: null });
  tr.beginTurn({ callerText: 'book', language: { current: 'en' } });
  const idx = tr.currentTurnIndex();
  tr.noteBrainV2Shadow({ stage: 'brain_v2_shadow', mode: 'shadow', turnIndex: idx, v2Text: 'Done, booked for Friday.', v2Lang: 'en', toolIntents: [{ name: 'createAppointment', v1Name: 'create_appointment', write: true }] });
  tr.noteTool({ name: 'create_appointment', status: 'ok' });
  tr.noteTts({ text: 'Booked for Friday.' });
  const rec = tr.commitTurn({ outcome: 'ok' });
  const st = rec.stages.find((s) => s.stage === 'brain_v2_shadow');
  assert.equal(st.mode, 'shadow'); assert.equal(st.diff.toolIntentMatch, true);
  assert.ok(st.diff.textSimilarity > 0.5); assert.equal(st.diff.langMismatch, false);
  assert.equal(sink.writes[0].stages.some((s) => s.stage === 'brain_v2_shadow'), true);
});

test('trace: shadow landing after commit updates the same turn row via sink.update', async () => {
  const sink = memSink();
  const tr = createVoiceTrace({ enabled: true, sink, callId: 'HD_abc', tenantId: null });
  tr.beginTurn({ callerText: 'hi', language: { current: 'sw' } }); const idx = tr.currentTurnIndex();
  tr.noteTts({ text: 'Karibu.' }); tr.commitTurn({ outcome: 'ok' });
  tr.noteBrainV2Shadow({ stage: 'brain_v2_shadow', mode: 'shadow', turnIndex: idx, v2Text: 'Welcome.', v2Lang: 'en', toolIntents: [] });
  await tr.finishCall();
  const up = sink.updates.find((u) => u.stages.some((s) => s.stage === 'brain_v2_shadow'));
  assert.ok(up); assert.equal(up.turnIndex, idx);
  const st = up.stages.find((s) => s.stage === 'brain_v2_shadow');
  assert.equal(st.diff.langMismatch, true); assert.equal(st.diff.toolIntentMatch, true);
});

test('diff: similarity + tool agreement helpers', () => {
  assert.equal(S.textSimilarity('', ''), 1);
  assert.equal(S.textSimilarity('a b', 'a b'), 1);
  assert.equal(S.textSimilarity('a b', 'c d'), 0);
  const d = S.diffAgainstLive({ v2Text: 'x', toolIntents: [{ v1Name: 'escalate' }] }, { stages: [{ stage: 'tool', name: 'create_appointment' }] });
  assert.equal(d.toolIntentMatch, false); assert.deepEqual(d.v2Tools, ['escalate']); assert.deepEqual(d.v1Tools, ['create_appointment']);
});

test('caller file: phone, contact name and open visit rows reach createState', async () => {
  let got = null;
  const loadV2 = () => ({ createState: (o) => { got = o; return {}; }, createDryRunHandlers: () => ({}), async *runTurnStream() { yield { type: 'done', line: '' }; } });
  const sh = S.createBrainV2Shadow({ env: {}, log: () => {}, loadV2, callerFile: () => ({ callerPhone: '+254790000001', contactName: 'Alvin', openRows: [
    { id: 'a1', kind: 'visit', job: 'Carpet cleaning', windowStart: '2026-10-16T07:00:00Z', place: 'Kitengela', status: 'confirmed' },
    { id: 'r1', kind: 'request', job: 'Callback' },
    { id: 'a0', kind: 'visit', job: 'Sofa', past: true },
  ] }) });
  await sh.fire({ text: 'hi', profile: {}, turnIndex: 1 });
  assert.equal(got.callerPhone, '+254790000001'); assert.equal(got.contactName, 'Alvin');
  assert.deepEqual(got.openRows, [{ id: 'a1', service_name: 'Carpet cleaning', window_start: '2026-10-16T07:00:00Z', address_landmark: 'Kitengela', status: 'confirmed' }]);
  // and the real v2 normalises it
  const st = require('../src/conversation/v2').createState({ profile: DD, ...S.callerFileForState({ callerFile: { openRows: [{ id: 'a1', kind: 'visit', job: 'Carpet', windowStart: '2026-10-16T07:00:00Z', place: 'Kitengela', status: 'confirmed' }] } }) });
  assert.equal(st.file.openRows[0].service, 'Carpet'); assert.equal(st.file.openRows[0].when.time, '10:00');
});

test('chain: a timed-out turn finishes before the next turn touches the state (never two at once)', async () => {
  let running = 0; let maxRunning = 0; const order = [];
  const loadV2 = () => ({ createState: () => ({}), createDryRunHandlers: () => ({}),
    async *runTurnStream(_s, o) {
      running += 1; maxRunning = Math.max(maxRunning, running); order.push(`start:${o.text}`);
      await new Promise((r) => setTimeout(r, o.text === 'slow' ? 120 : 5));
      running -= 1; order.push(`end:${o.text}`);
      yield { type: 'done', line: '' };
    } });
  const sh = S.createBrainV2Shadow({ env: { BRAIN_V2_SHADOW_TIMEOUT_MS: '30' }, log: () => {}, loadV2 });
  const a = sh.fire({ text: 'slow', profile: {}, turnIndex: 1 });
  const b = sh.fire({ text: 'next', profile: {}, turnIndex: 2 });
  const sa = await a; assert.equal(sa.timedOut, true);
  await b;
  assert.equal(maxRunning, 1);
  assert.deepEqual(order, ['start:slow', 'end:slow', 'start:next', 'end:next']);
});
