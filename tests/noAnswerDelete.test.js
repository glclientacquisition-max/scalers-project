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

test('server.js: gap guard is behind the flag and only when the rule withheld a filler', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /else if \(ackTracker && ruleFiller === null && tts && ackRule\.gapGuardEnabled\(\)\)/);
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
