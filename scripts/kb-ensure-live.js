#!/usr/bin/env node
'use strict';
// Retire the old brain (P1): every business must have a live KB snapshot so the KB brain always has a document.
// For each business with tenants.kb_live_version null:
//   - no kb_items at all (or only hidden ones): compile the empty catalogue and publish it live (an empty snapshot
//     is allowed; the brain degrades to "the team will confirm" / take a message).
//   - kb_items exist but the compile is blocked: NOT forced (that would hide the owner's items); listed with its issues.
// Run after kb-backfill.js. Idempotent. Dry run by default.
//   node scripts/kb-ensure-live.js [--apply] [--tenant <uuid>] [--skip-archived]
// Every business by default, archived / inactive ones too (the invariant holds for all; calls to them are blocked elsewhere).
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target project (never printed).
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const skipArchived = args.includes('--skip-archived');
const only = (() => { const i = args.indexOf('--tenant'); return i >= 0 ? args[i + 1] : null; })();

(async () => {
  const db = require('../src/db');
  const { supabase } = require('../src/lib/supabaseClient');
  const { compileKb } = require('../src/knowledge/kb/compile');
  const pub = require('../src/knowledge/kb/publish');
  let q = supabase.from('tenants').select('id, business_name, kb_live_version, archived_at').order('business_name');
  if (only) q = q.eq('id', only);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const out = [];
  for (const t of rows || []) {
    if (t.archived_at && skipArchived) { out.push({ id: t.id, business: t.business_name, action: 'skip_archived' }); continue; }
    if (t.kb_live_version != null) { out.push({ id: t.id, business: t.business_name, action: 'ok', live: t.kb_live_version }); continue; }
    const src = await db.listKbSource(t.id);
    const c = compileKb({ ...src, business: t.business_name });
    const shown = (src.items || []).filter((x) => x.status !== 'hidden').length;
    if (shown > 0 && c.status !== 'live') {
      out.push({ id: t.id, business: t.business_name, action: 'blocked', items: shown, issues: [...new Set(c.issues.map((i) => i.code))] });
      continue;
    }
    if (!apply) { out.push({ id: t.id, business: t.business_name, action: shown ? 'would_publish' : 'would_publish_empty', items: shown }); continue; }
    const r = await pub.compileAndPublish(db, t.id, { by: 'ensure-live', force: true, log: () => {} });
    out.push({ id: t.id, business: t.business_name, action: shown ? 'published' : 'published_empty', version: r.version, status: r.status, quality: r.readiness ? (r.readiness.passed ? 'ready' : r.readiness.failing.join(',')) : null });
  }
  console.log(JSON.stringify({ apply, at: new Date().toISOString(), businesses: out }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(`kb-ensure-live failed: ${e && e.message}`); process.exit(1); });
