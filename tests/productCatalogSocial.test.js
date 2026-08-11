const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeProducts,
  formatProductsBlock,
} = require('../src/conversation/productCatalog');
const {
  normalizeSocialHandles,
  formatSocialHandlesBlock,
  socialHandlesHaveContent,
} = require('../src/conversation/socialHandles');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');

describe('product catalogue + social handles', () => {
  it('normalizes product rows with stock and aliases', () => {
    const rows = normalizeProducts([
      {
        name: 'Atomic Habits',
        price: '2500 KES',
        in_stock: 'yes',
        aliases: 'Atomic habit, Clear',
        category: 'Self-help',
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].in_stock, 'yes');
    assert.deepEqual(rows[0].aliases, ['Atomic habit', 'Clear']);
    assert.match(formatProductsBlock(rows), /Atomic Habits/);
  });

  it('formats social handles for ground truth', () => {
    const social = normalizeSocialHandles({
      instagram: '@bookstorechapterone',
      website: 'https://chapteronebookstore.co.ke',
    });
    assert.equal(socialHandlesHaveContent(social), true);
    const block = formatSocialHandlesBlock(social);
    assert.match(block, /Instagram/);
    assert.match(block, /@bookstorechapterone/);
  });

  it('injects PRODUCT CATALOGUE and SOCIAL separately from services', () => {
    const text = buildLiveGroundTruth({
      vertical: 'retail',
      servicesCatalog: [
        { name: 'Book sourcing / special orders', notes: 'Free quote' },
      ],
      productCatalog: [
        { name: 'Atomic Habits', price: '2500 KES', in_stock: 'yes' },
      ],
      socialHandles: { instagram: '@bookstorechapterone' },
      faqs: [],
      teamDirectory: [],
      businessLocations: [],
      businessPolicies: {},
      agentTools: { escalate: true, end_call: true },
    });
    assert.match(text, /SERVICES \(what you offer/);
    assert.match(text, /PRODUCT CATALOGUE/);
    assert.match(text, /Atomic Habits/);
    assert.match(text, /SOCIAL & WEB/);
    assert.match(text, /@bookstorechapterone/);
    assert.doesNotMatch(text, /SERVICES CATALOG:/);
  });
});
