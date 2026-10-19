#!/usr/bin/env node
'use strict';

/**
 * PR821 pay probe: branch lookup speech must match frozen main (f6d7fee9) snapshot.
 * Exit 0 when regression count is 0.
 */

const fs = require('fs');
const path = require('path');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');

const NOW = new Date('2026-10-19T05:00:00.000Z');
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../tests/fixtures/lookupPayMainSpeech.json'), 'utf8'),
);

const FIXTURE_PAY = {
  paybill_with_account: {
    methods: ['mpesa_paybill'],
    mpesa_paybill: { business_no: '542542', account_mode: 'fixed', account: '70722' },
  },
  till: { methods: ['mpesa_till'], mpesa_till: '123456' },
  till_plus_cash: { methods: ['mpesa_till', 'cash'], mpesa_till: '123456' },
  till_plus_bank: {
    methods: ['mpesa_till', 'bank'],
    mpesa_till: '123456',
    bank: { bank_name: 'KCB', account_name: 'Pay Co', account_no: '1234567890' },
  },
  pochi: { methods: ['pochi'], pochi: { phone: '0712345678' } },
  send_money: { methods: ['mpesa_send'], mpesa_send: { phone: '0712345678' } },
  airtel: { methods: ['airtel'], airtel: { phone: '0734567890' } },
};

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

let regressions = 0;
for (const expected of SNAPSHOT.cases) {
  const pay = FIXTURE_PAY[expected.fixture];
  if (!pay) continue;
  const profile = tenantProfileFromRow(payRow(pay));
  const result = lookup('pay', expected.query, {
    profile,
    language: expected.language,
    now: NOW,
    seed: 0,
  });
  const speech = speechOf(result, expected.language);
  const statusOk = result.status === expected.status;
  const reasonOk = (result.reason || '') === expected.reason;
  const speechOk = speech === expected.speech;
  if (!statusOk || !reasonOk || !speechOk) {
    regressions++;
    console.error(
      `REGRESSION ${expected.fixture} ${expected.queryId} ${expected.language}`,
    );
  }
}

console.log(`pay probe: ${regressions} regressions (${SNAPSHOT.cases.length} checks)`);
process.exit(regressions === 0 ? 0 : 1);
