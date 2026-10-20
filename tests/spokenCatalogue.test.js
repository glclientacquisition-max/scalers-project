'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { speakCatalogueName, speakCatalogueNames } = require('../src/conversation/spokenCatalogue');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { offerCatalogueLine } = require('../src/conversation/knownFacts');
const { info } = require('../src/conversation/v2/receipts');

const JIRANI = {
  servicesCatalog: [
    { name: 'Deep clean, 1 bedroom', source: 'owner', pricing: { confirmed: true, amount_ksh: 6500, mode: 'fixed' }, price_range: 'KSh 6,500' },
    { name: 'Deep clean, 2 bedroom', source: 'owner', pricing: { confirmed: true, amount_ksh: 9500, mode: 'fixed' }, price_range: 'KSh 9,500' },
    { name: 'Deep clean, 3 bedroom', source: 'owner', pricing: { confirmed: true, amount_ksh: 13500, mode: 'fixed' }, price_range: 'KSh 13,500' },
    { name: 'Standard clean, 2 bedroom', source: 'owner', pricing: { confirmed: true, amount_ksh: 4500, mode: 'fixed' }, price_range: 'KSh 4,500' },
    { name: 'Sofa cleaning', source: 'owner', pricing: { confirmed: true, amount_ksh: 2500, mode: 'from' }, price_range: 'From KSh 2,500' },
    { name: 'Carpet cleaning', source: 'owner', pricing: { confirmed: true, mode: 'ask' } },
    { name: 'Move-out clean', source: 'owner', pricing: { confirmed: true, mode: 'ask' } },
  ],
};

describe('speakCatalogueName', () => {
  it('reads bedroom sizes as words in English and Kiswahili', () => {
    assert.equal(speakCatalogueName('Deep clean, 1 bedroom', 'en'), 'Deep clean, one bedroom');
    assert.equal(speakCatalogueName('Deep clean, 2 bedroom', 'en'), 'Deep clean, two bedroom');
    assert.equal(speakCatalogueName('Deep clean, 1 bedroom', 'sw'), 'Deep clean, chumba kimoja');
    assert.equal(speakCatalogueName('Deep clean, 2 bedroom', 'sw'), 'Deep clean, vyumba viwili');
    assert.equal(speakCatalogueName('Deep clean, 3 bedroom', 'sheng'), 'Deep clean, vyumba vitatu');
    assert.doesNotMatch(speakCatalogueName('Deep clean, 1 bedroom', 'sw'), /\b1\b|moja bedroom/);
  });

  it('keeps names without sizes', () => {
    assert.equal(speakCatalogueName('Mattress cleaning', 'sw'), 'Mattress cleaning');
  });
});

describe('lookup services uses the spoken compile', () => {
  it('does not read raw 1 bedroom / 2 bedroom titles', () => {
    const en = lookup('services', 'which services', { profile: JIRANI, language: 'en', seed: 0 });
    const sw = lookup('services', 'huduma gani', { profile: JIRANI, language: 'sw', seed: 0 });
    const enSpeech = speechOf(en, 'en');
    const swSpeech = speechOf(sw, 'sw');
    assert.doesNotMatch(enSpeech, /1 bedroom|2 bedroom|3 bedroom/);
    assert.doesNotMatch(swSpeech, /1 bedroom|2 bedroom|moja bedroom|mbili bedroom/);
    assert.match(enSpeech, /Bedroom Cleaning|one bedroom|Deep clean/i);
    assert.match(swSpeech, /chumba kimoja|vyumba|Bedroom Cleaning/i);
  });
});

describe('local catalogue line and v2 receipts share the same names', () => {
  it('rewrites a short bedroom list', () => {
    const short = { servicesCatalog: JIRANI.servicesCatalog.slice(0, 3) };
    const en = offerCatalogueLine('What services do you offer?', short, 'en');
    const sw = offerCatalogueLine('Niambie huduma zenu.', short, 'sw');
    assert.match(en, /one bedroom/);
    assert.match(sw, /chumba kimoja/);
    assert.doesNotMatch(sw, /1 bedroom|moja bedroom/);
  });

  it('v2 service list speaks sizes', () => {
    const line = info(
      { kind: 'services', names: speakCatalogueNames(['Deep clean, 1 bedroom', 'Sofa cleaning'], 'sw'), more: false },
      'sw'
    );
    assert.match(line, /chumba kimoja/);
    assert.doesNotMatch(line, /1 bedroom/);
  });
});
