// Fact-confirm PR 1: changed-only owner confirm on Settings save (FACT_HASH_MODE),
// stable service ids, the widened field path registry, and the flag-off P0 path.
// The Desk TS runs under node --experimental-strip-types (Node >= 22.6, as CI).

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { hashFactValue, factValueForPath } = require('../src/conversation/factHash');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const VECTORS = JSON.parse(read('tests/fixtures/factHashVectors.json')).vectors;

const [major, minor] = process.versions.node.split('.').map(Number);
const CAN_STRIP_TYPES = major > 22 || (major === 22 && minor >= 6);
const tsSkip = CAN_STRIP_TYPES ? false : `Node ${process.versions.node} has no --experimental-strip-types`;

function runTs(script) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--import', './tests/registerTs.mjs', '--input-type=module', '-e', script],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FACT_HASH_MODE: '' } }
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

const SEED_ROW = {
  business_name: 'Done and Dusted',
  vertical: 'home_services',
  agent_name: 'Wanjiru',
  hours_schedule: { mon: { open: '08:00', close: '17:00' } },
  business_locations: [{ name: 'Kilimani' }],
  business_policies: { payment: 'M-Pesa till 123456', returns: 'No returns', coverage_areas: ['Kilimani', 'Lavington'] },
  services_catalog: [
    { id: 'svc_aaaaaaaaaaaaaaaa', name: 'Sofa clean', price_range: 'KES 2,500' },
    { id: 'svc_bbbbbbbbbbbbbbbb', name: 'Carpet clean', price_range: 'KES 1,500' },
    { id: 'svc_cccccccccccccccc', name: 'Deep clean', site_visit_required: true },
  ],
  product_catalog: [],
  faqs: [{ question: 'Do you work Sundays?', answer: 'No' }],
};

let R = null;

before(() => {
  if (tsSkip) return;
  const seed = JSON.stringify(SEED_ROW);
  const vectors = JSON.stringify(VECTORS.map((v) => ({ input: v.input, sha256: v.sha256, name: v.name })));
  R = runTs(`
    import { planFactConfirm, overlayFieldMeta, validConfirmBatch, isEmptyFactValue, scopeFactPaths } from './dashboard/src/lib/factConfirm.ts';
    import { assignServiceIds, newServiceId } from './dashboard/src/lib/serviceIds.ts';
    import { isKnownFieldPath, cleanFieldPaths } from './dashboard/src/lib/fieldPathRegistry.ts';
    import { hashFactValue, factValueForPath } from './dashboard/src/lib/factHash.ts';
    import { indexFieldMeta, classifyRecord, factServices } from './dashboard/src/lib/provenance.ts';
    import { catalogRowFactValue } from './dashboard/src/lib/factHash.ts';

    const seed = ${seed};
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const out = {};

    out.vectors = ${vectors}.map((v) => ({ name: v.name, ok: hashFactValue(v.input) === v.sha256 }));

    // Unchanged policies save: nothing confirmed, seed stays seed.
    out.unchanged = planFactConfirm({ scope: 'policies', before: seed, after: clone(seed) });

    // Whitespace-only edit is not a change.
    const ws = clone(seed); ws.business_policies.payment = '  M-Pesa   till 123456 ';
    out.whitespace = planFactConfirm({ scope: 'policies', before: seed, after: ws });

    // Edited field becomes owner with the saved value's hash; neighbours untouched.
    const edited = clone(seed); edited.business_policies.returns = 'Exchanges within 7 days';
    out.edited = planFactConfirm({ scope: 'policies', before: seed, after: edited });
    out.editedHash = hashFactValue(factValueForPath('policies.returns', edited));

    // Cleared field reopens.
    const cleared = clone(seed); cleared.business_policies.returns = '';
    out.cleared = planFactConfirm({ scope: 'policies', before: seed, after: cleared });

    // Explicit "Looks right" with no change confirms the current value.
    out.looksRight = planFactConfirm({ scope: 'policies', before: seed, after: clone(seed), explicitPaths: ['policies.payment', 'policies.warranty'] });
    out.paymentHash = hashFactValue(factValueForPath('policies.payment', seed));

    // Scope: an Hours save never confirms catalogue or policies.
    const hours = clone(seed); hours.hours_schedule = { mon: { open: '09:00', close: '17:00' } }; hours.business_policies.returns = 'changed elsewhere';
    out.hoursScope = planFactConfirm({ scope: 'hours', before: seed, after: hours });

    // Catalogue: price edit on one service confirms only that row.
    const price = clone(seed); price.services_catalog[1].price_range = 'KES 1,800';
    out.price = planFactConfirm({ scope: 'catalog', before: seed, after: price });

    // Reorder with ids: nothing changes, nothing confirmed.
    const reordered = clone(seed); reordered.services_catalog.reverse();
    out.reorder = planFactConfirm({ scope: 'catalog', before: seed, after: reordered });

    // Delete with positional products: neighbours that only moved are not confirmed.
    const prodBefore = clone(seed); prodBefore.product_catalog = [{ name: 'A', price: '1' }, { name: 'B', price: '2' }, { name: 'C', price: '3' }];
    const prodAfter = clone(prodBefore); prodAfter.product_catalog.splice(0, 1);
    out.deleteMove = planFactConfirm({ scope: 'catalog', before: prodBefore, after: prodAfter });

    // A service that only gained its stable id is not "new".
    const noIds = clone(seed); noIds.services_catalog = noIds.services_catalog.map(({ id, ...rest }) => rest);
    const withIds = clone(noIds); withIds.services_catalog = assignServiceIds(withIds.services_catalog, noIds.services_catalog);
    out.gainedId = planFactConfirm({ scope: 'catalog', before: noIds, after: withIds });

    // Service ids survive reordering and edits; new rows and forged ids get fresh ones.
    const stored = seed.services_catalog;
    const submitted = [clone(stored[2]), { ...clone(stored[0]), name: 'Sofa clean (3 seater)' }, { name: 'Window clean' }, { id: 'svc_forgedforgedfo', name: 'Forged' }, { id: 'svc_aaaaaaaaaaaaaaaa', name: 'Dup' }];
    out.ids = assignServiceIds(submitted, stored).map((r) => r.id);
    out.freshId = newServiceId();

    // Registry.
    out.registry = Object.fromEntries([
      'catalog.service.svc_aaaaaaaaaaaaaaaa.name',
      'catalog.service.3f2b1c9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f.name',
      'catalog.service.4.name',
      'catalog.service.svc_x.price',
      'catalog.service.svc_x.site_visit',
      'catalog.product.SKU-1.price',
      'catalog.product.2.name',
      'policies.coverage_areas',
      'policies.holds',
      'hours.weekly_grid',
      'locations.branches',
      'catalog.service.svc x.name',
      'catalog.service.svc_x.notes',
      'catalog.service..name',
    ].map((p) => [p, isKnownFieldPath(p)]));
    out.cleanCap = cleanFieldPaths(Array.from({ length: 100 }, (_, i) => 'faqs.' + (i + 1))).length;

    // Import reopens a confirmed fact (hash mode readers).
    const confirmedHash = hashFactValue(catalogRowFactValue(seed.services_catalog[0]));
    const metaRows = [{ field_path: 'catalog.service.svc_aaaaaaaaaaaaaaaa.name', source: 'owner', value_hash: confirmedHash }];
    const imported = clone(seed.services_catalog); imported[0] = { ...imported[0], price_range: 'KES 3,000', source: 'import' };
    out.importBefore = factServices(seed.services_catalog, indexFieldMeta(metaRows, { hashMode: true })).map((r) => r.name);
    out.importAfter = factServices(imported, indexFieldMeta(metaRows, { hashMode: true })).map((r) => r.name);
    // Meta row tagged import (no owner) is not confirmed either, even with a matching hash.
    out.importTagged = factServices(seed.services_catalog, indexFieldMeta([{ ...metaRows[0], source: 'import' }], { hashMode: true })).map((r) => r.name);

    // Flag off = P0: an owner meta row without a hash is still fact; hash mode: it is not.
    const p0Rows = [{ field_path: 'catalog.service.svc_aaaaaaaaaaaaaaaa.name', source: 'owner' }];
    out.p0Off = factServices(seed.services_catalog, indexFieldMeta(p0Rows, { hashMode: false })).map((r) => r.name);
    out.p0On = factServices(seed.services_catalog, indexFieldMeta(p0Rows, { hashMode: true })).map((r) => r.name);

    // Compile overlay: the pending confirm is visible to the compile.
    const plan = planFactConfirm({ scope: 'catalog', before: seed, after: price });
    const overlaid = overlayFieldMeta(indexFieldMeta([], { hashMode: true }), plan);
    out.overlay = factServices(price.services_catalog, overlaid).map((r) => r.name);

    out.valid = validConfirmBatch(out.edited);
    out.invalid = [
      validConfirmBatch({ confirm: [{ path: 'a', hash: 'x' }], reopen: [] }),
      validConfirmBatch({ confirm: [{ path: 'a', hash: '${'a'.repeat(64)}' }, { path: 'a', hash: '${'b'.repeat(64)}' }], reopen: [] }),
      validConfirmBatch({ confirm: Array.from({ length: 501 }, (_, i) => ({ path: 'faqs.' + i, hash: '${'a'.repeat(64)}' })), reopen: [] }),
    ];
    out.empty = [isEmptyFactValue('  '), isEmptyFactValue([]), isEmptyFactValue({}), isEmptyFactValue({ price: '1' }, 'catalog.product.1.name'), isEmptyFactValue({ question: 'q', answer: '' }, 'faqs.1'), isEmptyFactValue('x')];
    out.allScope = scopeFactPaths('', seed).length > scopeFactPaths('policies', seed).length;

    console.log(JSON.stringify(out));
  `);
});

describe('changed-only confirm (FACT_HASH_MODE on)', { skip: tsSkip }, () => {
  it('shared hash vectors pass in TS too', () => {
    assert.ok(R.vectors.length >= 30);
    for (const v of R.vectors) assert.ok(v.ok, v.name);
  });

  it('an unchanged field stays seed (nothing confirmed)', () => {
    assert.deepEqual(R.unchanged, { confirm: [], reopen: [] });
  });

  it('a whitespace-only edit is not a change', () => {
    assert.deepEqual(R.whitespace, { confirm: [], reopen: [] });
  });

  it('an edited field becomes owner with the saved value hash, and only that field', () => {
    assert.deepEqual(R.edited.confirm, [{ path: 'policies.returns', hash: R.editedHash }]);
    assert.deepEqual(R.edited.reopen, []);
  });

  it('a field cleared to empty reopens', () => {
    assert.deepEqual(R.cleared, { confirm: [], reopen: ['policies.returns'] });
  });

  it('"Looks right" with no change confirms the current value; empty values are skipped', () => {
    assert.deepEqual(R.looksRight.confirm, [{ path: 'policies.payment', hash: R.paymentHash }]);
  });

  it('a scoped save only looks at its own section', () => {
    assert.deepEqual(R.hoursScope.confirm.map((r) => r.path), ['hours.weekly_grid']);
  });

  it('a price edit confirms only that service row', () => {
    assert.deepEqual(R.price.confirm.map((r) => r.path), ['catalog.service.svc_bbbbbbbbbbbbbbbb.name']);
  });

  it('reordering services with ids confirms nothing', () => {
    assert.deepEqual(R.reorder, { confirm: [], reopen: [] });
  });

  it('a delete never confirms neighbours that only moved', () => {
    assert.deepEqual(R.deleteMove.confirm, []);
    assert.deepEqual(R.deleteMove.reopen, ['catalog.product.3.name']);
  });

  it('a service that only gained its stable id is not confirmed', () => {
    assert.deepEqual(R.gainedId.confirm, []);
  });

  it('an import reopens a confirmed fact', () => {
    assert.ok(R.importBefore.includes('Sofa clean'));
    assert.ok(!R.importAfter.includes('Sofa clean'));
    assert.ok(!R.importTagged.includes('Sofa clean'));
  });

  it('the compile sees the pending confirm', () => {
    assert.deepEqual(R.overlay, ['Carpet clean']);
  });

  it('batch validation rejects bad hashes, duplicate paths, and more than 500', () => {
    assert.equal(R.valid, true);
    assert.deepEqual(R.invalid, [false, false, false]);
  });

  it('empty detection', () => {
    assert.deepEqual(R.empty, [true, true, true, true, true, false]);
    assert.equal(R.allScope, true);
  });
});

describe('stable service ids', { skip: tsSkip }, () => {
  it('survive reordering and edits; new, forged, and duplicate ids get fresh ones', () => {
    const [a, b, c, d, e] = R.ids;
    assert.equal(a, 'svc_cccccccccccccccc');
    assert.equal(b, 'svc_aaaaaaaaaaaaaaaa');
    for (const id of [c, d, e]) assert.match(id, /^svc_[0-9a-f]{16}$/);
    assert.notEqual(d, 'svc_forgedforgedfo');
    assert.notEqual(e, 'svc_aaaaaaaaaaaaaaaa');
    assert.equal(new Set(R.ids).size, 5);
    assert.match(R.freshId, /^svc_[0-9a-f]{16}$/);
  });
});

describe('field path registry', { skip: tsSkip }, () => {
  it('accepts stable service ids and the new paths, rejects junk', () => {
    for (const [p, ok] of Object.entries(R.registry)) {
      const expected = !['catalog.service.svc x.name', 'catalog.service.svc_x.notes', 'catalog.service..name'].includes(p);
      assert.equal(ok, expected, p);
    }
    assert.equal(R.cleanCap, 80);
  });
});

describe('flag off = P0', { skip: tsSkip }, () => {
  it('an owner meta row without a hash is fact with the flag off, not with it on', () => {
    assert.ok(R.p0Off.includes('Sofa clean'));
    assert.ok(!R.p0On.includes('Sofa clean'));
  });
});

describe('wiring (static)', () => {
  const actions = read('dashboard/src/app/(desk)/settings/actions.ts');
  const prov = read('dashboard/src/lib/tenantFieldProvenance.ts');

  it('flag is server-only and exactly "on"', () => {
    assert.match(prov, /process\.env\.FACT_HASH_MODE === "on"/);
    const dash = path.join(ROOT, 'dashboard/src');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
    for (const file of walk(dash)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /NEXT_PUBLIC_FACT_HASH_MODE/, file);
    }
  });

  it('settings save: hash mode uses the changed-only batch on the saved row; flag off keeps P0 attest', () => {
    assert.match(actions, /const hashMode = factHashModeFromEnv\(\)/);
    assert.match(actions, /if \(hashMode\) \{[\s\S]*readSavedFactRow[\s\S]*ownerConfirmPlan[\s\S]*\} else \{[\s\S]*ownerAttestFields\(/);
    assert.match(actions, /fieldMeta: compileFieldMeta/);
    assert.match(actions, /assignServiceIds\(pickedServices, storedServices\)/);
  });

  it('the unused stampOwnerFieldPaths action is gone', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'dashboard/src/app/(desk)/settings/provenanceActions.ts')), false);
    const all = spawnSync('git', ['grep', '-l', 'stampOwnerFieldPaths', '--', 'dashboard'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(all.stdout.trim(), '');
  });

  it('JS twin agrees on a saved-row hash', () => {
    const row = { business_policies: { payment: ' M-Pesa  till 123456' } };
    assert.equal(
      hashFactValue(factValueForPath('policies.payment', row)),
      hashFactValue('M-Pesa till 123456')
    );
  });
});
