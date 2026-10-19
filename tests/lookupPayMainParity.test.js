'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { loadMainLookup } = require('./helpers/mainLookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');

const NOW = new Date('2026-10-19T05:00:00.000Z');

function payRow(payOverrides) {
  return {
    business_name: 'Pay Co',
    business_policies: {
      payments: {
        version: 2,
        timings: ['on_delivery'],
        source: 'owner',
        confirmed: true,
        ...payOverrides,
      },
    },
  };
}

function sayPay(lookupFn, query, row, language) {
  const profile = tenantProfileFromRow(row);
  const result = lookupFn('pay', query, { profile, language, now: NOW, seed: 0 });
  return { result, speech: speechOf(result, language) };
}

const MAIN_PARITY_FIXTURES = [
  {
    name: 'paybill with account',
    pay: {
      methods: ['mpesa_paybill'],
      mpesa_paybill: { business_no: '542542', account_mode: 'fixed', account: '70722' },
    },
  },
  {
    name: 'till',
    pay: { methods: ['mpesa_till'], mpesa_till: '123456' },
  },
  {
    name: 'pochi',
    pay: { methods: ['pochi'], pochi: { phone: '0712345678' } },
  },
  {
    name: 'send money',
    pay: { methods: ['mpesa_send'], mpesa_send: { phone: '0712345678' } },
  },
  {
    name: 'airtel',
    pay: { methods: ['airtel'], airtel: { phone: '0734567890' } },
  },
];

const GENERAL_QUERIES = [
  ['en', 'How do I pay?'],
  ['sw', 'Nalipaje?'],
];

const MPESA_QUERIES = [
  ['en', 'Do you take M-Pesa?'],
  ['sw', 'Mnapokea M-Pesa?'],
];

test('pay: general questions match origin/main digit speech (EN and SW)', () => {
  const main = loadMainLookup();
  for (const fixture of MAIN_PARITY_FIXTURES) {
    const row = payRow(fixture.pay);
    for (const [language, query] of GENERAL_QUERIES) {
      const mainHit = sayPay(main.lookup, query, row, language);
      const branchHit = sayPay(lookup, query, row, language);
      assert.equal(branchHit.result.status, 'found', `${fixture.name} ${language}`);
      assert.equal(
        branchHit.speech,
        mainHit.speech,
        `${fixture.name} ${language}: ${query}`,
      );
    }
  }
});

test('pay: M-Pesa acceptance questions match origin/main when a number slot exists', () => {
  const main = loadMainLookup();
  for (const fixture of MAIN_PARITY_FIXTURES) {
    const row = payRow(fixture.pay);
    for (const [language, query] of MPESA_QUERIES) {
      const mainHit = sayPay(main.lookup, query, row, language);
      const branchHit = sayPay(lookup, query, row, language);
      assert.equal(branchHit.result.status, 'found', `${fixture.name} ${language}`);
      assert.equal(
        branchHit.speech,
        mainHit.speech,
        `${fixture.name} ${language}: ${query}`,
      );
    }
  }
});
