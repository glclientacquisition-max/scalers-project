const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifySay, dataLineFor } = require('../../src/speech/structured/verify');
const { getLanguagePack } = require('../../src/speech/structured/languages');
const { lockReplyLanguage } = require('../../src/speech/structured/languageLock');
const { statedNumbers } = require('../../src/speech/structured/numbers');
const { formatFactsBlock } = require('../../src/speech/structured/facts');
const { dustedTable, factId } = require('./helpers');

const table = dustedTable();
const codes = (r) => r.problems.map((p) => p.code);

describe('facts table', () => {
  it('cites every service, price and coverage row by id', () => {
    const block = formatFactsBlock(table);
    assert.match(block, /^GROUNDED FACTS/);
    assert.match(block, /\[cov:kitengela\] Coverage: Kitengela/);
    assert.match(block, /\[svc:3-bedroom-house\] 3-Bedroom House \(Standard\): KSh 6,000 flat/);
  });
  it('reads digits, English and Swahili number words', () => {
    assert.deepEqual([...statedNumbers('KSh 6,000 flat')], ['6000']);
    assert.ok(statedNumbers('six thousand shillings').has('6000'));
    assert.ok(statedNumbers('shilingi elfu sita').has('6000'));
  });
});

describe('verifySay: facts are checked against facts_used, not filtered by regex', () => {
  const house = [{ kind: 'price', id: factId(table, /^3-Bedroom House/) }];
  it('a cited price passes', () => {
    const r = verifySay('A standard 3-bedroom house clean is 6,000 shillings flat.', { locked: 'en', table, factsUsed: house, callerText: '' });
    assert.deepEqual(codes(r), []);
  });
  it('the same price without a citation fails', () => {
    const r = verifySay('A standard 3-bedroom house clean is 6,000 shillings flat.', { locked: 'en', table, factsUsed: [], callerText: '' });
    assert.deepEqual([...new Set(codes(r))], ['unbacked_number']);
    assert.ok(r.problems.some((p) => /6000/.test(p.detail)));
  });
  it("the caller's own numbers are allowed", () => {
    const r = verifySay('Got it, a 3-bedroom apartment.', { locked: 'en', table, factsUsed: [], callerText: 'a 3-bedroom apartment' });
    assert.deepEqual(codes(r), []);
  });
  it('a wrong price fails and the data line gives the real one', () => {
    const sentence = 'A 3-bedroom house is 6,500 shillings.';
    const r = verifySay(sentence, { locked: 'en', table, factsUsed: house, callerText: '' });
    assert.deepEqual(codes(r), ['unbacked_number']);
    assert.equal(dataLineFor(sentence, r.problems, { table, pack: getLanguagePack('en') }), '3-Bedroom House is KSh 6,000 flat.');
  });
  it('coverage is read from the coverage list (HD_015b "Kitengele")', () => {
    const r = verifySay('Sorry, Kitengela is outside our area.', { locked: 'en', table, factsUsed: [] });
    assert.deepEqual(codes(r), ['coverage_contradiction']);
    assert.equal(
      dataLineFor('x', r.problems, { table, pack: getLanguagePack('sw'), callerText: 'Mnafika Kitengela?' }),
      'Ndiyo, tunafika Kitengela.'
    );
    const nakuru = verifySay('Yes, we cover Nakuru.', { locked: 'en', table, factsUsed: [] });
    assert.deepEqual(codes(nakuru), ['coverage_unbacked']);
  });
  it('markup and tool markers in say fail', () => {
    assert.ok(codes(verifySay('Sure ###ENDCALL###', { locked: 'en', table })).includes('markup'));
    assert.ok(codes(verifySay('- Sofa cleaning', { locked: 'en', table })).includes('markup'));
  });
  it('a re-ask of a confirmed name fails', () => {
    const r = verifySay('Am I speaking with Alvin?', { locked: 'en', table, nameConfirmed: true });
    assert.deepEqual(codes(r), ['name_confirmed']);
  });
  it('English job nouns are fine in a Kiswahili sentence', () => {
    const r = verifySay('Tunafanya sofa cleaning na carpet cleaning.', { locked: 'sw', table });
    assert.deepEqual(codes(r), []);
  });
  it('an English sentence under a Kiswahili lock fails', () => {
    const r = verifySay('We clean sofas and carpets every day of the week.', { locked: 'sw', table });
    assert.deepEqual(codes(r), ['language']);
  });
});

describe('language lock', () => {
  it('Soniox tags lock the language before the request', () => {
    assert.deepEqual(lockReplyLanguage({ text: 'Habari, mnafanya usafi?', tokenLanguages: ['sw', 'sw', 'sw'] }), { lang: 'sw', source: 'soniox' });
    assert.equal(lockReplyLanguage({ text: 'How much is it?', tokenLanguages: ['en', 'en'] }).lang, 'en');
  });
  it('a turn of English job words keeps a Kiswahili call in Kiswahili', () => {
    const lock = lockReplyLanguage({ text: 'Carpet cleaning.', tokenLanguages: ['en', 'en'], state: { current: 'sw' } });
    assert.deepEqual(lock, { lang: 'sw', source: 'sticky_loanword_turn' });
  });
  it('falls back to the words, then sticky, then English', () => {
    assert.equal(lockReplyLanguage({ text: 'Hakuna shida, tutakuja kesho.' }).lang, 'sw');
    assert.equal(lockReplyLanguage({ text: 'mm', state: { current: 'sw' } }).lang, 'sw');
    assert.equal(lockReplyLanguage({ text: 'mm' }).lang, 'en');
  });
});

describe('HD_23445a4f780c: "outside Nairobi" is the caller, not a coverage denial', () => {
  const caller = 'Mmh, na kama niko outside Nairobi, how is it done?';
  const cov = (r) => r.problems.filter((p) => p.code.startsWith('coverage_'));
  it('a reply listing the areas we reach outside Nairobi passes', () => {
    for (const [locked, sentence] of [
      ['sw', 'Kama uko nje ya Nairobi, tunafika Kiambu, Kitengela, Juja, Ongata Rongai na Syokimau.'],
      ['sw', 'Tunafika maeneo ya nje ya Nairobi kama Syokimau na Kitengela.'],
      ['sw', 'Nje ya Nairobi tunafika Syokimau, Kitengela na Juja.'],
      ['sw', 'Hatufiki nje ya Nairobi isipokuwa Syokimau.'],
      ['en', 'Outside Nairobi county we also reach Syokimau and Kitengela.'],
      ['en', 'If you are outside Nairobi, we reach Kiambu, Juja and Syokimau.'],
    ]) {
      assert.deepEqual(cov(verifySay(sentence, { locked, table, factsUsed: [], callerText: caller })), [], sentence);
    }
  });
  it('a real denial of a covered place still fails', () => {
    assert.deepEqual(codes(verifySay('Kitengela iko nje ya maeneo yetu.', { locked: 'sw', table, factsUsed: [] })), ['coverage_contradiction']);
    assert.deepEqual(codes(verifySay('Hatufiki Kitengela.', { locked: 'sw', table, factsUsed: [] })), ['coverage_contradiction']);
  });
  it('the canned "Ndiyo, tunafika X." never replaces a reply about a place the caller did not name', () => {
    const r = verifySay('Hatufiki Syokimau.', { locked: 'sw', table, factsUsed: [], callerText: caller });
    assert.deepEqual(codes(r), ['coverage_contradiction']);
    assert.equal(dataLineFor('Hatufiki Syokimau.', r.problems, { table, pack: getLanguagePack('sw'), callerText: caller }), '');
    assert.equal(
      dataLineFor('Hatufiki Syokimau.', r.problems, { table, pack: getLanguagePack('sw'), callerText: 'Mnafika Syokimau?' }),
      'Ndiyo, tunafika Syokimau.'
    );
    const nakuru = verifySay('Yes, we cover Nakuru.', { locked: 'en', table, factsUsed: [] });
    assert.equal(dataLineFor('x', nakuru.problems, { table, pack: getLanguagePack('en'), callerText: caller }), '');
  });
});

