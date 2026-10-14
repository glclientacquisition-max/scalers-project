'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const M = require('../src/conversation/catalogueMouth');
const fx = require(path.join(__dirname, 'fixtures', 'mouth-lock', 'HD_cc0481620c50.json'));

function withFlag(v, fn) {
  const prev = process.env.VOICE_MOUTH_LOCK;
  if (v == null) delete process.env.VOICE_MOUTH_LOCK; else process.env.VOICE_MOUTH_LOCK = v;
  try { return fn(); } finally { if (prev === undefined) delete process.env.VOICE_MOUTH_LOCK; else process.env.VOICE_MOUTH_LOCK = prev; }
}
const state = (extra = {}) => ({ caller: { nameJustConfirmed: true }, language: { current: fx.language }, entities: fx.entities, conversation: {}, ...extra });
const profile = { servicesCatalog: fx.services.map((name) => ({ name })) };
const shape = (text, st = state()) => M.shapeCatalogueMouth(text, { state: st, callerText: fx.callerText, profile, language: fx.language });
const [first, second] = fx.model.split(/(?<=\.)\s+/);

test('flag defaults off', () => withFlag(null, () => assert.equal(M.mouthLockEnabled(), false)));

test('HD_cc0481620c50 OFF: reproduces staging (English re-ask replaces the Swahili readback)', () => withFlag(null, () => {
  assert.equal(shape(first), fx.heard[0]);
  assert.equal(shape(second), fx.heard[1]);
}));

test('HD_cc0481620c50 ON: Swahili readback kept, no re-ask of the given service', () => withFlag('1', () => {
  assert.equal(shape(first), first);
  assert.equal(shape(second), second);
  assert.doesNotMatch(shape(fx.model), /Which service/);
}));

test('ON: service missing -> re-ask stays, in the model language not the one-word turn', () => withFlag('1', () => {
  const st = state({ entities: {} });
  const out = shape('Tuna usafi wa sofa, carpet, godoro, nyumba, na madirisha.', st);
  assert.notEqual(out, 'Which service do you need?');
  assert.doesNotMatch(out, /Which service/);
}));

test('ON: a real list is still caught', () => withFlag('1', () => {
  const out = shape('We offer Sofa Cleaning, Mattress Cleaning, House Cleaning, Window Cleaning.', state({ language: { current: 'en' } }));
  assert.doesNotMatch(out, /Sofa Cleaning, Mattress Cleaning, House Cleaning/);
}));
