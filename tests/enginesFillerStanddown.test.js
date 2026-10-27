'use strict';
// BRAIN_ENGINES (#975) x Voice filler: one filler per turn, first one wins; streamed results never re-spoken.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEnginesFillerTurn } = require('../src/speech/enginesFillerStanddown');

function harness({ barged = () => false, phaseA = true, voiceFiller = 'Sawa.' } = {}) {
  const ev = [];
  const gate = createEnginesFillerTurn({
    fillerMs: 900,
    isBarged: barged,
    pickVoiceFiller: () => voiceFiller,
    playFiller: (text, src) => ev.push({ kind: 'filler', src, text }),
    speakLine: async (text) => { ev.push({ kind: 'line', text }); return { ok: true }; },
    cutFillerForReply: async () => { ev.push({ kind: 'cut' }); return true; },
    phaseA,
    markFiller: () => ev.push({ kind: 'markFiller' }),
    markFirstSpokenChunk: () => ev.push({ kind: 'markFirst' }),
  });
  return { gate, ev, fillers: () => ev.filter((e) => e.kind === 'filler') };
}

test('Brain filler at 700 ms: Voice 900 ms filler never fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gate, ev, fillers } = harness();
  gate.arm();
  t.mock.timers.tick(700);
  gate.onSentence({ text: 'Let me check the price.', lang: 'en', filler: true });
  t.mock.timers.tick(2000);
  assert.deepEqual(fillers(), [{ kind: 'filler', src: 'brain', text: 'Let me check the price.' }]);
  gate.onSentence({ text: 'A full clean is 2,500 shillings.', lang: 'en' });
  const r = await gate.finish({ streamed: true, line: 'A full clean is 2,500 shillings.' });
  assert.deepEqual(r.spoken, { ok: true });
  // the filler is not the first spoken chunk; the real line is, and Phase A cuts the filler before it
  assert.deepEqual(ev.map((e) => e.kind), ['markFiller', 'filler', 'markFirst', 'cut', 'line']);
  assert.equal(fillers().length, 1);
});

test('no Brain filler: Voice filler fires at 900 ms as today', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gate, fillers } = harness();
  gate.arm();
  t.mock.timers.tick(899);
  assert.equal(fillers().length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(fillers(), [{ kind: 'filler', src: 'voice', text: 'Sawa.' }]);
});

test('Brain filler after Voice filler already played is dropped (no stacked second filler)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gate, fillers } = harness();
  gate.arm();
  t.mock.timers.tick(900);
  gate.onSentence({ text: 'Let me check our hours.', lang: 'en', filler: true });
  assert.deepEqual(fillers().map((f) => f.src), ['voice']);
  assert.equal(gate.dropped[0].why, 'voice_filler_already');
});

test('a real line before 900 ms cancels the Voice filler; a late Brain filler after it is dropped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gate, fillers } = harness();
  gate.arm();
  t.mock.timers.tick(500);
  gate.onSentence({ text: 'We are open until six.', lang: 'en' });
  gate.onSentence({ text: 'Just a moment while I check.', lang: 'en', filler: true });
  t.mock.timers.tick(2000);
  assert.equal(fillers().length, 0);
  assert.equal(gate.dropped[0].why, 'reply_started');
});

test('caller speech mid-wait still clears: no Voice filler, no Brain filler, no line', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let barged = false;
  const { gate, ev, fillers } = harness({ barged: () => barged });
  gate.arm();
  t.mock.timers.tick(400);
  barged = true;
  t.mock.timers.tick(600); // 900 ms passes during caller speech
  gate.onSentence({ text: 'Let me check that area.', lang: 'en', filler: true });
  gate.onSentence({ text: 'Yes, we cover Kilimani.', lang: 'en' });
  const r = await gate.finish({ streamed: true, line: 'Yes, we cover Kilimani.' });
  assert.equal(fillers().length, 0);
  assert.equal(ev.filter((e) => e.kind === 'line').length, 0);
  assert.deepEqual(r.spoken, { ok: false, barged: true });
});

test('streamed:true is never re-spoken; streamed with no reply line returns empty, not the line', async () => {
  const a = harness();
  a.gate.onSentence({ text: 'Let me check.', lang: 'en', filler: true });
  const r = await a.gate.finish({ streamed: true, line: '' });
  assert.deepEqual(r.spoken, { ok: false, empty: true, streamed: true });
  assert.equal(a.ev.filter((e) => e.kind === 'line').length, 0);
  // not streamed: server.js keeps its own speak path
  const b = harness();
  assert.equal(await b.gate.finish({ streamed: false, line: 'Hi.' }), null);
  assert.equal(await b.gate.finish(null), null);
});

test('only one filler per turn even if the Brain emits two', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gate, fillers } = harness();
  gate.arm();
  t.mock.timers.tick(700);
  gate.onSentence({ text: 'Let me check the price.', filler: true });
  gate.onSentence({ text: 'Just a moment while I check.', filler: true });
  t.mock.timers.tick(1000);
  assert.equal(fillers().length, 1);
});

// server.js wiring: the gate is used only when BRAIN_ENGINES (+ BRAIN_MODEL_LEAD path) is on; off = today's code.
test('server.js: flag-off keeps the v1Filler / onV1Sentence / v1Chain path; gate is BRAIN_ENGINES-gated', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const enginesFiller = v1DraftOn && brainModelLead\.leadOn\(\{ tenantId: brainProfile\?\.id \}\) && brainEnginesOn\(\{ tenantId: brainProfile\?\.id \}\)/);
  assert.match(src, /if \(v1DraftOn && !enginesFiller\) \{\n\s+v1Filler = setTimeout\(/);
  assert.match(src, /const onV1Sentence = enginesFiller\n\s+\? enginesFiller\.onSentence\n\s+: v1DraftOn/);
  assert.match(src, /const enginesSpoken = enginesFiller \? await enginesFiller\.finish\(live\) : null;/);
  assert.match(src, /\} else if \(live\.streamed && v1Streamed\) \{\n\s+spoken = await v1Chain;/);
});

test('flag: BRAIN_ENGINES off by default', () => {
  const { brainEnginesOn } = require('../src/conversation/v2/flag');
  assert.equal(brainEnginesOn({ env: {} }), false);
  assert.equal(brainEnginesOn({ env: { BRAIN_ENGINES: 'off' } }), false);
  assert.equal(brainEnginesOn({ env: { BRAIN_ENGINES: 'on' } }), true);
});

// ---- end to end with #975's real runBrainEnginesTurn (stand-in models, real timers, no network)
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { PROFILE, ENV, U } = require('./helpers/enginesHarness');

function liveWith({ replyDelayMs = 0, env = {} }) {
  let step = {};
  const stream = () => async ({ request }) => {
    const sys = request.systemInstruction?.parts?.[0]?.text || '';
    if (/Read ONE caller turn/.test(sys)) return { text: JSON.stringify(step.u) };
    if (replyDelayMs) await new Promise((r) => setTimeout(r, replyDelayMs));
    return { text: JSON.stringify({ reply: step.reply }) };
  };
  const live = createBrainV2Live({
    env: { ...ENV, ...env }, applyTools: async () => ({ results: [] }), modelLeadStreamFor: stream, v1DraftStreamFor: stream,
    prewarm: false, now: () => new Date('2026-10-26T10:00:00+03:00'), callSid: 'HD_standdown0001',
    callerFile: { callerPhone: '+254700000123', contactName: null, openRows: [] }, log: () => {},
    recordWriteReceipt: async () => ({ ok: true }), confirmCallerName: async () => ({ ok: true }),
    resolveCallId: async () => '11111111-2222-4333-8444-555555555555',
  });
  return { live, set: (s) => { step = s; } };
}

async function runTurn({ replyDelayMs, env }) {
  const { live, set } = liveWith({ replyDelayMs, env });
  const step = { say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We open at 7:30 AM today.' };
  set(step);
  const { gate, ev, fillers } = harness();
  gate.arm(); // Voice arms its 900 ms filler as the turn starts (server.js order)
  const r = await live.run({ text: step.say, profile: PROFILE, onSentence: gate.onSentence });
  gate.cancel();
  const fin = await gate.finish(r);
  await new Promise((res) => setTimeout(res, 300)); // nothing fires late
  return { r, ev, fillers: fillers(), fin, lines: ev.filter((e) => e.kind === 'line').map((e) => e.text) };
}

test('e2e #975: slow reply -> Brain filler at 700 ms, Voice 900 ms filler stands down, line spoken once', async () => {
  const { r, fillers, lines, fin } = await runTurn({ replyDelayMs: 1200 });
  assert.equal(r.streamed, true);
  assert.equal(r.filler, 'Let me check our hours.');
  assert.deepEqual(fillers.map((f) => f.src), ['brain']);
  assert.equal(lines.join(' '), r.line);
  assert.equal(lines.length, r.sentences.length);
  assert.notEqual(fin, null);
});

test('e2e #975: Brain filler disabled (BRAIN_ENGINES_FILLER_MS=0) -> Voice filler at 900 ms, exactly one', async () => {
  const { fillers, lines, r } = await runTurn({ replyDelayMs: 1200, env: { BRAIN_ENGINES_FILLER_MS: '0' } });
  assert.deepEqual(fillers.map((f) => f.src), ['voice']);
  assert.equal(lines.join(' '), r.line);
});

test('e2e #975: Brain filler later than Voice (BRAIN_ENGINES_FILLER_MS=1000) -> Voice filler only, Brain one dropped', async () => {
  const { fillers } = await runTurn({ replyDelayMs: 1300, env: { BRAIN_ENGINES_FILLER_MS: '1000' } });
  assert.deepEqual(fillers.map((f) => f.src), ['voice']);
});

test('e2e #975: fast turn -> no filler at all', async () => {
  const { fillers, lines, r } = await runTurn({ replyDelayMs: 0 });
  assert.equal(fillers.length, 0);
  assert.equal(lines.join(' '), r.line);
});
