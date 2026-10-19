'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { DEFAULT_BY_KIND } = require('../src/conversation/unknownAnswerByKind');

const QUOTE_GENERAL =
  "I'll note what you need and the shop will call you back with a price.";
const NOW = new Date('2026-10-19T05:00:00.000Z');

function hoursRowUnconfirmed() {
  return {
    id: 't-hours',
    business_name: 'Demo Shop',
    hours_schedule: {
      timezone: 'Africa/Nairobi',
      days: {
        mon: { open: '08:00', close: '17:00' },
        tue: { open: '08:00', close: '17:00' },
        wed: { open: '08:00', close: '17:00' },
        thu: { open: '08:00', close: '17:00' },
        fri: { open: '08:00', close: '17:00' },
        sat: null,
        sun: null,
      },
    },
    services_catalog: [],
    business_policies: {},
  };
}

test('with VOICE_FALLBACK_BY_KIND off, hours unconfirmed still uses legacy general fallback', () => {
  const prevHash = process.env.FACT_HASH_MODE;
  const prevKind = process.env.VOICE_FALLBACK_BY_KIND;
  process.env.FACT_HASH_MODE = 'on';
  delete process.env.VOICE_FALLBACK_BY_KIND;
  const profile = tenantProfileFromRow(
    {
      ...hoursRowUnconfirmed(),
      unknown_answer_fallback: QUOTE_GENERAL,
    },
    { fieldMeta: { hashMode: true } }
  );
  const result = lookup('hours', 'What are your opening hours?', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(result.status, 'unconfirmed');
  assert.equal(speechOf(result, 'en'), QUOTE_GENERAL);
  if (prevHash == null) delete process.env.FACT_HASH_MODE;
  else process.env.FACT_HASH_MODE = prevHash;
  if (prevKind != null) process.env.VOICE_FALLBACK_BY_KIND = prevKind;
});

test('with VOICE_FALLBACK_BY_KIND on, hours unconfirmed uses hours fallback not quote general line', () => {
  const prevHash = process.env.FACT_HASH_MODE;
  const prevKind = process.env.VOICE_FALLBACK_BY_KIND;
  process.env.FACT_HASH_MODE = 'on';
  process.env.VOICE_FALLBACK_BY_KIND = 'on';
  const profile = tenantProfileFromRow(
    {
      ...hoursRowUnconfirmed(),
      unknown_answer_fallback: QUOTE_GENERAL,
    },
    { fieldMeta: { hashMode: true } }
  );
  const result = lookup('hours', 'What are your opening hours?', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(result.status, 'unconfirmed');
  const speech = speechOf(result, 'en');
  assert.equal(speech, DEFAULT_BY_KIND.hours.en);
  assert.doesNotMatch(speech, /price|shop will call you back with a price/i);
  assert.doesNotMatch(speech, /\btill\b/i);
  if (prevHash == null) delete process.env.FACT_HASH_MODE;
  else process.env.FACT_HASH_MODE = prevHash;
  if (prevKind == null) delete process.env.VOICE_FALLBACK_BY_KIND;
  else process.env.VOICE_FALLBACK_BY_KIND = prevKind;
});

test('quote price lookup never speaks the row amount', () => {
  process.env.VOICE_FALLBACK_BY_KIND = 'on';
  const profile = tenantProfileFromRow({
    business_name: 'Demo',
    services_catalog: [
      {
        name: 'Gutter cleaning',
        pricing_mode: 'quote',
        price: '4,500',
        source: 'owner',
        confirmed: true,
      },
    ],
  });
  const result = lookup('price', 'How much is gutter cleaning?', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(result.status, 'not_on_file');
  assert.doesNotMatch(speechOf(result, 'en'), /four thousand|4,?500|4500/i);
  delete process.env.VOICE_FALLBACK_BY_KIND;
});
