'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, speechOf } = require('../src/knowledge/lookup');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { DEFAULT_BY_KIND } = require('../src/conversation/unknownAnswerByKind');

const QUOTE_GENERAL =
  "I'll note what you need and the shop will call you back with a price.";
const GENERIC_GENERAL = 'Let me check with the team and get back to you.';
const NOW = new Date('2026-10-19T05:00:00.000Z');
const { isQuoteStyleFallbackLine } = require('../src/conversation/unknownAnswerByKind');

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

test('isQuoteStyleFallbackLine classifies Esga-style price callbacks', () => {
  assert.equal(isQuoteStyleFallbackLine(QUOTE_GENERAL), true);
  assert.equal(isQuoteStyleFallbackLine(GENERIC_GENERAL), false);
});

test('with VOICE_FALLBACK_BY_KIND on, quote owner line is used for price but not hours', () => {
  const prevHash = process.env.FACT_HASH_MODE;
  const prevKind = process.env.VOICE_FALLBACK_BY_KIND;
  process.env.FACT_HASH_MODE = 'on';
  process.env.VOICE_FALLBACK_BY_KIND = 'on';
  const profile = tenantProfileFromRow(
    {
      ...hoursRowUnconfirmed(),
      unknown_answer_fallback: QUOTE_GENERAL,
      unknown_answer_by_kind: { general: { en: QUOTE_GENERAL, sw: '' } },
    },
    { fieldMeta: { hashMode: true } }
  );
  const price = lookup('price', 'How much is cleaning?', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(speechOf(price, 'en'), QUOTE_GENERAL);
  const hours = lookup('hours', 'What are your opening hours?', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(speechOf(hours, 'en'), DEFAULT_BY_KIND.hours.en);
  if (prevHash == null) delete process.env.FACT_HASH_MODE;
  else process.env.FACT_HASH_MODE = prevHash;
  if (prevKind == null) delete process.env.VOICE_FALLBACK_BY_KIND;
  else process.env.VOICE_FALLBACK_BY_KIND = prevKind;
});

test('with VOICE_FALLBACK_BY_KIND on, generic owner general line is used for hours fee and pay', () => {
  const prevHash = process.env.FACT_HASH_MODE;
  const prevKind = process.env.VOICE_FALLBACK_BY_KIND;
  process.env.FACT_HASH_MODE = 'on';
  process.env.VOICE_FALLBACK_BY_KIND = 'on';
  const profile = tenantProfileFromRow(
    {
      id: 't-generic',
      business_name: 'Demo',
      hours_schedule: hoursRowUnconfirmed().hours_schedule,
      services_catalog: [],
      business_policies: {},
      unknown_answer_fallback: GENERIC_GENERAL,
      unknown_answer_by_kind: { general: { en: GENERIC_GENERAL, sw: '' } },
    },
    { fieldMeta: { hashMode: true } }
  );
  const hours = lookup('hours', 'opening hours', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(speechOf(hours, 'en'), GENERIC_GENERAL);
  const fee = lookup('fee', 'Do you deliver to Westlands?', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(speechOf(fee, 'en'), GENERIC_GENERAL);
  const pay = lookup('pay', 'till number', { profile, language: 'en', now: NOW, seed: 0 });
  assert.equal(speechOf(pay, 'en'), GENERIC_GENERAL);
  if (prevHash == null) delete process.env.FACT_HASH_MODE;
  else process.env.FACT_HASH_MODE = prevHash;
  if (prevKind == null) delete process.env.VOICE_FALLBACK_BY_KIND;
  else process.env.VOICE_FALLBACK_BY_KIND = prevKind;
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

// --- Pay default is callback-only; quote-style owner lines are price-only ---
const fs = require('fs');
const path = require('path');
const { lineForKind, generalFitsFallbackKind } = require('../src/conversation/unknownAnswerByKind');
const { callbackSafeLine } = require('../src/conversation/factSheet');

const QUOTE_CANNOT =
  'We cannot quote exact prices on the spot. Our team can prepare a formal quote for you.';

test('pay default is callback-only in both languages and passes the callback guard', () => {
  for (const lang of ['en', 'sw']) {
    const line = DEFAULT_BY_KIND.pay[lang];
    assert.ok(callbackSafeLine(line), `pay ${lang} must pass callbackSafeLine`);
    assert.doesNotMatch(line, /\bsend\b|itakutumia|tutakutumia/i, `pay ${lang} must not promise a send`);
    assert.equal(isQuoteStyleFallbackLine(line), false);
  }
  assert.match(DEFAULT_BY_KIND.pay.en, /call you back/i);
  assert.match(DEFAULT_BY_KIND.pay.sw, /kukupigia|itakupigia/i);
});

test('isQuoteStyleFallbackLine catches cannot quote / formal quote wording', () => {
  assert.equal(isQuoteStyleFallbackLine(QUOTE_CANNOT), true);
  assert.equal(isQuoteStyleFallbackLine("Sorry, we can't quote that on the phone."), true);
  assert.equal(isQuoteStyleFallbackLine('The team will prepare a formal quote.'), true);
  assert.equal(isQuoteStyleFallbackLine(GENERIC_GENERAL), false);
});

test('quote-style owner line is used for price only, never pay/hours/fee/general', () => {
  const byKind = { general: { en: QUOTE_CANNOT, sw: null } };
  const profile = { unknownAnswerFallback: QUOTE_CANNOT };
  assert.equal(lineForKind(byKind, 'price', 'en', profile), QUOTE_CANNOT);
  for (const kind of ['pay', 'hours', 'fee', 'general']) {
    assert.notEqual(lineForKind(byKind, kind, 'en', profile), QUOTE_CANNOT, kind);
    assert.equal(generalFitsFallbackKind(QUOTE_CANNOT, kind), false, kind);
  }
  assert.equal(lineForKind(byKind, 'pay', 'en', profile), DEFAULT_BY_KIND.pay.en);
  assert.equal(lineForKind(byKind, 'pay', 'sw', profile), DEFAULT_BY_KIND.pay.sw);
});

test('fallback-by-kind speech snapshot (tests/fixtures/fallbackByKindSpeech.json)', () => {
  const snap = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/fallbackByKindSpeech.json'), 'utf8'),
  );
  const profiles = {
    quote_owner: { byKind: { general: { en: QUOTE_CANNOT, sw: null } }, profile: { unknownAnswerFallback: QUOTE_CANNOT } },
    generic_owner: { byKind: { general: { en: GENERIC_GENERAL, sw: null } }, profile: { unknownAnswerFallback: GENERIC_GENERAL } },
    no_owner_line: { byKind: null, profile: {} },
  };
  for (const row of snap.cases) {
    const p = profiles[row.profile];
    assert.equal(lineForKind(p.byKind, row.kind, row.language, p.profile), row.line, `${row.profile} ${row.kind} ${row.language}`);
  }
});
