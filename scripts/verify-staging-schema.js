#!/usr/bin/env node
/**
 * Read-only staging schema verification against docs/database/staging_schema_manifest.json
 *
 * Modes:
 *   default (supabase-js): tables, key columns, buckets — no DATABASE_URL required
 *   --catalog: full catalog compare via STAGING_DATABASE_URL (postgres connection string)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-staging-schema.js
 *   STAGING_DATABASE_URL=postgresql://... node scripts/verify-staging-schema.js --catalog
 *
 * Never point at production ALCR (fjxcdccgyhnvnnlnovcl).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '../docs/database/staging_schema_manifest.json');
const PRODUCTION_REF = 'fjxcdccgyhnvnnlnovcl';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

function warn(msg) {
  console.warn(`⚠ ${msg}`);
}

function assertNotProduction() {
  const url = process.env.SUPABASE_URL || process.env.STAGING_SUPABASE_URL || '';
  const dbUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL || '';
  if (url.includes(PRODUCTION_REF) || dbUrl.includes(PRODUCTION_REF)) {
    console.error('Refusing to run: production ALCR project detected in URL.');
    process.exit(2);
  }
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

async function checkTables(supabase, manifest) {
  for (const table of manifest.public_tables) {
    const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      fail(`table missing or inaccessible: public.${table} — ${error.message}`);
    } else {
      pass(`table public.${table}`);
    }
  }
}

async function checkTenantColumns(supabase, manifest) {
  const cols = manifest.required_tenant_columns.join(',');
  const { error } = await supabase.from('tenants').select(cols).limit(1);
  if (error) {
    fail(`tenants required columns — ${error.message}`);
  } else {
    pass(`tenants columns: ${manifest.required_tenant_columns.join(', ')}`);
  }
}

async function checkBuckets(supabase, manifest) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    fail(`storage.listBuckets — ${error.message}`);
    return;
  }
  const names = new Set((data || []).map((b) => b.name));
  for (const bucket of manifest.storage_buckets) {
    if (!names.has(bucket.name)) {
      fail(`storage bucket missing: ${bucket.name}`);
    } else {
      const row = data.find((b) => b.name === bucket.name);
      if (row && row.public !== bucket.public) {
        warn(`bucket ${bucket.name} public=${row.public} (expected ${bucket.public})`);
      }
      pass(`storage bucket ${bucket.name}`);
    }
  }
}

async function checkCatalogPg(manifest) {
  const conn = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) {
    warn('--catalog skipped: set STAGING_DATABASE_URL for full catalog compare');
    return;
  }
  if (conn.includes(PRODUCTION_REF)) {
    console.error('Refusing catalog mode on production.');
    process.exit(2);
  }

  let pg;
  try {
    pg = require('pg');
  } catch {
    fail('--catalog requires devDependency pg (npm install)');
    return;
  }

  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const [table, expected] of Object.entries(manifest.foundation_column_counts)) {
      const res = await client.query(
        `select count(*)::int as n from information_schema.columns
         where table_schema='public' and table_name=$1`,
        [table]
      );
      const n = res.rows[0]?.n;
      if (n !== expected) {
        fail(`${table} column count: got ${n}, expected ${expected}`);
      } else {
        pass(`${table} column count = ${expected}`);
      }
    }

    for (const table of manifest.rls_enabled_tables) {
      const res = await client.query(
        `select c.relrowsecurity as rls from pg_class c
         join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname=$1`,
        [table]
      );
      if (!res.rows[0]?.rls) {
        fail(`RLS not enabled on public.${table}`);
      } else {
        pass(`RLS enabled on public.${table}`);
      }
    }

    const pol = await client.query(
      `select count(*)::int as n from pg_policies where schemaname='public'`
    );
    if (pol.rows[0].n < manifest.min_public_policies) {
      fail(`public policies: got ${pol.rows[0].n}, expected >= ${manifest.min_public_policies}`);
    } else {
      pass(`public policies >= ${manifest.min_public_policies}`);
    }

    for (const [ext, ver] of Object.entries(manifest.extensions)) {
      const res = await client.query(
        `select extversion from pg_extension where extname=$1`,
        [ext]
      );
      if (!res.rows.length) {
        fail(`extension missing: ${ext}`);
      } else {
        pass(`extension ${ext} @ ${res.rows[0].extversion}`);
      }
    }

    const fnRes = await client.query(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'`
    );
    const fnSet = new Set(fnRes.rows.map((r) => `${r.proname}(${r.args})`));
    for (const sig of manifest.required_functions) {
      const normalized = sig.replace(/\s+/g, '');
      const found = [...fnSet].some((f) => f.replace(/\s+/g, '') === normalized);
      if (!found) {
        fail(`function missing: ${sig}`);
      } else {
        pass(`function ${sig}`);
      }
    }

    if (manifest.staging_only?.notify_channels_authenticated_update_grant) {
      const grantRes = await client.query(
        `select has_column_privilege('authenticated', 'public.tenants', 'notify_channels', 'UPDATE') as ok`
      );
      if (!grantRes.rows[0]?.ok) {
        warn('staging notify_channels UPDATE grant absent (expected on staging after 3E fix)');
      } else {
        pass('staging notify_channels UPDATE grant (expected staging-only)');
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  assertNotProduction();
  const manifest = loadManifest();
  const catalogMode = process.argv.includes('--catalog');

  console.log('verify-staging-schema');
  console.log(`manifest v${manifest.version}`);

  const url = process.env.STAGING_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    fail('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or STAGING_* variants)');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  await checkTables(supabase, manifest);
  await checkTenantColumns(supabase, manifest);
  await checkBuckets(supabase, manifest);

  if (catalogMode) {
    await checkCatalogPg(manifest);
  } else {
    warn('Lightweight mode only. Pass --catalog with STAGING_DATABASE_URL for RLS/extensions/functions checks.');
  }

  if (process.exitCode) {
    console.error('\nSchema verification FAILED');
  } else {
    console.log('\nSchema verification PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
