#!/usr/bin/env node
'use strict';
// v2 KB cutover report: per Business, live / ready versions, brain target, latest readiness and what blocks it.
//   node scripts/kb-cutover.js                  # read-only table (JSON)
//   node scripts/kb-cutover.js --hold <uuid>    # ops hold on the old brain (brain_target v1)
//   node scripts/kb-cutover.js --allow <uuid>   # let readiness decide again (brain_target v2)
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target project (never printed).
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

(async () => {
  const db = require('../src/db');
  const { supabase } = require('../src/lib/supabaseClient');
  const hold = flag('--hold'); const allow = flag('--allow');
  if (hold || allow) { await db.setBrainTarget(hold || allow, hold ? 'v1' : 'v2'); console.log(JSON.stringify({ ok: true, tenant: hold || allow, brain_target: hold ? 'v1' : 'v2' })); process.exit(0); }
  const { data: rows, error } = await supabase.from('tenants').select('id, business_name, kb_live_version, kb_ready_version, brain_target').order('business_name');
  if (error) throw new Error(error.message);
  const out = [];
  for (const t of rows || []) {
    const { data: r } = await supabase.from('kb_readiness').select('snapshot_version, passed, checks, tests, checked_by, checked_at').eq('tenant_id', t.id).order('checked_at', { ascending: false }).limit(1).maybeSingle();
    const onV2 = t.brain_target !== 'v1' && t.kb_live_version != null && t.kb_live_version === t.kb_ready_version;
    out.push({
      id: t.id, business: t.business_name, live: t.kb_live_version, ready: t.kb_ready_version, target: t.brain_target, on_v2: onV2,
      readiness: r ? { passed: r.passed, at: r.checked_at, by: r.checked_by, failing: [...(r.checks || []).filter((c) => !c.ok).map((c) => c.id), ...(r.tests || []).filter((x) => !x.ok).map((x) => `test:${x.name}`)] } : null,
    });
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error(`kb-cutover failed: ${e && e.message}`); process.exit(1); });
