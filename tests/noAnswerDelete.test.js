'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/conversation/dynamicSpeech');
const G = require('../src/conversation/answerGrounding');
const A = require('../src/speech/ackRule');
const fx = require('./fixtures/no-answer-delete/calls.json');

function withFlag(v, fn) {
  const prev = process.env.VOICE_NO_ANSWER_DELETE;
  if (v == null) delete process.env.VOICE_NO_ANSWER_DELETE; else process.env.VOICE_NO_ANSWER_DELETE = v;
  try { return fn(); } finally { if (prev === undefined) delete process.env.VOICE_NO_ANSWER_DELETE; else process.env.VOICE_NO_ANSWER_DELETE = prev; }
}
const profile = { servicesCatalog: fx.catalogue.map((name) => ({ name })) };
const polish = (text, t) => D.polishSpokenDetail(text, {
  callerTurns: [t.caller], profile, toolResults: [], capabilities: {}, language: t.lang,
  state: { language: { current: t.lang }, conversation: { answersReceived: [t.caller] }, caller: {}, entities: {} },
}).text;
const deleted = () => fx.turns.filter((t) => polish(t.model, t) !== t.model).length;

test('flags default off', () => withFlag(null, () => { assert.equal(G.noAnswerDeleteEnabled(), false); assert.equal(A.gapGuardEnabled(), false); }));

test('HD_b401138c8ffd T3-T5 + HD_db0e864043c1 T17 OFF: reproduces staging deletions (4)', () => withFlag(null, () => {
  for (const t of fx.turns) assert.equal(polish(t.model, t), t.heard[0], `${t.callId} T${t.turn}`);
  assert.equal(deleted(), 4);
}));

test('ON: grounded lists survive any caller phrasing -> deleted-answer count 0', () => withFlag('1', () => {
  assert.equal(deleted(), 0);
  for (const phrasing of ['Mnafanya nini?', 'mnasafisha nini', 'What exactly... which?', 'na nini tena', 'okay so like']) {
    const t = { ...fx.turns[1], caller: phrasing };
    assert.equal(polish(t.model, t), t.model, phrasing);
  }
}));

test('ON: an invented service is still trimmed, replacement follows the reply language', () => withFlag('1', () => {
  const t = { ...fx.turns[2] }; // turn detected en, reply in Swahili
  const out = polish('Tunasafisha sofa, carpet, mattress, na fumigation, plumbing pia.', t);
  assert.notEqual(out, 'Tunasafisha sofa, carpet, mattress, na fumigation, plumbing pia.');
  assert.doesNotMatch(out, /What do you need done|We can help/);
  assert.deepEqual(G.serviceListGrounding('sofa, carpet, fumigation', { profile }).ungrounded, ['fumigation']);
}));

test('gap guard ON: no filler + >900 ms first audio -> neutral Mm., not ack-led, 0 stacks', () => {
  const heard = fx.turns.map((t) => ({ caller: t.caller, filler: '', reply: `Sawa, ${t.model} ${t.tail}`, firstPcmMs: t.firstPcmMs }));
  const off = A.replayHeard(heard);
  const on = A.replayHeard(heard, { gapGuard: true, gapMs: A.gapGuardMs({}) });
  assert.equal(off.filter((x) => x.filler).length, 0, 'staging: no filler on any turn');
  assert.equal(on.filter((x) => x.gap).length, heard.length);
  const s = A.scoreAckRule(on);
  assert.equal(s.stacks, 0);
  assert.equal(s.ackLed, 0, 'gap Mm is not an ack-led reply; Sawa lead stripped');
  // A gap Mm followed by an ack word does count as a stack.
  assert.equal(A.scoreAckRule([{ filler: 'Mm.', gap: true, text: 'Sawa, tuna sofa.' }]).stacks, 1);
  // ack gate on the HD_db0e864043c1 heard fixture still holds with the guard on.
  const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ack-heard', 'HD_db0e864043c1.heard.json'), 'utf8'));
  assert.equal(A.scoreAckRule(A.replayHeard(db.turns, { gapGuard: true })).stacks, 0);
});

// B2: the gap-guard clip was played only by the old Gemini turn (deleted with it). The clip warm is still behind the
// flag (Voice V1 decides whether the engines path plays it or the warm goes).
test('server.js (B2): the old turn\'s gap-guard play is gone; the warm stays behind the flag', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /else if \(ackTracker && ruleFiller === null && tts && ackRule\.gapGuardEnabled\(\)\)/);
  assert.match(src, /const gapWarm = ackRule\.gapGuardEnabled\(\)/);
});

const fx923 = require('./fixtures/no-answer-delete/HD_923e63f8a72b.json');
function replay923() {
  const prof = { servicesCatalog: fx923.catalogue.map((name) => ({ name })) };
  const answers = [];
  const st = { language: { current: 'sw' }, conversation: { answersReceived: answers }, caller: {}, entities: {} };
  return fx923.turns.map((t) => {
    answers.push(t.caller);
    const chunks = t.chunks.map((c) => (c === 'LIST' ? fx923.deletedList : c));
    const out = chunks.map((c) => D.polishSpokenDetail(c, { callerTurns: answers, profile: prof, state: st, language: 'sw', toolResults: [], capabilities: {}, streamChunk: true }).text);
    return { t, chunks, out };
  });
}

test('HD_923e63f8a72b OFF: list deleted on T2/T4/T5/T6, doubled "Unahitaji gani?" on T7 (staging)', () => withFlag(null, () => {
  const r = replay923();
  for (const { t, out } of r) assert.deepEqual(out, t.heard, `T${t.turn}`);
  assert.equal(r.filter(({ chunks, out }) => chunks.some((c, i) => c === fx923.deletedList && out[i] !== c)).length, 4);
}));

test('HD_923e63f8a72b ON: context, not wording — list kept on repeat asks/"Like.", 0 deleted, no doubled closer', () => withFlag('1', () => {
  const r = replay923();
  assert.equal(r.filter(({ chunks, out }) => chunks.some((c, i) => c === fx923.deletedList && out[i] !== c)).length, 0);
  const t7 = r.find(({ t }) => t.turn === 7);
  assert.equal(t7.out.join(' ').match(/Unahitaji gani\?/g).length, 1);
}));

test('ON: after an ungrounded list is cut, a "kati ya hizo" chunk pointing at it is dropped', () => withFlag('1', () => {
  const answers = ['Like.'];
  const st = { language: { current: 'sw' }, conversation: { answersReceived: answers }, caller: {}, entities: {} };
  const o = { callerTurns: answers, profile, state: st, language: 'sw', toolResults: [], capabilities: {}, streamChunk: true };
  const first = D.polishSpokenDetail('Tunasafisha sofa, carpet, mattress, fumigation na plumbing.', o).text;
  assert.match(first, /Tunaweza kusaidia/);
  assert.equal(D.polishSpokenDetail('Unahitaji ipi kati ya hizo?', o).text, '');
}));

const fx89 = require('./fixtures/hedge-gap/HD_89aa48bf657f.json');
test('HD_89aa48bf657f T7 hedge: OFF leaves "or let me know" fragment; ON strips the clause and re-capitalises', () => {
  const run = () => {
    const answers = [fx89.t7.caller];
    const st = { language: { current: 'en' }, conversation: { answersReceived: answers }, caller: {}, entities: {} };
    return fx89.t7.chunks.map((c) => D.polishSpokenDetail(c, { callerTurns: answers, profile, state: st, language: 'en', toolResults: [], capabilities: {}, streamChunk: true }).text);
  };
  withFlag(null, () => assert.deepEqual(run(), fx89.t7.heard));
  withFlag('1', () => {
    const out = run();
    assert.equal(out[1], 'Let me know if you want to ask about another cleaning service like carpets or sofas.');
    for (const line of out) assert.doesNotMatch(line, /^(or|and|but|so|na|au)\b/i);
    assert.equal(D.stripSpokenHedges('Okay, let me check that for you.', { language: 'en' }), 'Okay.');
    assert.equal(D.stripSpokenHedges('Sure, take your time and tell me the day.', { language: 'en' }), 'Sure, tell me the day.');
    assert.equal(D.stripSpokenHedges('Sawa nakucheckia, na nitakujulisha.', { language: 'sw' }), 'Nitakujulisha.');
  });
});

test('HD_89aa48bf657f gap guard: sent at 700 ms after end of turn (was 871-1060), cached clip keyed per call language', () => {
  const F = require('../src/speech/fillerPcmCache');
  const before = fx89.gapGuard.map((g) => g.endpointToGapLogMs);
  assert.ok(Math.min(...before) > 850);
  const after = fx89.gapGuard.map(() => {
    const ended = 1000; const handlerAt = ended + fx89.handlerStartAfterEndpointMs;
    return handlerAt - ended + A.gapGuardDelay(ended, handlerAt, {});
  });
  for (const ms of after) assert.equal(ms, 700);
  assert.equal(A.gapGuardDelay(0, 950, {}), 0, 'a late handler sends at once, never negative');
  // T1 miss: the ack warm keyed "Mm." without a call language; the gap warm uses the runtime key.
  const sw = A.gapWarmPhrases('sw');
  assert.deepEqual(sw[0], { text: 'Mm.', callLanguage: 'sw' });
  for (const p of sw) {
    assert.equal(F.lookupFillerPcm({ voiceId: 'v', text: p.text, callLanguage: p.callLanguage }).key,
      F.lookupFillerPcm({ voiceId: 'v', text: 'Mm.', callLanguage: p.callLanguage }).key);
  }
});

test('server.js (B2): no old-turn gap-guard timer left to speak over reply audio', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /gap-guard miss \(not cached\)|ackRule\.gapGuardDelay\(/);
});
