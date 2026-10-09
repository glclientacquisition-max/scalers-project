const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  targetGuard,
  isEmptyFactValue,
  runBackfill,
  PROD_REF,
  STAGING_REF,
} = require('../scripts/backfillFactHashes');
const { hashFactValue, catalogRowFactValue, faqFactValue } = require('../src/conversation/factHash');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const STAGING = `https://${STAGING_REF}.supabase.co`;

/** Minimal PostgREST-ish fake: records every query, filters in memory. */
function fakeClient({ meta = [], tenants = [], metaError = null, updateError = null } = {}) {
  const calls = [];
  const tables = { tenant_field_meta: meta, tenants };
  function query(table) {
    const q = { table, op: 'select', filters: [], patch: null, range: null };
    const api = {
      select(cols) { q.cols = cols; return api; },
      update(patch) { q.op = 'update'; q.patch = patch; return api; },
      eq(c, v) { q.filters.push((r) => r[c] === v); return api; },
      is(c, v) { q.filters.push((r) => (r[c] ?? null) === v); return api; },
      in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return api; },
      not(c, op, list) {
        assert.equal(op, 'in');
        const ids = list.replace(/^\(|\)$/g, '').split(',');
        q.filters.push((r) => !ids.includes(r[c]));
        return api;
      },
      order() { return api; },
      range(a, b) { q.range = [a, b]; return api; },
      then(resolve, reject) {
        calls.push(q);
        try {
          if (q.op === 'select' && table === 'tenant_field_meta' && metaError) return resolve({ data: null, error: metaError });
          const rows = tables[table].filter((r) => q.filters.every((f) => f(r)));
          if (q.op === 'update') {
            if (updateError) return resolve({ data: null, error: updateError });
            for (const r of rows) Object.assign(r, q.patch);
            return resolve({ data: rows, error: null });
          }
          const out = q.range ? rows.slice(q.range[0], q.range[1] + 1) : rows;
          return resolve({ data: out.map((r) => ({ ...r })), error: null });
        } catch (e) {
          return reject(e);
        }
      },
    };
    return api;
  }
  return { from: query, calls };
}

const tenant1 = {
  id: T1,
  business_name: '  Mama  Mboga ',
  vertical: 'retail',
  alert_email: '',
  business_policies: { payment: ['M-Pesa', 'cash'], holds: { allowed: true }, delivery: null },
  services_catalog: [{ id: 'svc-cut', name: 'Haircut', price: 500, site_visit_required: false }, { id: 'svc_empty', name: '' }],
  product_catalog: [],
  faqs: [{ question: 'Open Sunday?', answer: 'No' }, { question: 'Parking?', answer: '' }],
};
const tenant2 = { id: T2, business_name: 'Fundi Co', business_policies: {} };

function metaRows() {
  return [
    { tenant_id: T1, field_path: 'identity.business_name', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'payments.methods', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'policies.holds', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'catalog.service.svc-cut.name', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'faqs.1', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'catalog.service.svc-cut.price', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'catalog.service.svc-cut.site_visit', source: 'owner', value_hash: null },
    // empty values: never confirm
    { tenant_id: T1, field_path: 'team.notify.email', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'policies.delivery', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'catalog.service.svc_empty.name', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'faqs.2', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'catalog.service.svc_empty.price', source: 'owner', value_hash: null },
    // unresolved
    { tenant_id: T1, field_path: 'catalog.service.svc-gone.name', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'faqs.9', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'catalog.service.svc-gone.price', source: 'owner', value_hash: null },
    { tenant_id: T1, field_path: 'mystery.path', source: 'owner', value_hash: null },
    // not owner: untouched
    { tenant_id: T1, field_path: 'identity.vertical', source: 'seed', value_hash: null },
    { tenant_id: T2, field_path: 'identity.business_name', source: 'owner', value_hash: null },
    { tenant_id: T3, field_path: 'identity.business_name', source: 'owner', value_hash: null }, // tenant row gone
  ];
}

const quiet = () => {};

describe('backfillFactHashes args', () => {
  it('requires a scope, accepts repeatable --tenant and --all-except', () => {
    assert.match(parseArgs([]).errors.join(), /scope required/);
    const a = parseArgs(['--tenant', T1, '--tenant', T2, '--apply']);
    assert.deepEqual(a.tenants, [T1, T2]);
    assert.equal(a.apply, true);
    assert.deepEqual(a.errors, []);
    const b = parseArgs(['--all-except', `${T1}, ${T2}`]);
    assert.deepEqual(b.allExcept, [T1, T2]);
    assert.equal(b.apply, false);
    assert.match(parseArgs(['--tenant', T1, '--all-except', T2]).errors.join(), /not both/);
    assert.match(parseArgs(['--tenant']).errors.join(), /needs a value/);
    assert.match(parseArgs(['--tenant', "x'; drop"]).errors.join(), /not a tenant id/);
    assert.match(parseArgs(['--tenant', T1, '--bogus']).errors.join(), /unknown argument/);
  });
});

describe('backfillFactHashes target guard', () => {
  it('allows staging and local, refuses prod and unknown hosts without the flag', () => {
    assert.equal(targetGuard(STAGING).ok, true);
    assert.equal(targetGuard(STAGING).target, 'staging');
    for (const u of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321', 'http://kong.localhost']) {
      assert.equal(targetGuard(u).ok, true, u);
    }
    const prod = targetGuard(`https://${PROD_REF}.supabase.co`);
    assert.equal(prod.ok, false);
    assert.equal(prod.target, 'prod');
    assert.equal(targetGuard('https://abcdefghijklmnopqrst.supabase.co').ok, false);
    // staging ref smuggled into another host is not staging
    assert.equal(targetGuard(`https://${STAGING_REF}.supabase.co.evil.example`).ok, false);
    assert.equal(targetGuard(`https://${PROD_REF}.supabase.co`, { iHaveAlvinOk: true }).ok, true);
    assert.equal(targetGuard('').ok, false);
  });

  it('refuses prod before touching the client, even for a dry run', async () => {
    const client = fakeClient({ meta: metaRows(), tenants: [tenant1] });
    const lines = [];
    const r = await runBackfill({ client, supabaseUrl: `https://${PROD_REF}.supabase.co`, args: parseArgs(['--tenant', T1]), log: (l) => lines.push(l) });
    assert.equal(r.code, 2);
    assert.equal(client.calls.length, 0);
    assert.match(lines.join('\n'), /--i-have-alvin-ok/);
  });

  it('prod (Aris) runs with --i-have-alvin-ok: dry run, then --apply', async () => {
    const meta = metaRows();
    const client = fakeClient({ meta, tenants: [tenant1] });
    const prodUrl = `https://${PROD_REF}.supabase.co`;
    const lines = [];
    const dry = await runBackfill({ client, supabaseUrl: prodUrl, args: parseArgs(['--tenant', T1, '--i-have-alvin-ok']), log: (l) => lines.push(l) });
    assert.equal(dry.code, 0);
    assert.match(lines[0], /target: prod \| mode: dry run/);
    assert.ok(meta.every((m) => m.value_hash === null));
    const applied = await runBackfill({ client, supabaseUrl: prodUrl, args: parseArgs(['--tenant', T1, '--apply', '--i-have-alvin-ok']), log: quiet });
    assert.equal(applied.code, 0);
    assert.equal(applied.summary.totals.written, 7);
  });

  it('bad args exit 2 without touching the client', async () => {
    const client = fakeClient();
    const r = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--apply']), log: quiet });
    assert.equal(r.code, 2);
    assert.equal(client.calls.length, 0);
  });
});

describe('backfillFactHashes run', () => {
  it('dry run plans hashes, skips empty, reports unresolved, writes nothing', async () => {
    const meta = metaRows();
    const client = fakeClient({ meta, tenants: [tenant1, tenant2] });
    const lines = [];
    const r = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--tenant', T1, '--tenant', T3]), log: (l) => lines.push(l) });
    assert.equal(r.code, 0);
    assert.ok(client.calls.every((c) => c.op === 'select'));
    assert.ok(meta.every((m) => m.value_hash === null));
    const t1 = r.summary.tenants.find((t) => t.tenant_id === T1);
    assert.deepEqual(
      { owner: t1.owner_rows, write: t1.to_write, empty: t1.skipped_empty, nameless: t1.skipped_nameless, unresolved: t1.unresolved, written: t1.written },
      { owner: 16, write: 7, empty: 4, nameless: 1, unresolved: 4, written: 0 }
    );
    const t3 = r.summary.tenants.find((t) => t.tenant_id === T3);
    assert.equal(t3.unresolved, 1);
    assert.equal(r.summary.tenants.some((t) => t.tenant_id === T2), false);
    const reasons = Object.fromEntries(r.summary.unresolved.map((u) => [`${u.tenant_id}:${u.field_path}`, u.reason]));
    assert.equal(reasons[`${T1}:catalog.service.svc-gone.name`], 'row_not_found');
    assert.equal(reasons[`${T1}:faqs.9`], 'row_not_found');
    assert.equal(reasons[`${T1}:mystery.path`], 'unknown_path');
    assert.equal(reasons[`${T1}:catalog.service.svc-gone.price`], 'row_not_found');
    assert.equal(reasons[`${T3}:identity.business_name`], 'tenant_not_found');
    const out = lines.join('\n');
    assert.match(out, /dry run/);
    assert.match(out, /skipped_nameless=1/);
    assert.match(out, /sample \(5\)/);
    assert.doesNotMatch(out, /Mama|M-Pesa|Haircut/, 'sample prints hashes, never values');
  });

  it('--apply writes lowercase hex hashes of the stored row for owner rows only', async () => {
    const meta = metaRows();
    const client = fakeClient({ meta, tenants: [tenant1, tenant2] });
    const r = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--all-except', T3, '--apply']), log: quiet });
    assert.equal(r.code, 0);
    const get = (t, p) => meta.find((m) => m.tenant_id === t && m.field_path === p).value_hash;
    assert.equal(get(T1, 'identity.business_name'), hashFactValue('  Mama  Mboga '));
    assert.equal(get(T1, 'identity.business_name'), hashFactValue('Mama Mboga'));
    assert.equal(get(T1, 'payments.methods'), hashFactValue(['M-Pesa', 'cash']));
    assert.equal(get(T1, 'policies.holds'), hashFactValue(true));
    assert.equal(get(T1, 'catalog.service.svc-cut.name'), hashFactValue(catalogRowFactValue(tenant1.services_catalog[0])));
    assert.equal(get(T1, 'faqs.1'), hashFactValue(faqFactValue(tenant1.faqs[0])));
    assert.equal(get(T1, 'catalog.service.svc-cut.price'), hashFactValue({ price: 500 }));
    assert.equal(get(T1, 'catalog.service.svc-cut.site_visit'), hashFactValue(false));
    assert.equal(get(T1, 'catalog.service.svc_empty.price'), null, 'empty leaf never confirmed');
    assert.equal(get(T2, 'identity.business_name'), hashFactValue('Fundi Co'));
    for (const m of meta) if (m.value_hash) assert.match(m.value_hash, /^[0-9a-f]{64}$/);
    for (const p of ['team.notify.email', 'policies.delivery', 'catalog.service.svc_empty.name', 'faqs.2', 'mystery.path', 'identity.vertical']) {
      assert.equal(get(T1, p), null, p);
    }
    assert.equal(get(T3, 'identity.business_name'), null, 'excluded tenant untouched');
    assert.equal(r.summary.totals.written, 8);
  });

  it('never overwrites an existing value_hash and is idempotent', async () => {
    const meta = [
      { tenant_id: T2, field_path: 'identity.business_name', source: 'owner', value_hash: 'ABC123' },
      { tenant_id: T2, field_path: 'identity.vertical', source: 'owner', value_hash: null },
    ];
    const client = fakeClient({ meta, tenants: [{ ...tenant2, vertical: 'home_services' }] });
    const args = parseArgs(['--tenant', T2, '--apply']);
    const first = await runBackfill({ client, supabaseUrl: STAGING, args, log: quiet });
    assert.equal(meta[0].value_hash, 'ABC123');
    assert.equal(first.summary.totals.kept_existing, 1);
    assert.equal(first.summary.totals.written, 1);
    const second = await runBackfill({ client, supabaseUrl: STAGING, args, log: quiet });
    assert.equal(second.summary.totals.written, 0);
    assert.equal(second.summary.totals.unchanged, 1);
  });

  it('exits 3 when the value_hash column is missing', async () => {
    for (const metaError of [
      { code: '42703', message: 'column tenant_field_meta.value_hash does not exist' },
      { code: 'PGRST204', message: "Could not find the 'value_hash' column of 'tenant_field_meta' in the schema cache" },
    ]) {
      const client = fakeClient({ metaError });
      const lines = [];
      const r = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--tenant', T1]), log: (l) => lines.push(l) });
      assert.equal(r.code, 3);
      assert.match(lines.join('\n'), /value_hash is missing/);
    }
    const other = await runBackfill({ client: fakeClient({ metaError: { message: 'timeout' } }), supabaseUrl: STAGING, args: parseArgs(['--tenant', T1]), log: quiet });
    assert.equal(other.code, 4);
  });

  it('write errors exit 1', async () => {
    const client = fakeClient({ meta: metaRows(), tenants: [tenant1], updateError: { message: 'denied' } });
    const r = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--tenant', T1, '--apply']), log: quiet });
    assert.equal(r.code, 1);
    assert.equal(r.summary.totals.write_errors, 7);
  });

  it('services rows without ids: dry run warns, --apply refuses with exit 2 unless --allow-missing-ids', async () => {
    const legacy = { id: T2, business_name: 'Fundi Co', services_catalog: [{ name: 'Plumbing' }, { id: '7', name: 'Numeric id' }, { id: 'svc_ok', name: 'Ok' }] };
    const meta = () => [{ tenant_id: T2, field_path: 'identity.business_name', source: 'owner', value_hash: null }];

    let rows = meta();
    let lines = [];
    const dry = await runBackfill({ client: fakeClient({ meta: rows, tenants: [legacy] }), supabaseUrl: STAGING, args: parseArgs(['--tenant', T2]), log: (l) => lines.push(l) });
    assert.equal(dry.code, 0);
    assert.match(lines.join('\n'), new RegExp(`${T2}: 2 row\\(s\\)`));
    assert.deepEqual(dry.summary.missingIds, [{ tenant_id: T2, rows: 2 }]);

    rows = meta();
    lines = [];
    const client = fakeClient({ meta: rows, tenants: [legacy] });
    const refused = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--tenant', T2, '--apply']), log: (l) => lines.push(l) });
    assert.equal(refused.code, 2);
    assert.match(lines.join('\n'), /--allow-missing-ids/);
    assert.ok(client.calls.every((c) => c.op === 'select'), 'nothing written');
    assert.equal(rows[0].value_hash, null);

    const allowed = await runBackfill({ client, supabaseUrl: STAGING, args: parseArgs(['--tenant', T2, '--apply', '--allow-missing-ids']), log: quiet });
    assert.equal(allowed.code, 0);
    assert.equal(rows[0].value_hash, hashFactValue('Fundi Co'));
  });

  it('never confirms a .price / .site_visit leaf on a nameless row (skipped_nameless)', async () => {
    const tenant = {
      id: T2,
      services_catalog: [
        { id: 'svc_named', name: 'Carpet', price_range: 'KES 5', site_visit_required: true },
        { id: 'svc_nameless', name: '', price_range: 'KES 5', site_visit_required: true },
        { id: 'svc_blank', name: '   ', pricing_mode: 'quote', site_visit_required: false },
      ],
      product_catalog: [{ name: ' ', price: '9' }, { sku: 'P2', price: '10' }],
    };
    const leafPaths = [
      'catalog.service.svc_nameless.price',
      'catalog.service.svc_nameless.site_visit',
      'catalog.service.svc_blank.price',
      'catalog.service.svc_blank.site_visit',
      'catalog.product.1.price',
      'catalog.product.P2.price',
    ];
    const meta = [
      ...leafPaths,
      'catalog.service.svc_named.price',
      'catalog.service.svc_named.site_visit',
      'catalog.service.svc_nameless.name',
    ].map((field_path) => ({ tenant_id: T2, field_path, source: 'owner', value_hash: null }));
    const lines = [];
    const dry = await runBackfill({ client: fakeClient({ meta, tenants: [tenant] }), supabaseUrl: STAGING, args: parseArgs(['--tenant', T2]), log: (l) => lines.push(l) });
    assert.equal(dry.code, 0);
    const t = dry.summary.tenants[0];
    assert.deepEqual(
      { nameless: t.skipped_nameless, empty: t.skipped_empty, write: t.to_write },
      { nameless: 6, empty: 1, write: 2 },
      'six nameless leaves skipped; the nameless .name row is empty; only the named row leaves are planned'
    );
    assert.match(lines.join('\n'), /skipped_nameless=6/);
    assert.equal(dry.summary.totals.skipped_nameless, 6);

    const applied = await runBackfill({ client: fakeClient({ meta, tenants: [tenant] }), supabaseUrl: STAGING, args: parseArgs(['--tenant', T2, '--apply']), log: quiet });
    assert.equal(applied.summary.totals.written, 2);
    for (const p of leafPaths) assert.equal(meta.find((m) => m.field_path === p).value_hash, null, p);
    assert.equal(meta.find((m) => m.field_path === 'catalog.service.svc_named.price').value_hash, hashFactValue({ price: 'KES 5' }));
    assert.equal(meta.find((m) => m.field_path === 'catalog.service.svc_named.site_visit').value_hash, hashFactValue(true));
  });

  it('isEmptyFactValue', () => {
    assert.equal(isEmptyFactValue('identity.business_name', '   '), true);
    assert.equal(isEmptyFactValue('payments.methods', []), true);
    assert.equal(isEmptyFactValue('policies.returns', {}), true);
    assert.equal(isEmptyFactValue('policies.holds', false), false);
    assert.equal(isEmptyFactValue('catalog.service.x.name', { price: 5 }), true);
    assert.equal(isEmptyFactValue('catalog.service.x.price', { price: 5 }), false);
    assert.equal(isEmptyFactValue('catalog.service.x.site_visit', false), false);
    assert.equal(isEmptyFactValue('faqs.1', { question: 'q', answer: ' ' }), true);
  });
});
