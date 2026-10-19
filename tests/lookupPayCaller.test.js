'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { FALLBACK } = require('../evals/replay/profiles');

const NOW = new Date('2026-10-19T05:00:00.000Z');

function say(kind, query, row, language) {
  const profile = tenantProfileFromRow(row, {});
  const result = lookup(kind, query, { profile, language, now: NOW, seed: 0 });
  return { result, speech: speechOf(result, language) };
}

const CALLBACK_ROW = { unknown_answer_fallback: FALLBACK };

function confirmedPay(overrides) {
  return {
    ...CALLBACK_ROW,
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

test('pay: structured cash only', () => {
  const row = confirmedPay({ methods: ['cash'] });
  const en = say('pay', 'How do I pay?', row, 'en');
  const sw = say('pay', 'How do I pay?', row, 'sw');
  assert.equal(en.result.status, 'found');
  assert.equal(en.speech, 'You can pay by cash.');
  assert.equal(sw.result.status, 'found');
  assert.equal(sw.speech, 'Unaweza kulipa kwa pesa taslimu.');
});

test('pay: structured cash and cheque', () => {
  const row = confirmedPay({ methods: ['cash', 'cheque'] });
  const en = say('pay', 'How do I pay?', row, 'en');
  const sw = say('pay', 'How do I pay?', row, 'sw');
  assert.equal(en.result.status, 'found');
  assert.equal(en.speech, 'You can pay by cash or cheque.');
  assert.equal(sw.result.status, 'found');
  assert.equal(sw.speech, 'Unaweza kulipa kwa pesa taslimu au hundi.');
});

test('pay: legacy free-text only uses the callback line', () => {
  const row = {
    ...CALLBACK_ROW,
    business_name: 'Pay Co',
    business_policies: { payment: 'Cash on delivery only' },
  };
  for (const language of ['en', 'sw']) {
    const hit = say('pay', 'How do I pay?', row, language);
    assert.equal(hit.result.status, 'no_data', language);
    if (language === 'en') assert.equal(hit.speech, FALLBACK);
    else assert.equal(hit.speech, 'Wacha niulize timu kisha nikujulishe.');
    assert.doesNotMatch(hit.speech, /delivery only/i);
  }
});

test('pay: till question with no till uses the callback line', () => {
  const row = confirmedPay({ methods: ['cash'] });
  const en = say('pay', 'till number', row, 'en');
  const sw = say('pay', 'namba ya till', row, 'sw');
  assert.equal(en.result.status, 'no_data');
  assert.equal(en.speech, FALLBACK);
  assert.equal(sw.result.status, 'no_data');
  assert.equal(sw.speech, 'Wacha niulize timu kisha nikujulishe.');
});

test('pay: bank-only saved does not speak account details', () => {
  const row = confirmedPay({
    methods: ['bank'],
    bank: { bank_name: 'KCB', account_name: 'Pay Co', account_no: '1234567890' },
  });
  for (const language of ['en', 'sw']) {
    const general = say('pay', 'How do I pay?', row, language);
    assert.equal(general.result.status, 'no_data', `general ${language}`);
    const bank = say('pay', 'bank account number', row, language);
    assert.equal(bank.result.status, 'not_found_in_list', `bank ${language}`);
    if (language === 'en') {
      assert.equal(general.speech, FALLBACK);
      assert.equal(bank.speech, FALLBACK);
    } else {
      assert.equal(general.speech, 'Wacha niulize timu kisha nikujulishe.');
      assert.equal(bank.speech, 'Wacha niulize timu kisha nikujulishe.');
    }
    assert.doesNotMatch(general.speech, /KCB|1234567890/i);
    assert.doesNotMatch(bank.speech, /KCB|1234567890/i);
  }
});

test('pay: nothing saved uses the callback line', () => {
  const row = { ...CALLBACK_ROW, business_name: 'Pay Co', business_policies: {} };
  for (const language of ['en', 'sw']) {
    const hit = say('pay', 'How do I pay?', row, language);
    assert.equal(hit.result.status, 'no_data');
    if (language === 'en') assert.equal(hit.speech, FALLBACK);
    else assert.equal(hit.speech, 'Wacha niulize timu kisha nikujulishe.');
  }
});

test('pay: imported till is unconfirmed and uses the callback line', () => {
  const row = {
    ...CALLBACK_ROW,
    business_name: 'Pay Co',
    business_policies: {
      payments: {
        version: 2,
        methods: ['mpesa_till'],
        mpesa_till: '123456',
        timings: ['on_delivery'],
        source: 'import',
        confirmed: false,
        parsed_from: 'M-Pesa till 123456',
      },
    },
  };
  for (const language of ['en', 'sw']) {
    const general = say('pay', 'How do I pay?', row, language);
    const till = say('pay', 'till number', row, language);
    assert.equal(general.result.status, 'unconfirmed', language);
    assert.equal(till.result.status, 'unconfirmed', language);
    if (language === 'en') {
      assert.equal(general.speech, FALLBACK);
      assert.equal(till.speech, FALLBACK);
    } else {
      assert.equal(general.speech, 'Wacha niulize timu kisha nikujulishe.');
      assert.equal(till.speech, 'Wacha niulize timu kisha nikujulishe.');
    }
    assert.doesNotMatch(general.speech, /one two three/i);
  }
});
