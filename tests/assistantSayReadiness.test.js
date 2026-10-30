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
const { profiles, FALLBACK } = requireRoot('./evals/replay/profiles.js');
const { hashFactValue, factValueForPath } = requireRoot('./src/conversation/factHash.js');
const { lookup, speechOf } = requireRoot('./src/knowledge/lookup.js');

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
    const catalogItem = checklist.items.find((i) => i.id === 'prices');

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
      const row = say.rows.find((r) => r.id === item.id);
      assert.ok(row, item.id);
      const complete =
        item.id === 'unsure' ? row.stampTone === 'ok' : item.id === 'greeting' ? row.willSay : row.isFact && row.willSay;
      assert.equal(item.complete, complete, item.id);
      if (!item.complete) assert.equal(item.reason, row.reason);
    }
  });

  it('each readiness row matches the same lookup probe voice uses', () => {
    for (const key of ['carry', 'list']) {
      const profile = profileFromReplay(key);
      const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
      for (const id of ['prices', 'hours', 'areas', 'payment']) {
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

  it('when unsure uses team default or will say stamps, not fact wont say', () => {
    const profile = tenantProfileFromRow({ ...devRetailTenant, unknown_answer_fallback: 'We will call you back.' }, {});
    const say = evaluateAssistantSay(profile);
    const unsure = say.rows.find((r) => r.id === 'unsure');
    assert.ok(unsure);
    assert.equal(unsure.isFact, false);
    assert.equal(unsure.stampLabel, 'Will say');
    assert.equal(unsure.stampTone, 'ok');
    assert.notEqual(unsure.stampLabel, "Won't say");

    const defaultSay = evaluateAssistantSay(tenantProfileFromRow(devRetailTenant, {}));
    const defaultUnsure = defaultSay.rows.find((r) => r.id === 'unsure');
    assert.equal(defaultUnsure.stampLabel, 'Team default');
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
    const row = evaluateAssistantSay(profile, { now: FIXTURE_NOW }).rows.find((r) => r.id === 'areas');
    assert.equal(row.willSay, lookupProbeForRowId('areas', profile, FIXTURE_NOW).status === 'found');
  });

  it('a tenant with no catalogue or areas gets no price or delivery question', () => {
    const empty = tenantProfileFromRow({ business_name: 'Empty Co', services_catalog: [], product_catalog: [] }, {});
    const q = readinessQuestions(empty);
    assert.deepEqual(q.price, []);
    assert.deepEqual(q.fee, []);
    const say = evaluateAssistantSay(empty, { now: FIXTURE_NOW });
    assert.equal(say.rows.find((r) => r.id === 'prices').willSay, false);
    assert.equal(say.rows.find((r) => r.id === 'areas').willSay, false);
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
      const deliveryRow = say.rows.find((r) => r.id === 'areas');
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

  it('Jirani legacy payment note: callback on calls, distinct owner reason', () => {
    const prev = process.env.FACT_HASH_MODE;
    process.env.FACT_HASH_MODE = 'on';
    const legacyPayReason =
      'Your payment note has no number callers can use. Add your till or paybill on Policies.';
    try {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'fixtures/tenants/jirani-staging.json'), 'utf8')
      );
      const legacyPay = 'M-Pesa (Till) or cash after the job. No payment before the team arrives.';
      const tenant = {
        ...fixture.tenant,
        business_policies: {
          ...fixture.tenant.business_policies,
          payment: legacyPay,
        },
      };
      delete tenant.business_policies.payments;
      const value = factValueForPath('payments.methods', tenant);
      const profile = tenantProfileFromRow(tenant, {
        fieldMeta: {
          hashMode: true,
          byPath: {
            'payments.methods': {
              source: 'owner',
              value_hash: hashFactValue(value),
            },
          },
        },
      });
      const payHit = lookup('pay', 'How do I pay?', { profile, language: 'en', now: FIXTURE_NOW, seed: 0 });
      assert.equal(payHit.status, 'no_data');
      assert.equal(payHit.reason, 'legacy_text_only');
      assert.equal(speechOf(payHit, 'en'), FALLBACK);

      const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
      const checklist = getReadyChecklist(profile, { now: FIXTURE_NOW });
      const payRow = say.rows.find((r) => r.id === 'payment');
      const payItem = checklist.items.find((i) => i.id === 'payment');
      assert.equal(payRow.willSay, false);
      assert.equal(payItem.complete, false);
      assert.equal(payRow.reason, legacyPayReason);
      assert.equal(payItem.reason, legacyPayReason);
      assert.equal(payItem.complete, payRow.willSay);
    } finally {
      if (prev == null) delete process.env.FACT_HASH_MODE;
      else process.env.FACT_HASH_MODE = prev;
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
  describe('call-path readiness when stored fact hashes are stale', () => {
    const { indexFieldMeta } = requireRoot('./src/conversation/provenance.js');

    /** Done-and-Dusted-shaped sample tenant (made-up numbers, no real customer data). */
    function dndTenant() {
      return {
        id: 'fixture-dnd-shape',
        business_name: 'Sample Cleaning Co',
        vertical: 'home_services',
        greeting_text: 'Karibu Sample Cleaning, tunasafisha nyumba na ofisi. Tukusaidie vipi?',
        unknown_answer_fallback: "I don't have that exact detail, I can note it for the team.",
        services_catalog: [
          {
            id: 'svc_std_1br',
            name: '1-Bedroom Standard Clean',
            price: '2500',
            price_range: 'KSh 2,500',
            source: 'owner',
            pricing: { mode: 'fixed', unit: 'job', source: 'owner', amount_ksh: 2500, min_ksh: null, max_ksh: null, confirmed: true },
          },
          {
            id: 'svc_deep',
            name: 'Deep Clean',
            price: '6000',
            price_range: 'KSh 6,000-12,000',
            source: 'owner',
            pricing: { mode: 'range', unit: 'job', source: 'owner', min_ksh: 6000, max_ksh: 12000, amount_ksh: 6000, confirmed: true },
          },
        ],
        product_catalog: [],
        hours_schedule: {
          timezone: 'Africa/Nairobi',
          days: {
            mon: { open: '07:30', close: '18:00' },
            tue: { open: '07:30', close: '18:00' },
            wed: { open: '07:30', close: '18:00' },
            thu: { open: '07:30', close: '18:00' },
            fri: { open: '07:30', close: '18:00' },
            sat: { open: '08:00', close: '17:00' },
            sun: { open: '09:00', close: '15:00' },
          },
        },
        service_areas: {
          areas: [
            { id: 'county:nairobi', modes: ['visit'], source: 'owner', fee_ksh: null, fee_mode: 'free', confirmed: true },
          ],
        },
        business_policies: {
          payment: 'You can pay by M-Pesa Buy Goods Till 5123456, M-Pesa Paybill 600100, or cash.',
          payments: {
            version: 2,
            source: 'owner',
            confirmed: true,
            methods: ['mpesa_till', 'mpesa_paybill', 'cash'],
            timings: ['after_service'],
            mpesa_till: '5123456',
            mpesa_paybill: { business_no: '600100', account: null, account_mode: 'customer_phone' },
          },
        },
      };
    }

    const CATALOG_PATHS = (t) =>
      t.services_catalog.flatMap((r) => [`catalog.service.${r.id}.name`, `catalog.service.${r.id}.price`]);

    /** Owner meta rows; paths in `stale` carry a hash of an older value (a save that did not refresh it). */
    function metaFor(tenant, paths, { stale = [], source = 'owner' } = {}) {
      return paths.map((field_path) => ({
        field_path,
        source,
        value_hash: stale.includes(field_path)
          ? hashFactValue({ old: field_path })
          : hashFactValue(factValueForPath(field_path, tenant)),
      }));
    }

    function profileOf(tenant, metaRows, { kbProjected = false } = {}) {
      const profile = tenantProfileFromRow(tenant, {
        fieldMeta: indexFieldMeta(metaRows, { hashMode: true }),
        holdGate: {},
      });
      // kb/live.attach sets this when the published snapshot's rows replace the stored catalogue.
      if (kbProjected) profile.kbProjected = true;
      return profile;
    }

    const BASE_PATHS = ['hours.weekly_grid', 'service_areas.county:nairobi', 'policies.payment', 'payments.methods'];

    function rowOf(state, id) {
      return state.rows.find((r) => r.id === id);
    }

    it('Done-and-Dusted shape scores 6/6: stale catalogue and payments.methods hashes, KB path live', () => {
      const t = dndTenant();
      const stale = [...CATALOG_PATHS(t), 'payments.methods'];
      const profile = profileOf(t, metaFor(t, [...BASE_PATHS, ...CATALOG_PATHS(t)], { stale }), { kbProjected: true });
      // the cause: the stricter lookup check reads the stale hashes
      const c = { profile, language: 'en', now: FIXTURE_NOW, seed: 0 };
      assert.equal(lookup('price', 'How much is Deep Clean?', c).status, 'unconfirmed');
      assert.equal(lookup('pay', 'How do I pay?', c).status, 'unconfirmed');
      const say = evaluateAssistantSay(profile, { now: FIXTURE_NOW });
      assert.equal(say.readyCount, 6, JSON.stringify(say.rows.map((r) => [r.id, r.stampLabel, r.reason])));
      assert.equal(say.total, 6);
      assert.match(rowOf(say, 'prices').hearPreview, /1-Bedroom Standard Clean is KSh 2,500/);
      assert.equal(rowOf(say, 'prices').reason, 'Ready on the next call.');
      assert.match(rowOf(say, 'payment').hearPreview, /5123456/);
      assert.match(rowOf(say, 'payment').hearPreview, /600100/);
      assert.equal(getReadyChecklist(profile, { now: FIXTURE_NOW }).allDone, true);
    });

    it('stale catalogue hash on the stored row (no KB snapshot) still reads Won\'t say', () => {
      const t = dndTenant();
      const profile = profileOf(t, metaFor(t, [...BASE_PATHS, ...CATALOG_PATHS(t)], { stale: CATALOG_PATHS(t) }));
      assert.equal(rowOf(evaluateAssistantSay(profile, { now: FIXTURE_NOW }), 'prices').willSay, false);
    });

    it('KB rows with only unconfirmed or ask-for-quote prices are not ready', () => {
      const t = dndTenant();
      t.services_catalog = t.services_catalog.map((r, i) => ({
        ...r,
        pricing: i === 0 ? { ...r.pricing, confirmed: false } : { mode: 'ask', confirmed: true },
        price_range: i === 0 ? r.price_range : 'Custom quote',
        price: i === 0 ? r.price : '',
      }));
      const profile = profileOf(t, metaFor(t, [...BASE_PATHS, ...CATALOG_PATHS(t)], { stale: CATALOG_PATHS(t) }), { kbProjected: true });
      assert.equal(rowOf(evaluateAssistantSay(profile, { now: FIXTURE_NOW }), 'prices').willSay, false);
    });

    it('owner-saved payments bag is ready even when the payment policy hash is stale too', () => {
      const t = dndTenant();
      const profile = profileOf(t, metaFor(t, BASE_PATHS, { stale: ['payments.methods', 'policies.payment'] }));
      const row = rowOf(evaluateAssistantSay(profile, { now: FIXTURE_NOW }), 'payment');
      assert.equal(row.willSay, true);
      assert.match(row.hearPreview, /till number is 5123456/);
    });

    it('a parsed (not owner-saved) payments bag with no confirmed payment policy is not ready', () => {
      const t = dndTenant();
      t.business_policies.payments = { ...t.business_policies.payments, source: 'parsed', confirmed: false };
      const profile = profileOf(t, metaFor(t, BASE_PATHS, { stale: ['payments.methods', 'policies.payment'] }));
      assert.equal(rowOf(evaluateAssistantSay(profile, { now: FIXTURE_NOW }), 'payment').willSay, false);
    });

    it('a payment note with no number stays not ready (genuine miss)', () => {
      const t = dndTenant();
      t.business_policies = { payment: 'M-Pesa or cash after the job. No payment before the team arrives.' };
      const profile = profileOf(t, metaFor(t, ['hours.weekly_grid', 'policies.payment']));
      const row = rowOf(evaluateAssistantSay(profile, { now: FIXTURE_NOW }), 'payment');
      assert.equal(row.willSay, false);
      assert.equal(row.stampLabel, "Won't say");
    });

    it('owner hours with a stale hash read as the call fact sheet does; no owner row stays not ready', () => {
      const t = dndTenant();
      const stale = evaluateAssistantSay(profileOf(t, metaFor(t, BASE_PATHS, { stale: ['hours.weekly_grid'] })), { now: FIXTURE_NOW });
      assert.equal(rowOf(stale, 'hours').willSay, true);
      assert.match(rowOf(stale, 'hours').hearPreview, /Monday to Friday/);
      const seeded = evaluateAssistantSay(
        profileOf(t, [
          ...metaFor(t, BASE_PATHS.filter((p) => p !== 'hours.weekly_grid')),
          ...metaFor(t, ['hours.weekly_grid'], { stale: ['hours.weekly_grid'], source: 'seed' }),
        ]),
        { now: FIXTURE_NOW }
      );
      assert.equal(rowOf(seeded, 'hours').willSay, false);
      const none = evaluateAssistantSay(profileOf(t, metaFor(t, BASE_PATHS.filter((p) => p !== 'hours.weekly_grid'))), { now: FIXTURE_NOW });
      assert.equal(rowOf(none, 'hours').willSay, false);
    });
  });
});
