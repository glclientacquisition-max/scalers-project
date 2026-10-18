#!/usr/bin/env node
'use strict';
// Plan (never run) the tenant_field_meta.value_hash backfill that
// FACT_HASH_MODE=on needs. Prod has 0 of 212 rows hashed (18 Oct 2026), so
// turning the mode on today would make every fact unconfirmed.
//
// Input: a JSON export from a read-only query (docs/runbooks/value-hash-backfill.md):
//   { "tenants": [tenants rows], "field_meta": [tenant_field_meta rows] }
// Output: SQL on stdout. Step 1 is a full backup table; step 2 stamps only
// owner rows whose value_hash is null, with the hash of the value stored now
// (src/conversation/factHash.js, the same value Desk hashes on confirm); step 3
// is the rollback. This script never connects to a database.
//
// Usage: node scripts/plan-value-hash-backfill.js export.json [--date 20261019] > backfill.sql

const fs = require('fs');
const { hashFactValue, factValueForPath } = require('../src/conversation/factHash');

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * @param {{ tenants: object[], field_meta: object[] }} exported
 * @param {{ date?: string }} [opts]
 * @returns {{ sql: string, stamped: number, skipped: Array<{ tenant_id: string, field_path: string, reason: string }> }}
 */
function planBackfill(exported, opts = {}) {
  const date = String(opts.date || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const backup = `public.tenant_field_meta_backup_${date}`;
  const tenants = new Map((exported.tenants || []).map((t) => [t.id, t]));
  const updates = [];
  const skipped = [];
  for (const meta of exported.field_meta || []) {
    const key = { tenant_id: meta.tenant_id, field_path: meta.field_path };
    if (meta.value_hash) {
      skipped.push({ ...key, reason: 'already_hashed' });
      continue;
    }
    if (meta.source !== 'owner') {
      skipped.push({ ...key, reason: `source_${meta.source || 'none'}` });
      continue;
    }
    const tenant = tenants.get(meta.tenant_id);
    if (!tenant) {
      skipped.push({ ...key, reason: 'tenant_missing' });
      continue;
    }
    const value = factValueForPath(meta.field_path, tenant);
    if (value == null || value === '') {
      skipped.push({ ...key, reason: 'no_current_value' });
      continue;
    }
    updates.push(
      `update public.tenant_field_meta set value_hash = ${sqlText(hashFactValue(value))}` +
        ` where tenant_id = ${sqlText(meta.tenant_id)} and field_path = ${sqlText(meta.field_path)}` +
        ` and source = 'owner' and value_hash is null;`
    );
  }
  const sql = [
    '-- tenant_field_meta.value_hash backfill (planned by scripts/plan-value-hash-backfill.js).',
    '-- Needs Alvin\'s explicit yes before it runs on prod. Run in the Supabase SQL editor as one script.',
    '-- Meaning: every owner row is stamped as confirmed for the value stored today.',
    '',
    '-- 1. Backup (whole table), then check its row count matches before going on.',
    `create table ${backup} as select * from public.tenant_field_meta;`,
    `select (select count(*) from ${backup}) as backup_rows, (select count(*) from public.tenant_field_meta) as live_rows;`,
    '',
    '-- 2. Stamp owner rows with no hash yet.',
    'begin;',
    ...updates,
    `select count(*) filter (where value_hash is not null) as hashed, count(*) as total from public.tenant_field_meta;`,
    'commit;',
    '',
    '-- 3. Rollback (only if needed): put every value_hash back as it was in the backup.',
    `-- update public.tenant_field_meta m set value_hash = b.value_hash from ${backup} b`,
    '--  where b.tenant_id = m.tenant_id and b.field_path = m.field_path;',
    `-- drop table ${backup};  -- once FACT_HASH_MODE has run clean for a week`,
    '',
  ].join('\n');
  return { sql, stamped: updates.length, skipped };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/plan-value-hash-backfill.js export.json [--date YYYYMMDD]');
    process.exit(2);
  }
  const dateIdx = process.argv.indexOf('--date');
  const plan = planBackfill(JSON.parse(fs.readFileSync(file, 'utf8')), {
    date: dateIdx > 0 ? process.argv[dateIdx + 1] : undefined,
  });
  process.stdout.write(plan.sql);
  const reasons = {};
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  console.error(`stamped=${plan.stamped} skipped=${JSON.stringify(reasons)}`);
}

module.exports = { planBackfill };
