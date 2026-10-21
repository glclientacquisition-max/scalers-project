'use strict';
// Replay of a staging call (2026-10-19, anonymised). Every price, hours and
// pay lookup returned "unconfirmed" and spoke the callback line because the
// lookup read tenant_hold_gate (the stock-reservation capability, closed for
// almost every tenant) as a "facts are held" switch.
//
// The profile is built the way the live loader builds it: tenantProfileFromRow
// with the fieldMeta index (hash mode) and the real hold-gate reasons, so a
// loader field that hand-made fixtures omit cannot hide a gate again.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta, serviceFieldPath, hashFactValue } = require('../src/conversation/provenance');
const { catalogRowFactValue, factValueForPath, tenantRowFromProfile } = require('../src/conversation/factHash');
const { planLookupTurn } = require('../src/conversation/router');
const { lookup } = require('../src/knowledge/lookup');
const { profiles } = require('../evals/replay/profiles');

const ENV = { VOICE_LOOKUPS: 'on' };
const NOW = new Date('2026-10-18T23:07:20.000Z'); // 02:07 EAT, Monday
const CLOSED_HOLD_GATE = {
  allowed: false,
  reasons: [
    'Holds are not enabled in policies.',
    'Need at least one holdable product with owner provenance in the catalog.',
  ],
};
const EN_CB = 'Let me check with the team and get back to you.';
const SW_CB = 'Wacha niulize timu kisha nikujulishe.';

function row() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    business_name: 'Test Cleaners',
    vertical: 'home_services',
    agent_name: 'Amani',
    is_active: true,
    hours_schedule: {
      days: {
        mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' },
        wed: { open: '08:00', close: '17:00' }, thu: { open: '08:00', close: '17:00' },
        fri: { open: '08:00', close: '17:00' }, sat: { open: '09:00', close: '13:00' }, sun: null,
      },
      timezone: 'Africa/Nairobi',
    },
    services_catalog: [
      { id: 'svc_t_fixed', name: 'Carpet Cleaning', price: '2000', pricing_mode: 'fixed', price_range: 'KSh 2,000', source: 'owner' },
      { id: 'svc_t_from', name: 'Sofa Cleaning', price: '1500', pricing_mode: 'from', price_range: 'From KSh 1,500', source: 'owner' },
      { id: 'svc_t_range', name: 'Mattress Cleaning', price: '800', price_max: 1200, pricing_mode: 'range', price_range: 'KSh 800–1,200', source: 'owner' },
      { id: 'svc_t_quote', name: 'Office Deep Clean', price: '', pricing_mode: 'quote', price_range: '', source: 'owner' },
      { id: 'svc_t_ask', name: 'Curtain Cleaning', pricing_mode: 'ask', price_range: 'Ask', source: 'owner' },
    ],
    product_catalog: [],
    business_policies: {},
    service_areas: null,
  };
}

/** Owner meta rows stamped with the live hash, as the Desk save writes them. */
function metaFor(tenantRow) {
  const rows = tenantRow.services_catalog.map((svc, i) => ({
    field_path: serviceFieldPath(i, svc),
    source: 'owner',
    value_hash: hashFactValue(catalogRowFactValue(svc)),
  }));
  const probe = tenantProfileFromRow(tenantRow, {});
  rows.push({
    field_path: 'hours.weekly_grid',
    source: 'owner',
    value_hash: hashFactValue(factValueForPath('hours.weekly_grid', tenantRowFromProfile(probe))),
  });
  return { ...indexFieldMeta(rows), hashMode: true };
}

function liveProfile(holdGate) {
  const tenantRow = row();
  return tenantProfileFromRow(tenantRow, { fieldMeta: metaFor(tenantRow), holdGate });
}

// [caller said, language, expected outcome, expected speech matcher]
const CALL = [
  ['How much is Carpet Clean?', 'en', 'price', /Carpet Cleaning .*two thousand shillings/],
  ['How much is Carpet Cleaning?', 'en', 'price', /two thousand shillings/],
  ['Mattress Cleaning ni pesa ngapi?', 'sw', 'price', /mia nane hadi shilingi elfu moja na mia mbili/],
  ['How much is Curtain Cleaning?', 'en', 'price', new RegExp(`^${EN_CB}$`)],
  ['How much is Office Deep Clean?', 'en', 'price', new RegExp(`^${EN_CB}$`)],
  ['How much is the—', 'en', 'catalogue', /carpet cleaning/i],
  ['Mnafungua saa ngapi Jumamosi?', 'sw', 'hours', /Jumamosi .*saa tatu asubuhi hadi saa saba mchana/],
  ['And by till ni gani?', 'sw', 'service_facts', new RegExp(`^${SW_CB}$`)],
];

for (const gate of [CLOSED_HOLD_GATE, null, { allowed: true, reasons: [] }]) {
  test(`replay HD-staging-1019: lookups speak owner facts (holdGate=${gate ? gate.allowed : 'null'})`, () => {
    const profile = liveProfile(gate);
    const state = { conversation: {} };
    for (const [said, language, outcome, speech] of CALL) {
      const plan = planLookupTurn({ text: said, state, profile, language, now: NOW, env: ENV, seed: 1 });
      assert.ok(plan, `${said}: lookup did not handle the turn`);
      assert.equal(plan.outcome, outcome, said);
      assert.match(plan.speech, speech, `${said} -> ${plan.speech}`);
      assert.doesNotMatch(plan.speech, /\bask\b/i, said);
    }
  });
}

test('every lookup result is independent of the holds gate (all replay profiles)', () => {
  const asks = [
    ['price', 'how much is sofa cleaning'], ['price', 'how much is carpet cleaning'],
    ['hours', 'what are your hours'], ['hours', 'mnafungua saa ngapi jumamosi'],
    ['pay', 'namba ya till ni gani'], ['services', 'which services'], ['fee', 'mnafika Kileleshwa'],
  ];
  const bank = profiles();
  for (const [name, base] of Object.entries(bank)) {
    for (const [kind, query] of asks) {
      for (const language of ['en', 'sw']) {
        const ctx = { language, now: NOW, seed: 0 };
        const open = lookup(kind, query, { ...ctx, profile: { ...base, holdGate: null } });
        const shut = lookup(kind, query, { ...ctx, profile: { ...base, holdGate: CLOSED_HOLD_GATE } });
        assert.deepEqual(shut, open, `${name} ${kind} "${query}" ${language}`);
      }
    }
  }
});

test('lookup results say why: matched id and reason for found, quote and unconfirmed', () => {
  const profile = liveProfile(CLOSED_HOLD_GATE);
  const ctx = { profile, language: 'en', now: NOW, seed: 0 };
  const carpet = lookup('price', 'how much is carpet cleaning', ctx);
  assert.equal(carpet.status, 'found');
  assert.equal(carpet.id, 'price.carpet_cleaning');
  assert.equal(carpet.reason, 'match');
  const curtain = lookup('price', 'how much is curtain cleaning', ctx);
  assert.equal(curtain.status, 'not_on_file');
  assert.equal(curtain.reason, 'price_quote');
  const till = lookup('pay', 'namba ya till ni gani', ctx);
  assert.equal(till.status, 'no_data');
  assert.equal(till.reason, 'no_list');
  // An owner edit after the stamp: the hash no longer matches.
  const edited = { ...profile, servicesCatalog: profile.servicesCatalog.map((svc) => (
    svc.id === 'svc_t_fixed' ? { ...svc, price: '2500', price_range: 'KSh 2,500' } : svc
  )) };
  const stale = lookup('price', 'how much is carpet cleaning', { ...ctx, profile: edited });
  assert.equal(stale.status, 'unconfirmed');
  assert.equal(stale.reason, 'hash_mismatch');
});
