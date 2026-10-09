// Soniox language identification must reach the session and the token parser.
// Run: node --test tests/sonioxLanguage.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sonioxLanguageCode, tokensFromSonioxMessage } = require('../src/speech/sonioxStt');

describe('Soniox language identification', () => {
  it('turns the session flag on', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'speech', 'sonioxStt.js'), 'utf8');
    assert.match(source, /enable_language_identification:\s*true/);
  });

  it('parses sw and en tags and keeps an empty tag list when Soniox sends none', () => {
    assert.equal(sonioxLanguageCode('sw'), 'sw');
    assert.equal(sonioxLanguageCode('swh'), 'sw');
    assert.equal(sonioxLanguageCode('en-US'), 'en');
    assert.equal(sonioxLanguageCode(''), null);
    const parsed = tokensFromSonioxMessage({
      tokens: [
        { text: ' mimi', is_final: true, language: 'sw', start_ms: 1, end_ms: 2 },
        { text: ' naishi', is_final: true, language_code: 'swh' },
        { text: ' though', is_final: true, language: null },
      ],
    });
    assert.equal(parsed.finals.includes('mimi'), true);
    assert.deepEqual(parsed.tokenLanguages, ['sw', 'sw']);
    assert.equal(parsed.tokens[0].language, 'sw');
    assert.equal(parsed.tokens[2].language, null);
    const empty = tokensFromSonioxMessage({
      tokens: [{ text: 'Sawa.', is_final: true }],
    });
    assert.deepEqual(empty.tokenLanguages, []);
    assert.equal(empty.tokens[0].language, null);
  });
});
