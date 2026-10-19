'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

const requireRoot = createRequire(path.join(__dirname, '..', 'package.json'));
const { lookup, speechOf } = requireRoot('./src/knowledge/lookup.js');
const { tenantProfileFromRow } = requireRoot('./src/tenantProfile.js');

const NOW = new Date('2026-10-19T05:00:00.000Z');

function jiraniProfile() {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/tenants/jirani-staging.json'), 'utf8')
  );
  return tenantProfileFromRow(fixture.tenant, { fieldMeta: { hashMode: false }, holdGate: {} });
}

function price(query, profile) {
  const result = lookup('price', query, { profile, language: 'en', now: NOW, seed: 0 });
  return { result, speech: speechOf(result, 'en') };
}

describe('catalogue price matching (Jirani deep clean bedrooms)', () => {
  const profile = jiraniProfile();

  it('exact catalogue name resolves found, not ambiguous', () => {
    const hit = price('How much is Deep clean, 1 bedroom?', profile);
    assert.equal(hit.result.status, 'found');
    assert.match(hit.speech, /6,?500|six thousand five hundred/i);
  });

  it('same name without comma still resolves', () => {
    const hit = price('How much is Deep clean 1 bedroom?', profile);
    assert.equal(hit.result.status, 'found');
    assert.match(hit.speech, /1 bedroom|6,?500|six thousand five hundred/i);
  });

  it('spoken qualifier disambiguates siblings', () => {
    const hit = price('How much is one bedroom deep clean?', profile);
    assert.equal(hit.result.status, 'found');
    assert.match(hit.speech, /6,?500|six thousand five hundred/i);
  });

  it('Swahili bedroom number disambiguates', () => {
    const hit = price('Bei ya deep clean bedroom moja?', profile);
    assert.equal(hit.result.status, 'found');
    assert.match(hit.speech, /6,?500|six thousand five hundred/i);
  });

  it('generic deep clean stays ambiguous', () => {
    const hit = price('How much is deep clean?', profile);
    assert.equal(hit.result.status, 'ambiguous');
    assert.match(hit.speech, /Which one/i);
    assert.match(hit.speech, /1 bedroom/);
    assert.match(hit.speech, /2 bedroom/);
  });
});

describe('catalogue price matching: no false positives (Jirani siblings)', () => {
  const profile = jiraniProfile();
  const sw = (query) => {
    const result = lookup('price', query, { profile, language: 'sw', now: NOW, seed: 0 });
    return { result, speech: speechOf(result, 'sw') };
  };

  it('tier word picks the right sibling: standard 2 bedroom is not deep 2 bedroom', () => {
    const hit = price('two bedroom standard clean', profile);
    assert.equal(hit.result.status, 'found');
    assert.match(hit.speech, /Standard clean, 2 bedroom/);
    assert.match(hit.speech, /4,?500|four thousand five hundred/i);
  });

  it('a size the tenant does not list is never quoted from another size', () => {
    for (const q of ['How much is Standard clean, 3 bedroom?', 'How much is Deep clean, 4 bedroom?', 'four bedroom deep clean']) {
      const hit = price(q, profile);
      assert.notEqual(hit.result.status, 'found', q);
      assert.doesNotMatch(hit.speech, /shillings/i, q);
    }
  });

  it('2 bedroom never resolves to 1 bedroom; with two 2-bedroom rows it asks which', () => {
    const hit = price('how much is 2 bedroom', profile);
    assert.equal(hit.result.status, 'ambiguous');
    assert.deepEqual([...hit.result.options].sort(), ['Deep clean, 2 bedroom', 'Standard clean, 2 bedroom']);
    assert.doesNotMatch(hit.speech, /1 bedroom/);
  });

  it('Swahili number word with tier word resolves the sibling', () => {
    const hit = sw('Bei ya deep clean vyumba mbili?');
    assert.equal(hit.result.status, 'found');
    assert.match(hit.speech, /Deep clean, 2 bedroom/);
  });

  it('two items named in one question still asks which one', () => {
    const hit = price('How much is sofa cleaning and carpet cleaning?', profile);
    assert.equal(hit.result.status, 'ambiguous');
  });
});

describe('catalogue price matching (products)', () => {
  it('product rows use the same qualifier-aware matcher', () => {
    const profile = tenantProfileFromRow(
      {
        business_name: 'Gadget Shop',
        services_catalog: [],
        product_catalog: [
          { name: 'Fast charger 20W', price_range: '650', source: 'owner', confirmed: true },
          { name: 'Fast charger 30W', price_range: '850', source: 'owner', confirmed: true },
        ],
      },
      {}
    );
    const exact = price('How much is Fast charger 20W?', profile);
    assert.equal(exact.result.status, 'found');
    assert.match(exact.speech, /650|six hundred fifty/i);

    const vague = price('How much is fast charger?', profile);
    assert.equal(vague.result.status, 'ambiguous');
  });
});
