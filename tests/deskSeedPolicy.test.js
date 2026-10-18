/**
 * Desk compile twin of Brain's seed/instruction policy filter (#751, BRAIN_CALL_FIXES_D199).
 * Esga's warranty and cancellation lines are receptionist instructions, not facts.
 * Run: node --test tests/deskSeedPolicy.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const ESGA_POLICIES = {
  returns: 'Returns and exchanges follow shop policy,confirm details with the team if unsure.',
  delivery: 'Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.',
  warranty:
    ": the receptionist should not handle warranty claims directly. Instead, it should route the caller by giving them the manager's contact number.",
  cancellation:
    "When a customer asks to cancel an order, the receptionist should not confirm the cancellation directly. Instead, it should route the caller by providing the manager's contact number so they can follow up directly.",
  other: 'Open Saturdays until 2pm.',
};

const SAMPLES = [
  ESGA_POLICIES.returns,
  ESGA_POLICIES.delivery,
  ESGA_POLICIES.warranty,
  ESGA_POLICIES.cancellation,
  ESGA_POLICIES.other,
  'Same day Nairobi delivery for stocked items when available, countrywide shipping on request!',
  'Same-day Nairobi delivery for all stocked items when available; countrywide shipping on request.',
  'Delivery within Nakuru town same day, KES 200.',
  'Our assistant will take a message for the manager.',
  'Warranty: 6 months on all printers.',
];

/** Run code against the Desk twin (TypeScript) in a child process. */
function desk(body) {
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--import',
      './tests/registerTs.mjs',
      '--input-type=module',
      '-e',
      `import * as p from './dashboard/src/lib/provenance.ts';\n${body}`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

describe('Desk seed policy filter', () => {
  it('filter off keeps Esga instructions (matches Brain flag off); on drops them as unknown', () => {
    const out = desk(`
const pol = ${JSON.stringify(ESGA_POLICIES)};
const off = p.factPolicyMap(pol, null);
const on = p.factPolicyMap(pol, p.indexFieldMeta(null, { seedFilter: true }));
process.stdout.write(JSON.stringify({ off, on }));`);
    assert.ok(out.off.policies.warranty);
    assert.ok(out.off.policies.cancellation);
    assert.equal(out.on.policies.warranty, undefined);
    assert.equal(out.on.policies.cancellation, undefined);
    assert.ok(out.on.unknown.includes('Warranty'));
    assert.ok(out.on.unknown.includes('Cancellation'));
    assert.ok(out.on.policies.other, 'owner text stays');
  });

  it('near-duplicate starter text is seed only with the filter on', () => {
    const out = desk(`
const near = 'Same day Nairobi delivery for stocked items when available, countrywide shipping on request!';
const edited = 'Same-day Nairobi delivery for all stocked items when available; countrywide shipping on request.';
process.stdout.write(JSON.stringify({
  nearOff: p.isSeedPolicyText(near),
  editedOff: p.isSeedPolicyText(edited),
  editedOn: p.isSeedPolicyText(edited, { seedFilter: true }),
  ownerOn: p.isSeedPolicyText('Delivery within Nakuru town same day, KES 200.', { seedFilter: true }),
}));`);
    assert.deepEqual(out, { nearOff: true, editedOff: false, editedOn: true, ownerOn: false });
  });

  it('an owner meta row still wins over the filter', () => {
    const out = desk(`
const meta = p.indexFieldMeta([{ field_path: 'policies.warranty', source: 'owner' }], { seedFilter: true });
process.stdout.write(JSON.stringify(p.factPolicyMap(${JSON.stringify(ESGA_POLICIES)}, meta)));`);
    assert.ok(out.policies.warranty);
  });

  it('Settings starter text: unmarked exact starter shows (Esga delivery); owner text does not (D&D)', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types', '--no-warnings', '--import', './tests/registerTs.mjs', '--input-type=module', '-e',
        `import { seedStarterPolicies, normalizeBusinessPolicies } from './dashboard/src/lib/businessPolicies.ts';
const esga = normalizeBusinessPolicies(${JSON.stringify(ESGA_POLICIES)});
const dnd = normalizeBusinessPolicies({ payment: 'M-Pesa till 123. Deposit for deep cleans.', provenance: { payment: { source: 'owner', confirmed: true } } });
const marked = normalizeBusinessPolicies({ returns: 'Our own words', provenance: { returns: { source: 'seed' } } });
process.stdout.write(JSON.stringify({ esga: seedStarterPolicies(esga).map((r) => r.key), dnd: seedStarterPolicies(dnd).length, marked: seedStarterPolicies(marked).map((r) => r.key) }));`,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(child.status, 0, child.stderr);
    const out = JSON.parse(child.stdout);
    assert.deepEqual(out.esga.sort(), ['delivery', 'returns']);
    assert.equal(out.dnd, 0);
    assert.deepEqual(out.marked, ['returns']);
  });

  it('matches Brain line for line when Brain has the filter (#751)', (t) => {
    const brain = require('../src/conversation/provenance');
    if (typeof brain.isSeedPolicyText !== 'function') {
      t.skip('Brain filter not on this base yet (#751 unmerged)');
      return;
    }
    const prev = process.env.BRAIN_CALL_FIXES_D199;
    const results = {};
    for (const flag of ['off', 'on']) {
      process.env.BRAIN_CALL_FIXES_D199 = flag;
      results[flag] = SAMPLES.map((text) => brain.isSeedPolicyText(text));
    }
    if (prev === undefined) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
    const out = desk(`
const samples = ${JSON.stringify(SAMPLES)};
process.stdout.write(JSON.stringify({
  off: samples.map((s) => p.isSeedPolicyText(s)),
  on: samples.map((s) => p.isSeedPolicyText(s, { seedFilter: true })),
}));`);
    assert.deepEqual(out, results);
  });
});
