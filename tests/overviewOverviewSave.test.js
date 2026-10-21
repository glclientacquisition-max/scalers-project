'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const [major, minor] = process.versions.node.split('.').map(Number);
const CAN_STRIP_TYPES = major > 22 || (major === 22 && minor >= 6);
const tsSkip = CAN_STRIP_TYPES ? false : `Node ${process.versions.node} has no --experimental-strip-types`;

function runTs(script, env = {}) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--import', './tests/registerTs.mjs', '--input-type=module', '-e', script],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } }
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

describe('overview import save', () => {
  let R = null;

  before(() => {
    if (tsSkip) return;
    R = runTs(
      `
      import { planFactConfirm } from './dashboard/src/lib/factConfirm.ts';
      import { hashFactValue, factValueForPath } from './dashboard/src/lib/factHash.ts';
      import { applyStructuredPolicies, normalizeBusinessPolicies } from './dashboard/src/lib/businessPolicies.ts';
      import { createRequire } from 'node:module';
      const requireRoot = createRequire(import.meta.url);
      const { lookup } = requireRoot('./src/knowledge/lookup.js');
      const { tenantProfileFromRow } = requireRoot('./src/tenantProfile.js');

      const paymentsParsed = {
        version: 2,
        methods: ['mpesa_till'],
        mpesa_till: '123456',
        timings: ['on_delivery'],
        source: 'parsed',
        confirmed: false,
        parsed_from: 'M-Pesa till 123456',
      };
      const rowBefore = {
        business_name: 'Chapter One',
        services_catalog: [{
          name: 'A4 print',
          price_range: '20',
          pricing: { mode: 'fixed', amount_ksh: 20, unit: 'item', source: 'parsed', confirmed: false, parsed_from: '20' },
        }],
        business_policies: { payments: paymentsParsed, payment: 'M-Pesa till 123456' },
        hours_schedule: {
          timezone: 'Africa/Nairobi',
          days: { mon: { open: '08:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
        },
      };
      const policiesAfter = applyStructuredPolicies({
        ...normalizeBusinessPolicies(rowBefore.business_policies),
        payments: { ...paymentsParsed, source: 'owner', confirmed: true },
      });
      const rowAfter = {
        ...rowBefore,
        business_policies: policiesAfter.ok ? policiesAfter.policies : rowBefore.business_policies,
        services_catalog: [{
          ...rowBefore.services_catalog[0],
          pricing: { ...rowBefore.services_catalog[0].pricing, source: 'owner', confirmed: true },
        }],
      };
      const noop = planFactConfirm({
        scope: 'policies',
        before: rowBefore,
        after: rowBefore,
        explicitPaths: ['payments.methods'],
        saveIsConfirm: true,
      });
      const hashBefore = hashFactValue(factValueForPath('payments.methods', rowBefore));
      const hashAfterSame = hashFactValue(factValueForPath('payments.methods', rowBefore));
      const profile = tenantProfileFromRow(rowAfter, {});
      const payLookup = lookup('pay', 'till', { profile, language: 'en', now: new Date('2026-10-19T10:00:00+03:00'), seed: 0 });
      console.log(JSON.stringify({
        noopPaths: noop.confirm.length,
        hashStable: hashBefore === hashAfterSame,
        payStatus: payLookup.status,
        policiesOk: policiesAfter.ok,
      }));
    `,
      { FACT_SAVE_IS_CONFIRM: 'on' }
    );
  });

  it('no-op overview policies save keeps value_hash plan empty under save-is-confirm', () => {
    if (tsSkip) return;
    assert.equal(R.noopPaths, 0);
    assert.equal(R.hashStable, true);
  });

  it('after owner confirms payments, lookup pay is found', () => {
    if (tsSkip) return;
    assert.equal(R.policiesOk, true);
    assert.equal(R.payStatus, 'found');
  });
});
