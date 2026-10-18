'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf, lookupWithDeadline } = require('../src/knowledge/lookup');
const { normalisePrice, priceIsSpeakable } = require('../src/conversation/factPrice');
const { profiles, FALLBACK } = require('../evals/replay/profiles');
const { matchArea } = require('../src/knowledge/v2/nlu');

const NOW = new Date('2026-10-19T05:00:00.000Z');

function say(kind, query, profile, language) {
  const result = lookup(kind, query, { profile, language, now: NOW, seed: 0 });
  return { result, speech: speechOf(result, language) };
}

test('price kinds speak words, and Ask is the cannot-answer line', () => {
  const bank = profiles();
  const sofa = say('price', 'How much is sofa cleaning?', bank.carry, 'en');
  assert.equal(sofa.result.status, 'found');
  assert.match(sofa.speech, /from two thousand five hundred shillings/);
  assert.equal(sofa.result.value, 2500);

  const ask = say('price', 'How much is window cleaning?', bank.ask, 'en');
  assert.equal(ask.result.status, 'not_on_file');
  assert.equal(ask.speech, FALLBACK);
  assert.doesNotMatch(ask.speech, /ask/i);

  const range = say('price', 'How much is oven cleaning?', bank.range, 'en');
  assert.equal(range.result.status, 'found');
  assert.match(range.speech, /one thousand five hundred shillings to two thousand five hundred shillings/);
});

test('pricing_mode quote is the cannot-answer line, even with a number on the row', () => {
  const quote = say('price', 'How much is gutter cleaning?', profiles().quote, 'en');
  assert.equal(quote.result.status, 'not_on_file');
  assert.equal(quote.speech, FALLBACK);
  assert.doesNotMatch(quote.speech, /four thousand|4,500|4500/);
});

test('lookup prices come from factPrice.normalisePrice', () => {
  assert.equal(normalisePrice({ price_range: 'Ask' }).kind, 'quote');
  assert.equal(priceIsSpeakable(normalisePrice({ price_range: 'Ask' })), false);
  assert.equal(normalisePrice({ pricing_mode: 'ask', price: '4,500' }).kind, 'quote');
  assert.equal(normalisePrice({ pricing_mode: 'quote', price: '4,500' }).kind, 'quote');
  assert.deepEqual(
    normalisePrice({ pricing_mode: 'range', price: '1,500', price_max: '2,500', price_range: 'Ask' }),
    { kind: 'range', min: 1500, max: 2500, currency: 'KES' }
  );
  assert.equal(normalisePrice({ price_range: 'From KSh 2,500' }).kind, 'from');
});

test('Kileleshwa fee is pre-rendered, Sheng uses Swahili', () => {
  const profile = profiles().carry;
  const sw = say('area_fee', 'mnafika Kileleshwa', profile, 'sw');
  assert.equal(sw.speech, 'Ada ya usafiri hadi Kileleshwa ni shilingi mia tatu.');
  const sheng = say('fee', 'mnafika Kileleshwa', profile, 'sheng');
  assert.match(sheng.speech, /shilingi mia tatu/);
});

test('Rongai is a clarify, not the Ongata Rongai fee', () => {
  const hit = say('fee', 'Do you come to Rongai?', profiles().rongai, 'en');
  assert.equal(hit.result.status, 'ambiguous');
  assert.match(hit.speech, /Ongata Rongai/);
  assert.match(hit.speech, /Rongai town/);
});

test('hours use the Swahili clock', () => {
  const hit = say('hours', 'mnafungua saa ngapi', profiles().hours, 'sw');
  assert.match(hit.speech, /saa mbili asubuhi/);
  assert.match(hit.speech, /saa kumi na mbili jioni/);
  const clock = say('hours', 'saa ngapi', profiles().hours, 'en');
  assert.match(clock.speech, /It is eight AM/);
});

test('a missing till is the cannot-answer line', () => {
  const en = say('pay', 'till number', profiles().carry, 'en');
  assert.equal(en.result.status, 'not_on_file');
  assert.equal(en.speech, FALLBACK);
  const sw = say('pay', 'namba ya till', profiles().carry, 'sw');
  assert.equal(sw.speech, 'Wacha niulize timu kisha nikujulishe.');
});

test('services list is capped and a held tenant only gets the fallback', () => {
  const list = say('services', 'which services', profiles().list, 'en');
  assert.match(list.speech, /deep cleaning, standard cleaning, sofa cleaning, carpet cleaning and more/);
  const held = say('price', 'sofa cleaning', { ...profiles().carry, holdGate: { allowed: false, reasons: ['held'] } }, 'en');
  assert.equal(held.result.status, 'unconfirmed');
  assert.equal(held.speech, FALLBACK);
});

test('an unconfirmed price, including hash mode, is not spoken', () => {
  const imported = {
    ...profiles().carry,
    servicesCatalog: [{ name: 'Sofa cleaning', price_range: 'KSh 2,500', source: 'import', confirmed: false }],
  };
  const plain = say('price', 'sofa cleaning', imported, 'en');
  assert.equal(plain.result.status, 'unconfirmed');
  assert.equal(plain.speech, FALLBACK);

  const prev = process.env.FACT_HASH_MODE;
  process.env.FACT_HASH_MODE = 'on';
  try {
    const hashed = say('price', 'sofa cleaning', profiles().carry, 'en');
    assert.equal(hashed.result.status, 'unconfirmed');
    assert.doesNotMatch(hashed.speech, /two thousand/);
  } finally {
    if (prev == null) delete process.env.FACT_HASH_MODE;
    else process.env.FACT_HASH_MODE = prev;
  }
});

test('lookup brain time stays under 50ms', () => {
  const profile = profiles().carry;
  const samples = [];
  for (let i = 0; i < 40; i += 1) {
    const started = performance.now();
    lookup('price', 'sofa cleaning', { profile, language: 'en', now: NOW, seed: 0 });
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  assert.ok(p95 <= 50, `p95 ${p95}`);
});

test('listed area terms are visible to the place matcher', () => {
  const named = matchArea('Kileleshwa', profiles().carry);
  assert.equal(named && named.listed, true);
});

test('a slow lookup returns the ack and the fallback', async () => {
  const out = await lookupWithDeadline('price', 'sofa', { profile: profiles().carry, language: 'en' }, {
    timeoutMs: 20,
    lookupFn: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'found', speech: { en: 'late', sw: 'late' } }), 80)),
  });
  assert.equal(out.timedOut, true);
  assert.equal(out.ack, 'One moment.');
  assert.equal(out.speech, FALLBACK);
});
