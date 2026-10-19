'use strict';
// Voice owner pay lookup round 3 (e1d775db): airtel-only wording, named number
// kinds on multi-slot tenants, compound + unconfirmed. EN and SW.

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { FALLBACK } = require('../evals/replay/profiles');

const NOW = new Date('2026-10-19T05:00:00.000Z');

function say(query, row, language) {
  const profile = tenantProfileFromRow(row);
  const result = lookup('pay', query, { profile, language, now: NOW, seed: 0 });
  return { result, speech: speechOf(result, language) };
}

function confirmedPay(overrides) {
  return {
    unknown_answer_fallback: FALLBACK,
    business_name: 'Pay Co',
    business_policies: {
      payments: {
        version: 2,
        timings: ['on_delivery'],
        source: 'owner',
        confirmed: true,
        ...overrides,
      },
    },
  };
}

function expectCallback(hit, language) {
  if (language === 'en') assert.equal(hit.speech, FALLBACK);
  else assert.equal(hit.speech, 'Wacha niulize timu kisha nikujulishe.');
}

test('replay pay r3: airtel-only names Airtel on cash and compound (EN and SW)', () => {
  const row = confirmedPay({ methods: ['airtel'], airtel: { phone: '0734567890' } });
  const en = say('Can I pay cash?', row, 'en');
  assert.match(en.speech, /^We take Airtel Money\./);
  assert.doesNotMatch(en.speech, /We take M-Pesa/i);
  const sw = say('Mnaweza kulipa kwa pesa taslimu au M-Pesa?', row, 'sw');
  assert.match(sw.speech, /Tunachukua Airtel Money/);
  assert.doesNotMatch(sw.speech, /Tunapokea M-Pesa/);
});

test('replay pay r3: airtel-only M-Pesa till or paybill ask is callback (EN and SW)', () => {
  const row = confirmedPay({ methods: ['airtel'], airtel: { phone: '0734567890' } });
  for (const [language, query] of [
    ['en', 'M-Pesa till number?'],
    ['en', 'M-Pesa paybill number?'],
    ['sw', 'namba ya till ya M-Pesa?'],
  ]) {
    const hit = say(query, row, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
  }
});

test('replay pay r4: send money routing and Swahili number labels (EN and SW)', () => {
  const tillOnly = confirmedPay({ methods: ['mpesa_till'], mpesa_till: '123456' });
  const miss = say('Send money number?', tillOnly, 'en');
  assert.equal(miss.result.status, 'not_found_in_list');
  expectCallback(miss, 'en');
  const missSw = say('Namba ya tuma pesa?', tillOnly, 'sw');
  assert.equal(missSw.result.status, 'not_found_in_list');
  expectCallback(missSw, 'sw');

  const sendRow = confirmedPay({ methods: ['mpesa_send'], mpesa_send: { phone: '0712345678' } });
  const hitSw = say('Nalipaje?', sendRow, 'sw');
  assert.match(hitSw.speech, /^Namba ya kutuma pesa kwa M-Pesa ni /);
  assert.doesNotMatch(hitSw.speech, /Namba ya namba ya/);

  const airtel = confirmedPay({ methods: ['airtel'], airtel: { phone: '0734567890' } });
  const swAirtel = say('Nalipaje?', airtel, 'sw');
  assert.match(swAirtel.speech, /^Namba ya Airtel Money ni /);
});

test('replay pay r3: paybill plus till resolves named slot (EN and SW)', () => {
  const row = confirmedPay({
    methods: ['mpesa_till', 'mpesa_paybill'],
    mpesa_till: '123456',
    mpesa_paybill: { business_no: '542542', account_mode: 'fixed', account: '70722' },
  });
  const enPaybill = say('M-Pesa paybill number?', row, 'en');
  assert.match(enPaybill.speech, /paybill number is five four two five four two/);
  assert.doesNotMatch(enPaybill.speech, /till number is one two three/i);
  const enTill = say('M-Pesa till number?', row, 'en');
  assert.match(enTill.speech, /till number is one two three four five six/i);
  const swTill = say('namba ya till', row, 'sw');
  assert.match(swTill.speech, /Namba ya till ya M-Pesa ni moja mbili tatu nne tano sita/);
});

test('replay pay r3: compound on unconfirmed import is unconfirmed before listing (EN and SW)', () => {
  const row = {
    unknown_answer_fallback: FALLBACK,
    business_name: 'Pay Co',
    business_policies: {
      payments: {
        version: 2,
        methods: ['cash'],
        timings: ['on_delivery'],
        source: 'import',
        confirmed: false,
        parsed_from: 'Cash on delivery',
      },
    },
  };
  for (const [language, query] of [
    ['en', 'Do you take M-Pesa or cash?'],
    ['en', 'Do you take card or cash?'],
    ['en', 'Do you accept cheque or bank transfer?'],
    ['sw', 'Mnaweza kulipa kwa pesa taslimu au M-Pesa?'],
  ]) {
    const hit = say(query, row, language);
    assert.equal(hit.result.status, 'unconfirmed', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /You can pay by cash/i);
    assert.doesNotMatch(hit.speech, /pesa taslimu/i);
  }
});
