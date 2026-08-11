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

  it('supports multiple phones and socials with labels', () => {
    const social = normalizeSocialHandles({
      channels: [
        { kind: 'whatsapp', label: 'Main', value: '0740 442 943' },
        { kind: 'phone', label: 'Orders', value: '0111 222 333' },
        { kind: 'instagram', label: 'Instagram', value: '@bookstorechapterone' },
        { kind: 'website', value: 'https://chapteronebookstore.co.ke' },
      ],
    });
    assert.equal(socialHandlesHaveContent(social), true);
    assert.equal(social.channels.length, 4);
    const block = formatSocialHandlesBlock(social);
    assert.match(block, /Phones \/ WhatsApp/);
    assert.match(block, /Main/);
    assert.match(block, /Orders/);
    assert.match(block, /0740 442 943/);
    assert.match(block, /@bookstorechapterone/);
  });

  it('migrates legacy flat social fields including comma-separated phones', () => {
    const social = normalizeSocialHandles({
      whatsapp: '0740 442 943, 0111 000 111',
      instagram: '@bookstorechapterone',
      website: 'https://chapteronebookstore.co.ke',
    });
    assert.equal(social.channels.filter((c) => c.kind === 'whatsapp').length, 2);
    assert.equal(
      social.channels.some((c) => c.kind === 'instagram'),
      true
    );
  });

  it('injects PRODUCT CATALOGUE and phones/social separately from services', () => {
    const text = buildLiveGroundTruth({
      vertical: 'retail',
      servicesCatalog: [
        { name: 'Book sourcing / special orders', notes: 'Free quote' },
      ],
      productCatalog: [
        { name: 'Atomic Habits', price: '2500 KES', in_stock: 'yes' },
      ],
      socialHandles: {
        channels: [
          { kind: 'whatsapp', label: 'Main', value: '0740 442 943' },
          { kind: 'instagram', value: '@bookstorechapterone' },
        ],
      },
      faqs: [],
      teamDirectory: [],
      businessLocations: [],
      businessPolicies: {},
      agentTools: { escalate: true, end_call: true },
    });
    assert.match(text, /SERVICES \(what you offer/);
    assert.match(text, /PRODUCT CATALOGUE/);
    assert.match(text, /Atomic Habits/);
    assert.match(text, /PHONES, SOCIAL & WEB/);
    assert.match(text, /@bookstorechapterone/);
    assert.doesNotMatch(text, /SERVICES CATALOG:/);
  });
});
