'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');

const NOW = new Date('2026-10-19T05:00:00.000Z');

const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/lookupPayMainSpeech.json'), 'utf8'),
);

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

const FIXTURE_PAY = {
  paybill_with_account: {
    methods: ['mpesa_paybill'],
    mpesa_paybill: { business_no: '542542', account_mode: 'fixed', account: '70722' },
  },
  till: { methods: ['mpesa_till'], mpesa_till: '123456' },
  pochi: { methods: ['pochi'], pochi: { phone: '0712345678' } },
  send_money: { methods: ['mpesa_send'], mpesa_send: { phone: '0712345678' } },
  airtel: { methods: ['airtel'], airtel: { phone: '0734567890' } },
};

function sayPay(query, row, language) {
  const profile = tenantProfileFromRow(row);
  const result = lookup('pay', query, { profile, language, now: NOW, seed: 0 });
  return {
    result,
    speech: speechOf(result, language),
  };
}

test('pay: numbered methods match frozen main speech snapshot (f6d7fee9)', () => {
  for (const expected of SNAPSHOT.cases) {
    const pay = FIXTURE_PAY[expected.fixture];
    assert.ok(pay, `unknown fixture ${expected.fixture}`);
    const row = payRow(pay);
    const hit = sayPay(expected.query, row, expected.language);
    assert.equal(hit.result.status, expected.status, `${expected.fixture} ${expected.queryId}`);
    assert.equal(hit.result.reason, expected.reason, `${expected.fixture} ${expected.queryId} reason`);
    assert.equal(hit.speech, expected.speech, `${expected.fixture} ${expected.queryId} speech`);
  }
});
