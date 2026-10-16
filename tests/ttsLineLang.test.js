'use strict';
// Regression-9 R9 (HD_740090e11a2f): line language when the call has none; no English respelling in sw.
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./fixtures/tts/HD_740090e11a2f-nakuru.json');
const T = require('../src/speech/ttsNormalize');
const withFlag = (v, fn) => { const o = process.env.VOICE_TTS_LINE_LANG; if (v == null) delete process.env.VOICE_TTS_LINE_LANG; else process.env.VOICE_TTS_LINE_LANG = v; try { return fn(); } finally { if (o == null) delete process.env.VOICE_TTS_LINE_LANG; else process.env.VOICE_TTS_LINE_LANG = o; } };

test('flag on: the sw line is sw and Nakuru is said as written (no call language, sw call, tenant respelling)', () => withFlag('1', () => {
  for (const o of [{}, { callLanguage: 'sw' }, { extraLexicon: fx.lexicon }, { callLanguage: 'sw', extraLexicon: fx.lexicon }, { callLanguage: 'unknown' }]) {
    const r = T.prepareForTts(fx.line, o);
    assert.equal(r.language, fx.expected.language, JSON.stringify(o));
    assert.equal(r.text, fx.expected.text, JSON.stringify(o));
  }
}));
test('flag on: a respelling tagged sw still applies; English lines and calls unchanged', () => withFlag('1', () => {
  assert.match(T.prepareForTts(fx.line, { callLanguage: 'sw', extraLexicon: [{ ...fx.lexicon[0], langs: ['sw'] }] }).text, /Na-koo-roo/);
  assert.equal(T.prepareForTts(fx.line, { callLanguage: 'en' }).language, 'en');
  assert.equal(T.prepareForTts('We have three branches in Nakuru and Nairobi.', {}).language, 'en');
  assert.match(T.prepareForTts('We are in Nakuru.', { extraLexicon: fx.lexicon }).text, /Na-koo-roo/);
  assert.equal(T.detectLineLanguage('Okay.'), null);
}));
test('flag off: byte-identical to before (en for a call with no language, respelling applies)', () => withFlag(null, () => {
  assert.equal(T.prepareForTts(fx.line, {}).language, 'en');
  assert.match(T.prepareForTts(fx.line, { callLanguage: 'sw', extraLexicon: fx.lexicon }).text, /Na-koo-roo/);
}));
