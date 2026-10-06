// Language is data. Canned lines, tails, and offer-ask phrases come from packs.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canned,
  packFor,
  spokenLanguage,
  offerAskPattern,
  recognitionPhrases,
  incompleteTailPattern,
} = require('../src/speech/languages');
const { looksLikeOfferAsk } = require('../src/conversation/fileRead');

describe('language packs', () => {
  it('picks canned lines by call language, including a name', () => {
    assert.equal(canned('sw', 'clearTurn'), 'Naweza kusaidia?');
    assert.equal(canned('en', 'clearTurn'), 'How can I help?');
    assert.equal(canned('sw', 'repair'), 'Samahani, sema tena?');
    assert.equal(canned('sw', 'nameAsk', { name: 'Alvin' }), 'Je, naongea na Alvin?');
    assert.equal(canned('en', 'nameAsk', { name: 'Alvin' }), 'Am I speaking with Alvin?');
    assert.equal(canned('sheng', 'nothingOpen'), 'Hakuna kitu iko open.');
    assert.equal(canned('sheng', 'clearTurn'), 'Naweza kusaidia?');
    assert.equal(spokenLanguage('mixed'), 'sw');
    assert.equal(packFor('sheng').id, 'sheng');
  });

  it('treats the staging services questions as offer asks', () => {
    for (const line of [
      'Ni services gani mna offer?',
      'Mnaofa services gani?',
      'Mna offer services gani?',
      'What services do you offer?',
      'Maybe you can tell me the services that you have',
      'So uniambie services mko nayo',
    ]) {
      assert.equal(looksLikeOfferAsk(line), true, line);
      assert.equal(offerAskPattern().test(line), true, line);
    }
    assert.equal(looksLikeOfferAsk('Mm-hm.'), false);
  });

  it('holds nauliza and nilikuwa from the Kiswahili pack, not from code', () => {
    assert.equal(incompleteTailPattern().test('nauliza'), true);
    assert.equal(incompleteTailPattern().test('nilikuwa'), true);
    const phrases = recognitionPhrases();
    assert.ok(phrases.includes('services gani'));
    assert.ok(phrases.includes('huduma gani'));
    assert.ok(phrases.includes('mna offer'));
    assert.ok(!phrases.includes('gari'));
    assert.ok(!phrases.includes('gani'));
  });
});
