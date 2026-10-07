const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createLanguageState } = require('../src/conversation/language');
const { detectTurnLanguage, lockReplyLanguage } = require('../src/speech/languageLock');

function lock(previous, text, tokens) {
  return lockReplyLanguage(previous, detectTurnLanguage({ text, tokens }));
}

describe('language lock', () => {
  it('locks a clear English turn and keeps the sticky language', () => {
    const state = lock(createLanguageState(), 'What services do you offer?');
    assert.equal(state.current, 'en');
    assert.equal(state.reply, 'en');
  });

  it('does not flip English on one Kiswahili backchannel', () => {
    let state = lock(createLanguageState(), 'Hello, I need a couch cleaned please');
    assert.equal(state.current, 'en');
    state = lock(state, 'sawa');
    assert.equal(state.current, 'en');
    assert.equal(state.reply, 'sw');
    assert.equal(state.pending, 'sw');
  });

  it('does not flip on a single job-word loan', () => {
    let state = lock(createLanguageState(), 'What services do you offer?');
    state = lock(state, 'services');
    assert.equal(state.current, 'en');
    assert.equal(state.reply, 'en');
    assert.equal(state.detected, 'unknown');
  });

  it('flips to Kiswahili after two clear Kiswahili turns', () => {
    let state = lock(createLanguageState(), 'What services do you offer?');
    state = lock(state, 'Ni services gani mna offer?');
    assert.equal(state.current, 'en');
    assert.equal(state.reply, 'sw');
    state = lock(state, 'Mnaofa services gani?');
    assert.equal(state.current, 'sw');
    assert.equal(state.reply, 'sw');
  });

  it('treats a clear Sheng turn as Sheng', () => {
    const evidence = detectTurnLanguage({ text: 'Niaje maze, mna services gani?' });
    assert.equal(evidence.language, 'sheng');
    const state = lockReplyLanguage(createLanguageState(), evidence);
    assert.equal(state.reply, 'sheng');
    assert.equal(state.current, 'sheng');
  });

  it('uses Soniox tokens when the text is only a filler', () => {
    const tokens = [
      { text: 'hello', language: 'en' },
      { text: 'there', language: 'en' },
      { text: 'friend', language: 'en' },
    ];
    const evidence = detectTurnLanguage({ text: 'ok', tokens });
    assert.equal(evidence.language, 'en');
    const state = lockReplyLanguage(createLanguageState(), evidence);
    assert.equal(state.reply, 'en');
  });
});
