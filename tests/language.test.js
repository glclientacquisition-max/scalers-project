const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeCallerLanguage,
  resolveLanguageState,
  createLanguageState,
  languageDirective,
  spokenTextDirective,
  confirmationLanguage,
  pickFillerText,
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

  it('classifies the Oct 2026 Kiswahili lines', () => {
    assert.equal(analyzeCallerLanguage('Ah, nahitaji').language, 'sw');
    assert.equal(
      analyzeCallerLanguage('Economic—vitabu vya kuandikia').language,
      'sw'
    );
    assert.equal(analyzeCallerLanguage('Okay, kuonyesha').language, 'mixed');
  });

  it('leaves English on Okay kuonyesha and follows a clear English switch', () => {
    let state = resolveLanguageState(
      createLanguageState(),
      analyzeCallerLanguage('Hello, I need the price please')
    );
    assert.equal(state.current, 'en');

    state = resolveLanguageState(state, analyzeCallerLanguage('Okay, kuonyesha'));
    assert.equal(state.current, 'sw');

    state = resolveLanguageState(
      state,
      analyzeCallerLanguage('Can you help me in English please')
    );
    assert.equal(state.current, 'en');
  });

  it('prefers Soniox language tags when they cover the turn', () => {
    const swish = analyzeCallerLanguage('Okay, kuonyesha', {
      tokenLanguages: { en: 5, sw: 9 },
    });
    assert.equal(swish.language, 'mixed');
    assert.ok(swish.scores.sw > swish.scores.en);

    let state = resolveLanguageState(
      createLanguageState(),
      analyzeCallerLanguage('Nataka vitabu vya kuandikia')
    );
    assert.equal(state.current, 'sw');
    state = resolveLanguageState(
      state,
      analyzeCallerLanguage('I want the books in English', {
        tokenLanguages: { en: 28, sw: 0 },
      })
    );
    assert.equal(state.current, 'en');

    const ignored = analyzeCallerLanguage('Nataka vitabu vya kuandikia kesho', {
      tokenLanguages: { en: 2, sw: 0 },
    });
    assert.equal(ignored.language, 'sw');
  });

  it('keeps Sheng when Soniox tags the turn as Kiswahili', () => {
    const hit = analyzeCallerLanguage('Niaje maze, nataka cleaning', {
      tokenLanguages: { sw: 24, en: 0 },
    });
    assert.equal(hit.language, 'sheng');
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

describe('spokenTextDirective', () => {
  it('asks for plain speech and keeps commas', () => {
    const cue = spokenTextDirective();
    assert.match(cue, /commas/i);
    assert.doesNotMatch(cue, /Start a new sentence/i);
    assert.doesNotMatch(cue, /instead of a comma/i);
  });
});

describe('confirmationLanguage', () => {
  it('maps mixed to Kiswahili for backend spoken outcomes', () => {
    assert.equal(confirmationLanguage('sw'), 'sw');
    assert.equal(confirmationLanguage('sheng'), 'sheng');
    assert.equal(confirmationLanguage('mixed'), 'sw');
    assert.equal(confirmationLanguage('en'), 'en');
    assert.equal(confirmationLanguage('unknown'), 'en');
    assert.equal(pickFillerText('mixed'), 'Kidogo…');
    assert.equal(pickFillerText('en'), 'One moment…');
  });
});
