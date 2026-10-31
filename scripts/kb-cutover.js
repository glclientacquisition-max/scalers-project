#!/usr/bin/env node
'use strict';
// v2 KB cutover report: per Business, live / ready versions, brain target, latest readiness and what blocks it.
//   node scripts/kb-cutover.js                  # read-only table (JSON)
//   node scripts/kb-cutover.js --safe <uuid>    # emergency safe mode for one business (tenants.brain_mode safe)
//   node scripts/kb-cutover.js --full <uuid>    # back to the full KB brain (brain_mode full)
// No v1 hold any more: with BRAIN_KB_GATE on every business runs the KB brain; readiness is the `quality` column.
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target project (never printed).
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

(async () => {
  const db = require('../src/db');
  const { supabase } = require('../src/lib/supabaseClient');
  const { isKbLive } = require('../src/knowledge/kb/kbLive');
  const K = require('../src/knowledge/kb/kbLive');
  const safe = flag('--safe'); const full = flag('--full');
  if (safe || full) { await db.setBrainMode(safe || full, safe ? 'safe' : 'full'); console.log(JSON.stringify({ ok: true, tenant: safe || full, brain_mode: safe ? 'safe' : 'full' })); process.exit(0); }
  let { data: rows, error } = await supabase.from('tenants').select(`id, business_name, ${K.KB_LIVE_COLUMNS}`).order('business_name');
  if (error && /brain_mode/.test(error.message || '')) ({ data: rows, error } = await supabase.from('tenants').select(`id, business_name, ${K.KB_LIVE_COLUMNS_PRE_BRAIN_MODE}`).order('business_name'));
  if (error) throw new Error(error.message);
  const out = [];
  for (const t of rows || []) {
    const { data: r } = await supabase.from('kb_readiness').select('snapshot_version, passed, checks, tests, checked_by, checked_at').eq('tenant_id', t.id).order('checked_at', { ascending: false }).limit(1).maybeSingle();
    out.push({
      id: t.id, business: t.business_name, live: t.kb_live_version, ready: t.kb_ready_version,
      on_kb: isKbLive(t, { gate: process.env.BRAIN_KB_GATE }).live, quality: K.kbQuality(t), mode: K.brainMode(t, { safeEnv: process.env.BRAIN_SAFE_MODE }).mode,
      readiness: r ? { passed: r.passed, at: r.checked_at, by: r.checked_by, failing: [...(r.checks || []).filter((c) => !c.ok).map((c) => c.id), ...(r.tests || []).filter((x) => !x.ok).map((x) => `test:${x.name}`)] } : null,
    });
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error(`kb-cutover failed: ${e && e.message}`); process.exit(1); });
