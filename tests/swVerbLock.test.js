'use strict';
// VOICE_SW_VERB_LOCK: the first caller turn's Swahili verb sets the call language (fixture tests/fixtures/language/sw-verb-lock.json).
const { test } = require('node:test');
const assert = require('assert');
const FX = require('./fixtures/language/sw-verb-lock.json');
const L = require('../src/conversation/language');
const withFlag = (v, fn) => { const o = process.env.VOICE_SW_VERB_LOCK; if (v == null) delete process.env.VOICE_SW_VERB_LOCK; else process.env.VOICE_SW_VERB_LOCK = v; try { return fn(); } finally { if (o === undefined) delete process.env.VOICE_SW_VERB_LOCK; else process.env.VOICE_SW_VERB_LOCK = o; } };
const lockAfter = (turns) => turns.reduce((st, t) => L.resolveLanguageState(st, L.analyzeCallerLanguage(t)), L.createLanguageState()).current;

test('flag on: first-turn lock matches the fixture', () => withFlag('1', () => {
  for (const c of FX.cases) assert.strictEqual(lockAfter([c.first]), c.lock, c.first);
}));

test('flag off: unchanged (mnaosha carpet? still reads English)', () => withFlag(null, () => {
  assert.strictEqual(L.swVerbLockEnabled(), false);
  assert.strictEqual(lockAfter(['mnaosha carpet?']), 'en');
  assert.strictEqual(L.analyzeCallerLanguage('Do you clean carpets?').language, 'en');
}));

test('verb counter: conjugated verbs only, no English look-alikes', () => {
  for (const w of ['mnaosha', 'nilikuwa', 'tunasafisha', 'umesema', 'wanaonekanga']) assert.strictEqual(L.countSwahiliVerbs(w), 1, w);
  for (const w of ['manager', 'anatomy', 'metal', 'tuna', 'america', 'mattress', 'antenna', 'mentor', 'wanted']) assert.strictEqual(L.countSwahiliVerbs(w), 0, w);
});
