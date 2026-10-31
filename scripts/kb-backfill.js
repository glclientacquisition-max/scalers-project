#!/usr/bin/env node
'use strict';
// v2 Knowledge Base backfill: services_catalog + product_catalog -> kb_items (ids kept), compile a snapshot, check readiness.
// Idempotent: a second run changes nothing (same source hash -> no new snapshot). Dry run by default.
//   node scripts/kb-backfill.js                 # dry run, every business
//   node scripts/kb-backfill.js --apply         # write kb_items, publish snapshots, record readiness
//   node scripts/kb-backfill.js --apply --tenant <uuid>
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target project (never printed). Apply docs/supabase/kb_v2.sql first.
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = (() => { const i = args.indexOf('--tenant'); return i >= 0 ? args[i + 1] : null; })();

(async () => {
  const db = require('../src/db');
  const { supabase } = require('../src/lib/supabaseClient');
  const { fromLegacy } = require('../src/knowledge/kb/items');
  const { compileKb } = require('../src/knowledge/kb/compile');
  const pub = require('../src/knowledge/kb/publish');
  let q = supabase.from('tenants').select('id, business_name, services_catalog, product_catalog').order('business_name');
  if (only) q = q.eq('id', only);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const report = [];
  for (const row of rows || []) {
    const m = fromLegacy(row);
    const c = compileKb({ ...m, business: row.business_name });
    const line = { id: row.id, business: row.business_name, services: m.items.filter((x) => x.kind === 'service').length, products: m.items.filter((x) => x.kind === 'product').length, categories: m.categories.length, compile: c.status, issues: [...new Set(c.issues.map((i) => i.code))].join(',') };
    if (apply) {
      const r = await pub.compileAndPublish(db, row.id, { legacyRow: row, by: 'backfill', log: () => {} });
      Object.assign(line, { version: r.version, published: r.status, ready: r.readiness ? r.readiness.passed : null, failing: r.readiness ? r.readiness.failing.join(',') : null, upserted: r.synced ? r.synced.upserted : 0, hidden: r.synced ? r.synced.hidden : 0 });
    }
    report.push(line);
  }
  console.log(JSON.stringify({ apply, at: new Date().toISOString(), businesses: report }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(`kb-backfill failed: ${e && e.message}`); process.exit(1); });
