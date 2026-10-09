const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { prepareStructuredPiece, speakListJoins } = require('../../src/speech/structured/speechBoundary');
const { applyLexicon, isSyllableRespelling } = require('../../src/speech/pronunciationLexicon');

const env = { VOICE_TTS_PROSODY_MARKS: 'off', VOICE_STRUCTURED_RESPELL: 'off' };

describe('structured TTS boundary (the one sanitiser)', () => {
  it('speaks a grounded price and strips the marks Soniox reads aloud', () => {
    const out = prepareStructuredPiece('A standard 3-bedroom house clean is 6,000 shillings flat.', { language: 'en', env });
    assert.equal(out.text, 'A standard 3-bedroom house clean is six thousand shillings flat');
    assert.equal(out.language, 'en');
  });
  it('opens every later piece with a word gap and the first without', () => {
    assert.equal(prepareStructuredPiece('Yes, we cover Kitengela.', { first: true, env }).wire, 'Yes we cover Kitengela');
    assert.equal(prepareStructuredPiece('What day works?', { first: false, env }).wire, ' What day works');
  });
  it('refuses a letterless piece', () => {
    for (const piece of [',', ' - ', '...', '']) {
      assert.equal(prepareStructuredPiece(piece, { env }).wire, '');
    }
  });
  it('the locked language picks the TTS voice; Sheng rides English', () => {
    assert.equal(prepareStructuredPiece('Bei ni shilingi 6,000.', { language: 'sw', env }).language, 'sw');
    assert.equal(prepareStructuredPiece('Sawa, tutakuja.', { language: 'en', env }).language, 'en');
    assert.equal(prepareStructuredPiece('Poa, tutakam kesho.', { language: 'sheng', env }).language, 'en');
  });
  it('plain place names by default; legacy respellings only with VOICE_STRUCTURED_RESPELL=on', () => {
    assert.match(prepareStructuredPiece('We cover Kitengela and Ruiru.', { env }).text, /Kitengela and Ruiru/);
    // Main (#612) dropped the built-in Kitengela respelling for lack of listening
    // evidence, so RESPELL=on has nothing to add for it; the name stays plain.
    const on = prepareStructuredPiece('We cover Kitengela.', { env: { ...env, VOICE_STRUCTURED_RESPELL: 'on' } });
    assert.match(on.text, /Kitengela/);
    assert.match(prepareStructuredPiece('Pay with mpesa.', { env }).text, /M-Pesa/);
  });
  it('tenant lexicon entries still apply', () => {
    const out = prepareStructuredPiece('Welcome to Dusted.', { env, extraLexicon: [{ match: 'dusted', say: 'Dasted' }] });
    assert.match(out.text, /Dasted/);
  });
  it('VOICE_TTS_PROSODY_MARKS=on keeps only . , ?', () => {
    const out = prepareStructuredPiece('Yes; we cover Kitengela! What day works?', { env: { ...env, VOICE_TTS_PROSODY_MARKS: 'on' } });
    assert.equal(out.text, 'Yes, we cover Kitengela. What day works?');
  });
  it('a list keeps a beat once commas go', () => {
    assert.equal(speakListJoins('We offer sofa, carpet and mattress cleaning.'), 'We offer sofa and carpet and mattress cleaning.');
    assert.equal(speakListJoins('Hello Alvin, how are you and your family?'), 'Hello Alvin, how are you and your family?');
  });
});

describe('applyLexicon opts (flag-off callers pass three args)', () => {
  it('three-arg calls are unchanged', () => {
    // Same output as main's three-arg applyLexicon (no built-in place respelling since #612).
    assert.equal(applyLexicon('Kitengela via mpesa', 'en', []), 'Kitengela via M-Pesa');
  });
  it('builtinRespell false skips syllable respellings only', () => {
    assert.equal(applyLexicon('Kitengela via mpesa', 'en', [], { builtinRespell: false }), 'Kitengela via M-Pesa');
    assert.equal(isSyllableRespelling({ say: 'M-Pesa', priority: 100 }), false);
    assert.equal(isSyllableRespelling({ say: 'Kee-ten-geh-la', priority: 95 }), true);
  });
});

afterEach(() => {});
