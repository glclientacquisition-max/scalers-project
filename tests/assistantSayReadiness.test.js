'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireRoot = createRequire(path.join(__dirname, '..', 'package.json'));
const {
  evaluateAssistantSay,
  getReadyChecklist,
  lookupProbeForRowId,
} = requireRoot('./src/knowledge/assistantSayReadiness.js');
const { tenantProfileFromRow } = requireRoot('./src/tenantProfile.js');
const { profiles } = requireRoot('./evals/replay/profiles.js');

const FIXTURE_NOW = new Date('2026-10-19T05:00:00.000Z');

function profileFromReplay(key) {
  const p = profiles()[key];
  return tenantProfileFromRow(
    {
      id: `replay-${key}`,
      business_name: p.businessName,
      services_catalog: p.servicesCatalog,
      hours_schedule: p.hoursSchedule,
      service_areas: p.service_areas,
      business_policies: p.businessPolicies || {},
      unknown_answer_fallback: p.unknownAnswerFallback,
    },
    { fieldMeta: { hashMode: true }, holdGate: {} }
  );
}

/** Mirrors dashboard dev/settings-jobs retail tenant (Chapter One). */
const devRetailTenant = {
  business_name: 'Chapter One',
  services_catalog: [{ name: 'A4 print', price_range: '20', notes: '', out_of_scope: '' }],
  product_catalog: [],
  hours_schedule: {
    timezone: 'Africa/Nairobi',
    location: 'Westlands',
    days: {
      mon: { open: '08:00', close: '18:00' },
      tue: { open: '08:00', close: '18:00' },
      wed: { open: '08:00', close: '18:00' },
      thu: { open: '08:00', close: '18:00' },
      fri: { open: '08:00', close: '18:00' },
      sat: { open: '08:00', close: '18:00' },
      sun: null,
    },
  },
  business_policies: {
    payments: {
      version: 2,
      methods: ['mpesa_till', 'cash'],
      mpesa_till: '123456',
      timings: ['on_delivery'],
      source: 'parsed',
      confirmed: false,
      parsed_from: 'M-Pesa till 123456 or cash on delivery',
    },
  },
  unknown_answer_fallback: null,
};

function rowWillSay(state, id) {
  const row = state.rows.find((r) => r.id === id);
  return Boolean(row && row.willSay);
}

describe('assistantSayReadiness', () => {
  it('overview checklist matches readiness page Will say for hours and payment', () => {
    const profile = tenantProfileFromRow(devRetailTenant, {});
    const say = evaluateAssistantSay(profile);
    const checklist = getReadyChecklist(profile);

    const hoursItem = checklist.items.find((i) => i.id === 'hours');
    const payItem = checklist.items.find((i) => i.id === 'payment');
    const catalogItem = checklist.items.find((i) => i.id === 'catalog');

    assert.equal(hoursItem.complete, rowWillSay(say, 'hours'));
    assert.equal(payItem.complete, rowWillSay(say, 'payment'));
    assert.equal(catalogItem.complete, rowWillSay(say, 'prices'));
    if (!hoursItem.complete) assert.ok(hoursItem.reason);
    if (!payItem.complete) assert.ok(payItem.reason);
    assert.equal(hoursItem.complete, rowWillSay(say, 'hours'));
  });

  it('checklist complete flags match assistant-say rows when compile provenance is present', () => {
    const profile = tenantProfileFromRow(devRetailTenant, {
      fieldMeta: { hashMode: true },
      holdGate: {},
    });
    const say = evaluateAssistantSay(profile);
    const checklist = getReadyChecklist(profile);
    for (const item of checklist.items) {
      if (item.id === 'identity') {
        assert.equal(item.complete, Boolean(devRetailTenant.business_name?.trim()));
        continue;
      }
      const rowId = item.id === 'catalog' ? 'prices' : item.id === 'payment' ? 'payment' : item.id;
      const row = say.rows.find((r) => r.id === rowId);
      assert.ok(row, rowId);
      assert.equal(item.complete, row.willSay);
      if (!item.complete) assert.equal(item.reason, row.reason);
    }
  });

  it('each readiness row matches the same lookup probe voice uses', () => {
    for (const key of ['carry', 'list']) {
      const profile = profileFromReplay(key);
      const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
      for (const id of ['prices', 'hours', 'delivery', 'payment']) {
        const row = say.rows.find((r) => r.id === id);
        const result = lookupProbeForRowId(id, profile, FIXTURE_NOW);
        assert.ok(row, `${key}/${id}`);
        assert.equal(row.willSay, result.status === 'found', `${key}/${id}`);
      }
    }
  });

  it('catalogue marks prices ready when sofa cleaning lookup is found', () => {
    const p = profiles().carry;
    const profile = tenantProfileFromRow(
      {
        id: 'replay-carry-open',
        business_name: p.businessName,
        services_catalog: p.servicesCatalog,
        hours_schedule: p.hoursSchedule,
        service_areas: p.service_areas,
      },
      {}
    );
    const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
    const prices = say.rows.find((r) => r.id === 'prices');
    assert.equal(prices.willSay, true);
    assert.match(prices.reason, /Ready on the next call/);
  });

  it('when unsure uses neutral stamp labels, not Will say / Wont say', () => {
    const profile = tenantProfileFromRow({ ...devRetailTenant, unknown_answer_fallback: 'We will call you back.' }, {});
    const say = evaluateAssistantSay(profile);
    const unsure = say.rows.find((r) => r.id === 'unsure');
    assert.ok(unsure);
    assert.equal(unsure.isFact, false);
    assert.equal(unsure.stampLabel, 'Callback line set');
    assert.equal(unsure.stampTone, 'ok');
    assert.notEqual(unsure.stampLabel, "Won't say");

    const defaultSay = evaluateAssistantSay(tenantProfileFromRow(devRetailTenant, {}));
    const defaultUnsure = defaultSay.rows.find((r) => r.id === 'unsure');
    assert.equal(defaultUnsure.stampLabel, 'Using team default');
    assert.equal(defaultUnsure.stampTone, 'neutral');
  });
});
