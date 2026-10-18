'use strict';
// Catalogue price normaliser: never speak placeholder text (Ask, Call, …).
// Run: node --test tests/factPriceNormalise.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalisePrice,
  priceIsSpeakable,
  formatPriceDisplay,
  factSheetPriceNote,
} = require('../src/conversation/factPrice');
const factSheet = require('../src/conversation/factSheet');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { createBrainState } = require('../src/conversation/brainState');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { fileServicePriceLine } = require('../src/conversation/catalogueMouth');

const PLACEHOLDER_RE = /\b(?:^|\s)(?:ask|call us|tbd|negotiable|uliza)\b/i;

function withFlag(value, fn) {
  const prev = { refs: process.env.VOICE_FACT_REFS, fees: process.env.VOICE_AREA_FEES };
  const restore = (name, v) => (v == null ? delete process.env[name] : (process.env[name] = v));
  if (value == null) {
    delete process.env.VOICE_FACT_REFS;
    delete process.env.VOICE_AREA_FEES;
  } else process.env.VOICE_FACT_REFS = value;
  try {
    return fn();
  } finally {
    restore('VOICE_FACT_REFS', prev.refs);
    restore('VOICE_AREA_FEES', prev.fees);
  }
}

/** Fictional business: every legacy price is the word Ask. */
function exampleCleanersProfile(extra = {}) {
  return {
    businessName: 'Example Cleaners',
    agentName: 'Amina',
    servicesCatalog: [
      { name: 'Office cleaning', price_range: 'Ask', source: 'owner', confirmed: true },
      { name: 'Home cleaning', price_range: 'Ask', source: 'owner', confirmed: true },
      { name: 'Carpet shampoo', price_range: 'Ask', source: 'owner', confirmed: true },
    ],
    productCatalog: [],
    hoursSchedule: {
      days: { mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' } },
    },
    businessPolicies: {},
    ...extra,
  };
}

function mixedCatalogProfile() {
  return {
    businessName: 'Mtaa Mix Services',
    servicesCatalog: [
      { name: 'Standard clean', price_range: '2,000', source: 'owner', confirmed: true },
      { name: 'Deep clean', price_range: 'from 1500', source: 'owner', confirmed: true },
      { name: 'Mattress wash', price_range: '500-800', source: 'owner', confirmed: true },
      { name: 'Move-out clean', price_range: 'Call us', source: 'owner', confirmed: true },
      { name: 'Empty row', price_range: '', source: 'owner', confirmed: true },
      {
        name: 'Structured quote',
        pricing_mode: 'quote',
        price_range: '',
        price_max: null,
        source: 'owner',
        confirmed: true,
      },
    ],
  };
}

test('normalisePrice: legacy placeholders and mixed numeric forms', () => {
  assert.deepEqual(normalisePrice({ price_range: 'Ask' }), { kind: 'quote', currency: 'KES' });
  assert.deepEqual(normalisePrice({ price_range: 'Uliza' }), { kind: 'quote', currency: 'KES' });
  assert.deepEqual(normalisePrice({ price_range: '2,000' }), {
    kind: 'fixed',
    min: 2000,
    max: 2000,
    currency: 'KES',
  });
  assert.deepEqual(normalisePrice({ price_range: 'from 1,500' }), { kind: 'from', min: 1500, currency: 'KES' });
  assert.deepEqual(normalisePrice({ price_range: '500-800' }), {
    kind: 'range',
    min: 500,
    max: 800,
    currency: 'KES',
  });
  assert.deepEqual(normalisePrice({ price_range: '1.5k' }), {
    kind: 'fixed',
    min: 1500,
    max: 1500,
    currency: 'KES',
  });
  assert.deepEqual(normalisePrice({ pricing_mode: 'quote', price_range: '' }), { kind: 'quote', currency: 'KES' });
  assert.deepEqual(normalisePrice({ pricing_mode: 'ask', price_range: '' }), { kind: 'quote', currency: 'KES' });
  assert.deepEqual(
    normalisePrice({ pricing_mode: 'quote', price_range: '2,000' }),
    { kind: 'quote', currency: 'KES' }
  );
  assert.deepEqual(normalisePrice({ pricing_mode: 'range', price: '300', price_max: '600' }), {
    kind: 'range',
    min: 300,
    max: 600,
    currency: 'KES',
  });
});

test('Example Cleaners: FACT CARD never shows Ask; refs resolve to team callback (EN)', () => {
  withFlag('on', () => {
    const profile = exampleCleanersProfile();
    const card = factSheet.formatFactCard(factSheet.buildFactSheet(profile));
    assert.doesNotMatch(card, PLACEHOLDER_RE);
    assert.match(card, /not on file \(quote on request\)/);
    const sheet = factSheet.buildFactSheet(profile);
    const out = factSheet.renderFactRefs('Office cleaning is {price.office_cleaning}.', sheet, { language: 'en' });
    assert.doesNotMatch(out.text, PLACEHOLDER_RE);
    assert.equal(out.text, 'Let me check with the team and get back to you.');
  });
});

test('Example Cleaners: Swahili unknown-answer line on price ref', () => {
  withFlag('on', () => {
    const sheet = factSheet.buildFactSheet(exampleCleanersProfile());
    const out = factSheet.renderFactRefs('Usafi wa nyumbani ni {price.home_cleaning}.', sheet, { language: 'sw' });
    assert.doesNotMatch(out.text, PLACEHOLDER_RE);
    assert.equal(out.text, 'Wacha niulize timu kisha nikujulishe.');
  });
});

test('mixed catalogue: numeric prices render; placeholders never spoken (EN + SW)', () => {
  withFlag('on', () => {
    const profile = mixedCatalogProfile();
    const sheet = factSheet.buildFactSheet(profile);
    assert.equal(
      factSheet.renderFactRefs('Standard clean is {price.standard_clean}.', sheet, { language: 'en' }).text,
      'Standard clean is KSh 2,000.'
    );
    assert.equal(
      factSheet.renderFactRefs('Deep clean starts {price.deep_clean}.', sheet, { language: 'en' }).text,
      'Deep clean starts from KSh 1,500.'
    );
    assert.equal(
      factSheet.renderFactRefs('Mattress ni {price.mattress_wash}.', sheet, { language: 'sw' }).text,
      'Mattress ni KSh 500-800.'
    );
    for (const id of ['price.move_out_clean', 'price.empty_row', 'price.structured_quote']) {
      const out = factSheet.renderFactRefs(`That is {${id}}.`, sheet, { language: 'en' });
      assert.doesNotMatch(out.text, PLACEHOLDER_RE);
      assert.equal(out.text, 'Let me check with the team and get back to you.');
    }
  });
});

test('live ground truth never injects raw Ask into SERVICES', () => {
  const block = buildLiveGroundTruth(exampleCleanersProfile());
  assert.doesNotMatch(block, /\bPrice:\s*Ask\b/i);
  assert.match(block, /not on file \(quote on request\)/);
});

test('speech path: model line "the price is Ask" is dropped (flag on or off)', () => {
  const profile = exampleCleanersProfile();
  const ctx = {
    profile,
    language: 'en',
    callerTurns: ['how much for office cleaning'],
    state: createBrainState(),
    toolResults: [],
  };
  for (const flag of [null, 'on']) {
    withFlag(flag, () => {
      const out = guardSpokenReply('The price is Ask for that service.', ctx);
      assert.doesNotMatch(out, PLACEHOLDER_RE);
      assert.doesNotMatch(out, /\bAsk\b/);
    });
  }
});

test('local price line for quote row stays empty; guard drops spoken Ask', () => {
  const profile = exampleCleanersProfile();
  const line = fileServicePriceLine('how much is office cleaning', profile, 'en', createBrainState());
  assert.equal(line, '');
  const sw = fileServicePriceLine('bei ngapi ya home cleaning', profile, 'sw', createBrainState());
  assert.equal(sw, '');
});

test('polishSpokenDetail with fact ref on quote item (replay)', () => {
  withFlag('on', () => {
    const profile = exampleCleanersProfile();
    const res = polishSpokenDetail('Office cleaning is {price.office_cleaning}.', {
      state: createBrainState(),
      profile,
      language: 'en',
      callerTurns: ['how much for office cleaning'],
    });
    assert.doesNotMatch(res.text, PLACEHOLDER_RE);
    assert.match(res.text, /Let me check with the team/);
  });
});

test('factSheetPriceNote is stable copy for Desk alignment', () => {
  assert.equal(factSheetPriceNote(), 'not on file (quote on request)');
});
