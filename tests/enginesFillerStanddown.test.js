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

// ---- uncuttable:true (Brain #975 contract): reply waits for the filler; barge-in and the 2000 ms cap still cut
function uncutHarness({ barged = () => false, clock } = {}) {
  const ev = [];
  let finishFiller;
  const gate = createEnginesFillerTurn({
    fillerMs: 900,
    isBarged: barged,
    pickVoiceFiller: () => 'Sawa.',
    playFiller: (text, src) => { ev.push({ kind: 'filler', src, text }); return new Promise((r) => { finishFiller = () => { ev.push({ kind: 'filler_end' }); r({ ok: true }); }; }); },
    speakLine: async (text) => { ev.push({ kind: 'line', text }); return { ok: true }; },
    cutFillerForReply: async () => { ev.push({ kind: 'cut' }); return true; },
    phaseA: true,
    log: (m) => ev.push({ kind: 'log', m }),
    now: clock,
  });
  return { gate, ev, endFiller: () => finishFiller(), kinds: () => ev.filter((e) => e.kind !== 'log').map((e) => e.kind) };
}
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

test('uncuttable: reply ready mid-filler starts right after the filler ends; filler is not cut', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { gate, endFiller, kinds } = uncutHarness({ clock: () => Date.now() });
  gate.arm();
  t.mock.timers.tick(700);
  gate.onSentence({ text: 'Let me check our hours.', filler: true, uncuttable: true });
  t.mock.timers.tick(200);
  gate.onSentence({ text: 'We open at 7:30 AM today.' }); // reply ready while the filler plays
  await flush();
  t.mock.timers.tick(500);
  await flush();
  assert.deepEqual(kinds(), ['filler'], 'reply waits, no cut');
  endFiller(); // filler plays out (~700 ms)
  await flush();
  const r = await gate.finish({ streamed: true, line: 'We open at 7:30 AM today.' });
  assert.deepEqual(r.spoken, { ok: true });
  assert.deepEqual(kinds(), ['filler', 'filler_end', 'line']);
});

test('uncuttable: caller barge-in still cuts it (no wait, no line)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let barged = false;
  const { gate, kinds } = uncutHarness({ barged: () => barged, clock: () => Date.now() });
  gate.arm();
  t.mock.timers.tick(700);
  gate.onSentence({ text: 'Let me check our hours.', filler: true, uncuttable: true });
  gate.onSentence({ text: 'We open at 7:30 AM today.' });
  await flush();
  barged = true; // server.js barge-in cuts the filler stream (existing path); the gate stops waiting
  t.mock.timers.tick(40);
  await flush();
  const r = await gate.finish({ streamed: true, line: 'We open at 7:30 AM today.' });
  assert.deepEqual(r.spoken, { ok: false, barged: true });
  assert.deepEqual(kinds(), ['filler']);
});

test('uncuttable: a stuck filler is cut at 2000 ms playout, logged, then the reply plays', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { gate, ev, kinds } = uncutHarness({ clock: () => Date.now() });
  gate.arm();
  t.mock.timers.tick(700);
  gate.onSentence({ text: 'Let me check our hours.', filler: true, uncuttable: true });
  t.mock.timers.tick(100);
  gate.onSentence({ text: 'We open at 7:30 AM today.' });
  await flush();
  t.mock.timers.tick(1899); // 1999 ms of playout
  await flush();
  assert.deepEqual(kinds(), ['filler']);
  t.mock.timers.tick(1); // 2000 ms
  await flush();
  assert.deepEqual(kinds(), ['filler', 'cut', 'line']);
  assert.ok(ev.some((e) => e.kind === 'log' && /uncuttable filler cap: cut after 2000ms playout/.test(e.m)));
  const { UNCUTTABLE_CAP_MS } = require('../src/speech/enginesFillerStanddown');
  assert.equal(UNCUTTABLE_CAP_MS, 2000);
});

test('without uncuttable: the Phase A min-playout cut runs as before (cut, then line)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { gate, kinds } = uncutHarness({ clock: () => Date.now() });
  gate.arm();
  t.mock.timers.tick(700);
  gate.onSentence({ text: 'Let me check our hours.', filler: true });
  gate.onSentence({ text: 'We open at 7:30 AM today.' });
  await flush();
  assert.deepEqual(kinds(), ['filler', 'cut', 'line']);
  // and Voice's own filler is never treated as uncuttable
  const v = uncutHarness({ clock: () => Date.now() });
  v.gate.arm();
  t.mock.timers.tick(900);
  v.gate.onSentence({ text: 'We open at 7:30 AM today.' });
  await flush();
  assert.deepEqual(v.kinds(), ['filler', 'cut', 'line']);
});

test('uncuttable filler already finished before the reply: no wait, no cut', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { gate, endFiller, kinds } = uncutHarness({ clock: () => Date.now() });
  gate.onSentence({ text: 'Let me check our hours.', filler: true, uncuttable: true });
  endFiller();
  await flush();
  gate.onSentence({ text: 'We open at 7:30 AM today.' });
  await flush();
  assert.deepEqual(kinds(), ['filler', 'filler_end', 'line']);
});

// server.js wiring (B2): the engines run every turn, so the gate is always built; the non-engines v1Filler /
// onV1Sentence / v1Chain branch is left (unreachable) for Voice V1 to delete.
test('server.js: the engines filler gate is always built (B2); the old flag gates are gone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const enginesFiller = createEnginesFillerTurn\(\{/);
  assert.doesNotMatch(src, /brainEnginesOn|brainModelLead\.leadOn|brainV1Draft\.mode\(|brainV1Draft\.phaseA\(/);
  assert.match(src, /if \(v1DraftOn && !enginesFiller\) \{\n\s+v1Filler = setTimeout\(/);
  assert.match(src, /const onV1Sentence = enginesFiller\n\s+\? enginesFiller\.onSentence\n\s+: v1DraftOn/);
  assert.match(src, /const enginesSpoken = enginesFiller \? await enginesFiller\.finish\(live\) : null;/);
  assert.match(src, /\} else if \(live\.streamed && v1Streamed\) \{\n\s+spoken = await v1Chain;/);
  // the filler never reaches the transcript: only live.line is pushed, and the gate has no transcript hook
  assert.match(src, /if \(enginesFiller\) enginesFiller\.cancel\(\);\n.*\n\s+callTranscript\.pushAgent\(live\.line\);/);
  assert.match(src, /return speakThinkingAck\(text\)\.catch/);
  const gateSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'speech', 'enginesFillerStanddown.js'), 'utf8');
  assert.doesNotMatch(gateSrc, /pushAgent|callTranscript|appendTranscript/);
});

test('B2: no BRAIN_ENGINES switch (the flag module is gone)', () => {
  assert.throws(() => require('../src/conversation/v2/flag'), /Cannot find module/);
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
  const t0 = Date.now();
  const tee = (x) => { if (x && x.filler) ev.push({ kind: 'brain_emit', ms: Date.now() - t0, s: x }); gate.onSentence(x); };
  const origPlay = ev.push.bind(ev);
  ev.push = (e) => origPlay(e.kind === 'filler' ? { ...e, ms: Date.now() - t0 } : e);
  gate.arm(); // Voice arms its 900 ms filler as the turn starts (server.js order)
  const r = await live.run({ text: step.say, profile: PROFILE, onSentence: tee });
  gate.cancel();
  const fin = await gate.finish(r);
  await new Promise((res) => setTimeout(res, 300)); // nothing fires late
  return { r, ev, fillers: fillers().map(({ ms, ...f }) => f), fillerMs: fillers().map((f) => f.ms), emits: ev.filter((e) => e.kind === 'brain_emit'), fin, lines: ev.filter((e) => e.kind === 'line').map((e) => e.text) };
}

test('e2e #975: slow reply -> Brain filler at 700 ms, Voice 900 ms filler stands down, line spoken once', async () => {
  const { r, fillers, lines, fin, emits } = await runTurn({ replyDelayMs: 1200 });
  assert.equal(r.streamed, true);
  assert.equal(r.filler, 'Checking our hours.');
  // #975 @7df64505 contract: { text, lang, filler: true, uncuttable: true }, once per turn, <= 3 words
  assert.equal(emits.length, 1);
  assert.equal(emits[0].s.uncuttable, true);
  assert.ok(emits[0].s.text.split(/\s+/).length <= 3);
  // filler stays out of live.line / sentences (so out of the transcript)
  assert.doesNotMatch(r.line, /Checking our hours/);
  assert.ok(r.sentences.every((x) => !x.filler && !/Checking our hours/.test(x.text)));
  assert.deepEqual(fillers.map((f) => f.src), ['brain']);
  assert.equal(lines.join(' '), r.line);
  assert.equal(lines.length, r.sentences.length);
  assert.notEqual(fin, null);
});

test('e2e #975: BRAIN_ENGINES_FILLER_MS=0 (Brain filler off) -> Voice 900 ms filler fires as today, exactly one', async () => {
  const { fillers, fillerMs, emits, lines, r } = await runTurn({ replyDelayMs: 1200, env: { BRAIN_ENGINES_FILLER_MS: '0' } });
  assert.equal(emits.length, 0);
  assert.deepEqual(fillers.map((f) => f.src), ['voice']);
  assert.ok(fillerMs[0] >= 880 && fillerMs[0] < 1100, `voice filler at ${fillerMs[0]} ms`);
  assert.equal(lines.join(' '), r.line);
});

test('e2e #975: BRAIN_ENGINES_FILLER_MS=1000 is clamped to 850 by Brain -> Brain filler still first, Voice stands down', async () => {
  const { fillers, emits } = await runTurn({ replyDelayMs: 1300, env: { BRAIN_ENGINES_FILLER_MS: '1000' } });
  assert.deepEqual(fillers.map((f) => f.src), ['brain']);
  assert.ok(emits[0].ms < 900, `brain filler at ${emits[0].ms} ms`);
  // the 900+ drop case (a Brain filler after Voice's) stays covered by the unit test above
});

test('e2e #975: fast turn -> no filler at all', async () => {
  const { fillers, lines, r } = await runTurn({ replyDelayMs: 0 });
  assert.equal(fillers.length, 0);
  assert.equal(lines.join(' '), r.line);
});
