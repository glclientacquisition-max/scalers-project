'use strict';
// SPOKEN_CATALOGUE_ON_SAVE (default off, staging only). After an owner Save on
// services / products / service areas / locations, Desk pings Brain; Brain
// re-reads the tenant row, and only when the catalogue sourceHash changed it
// compiles the spoken catalogue in the background (never on the Save response
// path), with a 10 s cap on the AI pass and the rules output as fallback.
// Logs carry ids, counts and short codes only: never catalogue text.
//
// Write: one transaction through the RPC public.save_spoken_catalogue_version
// when Platform has created it; until then two ordered writes (version row,
// then tenants.spoken_catalogue), so a failure in between leaves only an extra
// draft history row, never a live doc without history. Optional columns
// tenants.live_version and versions.compile_error are written only if they exist.
// Go-live (Alvin): every successful compile goes live (tenants.spoken_catalogue +
// live_version); the version row stays 'draft' until an owner approves it.
const { compileSpokenCatalogue, needsRegeneration } = require('./spokenCatalogue');

const ON = /^(1|true|on|yes)$/i;
const enabled = (env = process.env) => ON.test(String(env.SPOKEN_CATALOGUE_ON_SAVE || '').trim());
const TENANT_COLS = 'id,services_catalog,product_catalog,service_areas,business_locations,spoken_catalogue';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function profileFromRow(r) {
  return { tenantId: r.id, servicesCatalog: r.services_catalog || [], productCatalog: r.product_catalog || [], serviceAreas: r.service_areas || null, businessLocations: r.business_locations || [] };
}

// generate wrapped with a hard timeout; the error is a code, never model text
function withTimeout(generate, ms) {
  if (typeof generate !== 'function') return null;
  return (args) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve().then(() => generate(args)).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); reject(new Error('generate_failed')); });
  });
}
const aiCode = (e) => (e == null ? null : /^timeout$/.test(String(e)) ? 'timeout' : 'generate_failed');

const optionalCols = new Map(); // memo per process: column -> exists
async function hasColumn(db, table, col) {
  const k = `${table}.${col}`;
  if (optionalCols.has(k)) return optionalCols.get(k);
  const { error } = await db.from(table).select(col).limit(0);
  const ok = !error; // 42703 / PGRST204 when missing
  optionalCols.set(k, ok);
  return ok;
}

async function writeVersion(db, tenantId, doc, { log }) {
  const compileError = doc.aiError ? String(doc.aiError).slice(0, 200) : null;
  const row = { tenant_id: tenantId, version: doc.version, schema_version: doc.schemaVersion, source_hash: doc.sourceHash, status: doc.status, generator: doc.generator, doc, issues: doc.issues || [] };
  // 1) one transaction, when Platform's RPC exists
  if (typeof db.rpc === 'function') {
    const { error } = await db.rpc('save_spoken_catalogue_version', { p_tenant_id: tenantId, p_version: row.version, p_schema_version: row.schema_version, p_source_hash: row.source_hash, p_status: row.status, p_generator: row.generator, p_doc: doc, p_issues: row.issues, p_compile_error: compileError });
    if (!error) return { mode: 'rpc' };
    if (/P0002|not found/i.test(`${error.code || ''} ${error.message || ''}`) && !/function/i.test(error.message || '')) throw new Error('no_tenant:rpc');
    if (!/function|does not exist|PGRST202|42883/i.test(`${error.code || ''} ${error.message || ''}`)) throw new Error(`rpc:${error.code || 'error'}`);
    log('spoken_catalogue rpc missing, ordered writes');
  }
  // 2) degrade: history row first, then the live doc
  const withErr = await hasColumn(db, 'tenant_spoken_catalogue_versions', 'compile_error');
  if (withErr) row.compile_error = compileError;
  const ins = await db.from('tenant_spoken_catalogue_versions').insert(row);
  if (ins.error) throw new Error(`insert:${ins.error.code || 'error'}`);
  const patch = { spoken_catalogue: doc };
  if (await hasColumn(db, 'tenants', 'live_version')) patch.live_version = doc.version;
  const up = await db.from('tenants').update(patch).eq('id', tenantId);
  if (up.error) throw new Error(`update:${up.error.code || 'error'}`);
  await db.from('tenant_spoken_catalogue_versions').update({ status: 'superseded' }).eq('tenant_id', tenantId).eq('status', 'draft').lt('version', doc.version);
  return { mode: 'ordered', liveVersion: 'live_version' in patch, compileError: withErr };
}

/** Run one compile for a tenant. Returns a small result; throws nothing. */
async function runSpokenCatalogueCompile(tenantId, { db, generate = null, timeoutMs = 10000, env = process.env, log = (m) => console.log(m), now = new Date() } = {}) {
  if (!enabled(env)) return { ok: true, skipped: 'flag_off' };
  if (!UUID.test(String(tenantId || ''))) return { ok: false, skipped: 'bad_tenant' };
  const t0 = Date.now();
  try {
    const { data, error } = await db.from('tenants').select(TENANT_COLS).eq('id', tenantId).maybeSingle();
    if (error || !data) return { ok: false, skipped: 'no_tenant' };
    const profile = profileFromRow(data);
    const previous = data.spoken_catalogue || null;
    if (!needsRegeneration(previous, profile)) { log(`[spoken_catalogue] tenant=${tenantId} unchanged v${previous.version}`); return { ok: true, skipped: 'unchanged', version: previous.version }; }
    const doc = await compileSpokenCatalogue(profile, { generate: withTimeout(generate, timeoutMs), previous, now });
    doc.aiError = aiCode(doc.aiError); // stored as a code only
    if (doc.status !== 'draft') doc.status = 'draft'; // a compile is never an approval; it still goes live
    const w = await writeVersion(db, tenantId, doc, { log });
    log(`[spoken_catalogue] tenant=${tenantId} v${doc.version} ${doc.generator}${doc.aiError ? ` ai=${doc.aiError}` : ''} entries=${doc.entries.length} categories=${doc.categories.length} issues=${doc.issues.length} hash=${doc.sourceHash.slice(0, 12)} write=${w.mode} ms=${Date.now() - t0}`);
    return { ok: true, version: doc.version, generator: doc.generator, aiError: doc.aiError, write: w, doc };
  } catch (e) {
    const code = String(e?.message || e).split(':')[0].slice(0, 40);
    log(`[spoken_catalogue] tenant=${tenantId} failed ${code} ms=${Date.now() - t0}`);
    return { ok: false, error: code };
  }
}

// Per-tenant coalescing: a burst of saves runs at most one compile now and one after it.
const running = new Map();
function scheduleSpokenCatalogueCompile(tenantId, deps = {}) {
  if (!enabled(deps.env || process.env)) return { scheduled: false, reason: 'flag_off' };
  const st = running.get(tenantId);
  if (st) { st.again = true; return { scheduled: true, coalesced: true }; }
  const s = { again: false };
  running.set(tenantId, s);
  const loop = async () => {
    do { s.again = false; await runSpokenCatalogueCompile(tenantId, deps); } while (s.again);
    running.delete(tenantId);
  };
  s.done = new Promise((r) => setImmediate(() => loop().then(r, r)));
  return { scheduled: true, done: s.done };
}

module.exports = { enabled, runSpokenCatalogueCompile, scheduleSpokenCatalogueCompile, profileFromRow, withTimeout, _resetColumnMemo: () => optionalCols.clear() };
