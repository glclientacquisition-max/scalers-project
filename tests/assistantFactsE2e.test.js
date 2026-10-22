'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const [major, minor] = process.versions.node.split('.').map(Number);
const tsSkip = major > 22 || (major === 22 && minor >= 6) ? false : `Node ${process.versions.node}`;

function runTs(script, env = {}) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--import', './tests/registerTs.mjs', '--input-type=module', '-e', script],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        FACT_HASH_MODE: 'on',
        FACT_SAVE_IS_CONFIRM: 'on',
        VOICE_AREA_FEES: 'on',
        ...env,
      },
    }
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

describe('assistant facts node e2e', { skip: tsSkip }, () => {
  let R = null;
  before(() => {
    R = runTs(`
      import { createRequire } from 'node:module';
      import { planFactConfirm } from './dashboard/src/lib/factConfirm.ts';
      import { hashFactValue, factValueForPath } from './dashboard/src/lib/factHash.ts';
      const requireRoot = createRequire(import.meta.url);
      const { indexFieldMeta } = requireRoot('./src/conversation/provenance.js');
      const { lookup, speechOf } = requireRoot('./src/knowledge/lookup.js');
      const { tenantProfileFromRow } = requireRoot('./src/tenantProfile.js');

      const baseRow = {
        business_name: 'Chapter One',
        hours_schedule: {
          timezone: 'Africa/Nairobi',
          days: {
            mon: { open: '08:00', close: '18:00' },
            tue: { open: '08:00', close: '18:00' },
            wed: { open: '08:00', close: '18:00' },
            thu: { open: '08:00', close: '18:00' },
            fri: { open: '08:00', close: '18:00' },
            sat: null,
            sun: null,
          },
        },
        services_catalog: [{
          id: 'svc_a',
          name: 'A4 print',
          price: '20',
          price_range: 'KSh 20',
          pricing_mode: 'fixed',
          source: 'owner',
        }],
        service_areas: {
          version: 1,
          areas: [{
            id: 'place:kilimani',
            modes: ['delivery'],
            fee_mode: 'fixed',
            fee_ksh: 200,
            source: 'owner',
            confirmed: true,
          }],
          delivered_by: ['self'],
          rider_paid: null,
          reach: 'deliver',
          no_premises: false,
          anywhere_kenya: false,
          outside_fee_ksh: null,
        },
        business_policies: {
          payments: {
            version: 2,
            methods: ['mpesa_till'],
            mpesa_till: '123456',
            timings: ['on_delivery'],
            source: 'owner',
          },
        },
      };

      function saveScope(scope, row) {
        return planFactConfirm({
          scope,
          before: baseRow,
          after: row,
          explicitPaths: scope === 'hours' ? ['hours.weekly_grid'] : undefined,
          saveIsConfirm: true,
        });
      }

      const hoursSave = saveScope('hours', baseRow);
      const priceSave = saveScope('catalog', baseRow);
      const locSave = saveScope('locations', baseRow);
      const paySave = saveScope('policies', baseRow);

      const { catalogRowFactValue } = requireRoot('./src/conversation/factHash.js');

      function metaRows(entries) {
        const rows = entries.map(({ field_path, value }) => ({
          field_path,
          source: 'owner',
          value_hash: hashFactValue(value),
        }));
        return indexFieldMeta(rows, { hashMode: true });
      }

      const hoursMeta = metaRows([
        { field_path: 'hours.weekly_grid', value: factValueForPath('hours.weekly_grid', baseRow) },
      ]);
      const svc = baseRow.services_catalog[0];
      const priceMeta = metaRows([
        { field_path: 'catalog.service.svc_a.name', value: catalogRowFactValue(svc) },
      ]);
      const feeMeta = metaRows([
        {
          field_path: 'service_areas.place:kilimani',
          value: factValueForPath('service_areas.place:kilimani', baseRow),
        },
      ]);
      const payMeta = metaRows([
        { field_path: 'payments.methods', value: factValueForPath('payments.methods', baseRow) },
      ]);

      const now = new Date('2026-10-19T10:00:00.000Z');
      const ctx = (profile) => ({ profile, language: 'en', now, seed: 0 });

      const hoursProfile = tenantProfileFromRow(baseRow, { fieldMeta: hoursMeta });
      const priceProfile = tenantProfileFromRow(baseRow, { fieldMeta: priceMeta });
      const feeProfile = tenantProfileFromRow(baseRow, { fieldMeta: feeMeta });
      const payProfile = tenantProfileFromRow(baseRow, { fieldMeta: payMeta });

      const hours = lookup('hours', 'What are your opening hours?', ctx(hoursProfile));
      const price = lookup('price', 'How much is A4 print?', ctx(priceProfile));
      const fee = lookup('fee', 'delivery to Kilimani', ctx(feeProfile));
      const pay = lookup('pay', 'till number', ctx(payProfile));

      const noop = planFactConfirm({
        scope: 'hours',
        before: baseRow,
        after: baseRow,
        explicitPaths: ['hours.weekly_grid'],
        saveIsConfirm: true,
      });
      const hashBefore = hoursMeta.byPath['hours.weekly_grid']?.value_hash;
      const hashAfter = hashFactValue(factValueForPath('hours.weekly_grid', baseRow));

      console.log(JSON.stringify({
        hours: { status: hours.status, speech: speechOf(hours, 'en') },
        price: { status: price.status, speech: speechOf(price, 'en') },
        fee: { status: fee.status, speech: speechOf(fee, 'en') },
        pay: { status: pay.status, speech: speechOf(pay, 'en') },
        noop,
        hashStable: hashBefore === hashAfter,
      }));
    `);
  });

  it('hours save → meta → profile → lookup found', () => {
    assert.equal(R.hours.status, 'found');
    assert.match(R.hours.speech, /Monday/i);
  });

  it('price save → lookup found', () => {
    assert.equal(R.price.status, 'found');
    assert.match(R.price.speech, /twenty shillings/i);
  });

  it('fee save → lookup found', () => {
    assert.equal(R.fee.status, 'found');
    assert.match(R.fee.speech, /two hundred/i);
  });

  it('pay save → lookup found', () => {
    assert.equal(R.pay.status, 'found');
    assert.match(R.pay.speech, /one two three four five six/i);
  });

  it('unchanged save keeps value_hash', () => {
    assert.deepEqual(R.noop.confirm, []);
    assert.equal(R.hashStable, true);
  });
});
