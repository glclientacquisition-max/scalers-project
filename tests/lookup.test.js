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
  assert.equal(en.result.status, 'no_data');
  assert.equal(en.speech, FALLBACK);
  const sw = say('pay', 'namba ya till', profiles().carry, 'sw');
  assert.equal(sw.speech, 'Wacha niulize timu kisha nikujulishe.');
});

test('a missing list is no_data, and an unlisted place is not a denial', () => {
  const none = say('fee', 'Do you charge a fee to come to Westlands?', profiles().nowhere, 'en');
  assert.equal(none.result.status, 'no_data');
  assert.equal(none.speech, FALLBACK);
  assert.doesNotMatch(none.speech, /don't come|Westlands/i);
  const sw = say('fee', 'Mnafika Westlands?', profiles().nowhere, 'sw');
  assert.equal(sw.result.status, 'no_data');
  assert.equal(sw.speech, 'Wacha niulize timu kisha nikujulishe.');
  assert.doesNotMatch(sw.speech, /Hatufiki|Westlands/);

  const listed = say('fee', 'Do you charge a fee to come to Westlands?', profiles().carry, 'en');
  assert.equal(listed.result.status, 'not_found_in_list');
  assert.equal(listed.speech, FALLBACK);
  assert.doesNotMatch(listed.speech, /don't come/);

  const opted = say('fee', 'Do you charge a fee to come to Westlands?', profiles().optout, 'sw');
  assert.equal(opted.result.status, 'not_found_in_list');
  assert.match(opted.speech, /Hatufiki Westlands/);

  assert.equal(say('price', 'How much is plumbing?', { ...profiles().nowhere, servicesCatalog: [] }, 'en').result.status, 'no_data');
  assert.equal(say('hours', 'opening hours', profiles().nowhere, 'en').result.status, 'no_data');
  assert.equal(say('services', 'which services', { ...profiles().nowhere, servicesCatalog: [] }, 'en').result.status, 'no_data');
  assert.equal(say('price', 'How much is plumbing?', profiles().carry, 'en').result.status, 'not_found_in_list');
});

test('a matching fact hash confirms hours, and a fee without one does not', () => {
  const { indexFieldMeta } = require('../src/conversation/provenance');
  const { hashFactValue, factValueForPath, tenantRowFromProfile } = require('../src/conversation/factHash');
  const hours = profiles().hours;
  const tenant = tenantRowFromProfile(hours);
  const grid = factValueForPath('hours.weekly_grid', tenant);
  const stamped = {
    ...hours,
    fieldMeta: indexFieldMeta([
      { field_path: 'hours.weekly_grid', source: 'owner', value_hash: hashFactValue(grid) },
    ]),
  };
  const area = profiles().carry.service_areas.areas.find((row) => row.id === 'place:kileleshwa');
  const feeValue = {
    id: 'place:kileleshwa',
    fee_mode: area.fee_mode,
    fee_ksh: area.fee_ksh,
    modes: area.modes,
  };
  const feeStamped = {
    ...profiles().carry,
    fieldMeta: indexFieldMeta([
      { field_path: 'service_areas.place:kileleshwa', source: 'owner', value_hash: hashFactValue(feeValue) },
    ]),
  };
  const prev = process.env.FACT_HASH_MODE;
  process.env.FACT_HASH_MODE = 'on';
  try {
    const en = say('hours', 'What are your opening hours?', stamped, 'en');
    const sw = say('hours', 'mnafungua saa ngapi', stamped, 'sw');
    assert.equal(en.result.status, 'found');
    assert.equal(sw.result.status, 'found');
    assert.match(en.speech, /every day from eight AM/);
    assert.match(sw.speech, /saa mbili asubuhi/);
    const bareFee = say('fee', 'mnafika Kileleshwa', profiles().carry, 'en');
    const bareFeeSw = say('fee', 'mnafika Kileleshwa', profiles().carry, 'sw');
    assert.equal(bareFee.result.status, 'unconfirmed');
    assert.equal(bareFeeSw.result.status, 'unconfirmed');
    assert.equal(bareFee.speech, FALLBACK);
    assert.equal(bareFeeSw.speech, 'Wacha niulize timu kisha nikujulishe.');
    const confirmedFee = say('fee', 'mnafika Kileleshwa', feeStamped, 'sw');
    assert.equal(confirmedFee.result.status, 'found');
    assert.match(confirmedFee.speech, /mia tatu/);
  } finally {
    if (prev == null) delete process.env.FACT_HASH_MODE;
    else process.env.FACT_HASH_MODE = prev;
  }
});

test('hours group identical days and stay unconfirmed without a stamp', () => {
  const grouped = say('hours', 'What are your opening hours?', profiles().grouped, 'en');
  assert.equal(grouped.result.status, 'found');
  assert.match(grouped.speech, /Monday to Saturday, nine AM to seven PM; closed Sunday/);
  assert.doesNotMatch(grouped.speech, /Tuesday/);
  const sw = say('hours', 'mnafungua saa ngapi', profiles().grouped, 'sw');
  assert.equal(sw.result.status, 'found');
  assert.match(sw.speech, /Jumatatu hadi Jumamosi/);
  assert.match(sw.speech, /Jumapili tumefunga/);

  const prev = process.env.FACT_HASH_MODE;
  process.env.FACT_HASH_MODE = 'on';
  try {
    const en = say('hours', 'What are your opening hours?', profiles().hours, 'en');
    const swHash = say('hours', 'mnafungua saa ngapi', profiles().hours, 'sw');
    assert.equal(en.result.status, 'unconfirmed');
    assert.equal(swHash.result.status, 'unconfirmed');
    assert.equal(en.speech, FALLBACK);
    assert.equal(swHash.speech, 'Wacha niulize timu kisha nikujulishe.');
    assert.doesNotMatch(en.speech, /Monday|eight/);
    assert.doesNotMatch(swHash.speech, /saa mbili/);
  } finally {
    if (prev == null) delete process.env.FACT_HASH_MODE;
    else process.env.FACT_HASH_MODE = prev;
  }
});

test('EN and SW lookups make the same decision', () => {
  const cases = [
    ['price', 'How much is sofa cleaning?', profiles().carry],
    ['price', 'How much is window cleaning?', profiles().ask],
    ['price', 'How much is plumbing?', profiles().carry],
    ['fee', 'mnafika Kileleshwa', profiles().carry],
    ['fee', 'Do you charge a fee to come to Westlands?', profiles().nowhere],
    ['fee', 'Do you charge a fee to come to Westlands?', profiles().carry],
    ['fee', 'Do you charge a fee to come to Westlands?', profiles().optout],
    ['hours', 'What are your opening hours?', profiles().grouped],
    ['hours', 'What are your opening hours?', profiles().nowhere],
    ['hours', 'saa ngapi', profiles().hours],
    ['pay', 'till number', profiles().carry],
    ['services', 'How much is the.', profiles().menu],
    ['services', 'which services', { ...profiles().nowhere, servicesCatalog: [] }],
  ];
  for (const [kind, query, profile] of cases) {
    const en = say(kind, query, profile, 'en');
    const sw = say(kind, query, profile, 'sw');
    assert.equal(en.result.status, sw.result.status, `${kind} ${query}`);
    assert.equal(en.result.id, sw.result.id, `${kind} ${query}`);
    const enCallback = en.speech === FALLBACK;
    const swCallback = sw.speech === 'Wacha niulize timu kisha nikujulishe.';
    assert.equal(enCallback, swCallback, `${kind} ${query} ${en.result.status}`);
  }
});

test('services list is capped, and a closed holds gate does not silence facts', () => {
  const list = say('services', 'which services', profiles().list, 'en');
  assert.match(list.speech, /Deep cleaning, Standard cleaning, Sofa cleaning, and Carpet cleaning, and more/);
  // tenant_hold_gate is the reservation capability. Most tenants have it closed.
  const closed = { allowed: false, reasons: ['Holds are not enabled in policies.'] };
  const priced = say('price', 'sofa cleaning', { ...profiles().carry, holdGate: closed }, 'en');
  assert.equal(priced.result.status, 'found');
  assert.match(priced.speech, /from two thousand five hundred shillings/);
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

test('lookup brain time stays near the same-run median', () => {
  const { summarizeLatency } = require('../evals/replay/latency');
  const profile = profiles().carry;
  for (let i = 0; i < 8; i += 1) lookup('price', 'sofa cleaning', { profile, language: 'en', now: NOW, seed: 0 });
  const samples = [];
  for (let i = 0; i < 40; i += 1) {
    const started = performance.now();
    lookup('price', 'sofa cleaning', { profile, language: 'en', now: NOW, seed: 0 });
    samples.push(performance.now() - started);
  }
  const gate = summarizeLatency(samples);
  assert.equal(gate.ok, true, `median ${gate.median} p95 ${gate.p95} cap ${gate.cap}`);
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
