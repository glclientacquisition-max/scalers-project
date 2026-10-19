'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('previewDeskLookupAction uses the same lookup() as voice', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--import',
      './tests/registerTs.mjs',
      '--input-type=module',
      '-e',
      `
        import { createRequire } from 'node:module';
        const requireRoot = createRequire(import.meta.url);
        const { lookup, speechOf } = requireRoot('./src/knowledge/lookup.js');
        const { tenantProfileFromRow } = requireRoot('./src/tenantProfile.js');
        const { profiles } = requireRoot('./evals/replay/profiles.js');
        const profile = tenantProfileFromRow({
          id: 't',
          business_name: profiles().carry.businessName,
          services_catalog: profiles().carry.servicesCatalog,
          hours_schedule: profiles().carry.hoursSchedule,
          service_areas: profiles().carry.service_areas,
          business_policies: {},
        });
        const result = lookup('price', 'How much is sofa cleaning?', { profile, language: 'en', now: new Date('2026-10-19T05:00:00.000Z'), seed: 0 });
        console.log(JSON.stringify({ status: result.status, speech: speechOf(result, 'en') }));
      `,
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const out = JSON.parse(child.stdout);
  assert.equal(out.status, 'found');
  assert.match(out.speech, /sofa/i);
});
