// Spoken service families for a long catalogue (ported from #609 8831ab03).
// HD_72ab69cbab2b T6 (staging, 2026-10-08 16:01 EAT): the flag-off catalogue
// fallback read sizes ("Mattress cleaning, 1-Bedroom Apartment, 2-Bedroom
// Apartment, and 3-Bedroom House, and more") instead of service types.
// Run: node --test tests/serviceFamilies.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { offerCatalogueLine, catalogueFileNames } = require('../src/conversation/knownFacts');
const { serviceFamilies } = require('../src/conversation/serviceFamilies');
const { catalogueGeminiDirective } = require('../src/speech/catalogueMouth');

const DUSTED = profileFromSnapshot(TENANT);

describe('service families for a long catalogue', () => {
  it('HD_72ab T6: speaks service types, not the first four package rows', () => {
    const en = offerCatalogueLine('And what are the services you offer?', DUSTED, 'en');
    assert.equal(
      en,
      'We offer Apartment and House Cleaning, Deep Cleaning, Office Cleaning, and Mattress cleaning, and more. Which one do you need?'
    );
    assert.doesNotMatch(en, /1-Bedroom|2-Bedroom|3-Bedroom/);
  });

  it('derives families from any file, not this tenant', () => {
    const salon = serviceFamilies([
      { name: 'Haircut' },
      { name: 'Kids haircut' },
      { name: 'Box braids' },
      { name: 'Knotless braids' },
      { name: 'Manicure' },
    ]).map((f) => f.label);
    assert.deepEqual(salon, ['Haircut', 'Braids', 'Manicure']);
    const byCategory = serviceFamilies([
      { name: 'Sofa', category: 'Upholstery' },
      { name: 'Armchair', category: 'Upholstery' },
      { name: 'Rug', category: 'Floors' },
    ]).map((f) => f.label);
    assert.deepEqual(byCategory, ['Upholstery', 'Rug']);
  });

  it('every file row lands in exactly one family', () => {
    const rows = DUSTED.servicesCatalog;
    const families = serviceFamilies(rows);
    const members = families.flatMap((f) => f.members);
    assert.equal(members.length, rows.length);
    assert.equal(new Set(members).size, rows.length);
  });

  it('keeps exact names when the file is short', () => {
    const short = { ...DUSTED, servicesCatalog: DUSTED.servicesCatalog.slice(11, 14) };
    assert.equal(
      offerCatalogueLine('What services do you offer?', short, 'en'),
      'We offer Sofa Cleaning, Carpet Cleaning, and Interior Window Cleaning. Which one do you need?'
    );
    assert.equal(catalogueFileNames(short).families, false);
  });

  it('the Gemini catalogue directive keeps exact file names', () => {
    const directive = catalogueGeminiDirective({ profile: DUSTED });
    assert.match(directive, /1-Bedroom Apartment/);
    assert.doesNotMatch(directive, /Apartment and House Cleaning/);
  });
});
