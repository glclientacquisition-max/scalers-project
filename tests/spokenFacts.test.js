'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  speakFileLine,
  compileSpokenCoverage,
  compileSpokenHours,
  compileSpokenPolicies,
  compileSpokenShop,
} = require('../src/conversation/spokenFacts');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { info } = require('../src/conversation/v2/receipts');

const SHOP = {
  servicesCatalog: [
    { name: 'Deep clean, 1 bedroom' },
    { name: 'Deep clean, 2 bedroom' },
    { name: 'Sofa cleaning' },
  ],
  businessPolicies: {
    coverage_areas: ['place:kileleshwa', 'place:westlands', 'place:kilimani', 'place:lavington', 'place:runda'],
    returns: 'No cash refunds. Store credit of KSh 1,500 within 7 days.',
    payment: 'M-Pesa Till 123456',
  },
  hoursSchedule: {
    days: {
      sun: { open: '08:00', close: '17:00' },
      mon: { open: '08:00', close: '17:00' },
      tue: { open: '08:00', close: '17:00' },
      wed: { open: '08:00', close: '17:00' },
      thu: { open: '08:00', close: '17:00' },
      fri: { open: '08:00', close: '17:00' },
      sat: { open: '08:00', close: '17:00' },
    },
  },
  businessLocations: [{ label: 'Yaya', address: 'Argwings Kodhek' }],
  faqs: [{ question: 'Do you bring chemicals?', answer: 'Yes. Call us on 0712345678.' }],
};

describe('speakFileLine', () => {
  it('speaks money in owner policy text and does not invent a refund', () => {
    const en = speakFileLine(SHOP.businessPolicies.returns, 'en');
    const sw = speakFileLine(SHOP.businessPolicies.returns, 'sw');
    assert.match(en, /one thousand five hundred shillings/i);
    assert.doesNotMatch(en, /KSh/);
    assert.match(sw, /shilingi/);
    assert.match(en, /No cash refunds/);
    assert.match(sw, /No cash refunds/);
  });
});

describe('compileSpokenCoverage', () => {
  it('caps the list and keeps file names', () => {
    const compiled = compileSpokenCoverage(SHOP);
    assert.deepEqual(compiled.names, ['Kileleshwa', 'Westlands', 'Kilimani', 'Lavington']);
    assert.equal(compiled.more, true);
    assert.match(compiled.opener('en'), /We serve Kileleshwa, Westlands, Kilimani, and Lavington\. We also cover other listed areas/i);
    assert.doesNotMatch(compiled.opener('en'), /and Lavington and other/);
    assert.match(compiled.opener('sw'), /Tunahudumia Kileleshwa, Westlands, Kilimani, na Lavington\. Pia tuna maeneo mengine/);
    assert.doesNotMatch(compiled.opener('en'), /Runda/);
  });
});

describe('compileSpokenHours and policies', () => {
  it('speaks the week window without KSh or 08:00', () => {
    const hours = compileSpokenHours(SHOP);
    assert.match(hours.opener('en'), /8 AM/);
    assert.match(hours.opener('en'), /5 PM/);
    assert.doesNotMatch(hours.opener('en'), /08:00/);
    assert.match(hours.opener('sw'), /saa mbili asubuhi/);
    assert.match(hours.opener('sw'), /saa kumi na moja jioni/);
    assert.doesNotMatch(hours.opener('sw'), /8 AM|5 PM|AM|PM/);
  });

  it('keeps empty policy unknown', () => {
    const policies = compileSpokenPolicies(SHOP);
    assert.match(policies.line('returns', 'en'), /one thousand five hundred shillings/);
    assert.equal(policies.line('warranty', 'en'), "I don't have that on file.");
    assert.equal(policies.line('warranty', 'sw'), 'Sina hiyo kwenye rekodi.');
  });
});

describe('compileSpokenShop and live ground truth', () => {
  it('puts a spoken mouth next to raw file blocks', () => {
    const shop = compileSpokenShop(SHOP);
    assert.match(shop.catalogue.opener('en'), /deep clean for one bedroom to two bedroom homes/i);
    const truth = buildLiveGroundTruth(SHOP);
    assert.match(truth, /SPOKEN CATALOGUE/);
    assert.match(truth, /SPOKEN COVERAGE/);
    assert.match(truth, /SPOKEN POLICIES/);
    assert.match(truth, /SPOKEN HOURS/);
    assert.match(truth, /1\. Deep clean, 1 bedroom/);
    assert.doesNotMatch(truth, /SPOKEN POLICIES[\s\S]*KSh 1,500/);
  });
});

describe('v2 coverage list uses spoken join', () => {
  it('asks where after the listed areas', () => {
    const line = info(
      { kind: 'coverage', general: 'Kileleshwa, Westlands, Kilimani, and Lavington', more: true },
      'en'
    );
    assert.match(line, /We serve Kileleshwa, Westlands, Kilimani, and Lavington\. We also cover other listed areas/);
    assert.doesNotMatch(line, /and Lavington and other/);
  });
});

describe('listed areas from service_areas', () => {
  it('treats Settings Locations as listed when serviceAreas is missing', () => {
    const { listedAreaIds } = require('../src/conversation/listedAreas');
    const ids = listedAreaIds({
      service_areas: {
        areas: [{ id: 'place:kileleshwa' }, { id: 'place:lavington' }],
      },
    });
    assert.deepEqual(ids, ['kileleshwa', 'lavington']);
  });
});
