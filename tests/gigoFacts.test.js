// GIGO P1/P2 fact schemas, readers, and read-only tools.
// A missing, garbage, seed, import, or stale-volatile value is unknown and is
// spoken as "let me confirm" (serve) or "take a message" (message mode).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validatePrice,
  validateStock,
  validateEta,
  validateText,
  validatePhone,
  validateEmail,
  GIGO_DOMAINS,
  FACTS,
  readFact,
  readCatalog,
  readFaqs,
  readAllFacts,
  lookupCatalogItem,
  checkCoverage,
  freshness,
  unknownFactLine,
  formatGigoFactsForPrompt,
  runFactTool,
  GIGO_FACT_TOOLS,
  DEFAULT_STALE_AFTER_DAYS,
  factsToReconfirm,
} = require('../src/conversation/gigo');
const { hashFactValue, factValueForPath, tenantRowFromProfile } = require('../src/conversation/factHash');
const { indexFieldMeta } = require('../src/conversation/provenance');

const NOW = new Date('2026-10-09T07:00:00Z');

function profile(extra = {}) {
  return {
    businessName: 'Done and Dusted',
    agentName: 'Amani',
    agentTone: 'warm',
    did: '+254709221537',
    vertical: 'home_services',
    afterHoursMode: 'serve',
    hoursSchedule: {
      days: {
        mon: { open: '08:00', close: '17:00' },
        tue: { open: '08:00', close: '17:00' },
        sun: null,
      },
    },
    businessHours: null,
    businessLocations: [{ label: 'Shop', address: 'Ngong Road', landmark: 'Prestige Plaza' }],
    businessPolicies: {
      payment: 'M-Pesa till 123456 or cash.',
      returns: '',
      coverage_areas: ['county:nairobi', 'place:kitengela'],
    },
    servicesCatalog: [
      { name: 'Carpet cleaning', price_range: 'KES 1,500 - 3,000', lead_time: '2-3 days' },
      { name: 'Sofa cleaning', price_range: '' },
    ],
    productCatalog: [
      { name: 'Ream of paper', sku: 'P1', price: '650', in_stock: 'yes' },
      { name: 'Stapler', sku: 'P2', price: 'tbd', in_stock: 'maybe' },
    ],
    faqs: [{ question: 'Do you have parking?', answer: 'Yes, behind the shop.' }],
    whatsappNumber: '+254700000111',
    alertEmail: 'owner@doneanddusted.co.ke',
    dailyBulletin: [],
    fieldMeta: null,
    ...extra,
  };
}

describe('gigo validators never fill a default', () => {
  it('price: amounts, quote wording, and ask mode are facts; garbage is not', () => {
    assert.deepEqual(validatePrice('KES 1,500 - 3,000'), { ok: true, value: { text: 'KES 1,500 - 3,000' } });
    assert.deepEqual(validatePrice('Quoted on site'), { ok: true, value: { text: 'Quoted on site', mode: 'ask' } });
    assert.deepEqual(validatePrice('', 'ask'), { ok: true, value: { text: '', mode: 'ask' } });
    assert.deepEqual(validatePrice('ask'), { ok: true, value: { text: '', mode: 'ask' } });
    assert.equal(validatePrice('').reason, 'missing');
    for (const bad of ['tbd', '0', 'N/A', '-500', 'cheap', '???', '999999999999']) {
      assert.equal(validatePrice(bad).ok, false, bad);
      assert.equal(validatePrice(bad).reason, 'garbage', bad);
    }
    assert.equal(validatePrice('Free quotation').ok, true);
  });

  it('stock: only an explicit yes or no', () => {
    assert.equal(validateStock('yes').value, 'yes');
    assert.equal(validateStock(false).value, 'no');
    assert.equal(validateStock('').reason, 'missing');
    assert.equal(validateStock('maybe').reason, 'missing');
    assert.equal(validateStock('lots').reason, 'garbage');
  });

  it('eta: needs a duration word', () => {
    assert.equal(validateEta('2-3 days').value, '2-3 days');
    assert.equal(validateEta('same day in Nairobi').ok, true);
    assert.equal(validateEta('siku mbili').ok, true);
    assert.equal(validateEta('3').reason, 'garbage');
    assert.equal(validateEta('soon').reason, 'garbage');
    assert.equal(validateEta(null).reason, 'missing');
  });

  it('text, phone, email placeholders are garbage', () => {
    for (const bad of ['n/a', 'TBD', '-', 'test', 'lorem ipsum dolor', 'x', '...']) {
      assert.equal(validateText(bad).reason, 'garbage', bad);
    }
    assert.equal(validatePhone('0000000000').reason, 'garbage');
    assert.equal(validatePhone('12').reason, 'garbage');
    assert.equal(validatePhone('+254 709 221 537').value, '+254709221537');
    assert.equal(validateEmail('a@example.com').reason, 'garbage');
    assert.equal(validateEmail('owner@shop.co.ke').ok, true);
  });
});

describe('gigo schema', () => {
  it('covers the 10 completeness domains with unique keys', () => {
    assert.deepEqual(GIGO_DOMAINS, [
      'identity', 'catalog', 'hours', 'locations', 'payments',
      'policies', 'faqs', 'team_notify', 'assistant', 'bulletin',
    ]);
    const keys = FACTS.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const def of FACTS) {
      assert.ok(GIGO_DOMAINS.includes(def.domain), def.key);
      assert.ok(def.fieldPath, def.key);
      assert.equal(def.phase, 'P1');
    }
    const all = readAllFacts(profile(), { now: NOW });
    assert.deepEqual(Object.keys(all), GIGO_DOMAINS);
  });

  it('owner notify targets are never speakable', () => {
    for (const key of ['team_notify.whatsapp', 'team_notify.email', 'identity.primary_phone']) {
      assert.equal(FACTS.find((f) => f.key === key).speakable, false);
    }
    const prompt = formatGigoFactsForPrompt(profile(), { now: NOW });
    assert.doesNotMatch(prompt, /254700000111|owner@doneanddusted/);
  });
});

describe('gigo readers', () => {
  it('reads owner facts as known', () => {
    const p = profile();
    assert.equal(readFact(p, 'payments.methods', { now: NOW }).value, 'M-Pesa till 123456 or cash.');
    assert.equal(readFact(p, 'hours.weekly', { now: NOW }).status, 'known');
    assert.deepEqual(readFact(p, 'locations.coverage_areas', { now: NOW }).value, ['county:nairobi', 'place:kitengela']);
  });

  it('missing and garbage are unknown, never a default', () => {
    const p = profile({
      hoursSchedule: { days: { mon: { open: '25:00', close: 'x' } } },
      businessPolicies: { returns: 'n/a', coverage_areas: [] },
      agentName: 'Receptionist',
      vertical: 'general',
    });
    const hours = readFact(p, 'hours.weekly', { now: NOW });
    assert.equal(hours.status, 'unknown');
    assert.equal(hours.reason, 'garbage');
    assert.equal(hours.value, null);
    assert.equal(readFact(p, 'policies.returns').reason, 'garbage');
    assert.equal(readFact(p, 'payments.methods').reason, 'missing');
    assert.equal(readFact(p, 'locations.coverage_areas').reason, 'missing');
    assert.equal(readFact(p, 'assistant.agent_name').reason, 'missing');
    assert.equal(readFact(p, 'identity.vertical').reason, 'missing');
    assert.equal(readFact(p, 'no.such').reason, 'no_such_fact');
  });

  it('seed policy text and seed/import meta are unconfirmed', () => {
    const seeded = profile({
      businessPolicies: { payment: 'M-Pesa and cash. Confirm other methods with the team if asked.' },
    });
    const r = readFact(seeded, 'payments.methods');
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'unconfirmed');
    assert.equal(r.source, 'seed');

    const imported = profile({
      fieldMeta: indexFieldMeta([{ field_path: 'hours.weekly_grid', source: 'import' }]),
    });
    assert.equal(readFact(imported, 'hours.weekly').reason, 'unconfirmed');
    const confirmed = profile({
      fieldMeta: indexFieldMeta([
        { field_path: 'hours.weekly_grid', source: 'import', confirmed_at: '2026-10-01T00:00:00Z' },
      ]),
    });
    assert.equal(readFact(confirmed, 'hours.weekly').status, 'known');
  });

  it('catalogue keeps confirmed rows and marks each unknown leaf', () => {
    const cat = readCatalog(profile(), { now: NOW });
    const carpet = cat.services.find((s) => s.name === 'Carpet cleaning');
    assert.equal(carpet.price.value.text, 'KES 1,500 - 3,000');
    assert.equal(carpet.lead_time.value, '2-3 days');
    const sofa = cat.services.find((s) => s.name === 'Sofa cleaning');
    assert.equal(sofa.price.status, 'unknown');
    assert.equal(sofa.price.reason, 'missing');
    const stapler = cat.products.find((s) => s.name === 'Stapler');
    assert.equal(stapler.price.reason, 'garbage');
    assert.equal(stapler.in_stock.status, 'unknown');
    assert.equal(stapler.lead_time.status, 'unknown');
  });

  it('pack-seed services and seed meta rows are not catalogue facts', () => {
    const p = profile({
      servicesCatalog: [{ name: 'Home cleaning', price_range: 'Quoted on site', notes: 'House, Airbnb, and general clean visits.' }],
      productCatalog: [{ name: 'Ream of paper', sku: 'P1', price: '650' }],
      fieldMeta: indexFieldMeta([{ field_path: 'catalog.product.P1.name', source: 'seed' }]),
    });
    const cat = readCatalog(p);
    assert.equal(cat.status, 'unknown');
    assert.equal(cat.reason, 'unconfirmed');
    assert.equal(cat.unconfirmedCount, 2);
    assert.equal(lookupCatalogItem(p, 'paper').status, 'unknown');
  });

  it('lookup: found, not listed, unknown', () => {
    const p = profile();
    const hit = lookupCatalogItem(p, 'carpet');
    assert.equal(hit.status, 'found');
    assert.equal(hit.item.name, 'Carpet cleaning');
    assert.equal(lookupCatalogItem(p, 'car wash').status, 'not_listed');
    assert.equal(lookupCatalogItem(profile({ servicesCatalog: [], productCatalog: [] }), 'carpet').status, 'unknown');
  });

  it('coverage: covered, not covered, unknown without a list', () => {
    const p = profile();
    assert.equal(checkCoverage(p, 'Kitengela').status, 'covered');
    assert.equal(checkCoverage(p, 'Westlands').status, 'covered');
    assert.equal(checkCoverage(p, 'Mombasa').status, 'not_covered');
    assert.equal(checkCoverage(profile({ businessPolicies: {} }), 'Mombasa').status, 'unknown');
  });

  it('faqs: only confirmed rows', () => {
    const seed = {
      question: 'Do you accept M-Pesa?',
      answer: 'Yes, we accept M-Pesa. You can pay on pickup or delivery as arranged.',
    };
    const r = readFaqs(profile({ faqs: [seed, { question: 'Parking?', answer: 'Behind the shop.' }] }));
    assert.equal(r.faqs.length, 1);
    assert.deepEqual(r.unknownTopics, ['FAQ: Do you accept M-Pesa?']);
  });
});

describe('gigo P2 freshness', () => {
  it('stale only when the meta row sets stale_after_days', () => {
    assert.equal(freshness({ confirmed_at: '2020-01-01T00:00:00Z' }, NOW).stale, false);
    assert.equal(
      freshness({ last_verified_at: '2026-09-01T00:00:00Z', stale_after_days: 7 }, NOW).stale,
      true
    );
    assert.equal(
      freshness({ last_verified_at: '2026-10-08T00:00:00Z', stale_after_days: 7 }, NOW).stale,
      false
    );
  });

  it('a stale volatile leaf (price, stock, eta) is unknown; a stale policy stays known and flagged', () => {
    const fieldMeta = indexFieldMeta([
      { field_path: 'catalog.product.P1.name', source: 'owner', last_verified_at: '2026-09-01T00:00:00Z', stale_after_days: 7 },
      { field_path: 'policies.payment', source: 'owner', last_verified_at: '2026-01-01T00:00:00Z', stale_after_days: 30 },
    ]);
    const p = profile({ fieldMeta });
    const ream = readCatalog(p, { now: NOW }).products.find((r) => r.name === 'Ream of paper');
    assert.equal(ream.price.reason, 'stale');
    assert.equal(ream.in_stock.reason, 'stale');
    const pay = readFact(p, 'payments.methods', { now: NOW });
    assert.equal(pay.status, 'known');
    assert.equal(pay.stale, true);
  });
});

describe('gigo P2 default shelf life (FACT_HASH_MODE)', () => {
  const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
  function hashedProfile(metaSpec, extra = {}) {
    const p = profile({ faqs: [{ question: 'Do you work Sundays?', answer: 'No, Monday to Saturday.' }], ...extra });
    const row = tenantRowFromProfile(p);
    const rows = metaSpec.map(([path, at, more = {}]) => ({
      field_path: path,
      source: 'owner',
      confirmed_at: at,
      value_hash: hashFactValue(factValueForPath(path, row)),
      ...more,
    }));
    return { p, rows };
  }
  const spec = [
    ['catalog.product.P1.name', daysAgo(10)],
    ['policies.payment', daysAgo(200)],
    ['hours.weekly_grid', daysAgo(100)],
    ['locations.branches', daysAgo(100)],
    ['identity.business_name', daysAgo(2000)],
    ['faqs.1', daysAgo(181)],
  ];

  it('locks the approved table', () => {
    assert.deepEqual({ ...DEFAULT_STALE_AFTER_DAYS }, {
      in_stock: 3, price: 30, lead_time: 14, bulletin: null, hours: 90, coverage_areas: 180,
      payments: 180, deposits: 90, policies: 180, faqs: 180, locations: 365,
      identity: null, assistant: null, team_notify: null,
    });
    assert.ok(Object.isFrozen(DEFAULT_STALE_AFTER_DAYS));
    for (const def of FACTS) assert.ok(def.shelfLife in DEFAULT_STALE_AFTER_DAYS, def.key);
  });

  it('flag on: defaults apply when the row has no stale_after_days', () => {
    const { p, rows } = hashedProfile(spec);
    const hp = { ...p, fieldMeta: indexFieldMeta(rows, { hashMode: true }) };
    const ream = readCatalog(hp, { now: NOW }).products.find((r) => r.name === 'Ream of paper');
    assert.equal(ream.price.status, 'known', 'price 30d: 10 days old is fresh');
    assert.equal(ream.in_stock.reason, 'stale', 'stock 3d: 10 days old is unknown');
    assert.equal(ream.reconfirm, true);
    const pay = readFact(hp, 'payments.methods', { now: NOW });
    assert.deepEqual([pay.status, pay.stale, pay.reconfirm], ['known', true, true], 'non-volatile stays spoken');
    const hours = readFact(hp, 'hours.weekly', { now: NOW });
    assert.deepEqual([hours.status, hours.stale, hours.reconfirm], ['known', true, true]);
    const loc = readFact(hp, 'locations.branches', { now: NOW });
    assert.deepEqual([loc.status, loc.stale, loc.reconfirm], ['known', false, false], '365d');
    const name = readFact(hp, 'identity.business_name', { now: NOW });
    assert.deepEqual([name.status, name.stale], ['known', false], 'identity never stale by age');
    const faqs = readFaqs(hp, { now: NOW });
    assert.equal(faqs.faqs.length, 1, 'stale FAQ still spoken');
    assert.deepEqual(faqs.reconfirm, [{ question: 'Do you work Sundays?', fieldPath: 'faqs.1' }]);
    assert.deepEqual(
      factsToReconfirm(hp, { now: NOW }).map((r) => r.fieldPath).sort(),
      ['catalog.product.P1.name', 'faqs.1', 'hours.weekly_grid', 'policies.payment']
    );
    // explicit hashMode on an unpinned index gives the same answer
    const viaOpt = readFact({ ...p, fieldMeta: indexFieldMeta(rows) }, 'payments.methods', { now: NOW, hashMode: true });
    assert.equal(viaOpt.reconfirm, true);
  });

  it('flag on: an explicit stale_after_days on the row beats the default', () => {
    const { p, rows } = hashedProfile([
      ['catalog.product.P1.name', daysAgo(10), { stale_after_days: 60 }],
      ['policies.payment', daysAgo(200), { stale_after_days: 365 }],
      ['hours.weekly_grid', daysAgo(5), { stale_after_days: 1 }],
    ]);
    const hp = { ...p, fieldMeta: indexFieldMeta(rows, { hashMode: true }) };
    const ream = readCatalog(hp, { now: NOW }).products.find((r) => r.name === 'Ream of paper');
    assert.equal(ream.in_stock.status, 'known');
    assert.equal(ream.reconfirm, false);
    assert.equal(readFact(hp, 'payments.methods', { now: NOW }).stale, false);
    assert.equal(readFact(hp, 'hours.weekly', { now: NOW }).reconfirm, true);
  });

  it('flag off: no defaults, no reconfirm keys, nothing queued', () => {
    const { p, rows } = hashedProfile(spec);
    const off = { ...p, fieldMeta: indexFieldMeta(rows, { hashMode: false }) };
    const ream = readCatalog(off, { now: NOW }).products.find((r) => r.name === 'Ream of paper');
    assert.equal(ream.in_stock.status, 'known');
    assert.equal('reconfirm' in ream, false);
    const pay = readFact(off, 'payments.methods', { now: NOW });
    assert.equal(pay.stale, false);
    assert.equal('reconfirm' in pay, false);
    assert.equal('reconfirm' in readFaqs(off, { now: NOW }), false);
    assert.deepEqual(factsToReconfirm(off, { now: NOW }), []);
    // same output as a P0 index with no flag pinned and FACT_HASH_MODE unset
    const prev = process.env.FACT_HASH_MODE;
    delete process.env.FACT_HASH_MODE;
    try {
      const p0 = { ...p, fieldMeta: indexFieldMeta(rows) };
      assert.deepEqual(readAllFacts(p0, { now: NOW }), readAllFacts(off, { now: NOW }));
    } finally {
      if (prev === undefined) delete process.env.FACT_HASH_MODE;
      else process.env.FACT_HASH_MODE = prev;
    }
  });
});

describe('gigo catalogue leaf paths (.price / .site_visit)', () => {
  const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
  const services = [
    { id: 'svc_carpet', name: 'Carpet cleaning', price_range: 'KES 1,500 - 3,000', site_visit_required: true },
  ];
  function setup(extraRows, hashMode) {
    const p = profile({ servicesCatalog: services, productCatalog: [] });
    const row = tenantRowFromProfile(p);
    const owner = (path, more = {}) => ({
      field_path: path,
      source: 'owner',
      confirmed_at: daysAgo(1),
      value_hash: hashFactValue(factValueForPath(path, row)),
      ...more,
    });
    const rows = [owner('catalog.service.svc_carpet.name'), ...extraRows.map(([path, more]) => owner(path, more))];
    return { ...p, fieldMeta: indexFieldMeta(rows, { hashMode }) };
  }
  const carpet = (p) => readCatalog(p, { now: NOW }).services[0];

  it('reads site visit as a service leaf', () => {
    const item = carpet(setup([], true));
    assert.deepEqual([item.site_visit.status, item.site_visit.value], ['known', true]);
    assert.equal(carpet(setup([], false)).site_visit.value, true);
  });

  it('hash mode: no leaf row means the leaf follows the row; a matching leaf row keeps it known', () => {
    assert.equal(carpet(setup([], true)).price.status, 'known');
    const item = carpet(setup([['catalog.service.svc_carpet.price'], ['catalog.service.svc_carpet.site_visit']], true));
    assert.equal(item.price.status, 'known');
    assert.equal(item.site_visit.status, 'known');
  });

  it('hash mode: a reopened or mismatched leaf row makes only that leaf unknown', () => {
    const item = carpet(
      setup(
        [
          ['catalog.service.svc_carpet.price', { value_hash: null }],
          ['catalog.service.svc_carpet.site_visit', { value_hash: hashFactValue(false) }],
        ],
        true
      )
    );
    assert.equal(item.name, 'Carpet cleaning');
    assert.deepEqual([item.price.status, item.price.reason], ['unknown', 'unconfirmed']);
    assert.deepEqual([item.site_visit.status, item.site_visit.reason], ['unknown', 'unconfirmed']);
  });

  it('hash mode: the price leaf row carries its own freshness (30 day default)', () => {
    const item = carpet(setup([['catalog.service.svc_carpet.price', { confirmed_at: daysAgo(31) }]], true));
    assert.deepEqual([item.price.status, item.price.reason], ['unknown', 'stale']);
    assert.equal(item.reconfirm, true);
  });

  it('a nameless row is never surfaced, even with owner-confirmed leaf hashes', () => {
    for (const hashMode of [true, false]) {
      const p = profile({
        servicesCatalog: [
          { id: 'svc_named', name: 'Carpet cleaning', price_range: 'KES 1,500' },
          { id: 'svc_nameless', name: '', price_range: 'KES 777', site_visit_required: true },
          { id: 'svc_blank', name: '   ', price_range: 'KES 888' },
        ],
        productCatalog: [{ sku: 'P9', price: '999', in_stock: 'yes' }],
      });
      const row = tenantRowFromProfile(p);
      const rows = [
        'catalog.service.svc_named.name',
        'catalog.service.svc_nameless.name',
        'catalog.service.svc_nameless.price',
        'catalog.service.svc_nameless.site_visit',
        'catalog.service.svc_blank.price',
        'catalog.product.P9.name',
        'catalog.product.P9.price',
      ].map((field_path) => ({
        field_path,
        source: 'owner',
        confirmed_at: NOW.toISOString(),
        value_hash: hashFactValue(factValueForPath(field_path, row)),
      }));
      const hp = { ...p, fieldMeta: indexFieldMeta(rows, { hashMode }) };
      const cat = readCatalog(hp, { now: NOW, hashMode });
      assert.deepEqual(cat.services.map((i) => i.name), ['Carpet cleaning'], `hashMode ${hashMode}`);
      assert.deepEqual(cat.products, [], `hashMode ${hashMode}`);
      for (const q of ['KES 777', '777', 'P9', '999']) {
        assert.notEqual(lookupCatalogItem(hp, q, { now: NOW, hashMode }).status, 'found', q);
      }
      assert.doesNotMatch(formatGigoFactsForPrompt(hp, { now: NOW, hashMode }), /777|888|999/);
    }
  });

  it('flag off: leaf rows are ignored', () => {
    const item = carpet(setup([['catalog.service.svc_carpet.price', { value_hash: null, source: 'seed' }]], false));
    assert.equal(item.price.status, 'known');
    assert.equal('reconfirm' in item, false);
  });
});

describe('gigo unknown speech', () => {
  it('serve confirms with the owner; message mode takes a message; no callback promise', () => {
    const serve = unknownFactLine({ topic: 'Price' });
    assert.equal(serve, "I don't have the price confirmed. Let me confirm with the owner.");
    const msg = unknownFactLine({ topic: 'Price', afterHoursMode: 'message' });
    assert.equal(msg, "I don't have the price confirmed. I can take a message for the owner.");
    assert.match(unknownFactLine({ language: 'sw' }), /Nitathibitisha na mwenye biashara/);
    assert.match(unknownFactLine({ language: 'sheng', afterHoursMode: 'message' }), /ujumbe/);
    for (const line of [serve, msg, unknownFactLine({ language: 'sw' })]) {
      assert.doesNotMatch(line, /call you back|callback|tutakupigia/i);
      assert.ok(line.split(/\s+/).length <= 25);
    }
  });
});

describe('gigo read tools', () => {
  it('declares three read-only tools', () => {
    assert.deepEqual(GIGO_FACT_TOOLS.map((t) => t.name), ['read_business_fact', 'lookup_catalog_item', 'check_coverage']);
    const keys = GIGO_FACT_TOOLS[0].parameters.properties.key.enum;
    assert.ok(!keys.includes('team_notify.whatsapp'));
  });

  it('read_business_fact returns the value or the unknown line', () => {
    const p = profile();
    const ok = runFactTool('read_business_fact', { key: 'payments.methods' }, p, { now: NOW });
    assert.equal(ok.status, 'known');
    assert.equal(ok.say, undefined);
    const miss = runFactTool('read_business_fact', { key: 'policies.returns' }, p, { now: NOW });
    assert.equal(miss.status, 'unknown');
    assert.equal(miss.value, undefined);
    assert.equal(miss.say, "I don't have the returns confirmed. Let me confirm with the owner.");
    const hidden = runFactTool('read_business_fact', { key: 'team_notify.whatsapp' }, p);
    assert.equal(hidden.ok, false);
    assert.equal(hidden.value, undefined);
  });

  it('lookup_catalog_item never invents a missing price, stock, or lead time', () => {
    const p = profile({ afterHoursMode: 'message' });
    const r = runFactTool('lookup_catalog_item', { query: 'stapler' }, p, { now: NOW });
    assert.equal(r.status, 'found');
    assert.equal(r.value.price, null);
    assert.equal(r.value.in_stock, null);
    assert.equal(r.value.lead_time, null);
    assert.deepEqual(r.value.unknown, ['price', 'in_stock', 'lead_time']);
    assert.match(r.say.price, /take a message/);
    const sofa = runFactTool('lookup_catalog_item', { query: 'sofa' }, profile(), { now: NOW });
    assert.deepEqual(sofa.value.unknown, ['price', 'lead_time']);
  });

  it('check_coverage unknown never says outside coverage', () => {
    const r = runFactTool('check_coverage', { place: 'Nakuru' }, profile({ businessPolicies: {} }));
    assert.equal(r.status, 'unknown');
    assert.doesNotMatch(r.say, /outside/i);
  });

  it('unknown tool and bad input do not throw', () => {
    assert.equal(runFactTool('nope', {}, profile()).reason, 'no_such_tool');
    assert.equal(runFactTool('lookup_catalog_item', null, null).status, 'unknown');
  });
});

describe('gigo prompt block', () => {
  it('states confirmed facts and lists unknown topics with the confirm line', () => {
    const text = formatGigoFactsForPrompt(profile(), { now: NOW });
    assert.match(text, /CONFIRMED BUSINESS FACTS/);
    assert.match(text, /Payment: M-Pesa till 123456 or cash\./);
    assert.match(text, /Carpet cleaning, price KES 1,500 - 3,000, lead time 2-3 days/);
    assert.match(text, /Sofa cleaning, price UNKNOWN, lead time UNKNOWN/);
    assert.match(text, /Stapler, price UNKNOWN, stock UNKNOWN/);
    assert.match(text, /UNKNOWN \(not confirmed by the owner/);
    assert.match(text, /- Returns/);
    assert.match(text, /Let me confirm with the owner/);
  });

  it('an empty file is all unknown and states nothing', () => {
    const text = formatGigoFactsForPrompt(
      { businessName: '', agentName: 'Receptionist', servicesCatalog: [], productCatalog: [], faqs: [] },
      { now: NOW }
    );
    assert.match(text, /\(none confirmed\)/);
    assert.match(text, /Opening hours/);
    assert.match(text, /Catalogue items not confirmed/);
  });

  it('no vendor names in caller or owner copy', () => {
    const copy = [
      formatGigoFactsForPrompt(profile(), { now: NOW }),
      unknownFactLine({}),
      unknownFactLine({ language: 'sw' }),
      ...GIGO_FACT_TOOLS.map((t) => t.description),
    ].join('\n');
    assert.doesNotMatch(copy, /gemini|soniox|sautikit|supabase|railway|vercel|openai|google|wallet|prepaid/i);
  });
});
