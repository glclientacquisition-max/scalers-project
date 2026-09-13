const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeCallerLanguage,
  resolveLanguageState,
  createLanguageState,
  languageDirective,
} = require('../src/conversation/language');

describe('caller language (Kiswahili)', () => {
  it('treats Kiswahili plus English job nouns as Kiswahili', () => {
    const hit = analyzeCallerLanguage('Nataka cleaning kesho');
    assert.equal(hit.language, 'sw');
    assert.equal(hit.scores.en, 0);
    assert.ok(hit.scores.sw >= 2);

    assert.equal(
      analyzeCallerLanguage('Unaweza kuja kesho saa nne?').language,
      'sw'
    );
    assert.equal(analyzeCallerLanguage('Sawa').language, 'sw');
    assert.equal(analyzeCallerLanguage('Hello, I need the price please').language, 'en');
  });

  it('switches to Kiswahili on a substantive visit ask after an English opener', () => {
    let state = resolveLanguageState(
      createLanguageState(),
      analyzeCallerLanguage('Hello, I need the price please')
    );
    assert.equal(state.current, 'en');

    state = resolveLanguageState(state, analyzeCallerLanguage('sawa'));
    assert.equal(state.current, 'en');

    state = resolveLanguageState(
      state,
      analyzeCallerLanguage('Nataka cleaning kesho Rongai')
    );
    assert.equal(state.current, 'sw');
    assert.match(languageDirective(state.current), /Kiswahili only/i);
  });

  it('does not treat a lone sawa as enough to leave English', () => {
    let state = resolveLanguageState(
      createLanguageState(),
      analyzeCallerLanguage('Can you hold a book for me please')
    );
    state = resolveLanguageState(state, analyzeCallerLanguage('sawa'));
    assert.equal(state.current, 'en');
    assert.equal(state.pending, 'sw');
  });
});
