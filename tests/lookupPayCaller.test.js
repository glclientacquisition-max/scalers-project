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

test('pay: cash plus blank till is cash only on general pay', () => {
  const row = confirmedPay({ methods: ['cash', 'mpesa_till'], mpesa_till: '' });
  const en = say('pay', 'How do I pay?', row, 'en');
  const sw = say('pay', 'Nalipaje?', row, 'sw');
  assert.equal(en.result.status, 'found');
  assert.equal(en.speech, 'You can pay by cash.');
  assert.equal(sw.result.status, 'found');
  assert.equal(sw.speech, 'Unaweza kulipa kwa pesa taslimu.');
});

test('pay: cash plus blank till asked about M-Pesa uses the callback line', () => {
  const row = confirmedPay({ methods: ['cash', 'mpesa_till'], mpesa_till: '' });
  const cases = [
    ['en', 'Do you take M-Pesa?'],
    ['sw', 'Mnapokea M-Pesa?'],
  ];
  for (const [language, query] of cases) {
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'no_data', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /You can pay by cash/i);
    assert.doesNotMatch(hit.speech, /pesa taslimu/i);
  }
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

test('pay: till tenant asked about cash or cheque states M-Pesa number, not callback', () => {
  const row = confirmedPay({ methods: ['mpesa_till'], mpesa_till: '123456' });
  const enCash = say('pay', 'Can I pay cash?', row, 'en');
  const swCheque = say('pay', 'Mnachukua hundi?', row, 'sw');
  assert.equal(enCash.result.status, 'found');
  assert.equal(
    enCash.speech,
    'We take M-Pesa. The till number is one two three four five six.',
  );
  assert.equal(swCheque.result.status, 'found');
  assert.match(swCheque.speech, /Tunapokea M-Pesa/);
  assert.match(swCheque.speech, /Namba ya till ni/);
});

test('pay: till plus cash tenant affirms cash and till on cash question', () => {
  const row = confirmedPay({ methods: ['mpesa_till', 'cash'], mpesa_till: '123456' });
  const en = say('pay', 'Can I pay cash?', row, 'en');
  const sw = say('pay', 'Naweza kulipa kwa pesa taslimu?', row, 'sw');
  assert.equal(en.result.status, 'found');
  assert.equal(
    en.speech,
    'You can pay by cash or M-Pesa. The till number is one two three four five six.',
  );
  assert.equal(sw.result.status, 'found');
  assert.match(sw.speech, /Unaweza kulipa kwa pesa taslimu au M-Pesa/);
  assert.match(sw.speech, /Namba ya till ni/);
});

test('pay: compound M-Pesa or cash covers saved methods', () => {
  const tillOnly = confirmedPay({ methods: ['mpesa_till'], mpesa_till: '123456' });
  const tillCash = confirmedPay({ methods: ['mpesa_till', 'cash'], mpesa_till: '123456' });
  const enOnly = say('pay', 'Do you take M-Pesa or cash?', tillOnly, 'en');
  assert.equal(enOnly.result.status, 'found');
  assert.equal(
    enOnly.speech,
    'We take M-Pesa. The till number is one two three four five six.',
  );
  const enBoth = say('pay', 'Can I pay cash or M-Pesa?', tillCash, 'en');
  assert.equal(enBoth.result.status, 'found');
  assert.equal(
    enBoth.speech,
    'You can pay by cash or M-Pesa. The till number is one two three four five six.',
  );
  const swBoth = say('pay', 'Mnaweza kulipa kwa pesa taslimu au M-Pesa?', tillCash, 'sw');
  assert.equal(swBoth.result.status, 'found');
  assert.match(swBoth.speech, /pesa taslimu au M-Pesa/);
});

test('pay: card and bank method questions use the method line', () => {
  const row = confirmedPay({ methods: ['card', 'bank'] });
  const enCard = say('pay', 'Do you take card?', row, 'en');
  const swCard = say('pay', 'Mnachukua kadi?', row, 'sw');
  assert.equal(enCard.result.status, 'found');
  assert.equal(enCard.speech, 'You can pay by card.');
  assert.equal(swCard.result.status, 'found');
  assert.equal(swCard.speech, 'Unaweza kulipa kwa kadi.');
  const enBank = say('pay', 'Can I pay by bank transfer?', row, 'en');
  const swBank = say('pay', 'Naweza kulipa kwa uhamisho wa benki?', row, 'sw');
  assert.equal(enBank.result.status, 'found');
  assert.equal(enBank.speech, 'You can pay by bank transfer.');
  assert.equal(swBank.result.status, 'found');
  assert.equal(swBank.speech, 'Unaweza kulipa kwa uhamisho wa benki.');
});

test('pay: off-topic pay questions without a saved number use the callback line', () => {
  const row = confirmedPay({ methods: ['cash', 'cheque', 'bank'] });
  for (const [language, query] of [
    ['en', 'Pay later?'],
    ['sw', 'Malipo?'],
  ]) {
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /You can pay by cash/i);
  }
});

test('pay: numbered tenant payment-number phrases read the confirmed number', () => {
  const row = confirmedPay({ methods: ['mpesa_till'], mpesa_till: '123456' });
  const cases = [
    ['sw', 'Nicheki namba ya kulipa'],
    ['sw', 'Nipe namba ya kulipa'],
    ['en', 'Payment number?'],
    ['sw', 'Malipo?'],
    ['sw', 'Malipo ni vipi?'],
    ['sw', 'Nataka kufanya malipo'],
  ];
  for (const [language, query] of cases) {
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'found', query);
    assert.match(hit.speech, /one two three four five six|moja mbili tatu nne tano sita/i, query);
    assert.doesNotMatch(hit.speech, new RegExp(FALLBACK.slice(0, 20)));
  }
});

test('pay: pay later uses the callback even when a till is saved', () => {
  const row = confirmedPay({ methods: ['mpesa_till'], mpesa_till: '123456' });
  for (const [language, query] of [
    ['en', 'Pay later?'],
    ['sw', 'Naweza kulipa baadaye?'],
  ]) {
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /one two three|moja mbili tatu/i);
  }
});

test('pay: airtel-only uses Airtel wording and rejects M-Pesa till or paybill asks', () => {
  const row = confirmedPay({ methods: ['airtel'], airtel: { phone: '0734567890' } });
  const enCash = say('pay', 'Can I pay cash?', row, 'en');
  assert.equal(enCash.result.status, 'found');
  assert.match(enCash.speech, /^We take Airtel Money\./);
  assert.doesNotMatch(enCash.speech, /We take M-Pesa/i);
  const swCompound = say('pay', 'Mnaweza kulipa kwa pesa taslimu au M-Pesa?', row, 'sw');
  assert.equal(swCompound.result.status, 'found');
  assert.match(swCompound.speech, /Tunachukua Airtel Money/);
  for (const [language, query] of [
    ['en', 'M-Pesa till number?'],
    ['en', 'M-Pesa paybill number?'],
    ['sw', 'namba ya till ya M-Pesa?'],
  ]) {
    const hit = say('pay', query, row, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
  }
});

test('pay: send money ask without send slot uses callback; send tenant reads number (EN and SW)', () => {
  const tillOnly = confirmedPay({ methods: ['mpesa_till'], mpesa_till: '123456' });
  for (const [language, query] of [
    ['en', 'Send money number?'],
    ['sw', 'Namba ya kutuma pesa?'],
    ['sw', 'Namba ya tuma pesa?'],
  ]) {
    const hit = say('pay', query, tillOnly, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /one two three|moja mbili tatu/i);
  }
  const sendRow = confirmedPay({ methods: ['mpesa_send'], mpesa_send: { phone: '0712345678' } });
  const en = say('pay', 'Send money number?', sendRow, 'en');
  assert.equal(en.result.status, 'found');
  assert.match(en.speech, /send money number is zero seven one two three four five six seven eight/i);
  const sw = say('pay', 'Namba ya kutuma pesa?', sendRow, 'sw');
  assert.equal(sw.result.status, 'found');
  assert.match(sw.speech, /^Namba ya kutuma pesa kwa M-Pesa ni /);
  assert.doesNotMatch(sw.speech, /Namba ya namba ya/i);
});

test('pay: Swahili paybill and pochi lines use single Namba ya prefix', () => {
  const paybill = confirmedPay({
    methods: ['mpesa_paybill'],
    mpesa_paybill: { business_no: '542542', account_mode: 'fixed', account: '70722' },
  });
  const swPaybill = say('pay', 'Nalipaje?', paybill, 'sw');
  assert.match(swPaybill.speech, /^Namba ya paybill ya M-Pesa ni /);
  assert.doesNotMatch(swPaybill.speech, /Namba ya namba ya/i);
  const pochi = confirmedPay({ methods: ['pochi'], pochi: { phone: '0712345678' } });
  const swPochi = say('pay', 'Nalipaje?', pochi, 'sw');
  assert.match(swPochi.speech, /^Namba ya Pochi la Biashara ni /);
  assert.doesNotMatch(swPochi.speech, /Namba ya namba ya/i);
});

test('pay: paybill plus till tenant resolves paybill and till number asks separately', () => {
  const row = confirmedPay({
    methods: ['mpesa_till', 'mpesa_paybill'],
    mpesa_till: '123456',
    mpesa_paybill: { business_no: '542542', account_mode: 'fixed', account: '70722' },
  });
  const paybill = say('pay', 'M-Pesa paybill number?', row, 'en');
  assert.equal(paybill.result.status, 'found');
  assert.match(paybill.speech, /paybill number is five four two five four two/);
  assert.match(paybill.speech, /account is seven zero seven two two/);
  assert.doesNotMatch(paybill.speech, /till number is one two three/i);
  const till = say('pay', 'M-Pesa till number?', row, 'en');
  assert.equal(till.result.status, 'found');
  assert.match(till.speech, /till number is one two three four five six/i);
  assert.doesNotMatch(till.speech, /paybill/i);
});

test('pay: compound questions respect unconfirmed payments before listing methods', () => {
  const importedCash = {
    ...CALLBACK_ROW,
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
  const cases = [
    ['en', 'Do you take M-Pesa or cash?'],
    ['en', 'Do you take card or cash?'],
    ['en', 'Do you accept cheque or bank transfer?'],
    ['sw', 'Mnaweza kulipa kwa pesa taslimu au M-Pesa?'],
  ];
  for (const [language, query] of cases) {
    const hit = say('pay', query, importedCash, language);
    assert.equal(hit.result.status, 'unconfirmed', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /You can pay by cash/i);
    assert.doesNotMatch(hit.speech, /pesa taslimu/i);
  }
});

test('pay: compound question with none of the asked methods saved uses callback', () => {
  const chequeOnly = confirmedPay({ methods: ['cheque'] });
  for (const [language, query] of [
    ['en', 'Do you take M-Pesa or cash?'],
    ['sw', 'Mnaweza kulipa kwa pesa taslimu au M-Pesa?'],
  ]) {
    const hit = say('pay', query, chequeOnly, language);
    assert.equal(hit.result.status, 'not_found_in_list', query);
    expectCallback(hit, language);
    assert.doesNotMatch(hit.speech, /cheque|hundi/i);
  }
  const cardBank = confirmedPay({ methods: ['card', 'bank'] });
  const en = say('pay', 'Do you take M-Pesa or cash?', cardBank, 'en');
  assert.equal(en.result.status, 'not_found_in_list');
  expectCallback(en, 'en');
  assert.doesNotMatch(en.speech, /card|bank transfer/i);
});

test('pay: imported till asked about M-Pesa is unconfirmed before not_in_list', () => {
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
  const hit = say('pay', 'Do you take M-Pesa?', row, 'en');
  assert.equal(hit.result.status, 'unconfirmed');
  expectCallback(hit, 'en');
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
