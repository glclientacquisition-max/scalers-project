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
  readinessQuestions,
  previewSampleQuestions,
} = requireRoot('./src/knowledge/assistantSayReadiness.js');
const fs = require('node:fs');
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

  it('catalogue marks prices ready when a catalogue item lookup is found', () => {
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

  // Probes must come from THIS tenant's data. A fixed "How much is sofa cleaning?"
  // (a Jirani item) or "Kilimani" probe is wrong for every other business.
  it('price and delivery probes come only from the tenant catalogue and areas', () => {
    const retail = tenantProfileFromRow({
      ...devRetailTenant,
      product_catalog: [{ name: 'Fast charger 20W', price_range: '650' }],
      service_areas: { version: 1, areas: [{ id: 'place:westlands', name: 'Westlands', fee_mode: 'fixed', fee_ksh: 200, source: 'owner' }] },
    }, {});
    const q = readinessQuestions(retail);
    assert.deepEqual(q.price, ['How much is A4 print?', 'How much is Fast charger 20W?']);
    assert.deepEqual(q.fee, ['Do you deliver to Westlands?']);
    assert.deepEqual(q.hours, ['What are your opening hours?']);
    assert.deepEqual(q.pay, ['How do I pay?']);
    const all = JSON.stringify(q).toLowerCase();
    for (const foreign of ['sofa', 'kilimani', 'carpet']) assert.ok(!all.includes(foreign), foreign);
  });

  it('id-only areas are asked by their place name, as voice resolves them', () => {
    const profile = tenantProfileFromRow({
      business_name: 'Area Co',
      service_areas: { version: 1, areas: [{ id: 'place:westlands', fee_mode: 'fixed', fee_ksh: 350, source: 'owner' }] },
    }, {});
    assert.deepEqual(readinessQuestions(profile).fee, ['Do you deliver to Westlands?']);
    assert.equal(previewSampleQuestions(profile).delivery, 'Do you deliver to Westlands?');
    const row = evaluateAssistantSay(profile, { now: FIXTURE_NOW }).rows.find((r) => r.id === 'delivery');
    assert.equal(row.willSay, lookupProbeForRowId('delivery', profile, FIXTURE_NOW).status === 'found');
  });

  it('a tenant with no catalogue or areas gets no price or delivery question', () => {
    const empty = tenantProfileFromRow({ business_name: 'Empty Co', services_catalog: [], product_catalog: [] }, {});
    const q = readinessQuestions(empty);
    assert.deepEqual(q.price, []);
    assert.deepEqual(q.fee, []);
    const say = evaluateAssistantSay(empty, { now: FIXTURE_NOW });
    assert.equal(say.rows.find((r) => r.id === 'prices').willSay, false);
    assert.equal(say.rows.find((r) => r.id === 'delivery').willSay, false);
    assert.deepEqual(previewSampleQuestions(empty), {
      price: '',
      hours: 'What are your opening hours?',
      delivery: '',
      pay: 'How do I pay?',
    });
  });

  it('payment readiness uses any-method lookup for till, paybill, pochi, and legacy text', () => {
    const now = FIXTURE_NOW;
    const base = {
      business_name: 'Pay Co',
      hours_schedule: {
        timezone: 'Africa/Nairobi',
        days: { mon: { open: '08:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
      },
    };
    const cases = [
      {
        name: 'till-only',
        row: {
          business_policies: {
            payments: {
              version: 2,
              methods: ['mpesa_till'],
              mpesa_till: '123456',
              timings: ['on_delivery'],
              source: 'owner',
              confirmed: true,
            },
          },
        },
        complete: true,
      },
      {
        name: 'paybill-only',
        row: {
          business_policies: {
            payments: {
              version: 2,
              methods: ['mpesa_paybill'],
              mpesa_paybill: { business_no: '542542', account_mode: 'customer_name', account: null },
              timings: ['on_delivery'],
              source: 'owner',
              confirmed: true,
            },
          },
        },
        complete: true,
      },
      {
        name: 'pochi',
        row: {
          business_policies: {
            payments: {
              version: 2,
              methods: ['pochi'],
              pochi: { phone: '+254712345678' },
              timings: ['on_delivery'],
              source: 'owner',
              confirmed: true,
            },
          },
        },
        complete: true,
      },
      {
        name: 'airtel',
        row: {
          business_policies: {
            payments: {
              version: 2,
              methods: ['airtel'],
              airtel: { till: '12345', phone: null },
              timings: ['on_delivery'],
              source: 'owner',
              confirmed: true,
            },
          },
        },
        complete: true,
      },
      {
        name: 'cash-only-text',
        row: {
          business_policies: {
            payments: {
              version: 2,
              methods: ['cash'],
              timings: ['on_delivery'],
              source: 'owner',
              confirmed: true,
            },
          },
        },
        complete: true,
      },
      {
        name: 'legacy-text-only',
        row: {
          business_policies: {
            payment: 'Cash on delivery only',
          },
        },
        complete: false,
      },
      {
        name: 'legacy-till-and-cash',
        row: {
          business_policies: {
            payment: 'M-Pesa (Till) or cash after the job',
            payments: {
              version: 2,
              methods: ['mpesa_till', 'cash'],
              mpesa_till: '654321',
              timings: ['after_job'],
              source: 'owner',
              confirmed: true,
              parsed_from: 'M-Pesa (Till) or cash after the job',
            },
          },
        },
        complete: true,
      },
      {
        name: 'none',
        row: { business_policies: {} },
        complete: false,
      },
    ];

    for (const { name, row, complete } of cases) {
      const profile = tenantProfileFromRow({ ...base, ...row }, {});
      const say = evaluateAssistantSay(profile, { now });
      const checklist = getReadyChecklist(profile, { now });
      const payRow = say.rows.find((r) => r.id === 'payment');
      const payItem = checklist.items.find((i) => i.id === 'payment');
      assert.equal(payRow.willSay, complete, `${name} willSay`);
      assert.equal(payItem.complete, complete, `${name} checklist`);
      assert.equal(payItem.complete, payRow.willSay, `${name} parity`);
      assert.equal(payRow.title, 'Payment details', name);
      assert.equal(payItem.label, 'Payment details', name);
      if (!complete) {
        assert.match(payItem.reason, /Policies/i, name);
      }
    }
  });

  it('a product-only catalogue is probed (retail without services)', () => {
    const profile = tenantProfileFromRow({
      business_name: 'Gadget Shop',
      services_catalog: [],
      product_catalog: [{ name: 'Fast charger 20W', price_range: '650', source: 'owner' }],
    }, {});
    assert.deepEqual(readinessQuestions(profile).price, ['How much is Fast charger 20W?']);
    const row = evaluateAssistantSay(profile, { now: FIXTURE_NOW }).rows.find((r) => r.id === 'prices');
    const probe = lookupProbeForRowId('prices', profile, FIXTURE_NOW);
    assert.equal(row.willSay, probe.status === 'found');
  });

  it('preview samples match readiness row verdict for price and delivery', () => {
    const { lookup } = requireRoot('./src/knowledge/lookup.js');
    for (const key of ['carry', 'list']) {
      const profile = profileFromReplay(key);
      const samples = previewSampleQuestions(profile, { now: FIXTURE_NOW });
      const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
      const pricesRow = say.rows.find((r) => r.id === 'prices');
      const deliveryRow = say.rows.find((r) => r.id === 'delivery');
      const c = { profile, language: 'en', now: FIXTURE_NOW, seed: 0 };
      if (samples.price) {
        const priceHit = lookup('price', samples.price, c);
        assert.equal(priceHit.status === 'found', pricesRow.willSay, `${key} price preview`);
      }
      if (samples.delivery) {
        const feeHit = lookup('fee', samples.delivery, c);
        assert.equal(feeHit.status === 'found', deliveryRow.willSay, `${key} delivery preview`);
      }
      assert.equal(samples.hours, readinessQuestions(profile).hours[0], key);
      assert.equal(samples.pay, readinessQuestions(profile).pay[0], key);
    }
  });

  it('Jirani preview default price question is found when the prices row is Will say', () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures/tenants/jirani-staging.json'), 'utf8')
    );
    const profile = tenantProfileFromRow(fixture.tenant, {});
    const { lookup } = requireRoot('./src/knowledge/lookup.js');
    const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
    const pricesRow = say.rows.find((r) => r.id === 'prices');
    const sample = previewSampleQuestions(profile, { now: FIXTURE_NOW }).price;
    assert.ok(sample);
    const hit = lookup('price', sample, { profile, language: 'en', now: FIXTURE_NOW, seed: 0 });
    assert.equal(hit.status === 'found', pricesRow.willSay);
  });

  it('no tenant item or place is hard-coded in the probes or the Desk preview', () => {
    const root = path.join(__dirname, '..');
    const sources = [
      'src/knowledge/assistantSayReadiness.js',
      'dashboard/src/components/assistantSay/AssistantSayLookupPreview.tsx',
    ];
    for (const rel of sources) {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.ok(!/How much is [A-Za-z]/.test(text.replace(/How much is \$\{/g, '')), `${rel}: literal price question`);
      assert.ok(!/deliver to [A-Z]/.test(text), `${rel}: literal place`);
      assert.ok(!/sofa|kilimani/i.test(text), `${rel}: tenant-specific sample`);
    }
  });
});
