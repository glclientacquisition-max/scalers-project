#!/usr/bin/env node
// Compile the spoken catalogue for tenants. DRY RUN by default: reads tenants,
// prints what would be written, writes nothing. --apply writes (needs the
// migration supabase/migrations/20261015063255_spoken_catalogue.sql applied
// first, and staging credentials in env). --ai uses Gemini for the AI pass.
//   node scripts/backfill-spoken-catalogue.js [--tenant <id>] [--ai] [--apply] [--from-file profiles.json]
//     [--approve-prices <tenantId,...>]  owner said these tenants' prices are right as written (priceStatus approved)
const fs = require('fs');
const { compileSpokenCatalogue, needsRegeneration, approvePrices } = require('../src/knowledge/spokenCatalogue');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

function geminiGenerate() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('--ai needs GEMINI_API_KEY');
  const { createGeminiSend } = require('../src/conversation/v2/transport');
  const send = createGeminiSend({ apiKey: key, model: process.env.SPOKEN_CATALOGUE_MODEL || 'gemini-3.5-flash', timeoutMs: 30000, thinkingMinimal: false });
  return async ({ prompt, schema }) => {
    const resp = await send({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } });
    return JSON.parse((resp?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
  };
}
async function loadTenants() {
  if (val('--from-file')) return JSON.parse(fs.readFileSync(val('--from-file'), 'utf8'));
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let q = db.from('tenants').select('id,services_catalog,product_catalog,service_areas,business_locations,spoken_catalogue');
  if (val('--tenant')) q = q.eq('id', val('--tenant'));
  const { data, error } = await q; if (error) throw new Error(error.message);
  return { db, rows: data };
}
(async () => {
  const loaded = await loadTenants();
  const rows = Array.isArray(loaded) ? loaded : loaded.rows;
  const generate = flag('--ai') ? geminiGenerate() : null;
  for (const r of rows) {
    const profile = { tenantId: r.id, servicesCatalog: r.services_catalog || [], productCatalog: r.product_catalog || [], serviceAreas: r.service_areas || null, businessLocations: r.business_locations || [] };
    if (!needsRegeneration(r.spoken_catalogue, profile) && !flag('--force')) { console.log(`${r.id} up to date (v${r.spoken_catalogue.version})`); continue; }
    const doc = await compileSpokenCatalogue(profile, { generate, previous: r.spoken_catalogue || null });
    if (String(val('--approve-prices') || '').split(',').includes(r.id)) { approvePrices(doc, { by: 'owner' }); console.log(`${r.id} prices owner-approved`); }
    console.log(`${r.id} -> v${doc.version} ${doc.generator} entries=${doc.entries.length} categories=${doc.categories.length} ambiguity=${doc.coverage.ambiguityGroups.length} issues=${doc.issues.length}`);
    if (flag('--report')) {
      for (const e of doc.entries) console.log(`   ${e.raw.name} | sw: ${e.spoken.sw} | en: ${e.spoken.en} | cat: ${e.category.id} | price ${e.priceStatus}: sw ${e.price.sw} / en ${e.price.en} | explain sw: ${e.explain.sw}`);
      console.log(`   categories: ${doc.categories.map((c) => `${c.id}=${c.sw} / ${c.en}`).join(' ; ')}`);
      console.log(`   ambiguity: ${doc.coverage.ambiguityGroups.map((g) => `${g.heard}:${g.options.join('/')}`).join('; ') || 'none'}`);
      for (const i of doc.issues) console.log(`   review: ${i.id} ${i.field} ${i.code}${i.raw ? ` (${i.raw})` : ''}`);
    }
    if (!flag('--apply')) continue;
    const { db } = loaded;
    const ins = await db.from('tenant_spoken_catalogue_versions').insert({ tenant_id: r.id, version: doc.version, schema_version: doc.schemaVersion, source_hash: doc.sourceHash, status: doc.status, generator: doc.generator, doc, issues: doc.issues });
    if (ins.error) throw new Error(ins.error.message);
    const up = await db.from('tenants').update({ spoken_catalogue: doc }).eq('id', r.id);
    if (up.error) throw new Error(up.error.message);
  }
  if (!flag('--apply')) console.log('dry run: nothing written');
})().catch((e) => { console.error(e.message); process.exit(1); });
