#!/usr/bin/env node
'use strict';
// Staging-only seed for the three browser-demo tenants.
// Does not run unless RAILWAY_ENVIRONMENT is exactly "staging" and SUPABASE_URL
// is the staging project. Refuses the prod project and the Aris line.
//
// Dry run (prints the plan, writes nothing):
//   RAILWAY_ENVIRONMENT=staging SUPABASE_URL=https://sgcdncjxauhsbunobmob.supabase.co \
//     node scripts/seed-demo-tenants.js
//
// Apply or remove (Alvin or Chief only; this file is never called from CI):
//   node scripts/seed-demo-tenants.js --apply
//   node scripts/seed-demo-tenants.js --remove
//
// SUPABASE_SERVICE_ROLE_KEY is read from the environment for --apply and --remove.
// The script does not print it.

const {
  assertPayloadSafe,
  assertRemovable,
  assertSeedTarget,
  seedRows,
} = require('../src/demo/tenants');

function planText(rows) {
  const lines = ['Demo tenant seed plan (no write yet):'];
  for (const row of rows) {
    lines.push(
      `- ${row.id} ${row.business_name} type=${row.business_type} did=${row.sautikit_virtual_number} billing=${row.billing_enforcement} notify=off bookings=off`
    );
  }
  lines.push('Re-run with --apply to upsert these three ids only, or --remove to delete them.');
  lines.push('See docs/how-to/demo-tenants.md.');
  return lines.join('\n');
}

function targetFromEnv() {
  return assertSeedTarget({
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT,
    supabaseUrl: process.env.SUPABASE_URL,
  });
}

function normalizeSupabaseUrl(raw) {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  url = url.replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
  return url;
}

async function client() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('refusing: SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  const { createClient } = require('@supabase/supabase-js');
  return createClient(normalizeSupabaseUrl(process.env.SUPABASE_URL), process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function apply(supabase, rows) {
  const ids = rows.map((row) => row.id);
  const { data: existing, error: readError } = await supabase
    .from('tenants')
    .select('id, sautikit_virtual_number, business_name')
    .in('id', ids);
  if (readError) throw new Error(readError.message);
  for (const row of existing || []) {
    const gate = assertRemovable(row);
    if (!gate.ok) {
      throw new Error(`refusing: existing ${row.id} (${row.business_name}) is ${gate.reason}`);
    }
  }
  let payload = rows;
  let { error } = await supabase.from('tenants').upsert(payload, { onConflict: 'id' });
  if (error && /business_type/i.test(error.message || '')) {
    payload = rows.map((row) => {
      const next = { ...row };
      delete next.business_type;
      return next;
    });
    ({ error } = await supabase.from('tenants').upsert(payload, { onConflict: 'id' }));
  }
  if (error && /greeting_language/i.test(error.message || '')) {
    payload = payload.map((row) => {
      const next = { ...row };
      delete next.greeting_language;
      return next;
    });
    ({ error } = await supabase.from('tenants').upsert(payload, { onConflict: 'id' }));
  }
  if (error) throw new Error(error.message);
  console.log(`upserted ${ids.length} demo tenants`);
}

async function remove(supabase, rows) {
  const ids = rows.map((row) => row.id);
  const { data: existing, error: readError } = await supabase
    .from('tenants')
    .select('id, sautikit_virtual_number, business_name')
    .in('id', ids);
  if (readError) throw new Error(readError.message);
  const found = existing || [];
  for (const row of found) {
    const gate = assertRemovable(row);
    if (!gate.ok) {
      throw new Error(`refusing: will not delete ${row.id} (${gate.reason})`);
    }
  }
  if (!found.length) {
    console.log('no demo tenant rows to remove');
    return;
  }
  const { error } = await supabase.from('tenants').delete().in(
    'id',
    found.map((row) => row.id)
  );
  if (error) throw new Error(error.message);
  console.log(`removed ${found.length} demo tenants`);
}

async function main() {
  const applyFlag = process.argv.includes('--apply');
  const removeFlag = process.argv.includes('--remove');
  if (applyFlag && removeFlag) {
    console.error('refusing: pass only one of --apply or --remove');
    process.exit(1);
  }
  const gate = targetFromEnv();
  if (!gate.ok) {
    console.error(gate.reason);
    process.exit(1);
  }
  const rows = assertPayloadSafe(seedRows());
  if (!applyFlag && !removeFlag) {
    console.log(planText(rows));
    process.exit(0);
  }
  const supabase = await client();
  if (removeFlag) await remove(supabase, rows);
  else await apply(supabase, rows);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { planText, targetFromEnv, main };
