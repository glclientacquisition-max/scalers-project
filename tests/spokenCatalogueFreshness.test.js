'use strict';
// A stale stored spoken catalogue never speaks a removed or changed price.
const test = require('node:test');
const assert = require('node:assert');
const SC = require('../src/knowledge/spokenCatalogue');
const T = require('../src/conversation/v2/topic');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

function staleProfile() {
  const old = SC.compileSync(DD);
  const rows = JSON.parse(JSON.stringify(DD.servicesCatalog));
  const target = rows.find((r) => r.price_range); target.price_range = ''; target.pricing = null; // owner removed the price
  return { profile: { ...DD, servicesCatalog: rows, spokenCatalogue: old }, target };
}
const withEnv = (k, v, fn) => { const o = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; try { return fn(); } finally { if (o === undefined) delete process.env[k]; else process.env[k] = o; } };

test('topic pinDoc fallback uses the freshness-checked lookup', () => {
  const { profile, target } = staleProfile();
  withEnv('SPOKEN_CATALOGUE_STORED_FIRST', null, () => {
    const doc = T.pinDoc({}, { ...profile });
    const e = SC.entryForRaw(doc, target.name);
    assert.ok(e, 'entry present');
    assert.ok(!e.raw.price && !(e.price?.numbers || []).length, 'removed price is not spoken');
  });
});

test('stored-first + stale: changed entries are refreshed, unchanged owner edits are kept', () => {
  const { profile, target } = staleProfile();
  const other = profile.spokenCatalogue.entries.find((e) => e.raw.name !== target.name);
  other.spoken = { en: 'owner name', sw: 'jina la mwenye' }; other.edited = true;
  withEnv('SPOKEN_CATALOGUE_STORED_FIRST', '1', () => {
    const m = SC.resolveSpokenCatalogueMeta(profile);
    assert.equal(m.stale, true);
    assert.equal(m.refreshed, true);
    assert.ok(!SC.entryForRaw(m.doc, target.name).raw.price);
    assert.equal(SC.entryForRaw(m.doc, other.raw.name).spoken.en, 'owner name');
  });
});

test('stored-first + fresh doc is returned unchanged', () => {
  const doc = SC.compileSync(DD);
  withEnv('SPOKEN_CATALOGUE_STORED_FIRST', '1', () => {
    const m = SC.resolveSpokenCatalogueMeta({ ...DD, spokenCatalogue: doc });
    assert.equal(m.doc, doc); assert.equal(m.stale, false);
  });
});
