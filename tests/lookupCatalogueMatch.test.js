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
