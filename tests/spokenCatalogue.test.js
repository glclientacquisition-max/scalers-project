'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  speakCatalogueName,
  speakCatalogueNames,
  compileSpokenCatalogue,
} = require('../src/conversation/spokenCatalogue');
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

  it('speaks sq ft, litres, and per seat instead of the typed token', () => {
    assert.match(speakCatalogueName('Office, 1200 sq ft', 'en'), /one thousand two hundred square feet/i);
    assert.match(speakCatalogueName('Office, 1200 sq ft', 'sw'), /futi za mraba/);
    assert.doesNotMatch(speakCatalogueName('Office, 1200 sq ft', 'en'), /sq\s*ft/i);
    assert.match(speakCatalogueName('Water, 20 litres', 'en'), /twenty litres/i);
    assert.match(speakCatalogueName('Water, 20 litres', 'sw'), /lita ishirini|ishirini/);
    assert.match(speakCatalogueName('Sofa cleaning per seat', 'en'), /per seat/i);
    assert.match(speakCatalogueName('Sofa cleaning per seat', 'sw'), /kwa kiti/);
  });
});

describe('compileSpokenCatalogue groups size siblings', () => {
  it('does not list every Jirani bedroom SKU on the first ask', () => {
    const compiled = compileSpokenCatalogue(JIRANI);
    const en = compiled.opener('en');
    const sw = compiled.opener('sw');
    assert.doesNotMatch(en, /Deep clean, one bedroom.*Deep clean, two bedroom/);
    assert.doesNotMatch(sw, /1 bedroom|2 bedroom|moja bedroom/);
    assert.match(en, /deep clean for one bedroom to three bedroom homes/i);
    assert.match(sw, /chumba kimoja hadi vyumba vitatu/i);
    assert.match(en, /sofa cleaning/i);
    assert.match(en, /and more/i);
  });

  it('groups seater, kilo, and pack siblings the same way', () => {
    const compiled = compileSpokenCatalogue({
      servicesCatalog: [
        { name: 'Sofa, 3 seater' },
        { name: 'Sofa, 5 seater' },
        { name: 'Wash, 5 kg' },
        { name: 'Wash, 10 kg' },
        { name: 'Detergent small' },
        { name: 'Detergent large' },
      ],
    });
    const en = compiled.opener('en');
    const sw = compiled.opener('sw');
    assert.match(en, /sofa for three seater to five seater/i);
    assert.match(en, /wash for five kilo to ten kilo/i);
    assert.match(en, /detergent, small and large/i);
    assert.match(sw, /kiti tatu hadi kiti tano/i);
    assert.match(sw, /kilo tano hadi kilo kumi/i);
    assert.doesNotMatch(en, /3 seater|5 kg/);
    assert.doesNotMatch(sw, /moja seater|5 kg/);
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
    assert.match(enSpeech, /deep clean for one bedroom to three bedroom homes/i);
    assert.match(swSpeech, /chumba kimoja hadi vyumba vitatu/i);
  });
});

describe('local catalogue line and v2 receipts share the same names', () => {
  it('rewrites a short bedroom list into one family', () => {
    const short = { servicesCatalog: JIRANI.servicesCatalog.slice(0, 3) };
    const en = offerCatalogueLine('What services do you offer?', short, 'en');
    const sw = offerCatalogueLine('Niambie huduma zenu.', short, 'sw');
    assert.match(en, /deep clean for one bedroom to three bedroom homes/i);
    assert.match(sw, /chumba kimoja hadi vyumba vitatu/i);
    assert.doesNotMatch(en, /Deep clean, one bedroom, Deep clean, two bedroom/);
    assert.doesNotMatch(sw, /1 bedroom|moja bedroom/);
  });

  it('v2 service list speaks sizes', () => {
    const line = info(
      { kind: 'services', names: speakCatalogueNames(['Deep clean, 1 bedroom', 'Sofa cleaning'], 'sw'), more: false },
      'sw'
    );
    assert.match(line, /chumba kimoja/);
    assert.match(line, /^Tuna /);
    assert.match(line, /Unahitaji gani/);
    assert.doesNotMatch(line, /1 bedroom|Tunafanya/);
  });

  it('v2 English list uses the compile opener', () => {
    const line = info(
      { kind: 'services', names: ['Deep clean for one bedroom to three bedroom homes', 'Sofa cleaning'], more: true },
      'en'
    );
    assert.match(line, /^We offer /);
    assert.match(line, /Which one do you need/);
    assert.doesNotMatch(line, /We do |would you like/i);
  });

  it('v2 offered price uses spoken money, not KSh', () => {
    const en = info({ kind: 'offered', label: 'Deep clean, 1 bedroom', price: 'KSh 6,500' }, 'en');
    const sw = info({ kind: 'offered', label: 'Deep clean, 1 bedroom', price: 'KSh 6,500' }, 'sw');
    assert.match(en, /one bedroom/);
    assert.match(en, /six thousand five hundred shillings/);
    assert.doesNotMatch(en, /KSh/);
    assert.match(sw, /chumba kimoja/);
    assert.match(sw, /shilingi/);
    assert.doesNotMatch(sw, /KSh|moja bedroom/);
  });
});
