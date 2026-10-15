'use strict';
// SPOKEN_CATALOGUE_ON_SAVE: compile on owner Save (background, hash-gated, rules fallback).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/knowledge/spokenCatalogueOnSave');
const { applyOwnerEdit, sourceHash } = require('../src/knowledge/spokenCatalogue');

const TID = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
const ON = { SPOKEN_CATALOGUE_ON_SAVE: '1' };
const base = () => ({ id: TID, services_catalog: [{ name: 'Sofa Cleaning (per seat)', price_range: 'KSh 800' }, { name: 'Carpet Cleaning (per room)', price_range: 'From KSh 2,200 per m²', notes: 'Shampoo, dry' }], product_catalog: [], service_areas: { areas: [{ id: 'area:kitengela', name: 'kitengela' }] }, business_locations: [], spoken_catalogue: null });

function fakeDb(row, { rpc = 'missing', cols = [] } = {}) {
  const calls = { inserts: [], updates: [], rpc: [], selects: 0 };
  const db = {
    calls,
    rpc: async (name, args) => { calls.rpc.push({ name, args }); if (rpc === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function' } }; row.spoken_catalogue = args.p_doc; return { error: null }; },
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select(c) { q.cols = c; return chain; },
        limit() { const missing = c => !['id', 'spoken_catalogue', ...cols].includes(c); return Promise.resolve({ error: missing(q.cols) ? { code: '42703' } : null }); },
        eq(k, v) { q.filters.push([k, v]); return chain; },
        lt() { return Promise.resolve({ error: null }); },
        maybeSingle: async () => { calls.selects++; return { data: JSON.parse(JSON.stringify(row)), error: null }; },
        insert: async (r) => { calls.inserts.push(r); return { error: null }; },
        update(p) { calls.updates.push({ table, p }); if (table === 'tenants') Object.assign(row, JSON.parse(JSON.stringify(p))); const u = { eq: () => u, lt: () => Promise.resolve({ error: null }), then: (r) => r({ error: null }) }; return u; },
      };
      return chain;
    },
  };
  return db;
}
const quiet = { log: () => {} };

test('flag off: no-op, nothing read or written', async () => {
  const db = fakeDb(base());
  assert.deepEqual(await S.runSpokenCatalogueCompile(TID, { db, env: {}, ...quiet }), { ok: true, skipped: 'flag_off' });
  assert.equal(S.scheduleSpokenCatalogueCompile(TID, { db, env: {} }).scheduled, false);
  assert.equal(db.calls.selects + db.calls.inserts.length + db.calls.updates.length, 0);
});

test('save triggers a compile: version row then live doc; no catalogue text in logs', async () => {
  S._resetColumnMemo();
  const row = base(); const db = fakeDb(row); const logs = [];
  const r = await S.runSpokenCatalogueCompile(TID, { db, env: ON, log: (m) => logs.push(m) });
  assert.equal(r.ok, true); assert.equal(r.version, 1); assert.equal(r.generator, 'rules');
  assert.equal(db.calls.inserts.length, 1);
  const ins = db.calls.inserts[0];
  assert.deepEqual(Object.keys(ins).sort(), ['doc', 'generator', 'issues', 'schema_version', 'source_hash', 'status', 'tenant_id', 'version']);
  assert.match(ins.source_hash, /^[0-9a-f]{64}$/); assert.equal(ins.status, 'draft');
  const live = db.calls.updates.find((u) => u.table === 'tenants').p;
  assert.deepEqual(Object.keys(live), ['spoken_catalogue'], 'live_version / compile_error absent on staging: not written');
  assert.equal(row.spoken_catalogue.sourceHash, sourceHash(S.profileFromRow(row)));
  for (const l of logs) assert.doesNotMatch(l, /sofa|carpet|kitengela|2,200|800/i);
});

test('scheduled from the Save path: returns at once, compiles in the background, bursts coalesce', async () => {
  const row = base(); const db = fakeDb(row);
  const a = S.scheduleSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  const b = S.scheduleSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  assert.equal(a.scheduled, true); assert.equal(b.coalesced, true);
  assert.equal(db.calls.inserts.length, 0, 'nothing ran before the Save returned');
  await a.done;
  assert.equal(db.calls.inserts.length, 1, 'second pass saw an unchanged hash');
});

test('unchanged hash skips the compile', async () => {
  const row = base(); const db = fakeDb(row);
  await S.runSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  const r = await S.runSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  assert.equal(r.skipped, 'unchanged'); assert.equal(db.calls.inserts.length, 1);
});

test('generate failure or timeout falls back to rules; the stored error is a code', async () => {
  for (const [generate, code] of [[async () => { throw new Error('Unexpected token S in "Sofa Cleaning"'); }, 'generate_failed'], [() => new Promise(() => {}), 'timeout']]) {
    const db = fakeDb(base());
    const r = await S.runSpokenCatalogueCompile(TID, { db, env: ON, generate, timeoutMs: 50, ...quiet });
    assert.equal(r.ok, true); assert.equal(r.generator, 'rules'); assert.equal(r.aiError, code);
    assert.ok(r.doc.entries.every((e) => e.spoken.en), 'rules output complete');
    assert.equal(db.calls.inserts[0].doc.aiError, code);
  }
});

test('owner edits survive a recompile of another row', async () => {
  const row = base(); const db = fakeDb(row);
  await S.runSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  const sofa = row.spoken_catalogue.entries.find((e) => /sofa/.test(e.id));
  row.spoken_catalogue = applyOwnerEdit(row.spoken_catalogue, { id: sofa.id, field: 'spoken', lang: 'sw', value: 'kuosha sofa kwa kiti' });
  row.services_catalog = [...row.services_catalog, { name: 'Interior Window Cleaning', price_range: 'KSh 200' }];
  const r = await S.runSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  assert.equal(r.version, 2);
  const kept = r.doc.entries.find((e) => e.id === sofa.id);
  assert.equal(kept.spoken.sw, 'kuosha sofa kwa kiti'); assert.equal(kept.edited, true);
  assert.ok(r.doc.entries.some((e) => /window/.test(e.id)));
});

test('one transaction through the RPC when Platform has created it; optional columns written when present', async () => {
  S._resetColumnMemo();
  const row = base(); const db = fakeDb(row, { rpc: 'ok' });
  const r = await S.runSpokenCatalogueCompile(TID, { db, env: ON, ...quiet });
  assert.equal(r.write.mode, 'rpc'); assert.equal(db.calls.inserts.length, 0);
  assert.equal(db.calls.rpc[0].name, 'save_spoken_catalogue_version');
  S._resetColumnMemo();
  const db2 = fakeDb(base(), { cols: ['live_version', 'compile_error'] });
  const r2 = await S.runSpokenCatalogueCompile(TID, { db: db2, env: ON, ...quiet });
  assert.deepEqual(r2.write, { mode: 'ordered', liveVersion: true, compileError: true });
  S._resetColumnMemo();
});

test('bad tenant id is refused', async () => {
  assert.equal((await S.runSpokenCatalogueCompile('x; drop', { db: fakeDb(base()), env: ON, ...quiet })).skipped, 'bad_tenant');
});
