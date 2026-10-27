// SPOKEN_CATALOGUE_STORED_FIRST: hash parity across writers/readers, stored-first
// call path, degraded compile with no doc, and flag-off parity with old behaviour.
const test = require('node:test');
const assert = require('node:assert');
const SC = require('../src/knowledge/spokenCatalogue');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { profileFromRow } = require('../src/knowledge/spokenCatalogueOnSave');

// Done-and-Dusted-shaped row: 6 service areas + 1 location (areas drive the hash).
const row = {
  id: 'df4ad9d8-28ff-4810-b1e6-94f5495472b0', business_name: 'Done and Dusted',
  services_catalog: [
    { id: 's1', name: '2-Bedroom Deep Clean', category: 'house', price_range: 'KES 6,000', pricing: { unit: 'job', confirmed: true } },
    { id: 's2', name: 'Sofa Cleaning (per seat)', category: 'upholstery', price: 'KES 800' },
  ],
  product_catalog: [],
  service_areas: { areas: [{ id: 'place:kilimani' }, { id: 'place:lavington' }, { id: 'place:westlands' }, { id: 'place:kileleshwa' }, { id: 'county:nairobi' }, { id: 'place:karen', name: 'Karen' }] },
  business_locations: [{ name: 'HQ', area: 'Kilimani' }],
};
const withFlag = (v, fn) => { const o = process.env.SPOKEN_CATALOGUE_STORED_FIRST; if (v == null) delete process.env.SPOKEN_CATALOGUE_STORED_FIRST; else process.env.SPOKEN_CATALOGUE_STORED_FIRST = v; try { return fn(); } finally { if (o == null) delete process.env.SPOKEN_CATALOGUE_STORED_FIRST; else process.env.SPOKEN_CATALOGUE_STORED_FIRST = o; } };

test('one mapping and column list for backfill and on-save', () => {
  assert.deepStrictEqual(profileFromRow(row), SC.catalogueProfileFromRow(row));
  for (const c of ['services_catalog', 'product_catalog', 'service_areas', 'business_locations', 'spoken_catalogue']) assert.ok(SC.CATALOGUE_COLS.includes(c));
});

test('hash parity: call profile == backfill (flag on)', () => withFlag('1', () => {
  const backfill = SC.sourceHash(SC.catalogueProfileFromRow(row));
  const call = tenantProfileFromRow(row);
  assert.deepStrictEqual(call.serviceAreas, row.service_areas);
  assert.strictEqual(SC.sourceHash(call), backfill);
}));

test('flag off: call profile unchanged (no serviceAreas, old divergent hash)', () => withFlag(null, () => {
  const call = tenantProfileFromRow(row);
  assert.strictEqual('serviceAreas' in call, false);
  assert.notStrictEqual(SC.sourceHash(call), SC.sourceHash(SC.catalogueProfileFromRow(row)));
}));

test('stored-first: stored doc returned even on hash mismatch, traced stale', () => withFlag('1', () => {
  const stored = SC.compileSync(SC.catalogueProfileFromRow(row)); stored.version = 1;
  const drifted = { ...SC.catalogueProfileFromRow(row), serviceAreas: null, spokenCatalogue: stored };
  const m = SC.resolveSpokenCatalogueMeta(drifted);
  assert.strictEqual(m.doc, stored); assert.strictEqual(m.stale, true); assert.strictEqual(m.degraded, false);
  const fresh = SC.resolveSpokenCatalogueMeta({ ...SC.catalogueProfileFromRow(row), spokenCatalogue: stored });
  assert.strictEqual(fresh.doc, stored); assert.strictEqual(fresh.stale, false);
}));

test('stored-first: no doc -> compileSync v0, traced degraded', () => withFlag('1', () => {
  const m = SC.resolveSpokenCatalogueMeta(SC.catalogueProfileFromRow(row));
  assert.strictEqual(m.degraded, true); assert.strictEqual(m.doc.version, 0); assert.ok(m.doc.entries.length >= 2);
}));

test('flag off: mismatch still recompiles v0 (current behaviour)', () => withFlag(null, () => {
  const stored = SC.compileSync(SC.catalogueProfileFromRow(row)); stored.version = 1;
  const drifted = { ...SC.catalogueProfileFromRow(row), serviceAreas: null, spokenCatalogue: stored };
  const m = SC.resolveSpokenCatalogueMeta(drifted);
  assert.notStrictEqual(m.doc, stored); assert.strictEqual(m.doc.version, 0); assert.strictEqual(m.stale, false); assert.strictEqual(m.degraded, false);
  assert.strictEqual(SC.resolveSpokenCatalogue(drifted).version, 0);
  const ok = { ...SC.catalogueProfileFromRow(row), spokenCatalogue: stored };
  assert.strictEqual(SC.resolveSpokenCatalogue(ok), stored);
}));
