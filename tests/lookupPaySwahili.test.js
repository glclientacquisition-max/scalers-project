'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { hashFactValue, factValueForPath } = require('../src/conversation/factHash');

test('pay till answer uses natural Swahili, not English till number label', () => {
  const prev = process.env.FACT_HASH_MODE;
  process.env.FACT_HASH_MODE = 'on';
  const row = {
    id: 't-pay',
    business_name: 'Demo Shop',
    business_policies: {
      payments: {
        version: 2,
        methods: ['mpesa_till'],
        mpesa_till: '123456',
        source: 'owner',
        confirmed: true,
      },
    },
  };
  const value = factValueForPath('payments.methods', row);
  const profile = tenantProfileFromRow(row, {
    fieldMeta: {
      hashMode: true,
      byPath: {
        'payments.methods': {
          source: 'owner',
          value_hash: hashFactValue(value),
        },
      },
    },
  });
  const result = lookup('pay', 'namba ya till', {
    profile,
    language: 'sw',
    now: new Date('2026-10-19T10:00:00+03:00'),
    seed: 0,
  });
  assert.equal(result.status, 'found');
  const speech = speechOf(result, 'sw');
  assert.match(speech, /Namba ya till ya M-Pesa ni/);
  assert.doesNotMatch(speech, /till number/i);
  if (prev == null) delete process.env.FACT_HASH_MODE;
  else process.env.FACT_HASH_MODE = prev;
});
