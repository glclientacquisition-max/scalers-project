'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { FALLBACK } = require('../evals/replay/profiles');
const { hashFactValue, factValueForPath } = require('../src/conversation/factHash');

const NOW = new Date('2026-10-19T05:00:00.000Z');

function say(kind, query, row, language, profileOpts) {
  const profile = tenantProfileFromRow(row, profileOpts || {});
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

function expectCallback(hit, language) {
  if (language === 'en') assert.equal(hit.speech, FALLBACK);
  else assert.equal(hit.speech, 'Wacha niulize timu kisha nikujulishe.');
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
    assert.equal(hit.result.reason, 'legacy_text_only', language);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /delivery only/i);
  }
});

test('pay: till question with no till uses the callback line', () => {
  const row = confirmedPay({ methods: ['cash'] });
  const en = say('pay', 'till number', row, 'en');
  const sw = say('pay', 'namba ya till', row, 'sw');
  assert.equal(en.result.status, 'no_data');
  expectCallback(en, 'en');
  assert.equal(sw.result.status, 'no_data');
  expectCallback(sw, 'sw');
});

test('pay: cash-only tenant asked about M-Pesa or cheque gets the callback line', () => {
  const row = confirmedPay({ methods: ['cash'] });
  const cases = [
    ['en', 'Do you take M-Pesa?'],
    ['sw', 'Mnapokea M-Pesa?'],
    ['en', 'Do you accept cheques?'],
    ['sw', 'Mnachukua hundi?'],
  ];
  for (const [language, query] of cases) {
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /You can pay by cash/i);
  }
});

test('pay: cheque-only tenant asked about cash gets the callback line', () => {
  const row = confirmedPay({ methods: ['cheque'] });
  for (const language of ['en', 'sw']) {
    const query = language === 'en' ? 'Can I pay cash?' : 'Naweza kulipa kwa pesa taslimu?';
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'not_found_in_list');
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /cheque|hundi/i);
  }
});

test('pay: cash plus blank till lists both on general pay', () => {
  const row = confirmedPay({ methods: ['cash', 'mpesa_till'], mpesa_till: '' });
  const en = say('pay', 'How do I pay?', row, 'en');
  const sw = say('pay', 'How do I pay?', row, 'sw');
  assert.equal(en.result.status, 'found');
  assert.match(en.speech, /cash/);
  assert.match(en.speech, /M-Pesa Buy Goods/);
  assert.equal(sw.result.status, 'found');
  assert.match(sw.speech, /pesa taslimu/);
  assert.match(sw.speech, /M-Pesa Buy Goods/);
});

test('pay: bank-only general names bank without account digits', () => {
  const row = confirmedPay({
    methods: ['bank'],
    bank: { bank_name: 'KCB', account_name: 'Pay Co', account_no: '1234567890' },
  });
  for (const language of ['en', 'sw']) {
    const general = say('pay', 'How do I pay?', row, language);
    assert.equal(general.result.status, 'found', `general ${language}`);
    assert.doesNotMatch(general.speech, /1234567890|KCB/i);
    const bank = say('pay', 'bank account number', row, language);
    assert.equal(bank.result.status, 'not_found_in_list', `bank ${language}`);
    expectCallback(bank, language);
  }
});

test('pay: nothing saved uses the callback line with no_data', () => {
  const row = { ...CALLBACK_ROW, business_name: 'Pay Co', business_policies: {} };
  for (const language of ['en', 'sw']) {
    const general = say('pay', 'How do I pay?', row, language);
    assert.equal(general.result.status, 'no_data');
    expectCallback(general, language);
    const bank = say('pay', 'bank account number', row, language);
    assert.equal(bank.result.status, 'no_data');
    expectCallback(bank, language);
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
    expectCallback(general, language);
    expectCallback(till, language);
    assert.doesNotMatch(general.speech, /one two three/i);
  }
});

test('pay: FACT_HASH_MODE confirms payments from tenant_field_meta', () => {
  const prev = process.env.FACT_HASH_MODE;
  process.env.FACT_HASH_MODE = 'on';
  try {
    const row = {
      ...CALLBACK_ROW,
      id: 't-pay-hash',
      business_name: 'Pay Co',
      business_policies: {
        payments: {
          version: 2,
          methods: ['cash'],
          timings: ['on_delivery'],
          source: 'owner',
          confirmed: true,
        },
      },
    };
    const value = factValueForPath('payments.methods', row);
    const profileOpts = {
      fieldMeta: {
        hashMode: true,
        byPath: {
          'payments.methods': {
            source: 'owner',
            value_hash: hashFactValue(value),
          },
        },
      },
    };
    const en = say('pay', 'How do I pay?', row, 'en', profileOpts);
    const sw = say('pay', 'How do I pay?', row, 'sw', profileOpts);
    assert.equal(en.result.status, 'found');
    assert.equal(en.speech, 'You can pay by cash.');
    assert.equal(sw.result.status, 'found');
    assert.equal(sw.speech, 'Unaweza kulipa kwa pesa taslimu.');
  } finally {
    if (prev == null) delete process.env.FACT_HASH_MODE;
    else process.env.FACT_HASH_MODE = prev;
  }
});
