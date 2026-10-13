// GIGO confirm v2: shared value hash (JS + TS twin), value_hash-gated
// confirmation, stable service ids, and the column-tolerant meta select.

// Fixtures here use P0 owner rows (no value_hash). An ambient FACT_HASH_MODE=on
// in the shell must not flip them; hash-mode cases set the flag per test.
delete process.env.FACT_HASH_MODE;
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  canonicalFactJson,
  hashFactValue,
  factValueForPath,
  catalogRowFactValue,
  stableRowId,
} = require('../src/conversation/factHash');
const {
  indexFieldMeta,
  isConfirmed,
  buildCompileSections,
  classifyRecord,
  factServices,
  factProducts,
  factFaqs,
  factPolicyMap,
  serviceFieldPath,
} = require('../src/conversation/provenance');
const { readFact, readCatalog } = require('../src/conversation/gigo');
const {
  selectTenantFieldMeta,
  isMissingColumnError,
  TENANT_FIELD_META_COLUMN_SETS,
} = require('../src/lib/tenantFieldMetaSelect');

const ROOT = path.join(__dirname, '..');
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/factHashVectors.json'), 'utf8')).vectors;

const [major, minor] = process.versions.node.split('.').map(Number);
const CAN_STRIP_TYPES = major > 22 || (major === 22 && minor >= 6);

/** Run an ESM script that imports dashboard TS. Returns parsed stdout JSON. */
function runTs(script, env = {}) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--import', './tests/registerTs.mjs', '--input-type=module', '-e', script],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FACT_HASH_MODE: '', ...env } }
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

const tsSkip = CAN_STRIP_TYPES ? false : `Node ${process.versions.node} has no --experimental-strip-types`;

describe('fact hash vectors', () => {
  it(`JS matches all ${VECTORS.length} shared vectors`, () => {
    assert.ok(VECTORS.length >= 30);
    for (const v of VECTORS) {
      assert.equal(canonicalFactJson(v.input), v.canonical, v.name);
      assert.equal(hashFactValue(v.input), v.sha256, v.name);
      assert.equal(
        crypto.createHash('sha256').update(v.canonical, 'utf8').digest('hex'),
        v.sha256,
        `${v.name}: sha256 of canonical`
      );
    }
  });

  it('the rules the vectors pin', () => {
    const h = hashFactValue;
    assert.equal(h(600), h('600.00'));
    assert.equal(h('600.0'), h('600'));
    assert.equal(h('  a \n b '), h('a b'));
    assert.notEqual(h('Paybill'), h('paybill'));
    assert.equal(h('Cafe\u0301'), h('Caf\u00e9'));
    assert.equal(h({ b: 1, a: 2 }), h({ a: 2, b: 1 }));
    assert.notEqual(h(['a', 'b']), h(['b', 'a']));
    assert.notEqual(h('0712345678'), h('712345678'));
    assert.notEqual(h('1,500'), h('1500'));
    assert.equal(h({ a: 1, b: undefined }), h({ a: 1 }));
    assert.equal(h(undefined), h(null));
    assert.match(h('x'), /^[0-9a-f]{64}$/);
  });

  it('TS twin matches all shared vectors', { skip: tsSkip }, () => {
    const out = runTs(`
      import { readFileSync } from 'node:fs';
      import { canonicalFactJson, hashFactValue } from './dashboard/src/lib/factHash.ts';
      const { vectors } = JSON.parse(readFileSync('./tests/fixtures/factHashVectors.json', 'utf8'));
      process.stdout.write(JSON.stringify(vectors.map((v) => [canonicalFactJson(v.input), hashFactValue(v.input)])));
    `);
    VECTORS.forEach((v, i) => {
      assert.equal(out[i][0], v.canonical, v.name);
      assert.equal(out[i][1], v.sha256, v.name);
    });
  });

  it('TS pure sha256 matches node crypto across block sizes and unicode', { skip: tsSkip }, () => {
    const inputs = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'y'.repeat(1000), 'Karibu \u{1F44B} \u00e9\u0301'];
    const out = runTs(`
      import { sha256Hex } from './dashboard/src/lib/factHash.ts';
      process.stdout.write(JSON.stringify(${JSON.stringify(inputs)}.map(sha256Hex)));
    `);
    inputs.forEach((s, i) => {
      assert.equal(out[i], crypto.createHash('sha256').update(s, 'utf8').digest('hex'), `len ${s.length}`);
    });
  });
});

const TENANT = {
  business_name: 'Done and Dusted',
  hours_schedule: { days: { mon: { open: '08:00', close: '17:00' } } },
  business_policies: { payment: 'M-Pesa till 123456', coverage_areas: ['county:nairobi'], holds: { allowed: 'yes' } },
  faqs: [{ question: 'Parking?', answer: 'Behind the shop.', status: 'golden', source: 'owner' }],
  services_catalog: [
    { id: 'svc_carpet', name: 'Carpet cleaning', price_range: 'KES 1,500', in_stock: '', source: 'owner' },
    { name: 'Sofa cleaning', price_range: '2000' },
  ],
  product_catalog: [{ name: 'Ream', sku: 'P1', price: 650 }],
};

describe('factValueForPath', () => {
  it('maps field paths to the stored value', () => {
    assert.equal(factValueForPath('identity.business_name', TENANT), 'Done and Dusted');
    assert.equal(factValueForPath('policies.payment', TENANT), 'M-Pesa till 123456');
    assert.equal(factValueForPath('payments.methods', TENANT), 'M-Pesa till 123456');
    assert.deepEqual(factValueForPath('policies.coverage_areas', TENANT), ['county:nairobi']);
    assert.equal(factValueForPath('policies.holds.allowed', TENANT), 'yes');
    assert.deepEqual(factValueForPath('faqs.1', TENANT), { question: 'Parking?', answer: 'Behind the shop.' });
    assert.deepEqual(factValueForPath('catalog.service.svc_carpet.name', TENANT), {
      id: 'svc_carpet',
      name: 'Carpet cleaning',
      price_range: 'KES 1,500',
    });
    assert.deepEqual(factValueForPath('catalog.service.2.name', TENANT), { name: 'Sofa cleaning', price_range: '2000' });
    assert.deepEqual(factValueForPath('catalog.product.P1.name', TENANT), { name: 'Ream', sku: 'P1', price: 650 });
    assert.equal(factValueForPath('policies.returns', TENANT), null);
    assert.equal(factValueForPath('catalog.service.9.name', TENANT), null);
    assert.equal(factValueForPath('nope.path', TENANT), undefined);
  });

  it('a catalogue row hash ignores envelope keys and empty leaves, and changes on a price edit', () => {
    const row = TENANT.services_catalog[0];
    assert.equal(
      hashFactValue(catalogRowFactValue(row)),
      hashFactValue(catalogRowFactValue({ ...row, source: 'import', status: 'golden', notes: '' }))
    );
    assert.notEqual(
      hashFactValue(catalogRowFactValue(row)),
      hashFactValue(catalogRowFactValue({ ...row, price_range: 'KES 1,800' }))
    );
  });

  it('TS twin reads the same values and hashes', { skip: tsSkip }, () => {
    const paths = [
      'identity.business_name', 'hours.weekly_grid', 'policies.payment', 'payments.methods',
      'policies.coverage_areas', 'policies.holds.allowed', 'faqs.1', 'catalog.service.svc_carpet.name',
      'catalog.service.2.name', 'catalog.product.P1.name', 'policies.returns',
    ];
    const out = runTs(`
      import { factValueForPath, hashFactValue } from './dashboard/src/lib/factHash.ts';
      const t = ${JSON.stringify(TENANT)};
      process.stdout.write(JSON.stringify(${JSON.stringify(paths)}.map((p) => hashFactValue(factValueForPath(p, t)))));
    `);
    paths.forEach((p, i) => assert.equal(out[i], hashFactValue(factValueForPath(p, TENANT)), p));
  });
});

describe('shared path vectors (factValueForPath)', () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/factHashVectors.json'), 'utf8'));
  const PATH_VECTORS = FIXTURE.pathVectors;

  it(`JS matches all ${PATH_VECTORS.length} path vectors, including .price and .site_visit`, () => {
    assert.ok(PATH_VECTORS.some((v) => /\.price$/.test(v.path)));
    assert.ok(PATH_VECTORS.some((v) => /\.site_visit$/.test(v.path)));
    for (const v of PATH_VECTORS) {
      const value = factValueForPath(v.path, FIXTURE.pathTenant);
      if (v.unknownPath) {
        assert.equal(value, undefined, v.name);
        continue;
      }
      assert.deepEqual(value, v.value, v.name);
      assert.equal(hashFactValue(value), v.sha256, v.name);
    }
  });

  it('a price or site visit edit changes the leaf hash; whitespace does not', () => {
    const t = FIXTURE.pathTenant;
    const leaf = (p, tenant) => hashFactValue(factValueForPath(p, tenant));
    const edited = JSON.parse(JSON.stringify(t));
    edited.services_catalog[1].priceRange = 'KES 900';
    assert.equal(leaf('catalog.service.2.price', edited), leaf('catalog.service.2.price', t));
    edited.services_catalog[1].priceRange = 'KES 950';
    assert.notEqual(leaf('catalog.service.2.price', edited), leaf('catalog.service.2.price', t));
    edited.services_catalog[0].site_visit_required = 'yes';
    assert.notEqual(leaf('catalog.service.svc_carpet.site_visit', edited), leaf('catalog.service.svc_carpet.site_visit', t));
    // the leaf follows the id, not the position
    const moved = JSON.parse(JSON.stringify(t));
    moved.services_catalog.reverse();
    assert.equal(leaf('catalog.service.svc_carpet.price', moved), leaf('catalog.service.svc_carpet.price', t));
  });

  it('TS twin matches all path vectors', { skip: tsSkip }, () => {
    const out = runTs(`
      import { readFileSync } from 'node:fs';
      import { factValueForPath, hashFactValue } from './dashboard/src/lib/factHash.ts';
      const f = JSON.parse(readFileSync('./tests/fixtures/factHashVectors.json', 'utf8'));
      process.stdout.write(JSON.stringify(f.pathVectors.map((v) => {
        const value = factValueForPath(v.path, f.pathTenant);
        return value === undefined ? { unknown: true } : { value, sha256: hashFactValue(value) };
      })));
    `);
    PATH_VECTORS.forEach((v, i) => {
      if (v.unknownPath) return assert.deepEqual(out[i], { unknown: true }, v.name);
      assert.deepEqual(out[i].value, v.value, v.name);
      assert.equal(out[i].sha256, v.sha256, v.name);
    });
  });
});

describe('stable service ids', () => {
  it('uses a non-numeric id, else the position', () => {
    assert.equal(serviceFieldPath(0, { id: 'svc_carpet' }), 'catalog.service.svc_carpet.name');
    assert.equal(serviceFieldPath(0, { id: '7' }), 'catalog.service.1.name');
    assert.equal(serviceFieldPath(1, { id: 'bad id!' }), 'catalog.service.2.name');
    assert.equal(serviceFieldPath(2), 'catalog.service.3.name');
    assert.equal(stableRowId({ id: '3f2a9c1e-0b7d-4f5e-9a51-2a1c0d9e8b7f' }), '3f2a9c1e-0b7d-4f5e-9a51-2a1c0d9e8b7f');
  });

  it('a confirmation follows the id when rows are reordered', () => {
    const carpet = { id: 'svc_carpet', name: 'Carpet cleaning', price_range: 'KES 1,500' };
    const carpetMeta = {
      field_path: 'catalog.service.svc_carpet.name',
      source: 'owner',
      value_hash: hashFactValue(catalogRowFactValue(carpet)),
    };
    const reordered = [{ name: 'New row', price_range: '100' }, carpet];
    // Hash mode: the new row has no meta row, so it is not confirmed.
    assert.deepEqual(factServices(reordered, hashIdx([carpetMeta])).map((r) => r.name), ['Carpet cleaning']);
    // Flag off: P0 fallback, unmarked rows stay owner.
    assert.deepEqual(factServices(reordered, indexFieldMeta([carpetMeta])).map((r) => r.name), ['New row', 'Carpet cleaning']);
  });
});

const hashIdx = (rows) => indexFieldMeta(rows, { hashMode: true });

function owner(fieldPath, value, extra = {}) {
  return { field_path: fieldPath, source: 'owner', value_hash: hashFactValue(value), ...extra };
}

describe('value_hash confirmation (JS)', () => {
  it('owner + matching hash is fact; edit, missing hash, or non-owner is not', () => {
    const v = 'M-Pesa till 123456';
    const ok = hashIdx([owner('policies.payment', v)]);
    assert.equal(ok.hashMode, true);
    assert.equal(classifyRecord({}, { fieldMeta: ok, fieldPath: 'policies.payment', value: v }).fact, true);
    assert.equal(
      classifyRecord({}, { fieldMeta: ok, fieldPath: 'policies.payment', value: '  M-Pesa   till 123456 ' }).fact,
      true,
      'whitespace-only edit keeps the confirmation'
    );
    const edited = classifyRecord({}, { fieldMeta: ok, fieldPath: 'policies.payment', value: 'M-Pesa till 999999' });
    assert.equal(edited.fact, false);
    assert.equal(edited.hashCheck, 'mismatch');
    const noHash = hashIdx([{ field_path: 'policies.payment', source: 'owner', value_hash: null }]);
    const r = classifyRecord({}, { fieldMeta: noHash, fieldPath: 'policies.payment', value: v });
    assert.equal(r.fact, false);
    assert.equal(r.hashCheck, 'missing');
    const imported = hashIdx([
      { ...owner('policies.payment', v), source: 'import', confirmed_at: '2026-10-01T00:00:00Z' },
    ]);
    assert.equal(classifyRecord({}, { fieldMeta: imported, fieldPath: 'policies.payment', value: v }).fact, false);
    assert.equal(classifyRecord({}, { fieldMeta: ok, fieldPath: 'policies.payment' }).fact, false, 'no value, no confirm');
  });

  it('the table row beats in-data owner hints', () => {
    const faq = { question: 'Parking?', answer: 'Behind the shop.', source: 'owner', confirmed: true, status: 'golden' };
    const seeded = hashIdx([{ field_path: 'faqs.1', source: 'seed', value_hash: null }]);
    assert.equal(factFaqs([faq], seeded).length, 0);
    const confirmed = hashIdx([owner('faqs.1', { question: faq.question, answer: faq.answer })]);
    const rows = factFaqs([faq], confirmed);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'golden');
    const unhashedOwner = hashIdx([{ field_path: 'faqs.1', source: 'owner', value_hash: '' }]);
    assert.equal(factFaqs([faq], unhashedOwner).length, 0);
  });

  it('policies, products, and services follow the hash', () => {
    const policies = { payment: 'M-Pesa till 123456', returns: 'Seven days with receipt.' };
    const meta = hashIdx([owner('policies.payment', policies.payment), owner('policies.returns', 'Fourteen days.')]);
    const split = factPolicyMap(policies, meta);
    assert.equal(split.policies.payment, 'M-Pesa till 123456');
    assert.equal(split.policies.returns, undefined);
    assert.ok(split.unknown.includes('Returns'));
    const ream = { name: 'Ream', sku: 'P1', price: 650 };
    const pmeta = hashIdx([owner('catalog.product.P1.name', catalogRowFactValue({ ...ream, price: '650.00' }))]);
    assert.equal(factProducts([ream], pmeta).length, 1, '650 and "650.00" hash the same');
    assert.equal(factProducts([{ ...ream, price: 700 }], pmeta).length, 0, 'a price edit reopens the row');
  });

  it('no meta row, or a row without value_hash (column absent), is unconfirmed in hash mode', () => {
    const noCol = hashIdx([{ field_path: 'policies.payment', source: 'owner' }]);
    const r = classifyRecord({}, { fieldMeta: noCol, fieldPath: 'policies.payment', value: 'x y' });
    assert.equal(r.fact, false);
    assert.equal(r.hashCheck, 'missing');
    const none = classifyRecord({ source: 'owner', confirmed: true }, { fieldMeta: hashIdx([]), fieldPath: 'policies.payment', value: 'x y' });
    assert.equal(none.fact, false);
    assert.equal(none.hashCheck, 'no_row');
    const noTable = classifyRecord({}, { fieldMeta: null, fieldPath: 'policies.payment', value: 'x y', hashMode: true });
    assert.equal(noTable.fact, false);
    assert.equal(indexFieldMeta(null, { hashMode: true }).hashMode, true);
    assert.equal(indexFieldMeta(null), null);
  });

  it('gigo readers use the hash', () => {
    const profile = {
      businessPolicies: { payment: 'M-Pesa till 123456' },
      hoursSchedule: { days: { mon: { open: '08:00', close: '17:00' } } },
      servicesCatalog: [{ id: 'svc_carpet', name: 'Carpet cleaning', price_range: 'KES 1,500' }],
      fieldMeta: hashIdx([
        owner('policies.payment', 'M-Pesa till 123456'),
        owner('hours.weekly_grid', { days: { mon: { open: '08:00', close: '18:00' } } }),
        owner('catalog.service.svc_carpet.name', { id: 'svc_carpet', name: 'Carpet cleaning', price_range: 'KES 1,500' }),
      ]),
    };
    assert.equal(readFact(profile, 'payments.methods').status, 'known');
    const hours = readFact(profile, 'hours.weekly');
    assert.equal(hours.status, 'unknown');
    assert.equal(hours.reason, 'unconfirmed');
    const cat = readCatalog(profile);
    assert.equal(cat.services[0].fieldPath, 'catalog.service.svc_carpet.name');
    assert.equal(cat.services[0].price.value.text, 'KES 1,500');
  });
});

describe('FACT_HASH_MODE flag (JS)', () => {
  function withEnv(value, fn) {
    const prev = process.env.FACT_HASH_MODE;
    if (value === undefined) delete process.env.FACT_HASH_MODE;
    else process.env.FACT_HASH_MODE = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.FACT_HASH_MODE;
      else process.env.FACT_HASH_MODE = prev;
    }
  }
  const meta = () => indexFieldMeta([{ field_path: 'policies.payment', source: 'owner', value_hash: 'f'.repeat(64) }]);
  const classify = (opts = {}) =>
    classifyRecord({}, { fieldMeta: meta(), fieldPath: 'policies.payment', value: 'M-Pesa', ...opts });

  it('is on only when exactly "on"', () => {
    assert.equal(withEnv('on', () => classify()).fact, false, 'on: hash mismatch');
    for (const v of [undefined, '', 'ON', 'On', ' on', '1', 'true', 'yes', 'off']) {
      assert.equal(withEnv(v, () => classify()).fact, true, `env ${JSON.stringify(v)} is off`);
      assert.equal(withEnv(v, () => classify()).hashCheck, undefined);
    }
  });

  it('an explicit { hashMode } beats env, both ways', () => {
    assert.equal(withEnv('on', () => classify({ hashMode: false })).fact, true);
    assert.equal(withEnv(undefined, () => classify({ hashMode: true })).fact, false);
    assert.equal(withEnv('on', () => isConfirmed({ confirmed: true }, { hashMode: false })), true);
    assert.equal(withEnv('on', () => isConfirmed({ confirmed: true })), false);
    assert.equal(withEnv(undefined, () => isConfirmed({ confirmed: true })), true);
  });

  it('flag off: rows with value_hash give exactly the P0 compile output', () => {
    const fixture = {
      faqs: [{ question: 'Parking?', answer: 'Behind the shop.' }, { question: 'Wifi?', answer: 'Yes.' }],
      businessPolicies: { payment: 'M-Pesa till 1', returns: 'Seven days.' },
      productCatalog: [{ name: 'Ream', sku: 'P1', price: '650' }],
      servicesCatalog: [{ id: 'svc_a', name: 'Carpet', price_range: '1500' }],
    };
    const p0Rows = [
      { field_path: 'faqs.2', source: 'seed' },
      { field_path: 'policies.returns', source: 'import' },
      { field_path: 'policies.payment', source: 'owner' },
    ];
    const hashedRows = p0Rows.map((r) => ({ ...r, value_hash: 'a'.repeat(64), last_verified_at: null, stale_after_days: null }));
    withEnv(undefined, () => {
      const a = buildCompileSections({ ...fixture, fieldMeta: indexFieldMeta(p0Rows) });
      const b = buildCompileSections({ ...fixture, fieldMeta: indexFieldMeta(hashedRows) });
      assert.deepEqual(b, a);
      assert.deepEqual(factServices(fixture.servicesCatalog, indexFieldMeta(hashedRows)).length, 1);
    });
  });

  it('buildCompileSections and gigo readers take { hashMode }', () => {
    const rows = [owner('policies.payment', 'M-Pesa till 1')];
    withEnv(undefined, () => {
      const on = buildCompileSections({ businessPolicies: { payment: 'M-Pesa till 1', returns: 'Seven days.' }, fieldMeta: indexFieldMeta(rows), hashMode: true });
      assert.match(on.policiesText, /M-Pesa till 1/);
      assert.doesNotMatch(on.policiesText, /Seven days/, 'returns has no meta row');
      const profile = { businessPolicies: { payment: 'M-Pesa till 1', returns: 'Seven days.' }, fieldMeta: indexFieldMeta(rows) };
      assert.equal(readFact(profile, 'policies.returns').status, 'known', 'flag off: P0');
      assert.equal(readFact(profile, 'policies.returns', { hashMode: true }).reason, 'unconfirmed');
      assert.equal(readFact(profile, 'payments.methods', { hashMode: true }).status, 'known');
      assert.equal(readFact({ businessPolicies: { payment: 'x y z' } }, 'payments.methods', { hashMode: true }).reason, 'unconfirmed');
    });
  });
});

describe('value_hash confirmation (TS twin)', () => {
  it('classifies the same as JS', { skip: tsSkip }, () => {
    const v = 'M-Pesa till 123456';
    const cases = [
      { rows: [owner('policies.payment', v)], path: 'policies.payment', value: v },
      { rows: [owner('policies.payment', v)], path: 'policies.payment', value: 'M-Pesa till 999999' },
      { rows: [{ field_path: 'policies.payment', source: 'owner', value_hash: null }], path: 'policies.payment', value: v },
      { rows: [{ field_path: 'policies.payment', source: 'owner' }], path: 'policies.payment', value: v },
      { rows: [owner('policies.payment', v)], path: 'policies.payment', value: '600.00' },
    ];
    const services = [{ name: 'New row', price_range: '100' }, { id: 'svc_carpet', name: 'Carpet cleaning', price_range: '1500' }];
    const svcRows = [
      { field_path: 'catalog.service.1.name', source: 'seed', value_hash: null },
      owner('catalog.service.svc_carpet.name', { id: 'svc_carpet', name: 'Carpet cleaning', price_range: '1500.0' }),
    ];
    const out = runTs(`
      import { indexFieldMeta, classifyRecord, factServices } from './dashboard/src/lib/provenance.ts';
      const cases = ${JSON.stringify(cases)};
      const run = (hashMode) => cases.map((c) => classifyRecord({}, { fieldMeta: indexFieldMeta(c.rows), fieldPath: c.path, value: c.value, hashMode }));
      const svc = factServices(${JSON.stringify(services)}, indexFieldMeta(${JSON.stringify(svcRows)}, { hashMode: true })).map((r) => r.name);
      // FACT_HASH_MODE=on is set on this child: the TS twin must ignore env.
      const envIgnored = classifyRecord({}, { fieldMeta: indexFieldMeta(cases[3].rows), fieldPath: 'policies.payment', value: 'x' });
      process.stdout.write(JSON.stringify({ on: run(true), off: run(false), svc, envIgnored }));
    `, { FACT_HASH_MODE: 'on' });
    for (const hashMode of [true, false]) {
      const js = cases.map((c) => classifyRecord({}, { fieldMeta: indexFieldMeta(c.rows), fieldPath: c.path, value: c.value, hashMode }));
      assert.deepEqual(out[hashMode ? 'on' : 'off'], js, `hashMode ${hashMode}`);
    }
    assert.deepEqual(out.svc, factServices(services, hashIdx(svcRows)).map((r) => r.name));
    assert.deepEqual(out.svc, ['Carpet cleaning']);
    assert.equal(out.envIgnored.fact, true);
    assert.equal(out.envIgnored.hashCheck, undefined);
  });
});

describe('listTenantFieldMeta column step-down', () => {
  const missing = (col) => ({ code: '42703', message: `column tenant_field_meta.${col} does not exist` });

  it('selects value_hash and freshness when the columns exist', async () => {
    const seen = [];
    const res = await selectTenantFieldMeta(async (cols) => {
      seen.push(cols);
      return { data: [{ field_path: 'policies.payment', source: 'owner', value_hash: 'abc' }], error: null };
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /value_hash/);
    assert.match(seen[0], /last_verified_at, stale_after_days/);
    assert.equal(res.rows.length, 1);
  });

  it('steps down when value_hash is not on this database, and rows then keep P0 rules', async () => {
    const seen = [];
    const res = await selectTenantFieldMeta(async (cols) => {
      seen.push(cols);
      if (cols.includes('value_hash')) return { data: null, error: missing('value_hash') };
      return { data: [{ field_path: 'policies.payment', source: 'owner', last_verified_at: null, stale_after_days: null }], error: null };
    });
    assert.equal(seen.length, 2);
    assert.equal(res.columns, TENANT_FIELD_META_COLUMN_SETS[1]);
    const row = { fieldPath: 'policies.payment', value: 'x' };
    assert.equal(classifyRecord({}, { ...row, fieldMeta: hashIdx(res.rows) }).hashCheck, 'missing');
    assert.equal(classifyRecord({}, { ...row, fieldMeta: indexFieldMeta(res.rows), hashMode: false }).fact, true);
  });

  it('falls back to the P0 columns, and passes other errors through', async () => {
    const res = await selectTenantFieldMeta(async (cols) =>
      cols.includes('last_verified_at') ? { data: null, error: missing('last_verified_at') } : { data: [], error: null }
    );
    assert.equal(res.columns, TENANT_FIELD_META_COLUMN_SETS[2]);
    assert.deepEqual(res.rows, []);
    const table = await selectTenantFieldMeta(async () => ({
      data: null,
      error: { code: '42P01', message: 'relation "public.tenant_field_meta" does not exist' },
    }));
    assert.equal(table.rows, null);
    assert.equal(table.error.code, '42P01');
    assert.equal(isMissingColumnError({ message: "Could not find the 'value_hash' column of 'tenant_field_meta' in the schema cache" }), true);
    assert.equal(isMissingColumnError({ message: 'permission denied for table tenant_field_meta' }), false);
  });

  it('db.js listTenantFieldMeta goes through the step-down', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/db.js'), 'utf8');
    const body = src.slice(src.indexOf('async function listTenantFieldMeta'), src.indexOf('async function upsertTenantFieldMeta'));
    assert.match(body, /selectTenantFieldMeta/);
    assert.doesNotMatch(body, /\.select\('field_path, source, confirmed_by, confirmed_at'\)/);
  });
});
