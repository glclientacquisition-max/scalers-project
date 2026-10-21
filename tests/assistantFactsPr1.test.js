// PR1: service_areas attest paths, payments v2 hash, save-is-confirm no-op guard.

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

describe('assistant facts PR1', () => {
  let R = null;

  before(() => {
    if (tsSkip) return;
    R = runTs(`
      import { fieldPathsAttestedOnSettingsSave } from './dashboard/src/lib/fieldPathsFromSettingsSave.ts';
      import { planFactConfirm } from './dashboard/src/lib/factConfirm.ts';
      import { hashFactValue, factValueForPath } from './dashboard/src/lib/factHash.ts';
      import { paymentsFactHashValue } from './dashboard/src/lib/payments.ts';
      const row = {
        business_name: 'Demo Shop',
        hours_schedule: { mon: { open: '08:00', close: '17:00' } },
        service_areas: {
          version: 1,
          areas: [{ id: 'place:kilimani', modes: ['delivery'], fee_mode: 'fixed', fee_ksh: 200, source: 'owner', confirmed: true }],
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
            confirmed: true,
          },
        },
      };
      const pathsOff = fieldPathsAttestedOnSettingsSave({
        scope: 'locations',
        businessLocationsCount: 1,
        serviceAreas: row.service_areas,
      });
      process.env.DESK_ATTEST_SERVICE_AREAS = 'on';
      const pathsOn = fieldPathsAttestedOnSettingsSave({
        scope: 'locations',
        businessLocationsCount: 1,
        serviceAreas: row.service_areas,
      });
      process.env.FACT_PAYMENTS_V2_HASH = 'on';
      const { factValueForPath: fv } = await import('./dashboard/src/lib/factHash.ts');
      const payHash = hashFactValue(fv('payments.methods', row));
      const noop = planFactConfirm({
        scope: 'hours',
        before: row,
        after: row,
        explicitPaths: ['hours.weekly_grid'],
        saveIsConfirm: true,
      });
      console.log(JSON.stringify({
        pathsOff,
        pathsOn,
        payHashLen: payHash.length,
        noopConfirm: noop.confirm.length,
        paymentsBody: paymentsFactHashValue(row.business_policies.payments),
      }));
    `);
  });

  it('attests service_areas paths only when DESK_ATTEST_SERVICE_AREAS=on', () => {
    if (tsSkip) return;
    assert.ok(!R.pathsOff.includes('service_areas.place:kilimani'));
    assert.ok(R.pathsOn.includes('service_areas.place:kilimani'));
    assert.ok(R.pathsOn.includes('policies.coverage_areas'));
  });

  it('payments v2 hash uses structured payments object', () => {
    if (tsSkip) return;
    assert.equal(R.payHashLen, 64);
    assert.deepEqual(R.paymentsBody?.methods, ['mpesa_till']);
  });

  it('save-is-confirm skips explicit confirm on no-op save', () => {
    if (tsSkip) return;
    assert.equal(R.noopConfirm, 0);
  });
});
