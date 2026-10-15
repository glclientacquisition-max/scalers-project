#!/usr/bin/env node
// Compile the spoken catalogue for tenants. DRY RUN by default: reads tenants,
// prints what would be written, writes nothing. --apply writes (needs the
// migration supabase/migrations/20261015063255_spoken_catalogue.sql applied
// first, and staging credentials in env). --ai uses Gemini for the AI pass.
//   node scripts/backfill-spoken-catalogue.js [--tenant <id>] [--ai] [--apply] [--from-file profiles.json]
//     [--approve-prices <tenantId,...>]  owner said these tenants' prices are right as written (priceStatus approved)
const fs = require('fs');
const { CATALOGUE_COLS, catalogueProfileFromRow, compileSpokenCatalogue, needsRegeneration, approvePrices } = require('../src/knowledge/spokenCatalogue');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

function geminiGenerate() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('--ai needs GEMINI_API_KEY');
  const { createSpokenCatalogueGenerate } = require('../src/knowledge/spokenCatalogueGenerate');
  return createSpokenCatalogueGenerate({ apiKey: key, model: process.env.SPOKEN_CATALOGUE_MODEL || 'gemini-3.5-flash', timeoutMs: 30000 });
}
async function loadTenants() {
  if (val('--from-file')) return JSON.parse(fs.readFileSync(val('--from-file'), 'utf8'));
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let q = db.from('tenants').select(CATALOGUE_COLS.join(','));
  if (val('--tenant')) q = q.eq('id', val('--tenant'));
  const { data, error } = await q; if (error) throw new Error(error.message);
  return { db, rows: data };
}
// --apply writes each compiled doc through public.save_spoken_catalogue_version
// (migration 20261015113748): one transaction that inserts the version row
// (status 'draft' until an owner approves), supersedes older drafts and goes
// live (tenants.spoken_catalogue + live_version). No direct table writes.
// Without --apply it is a dry run: compiles and prints, writes nothing.
const { rpcArgs, aiCode } = require('../src/knowledge/spokenCatalogueOnSave');
async function backfill({ rows, db = null, generate = null, apply = false, force = false, report = false, log = console.log }) {
  const out = { compiled: 0, written: 0, upToDate: 0 };
  for (const r of rows) {
    const profile = catalogueProfileFromRow(r);
    if (!needsRegeneration(r.spoken_catalogue, profile) && !force) { log(`${r.id} up to date (v${r.spoken_catalogue.version})`); out.upToDate++; continue; }
    const doc = await compileSpokenCatalogue(profile, { generate, previous: r.spoken_catalogue || null });
    doc.status = 'draft'; // a compile is never an approval
    doc.aiError = aiCode(doc.aiError);
    if (r.spoken_catalogue && doc.version <= (r.spoken_catalogue.version || 0)) doc.version = (r.spoken_catalogue.version || 0) + 1; // --force on an unchanged hash
    if (String(val('--approve-prices') || '').split(',').includes(r.id)) { approvePrices(doc, { by: 'owner' }); log(`${r.id} prices owner-approved`); }
    out.compiled++;
    log(`${r.id} -> v${doc.version} ${doc.generator} entries=${doc.entries.length} categories=${doc.categories.length} ambiguity=${doc.coverage.ambiguityGroups.length} issues=${doc.issues.length}`);
    if (report) {
      for (const e of doc.entries) log(`   ${e.raw.name} | sw: ${e.spoken.sw} | en: ${e.spoken.en} | cat: ${e.category.id} | price ${e.priceStatus}: sw ${e.price.sw} / en ${e.price.en} | explain sw: ${e.explain.sw}`);
      log(`   categories: ${doc.categories.map((c) => `${c.id}=${c.sw} / ${c.en}`).join(' ; ')}`);
      log(`   ambiguity: ${doc.coverage.ambiguityGroups.map((g) => `${g.heard}:${g.options.join('/')}`).join('; ') || 'none'}`);
      for (const i of doc.issues) log(`   review: ${i.id} ${i.field} ${i.code}${i.raw ? ` (${i.raw})` : ''}`);
    }
    if (!apply) continue;
    const { error } = await db.rpc('save_spoken_catalogue_version', rpcArgs(r.id, doc));
    if (error) throw new Error(`${r.id}: save_spoken_catalogue_version ${error.code || ''} ${error.message || ''}`.trim());
    out.written++;
  }
  if (!apply) log('dry run: nothing written');
  return out;
}
if (require.main === module) {
  (async () => {
    const loaded = await loadTenants();
    const rows = Array.isArray(loaded) ? loaded : loaded.rows;
    if (flag('--apply') && !loaded.db) throw new Error('--apply needs the database (not --from-file)');
    await backfill({ rows, db: loaded.db || null, generate: flag('--ai') ? geminiGenerate() : null, apply: flag('--apply'), force: flag('--force'), report: flag('--report') });
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { backfill };
