#!/usr/bin/env node
// One-time backfill of tenant_field_meta.value_hash for owner-sourced rows
// (GIGO confirm v2). For each row with source = 'owner' and no value_hash,
// hash the value the row's field_path points at in the stored tenants row:
//   value_hash = hashFactValue(factValueForPath(field_path, tenant))
//
// Dry run by default. --apply writes. Never overwrites an existing value_hash
// (that would silently re-confirm an edited value), never confirms an empty
// value, and reports rows whose path cannot be resolved.
//
// Usage:
//   node scripts/backfillFactHashes.js --tenant <uuid> [--tenant <uuid> ...] [--apply]
//   node scripts/backfillFactHashes.js --all-except <uuid,uuid> [--apply]
//   Options: --sample <n> (default 5)  --i-have-alvin-ok (non-staging targets)
//            --allow-missing-ids (apply even when services rows have no stable id)
//
// Order: tenant_field_confirm_v2.sql, then services_catalog_stable_ids.sql,
// then this script. A service row's hash includes its id, and the ids SQL
// clears value_hash on the paths it moves, so hashing a row before it has an id
// is wasted. Services rows without a stable id are reported per tenant, and
// --apply refuses (exit 2) unless --allow-missing-ids is passed.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Target guard: staging (sgcdncjxauhsbunobmob) and local URLs run. Anything
// else, including prod ALCR fjxcdccgyhnvnnlnovcl (docs/operations/ENVIRONMENTS.md),
// is refused (dry run included) unless --i-have-alvin-ok is passed.
//
// Exit codes: 0 ok, 1 write errors, 2 bad arguments or guard refusal,
// 3 value_hash column missing (apply docs/supabase/tenant_field_confirm_v2.sql), 4 read error.

const { hashFactValue, factValueForPath, stableRowId } = require('../src/conversation/factHash');

const STAGING_REF = 'sgcdncjxauhsbunobmob';
const PROD_REF = 'fjxcdccgyhnvnnlnovcl';
const PAGE = 1000;
const UUIDISH = /^[0-9a-f-]{8,64}$/i;

function usage() {
  return [
    'Usage: node scripts/backfillFactHashes.js (--tenant <id> ... | --all-except <id,id>) [--apply] [--sample N] [--i-have-alvin-ok] [--allow-missing-ids]',
    'Dry run unless --apply. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {
    apply: false,
    tenants: [],
    allExcept: null,
    iHaveAlvinOk: false,
    allowMissingIds: false,
    sample: 5,
    help: false,
    errors: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) {
        out.errors.push(`${a} needs a value`);
        return '';
      }
      i += 1;
      return v;
    };
    if (a === '--apply') out.apply = true;
    else if (a === '--i-have-alvin-ok') out.iHaveAlvinOk = true;
    else if (a === '--allow-missing-ids') out.allowMissingIds = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--tenant') {
      const v = next().trim();
      if (v) out.tenants.push(v);
    } else if (a === '--all-except') {
      const v = next();
      out.allExcept = [...(out.allExcept || []), ...v.split(',').map((s) => s.trim()).filter(Boolean)];
    } else if (a === '--sample') {
      const n = Number(next());
      if (!Number.isInteger(n) || n < 0) out.errors.push('--sample must be a whole number');
      else out.sample = n;
    } else out.errors.push(`unknown argument ${a}`);
  }
  if (!out.help) {
    if (out.tenants.length && out.allExcept) out.errors.push('use --tenant or --all-except, not both');
    if (!out.tenants.length && !out.allExcept) out.errors.push('scope required: --tenant <id> (repeatable) or --all-except <id,...>');
    if (out.allExcept && !out.allExcept.length) out.errors.push('--all-except needs at least one id');
    for (const id of [...out.tenants, ...(out.allExcept || [])]) {
      if (!UUIDISH.test(id)) out.errors.push(`not a tenant id: ${id}`);
    }
  }
  return out;
}

function isLocalHost(host) {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host === 'host.docker.internal' ||
    host.endsWith('.localhost')
  );
}

/**
 * @returns {{ ok: boolean, target: 'staging'|'local'|'prod'|'unknown', reason: string }}
 */
function targetGuard(rawUrl, { iHaveAlvinOk = false } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    return { ok: false, target: 'unknown', reason: 'SUPABASE_URL is missing or not a URL' };
  }
  const host = url.hostname.toLowerCase();
  if (host === `${STAGING_REF}.supabase.co`) return { ok: true, target: 'staging', reason: '' };
  if (isLocalHost(host)) return { ok: true, target: 'local', reason: '' };
  const target = host.includes(PROD_REF) ? 'prod' : 'unknown';
  if (iHaveAlvinOk) return { ok: true, target, reason: '' };
  return {
    ok: false,
    target,
    reason: `refusing ${target === 'prod' ? `prod (${PROD_REF})` : `non-staging host ${host}`} without --i-have-alvin-ok`,
  };
}

function isMissingValueHashColumn(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /value_hash/i.test(text) && /42703|PGRST204|does not exist|could not find|schema cache/i.test(text);
}

function scopeQuery(q, args, column) {
  if (args.tenants.length) return q.in(column, args.tenants);
  return q.not(column, 'in', `(${args.allExcept.join(',')})`);
}

async function readOwnerRows(client, args) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from('tenant_field_meta').select('tenant_id, field_path, source, value_hash').eq('source', 'owner');
    q = scopeQuery(q, args, 'tenant_id').order('tenant_id').order('field_path').range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) return { rows: null, error };
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, error: null };
}

/** catalog / faq paths name a row; a null value there means the row is gone. */
function namesARow(path) {
  return /^(catalog\.(service|product)\..+\.name|faqs\.\d+)$/.test(path);
}

/** catalog.<kind>.<key>.price / .site_visit -> its row's name path, else null. */
function leafRowPath(path) {
  return /^catalog\.(service|product)\..+\.(price|site_visit)$/.test(path)
    ? path.replace(/\.(price|site_visit)$/, '.name')
    : null;
}

/** services_catalog object rows without a stable (non-numeric) id. */
function servicesMissingIds(tenant) {
  let list = tenant?.services_catalog;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return 0;
  return list.filter((row) => row && typeof row === 'object' && !Array.isArray(row) && !stableRowId(row)).length;
}

function isEmptyFactValue(path, value) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if (/^catalog\..+\.name$/.test(path)) return !String(value.name ?? '').trim();
    if (/^faqs\./.test(path)) return !String(value.question ?? '').trim() || !String(value.answer ?? '').trim();
    return Object.keys(value).length === 0;
  }
  return false;
}

/**
 * Plan (and with --apply, write) value_hash for owner rows.
 * @param {{ client: any, supabaseUrl: string, args: ReturnType<typeof parseArgs>, log?: (line: string) => void }} p
 * @returns {Promise<{ code: number, summary: object }>}
 */
async function runBackfill({ client, supabaseUrl, args, log = console.log }) {
  if (args.help) {
    log(usage());
    return { code: 0, summary: null };
  }
  if (args.errors.length) {
    for (const e of args.errors) log(`error: ${e}`);
    log(usage());
    return { code: 2, summary: null };
  }
  const guard = targetGuard(supabaseUrl, { iHaveAlvinOk: args.iHaveAlvinOk });
  if (!guard.ok) {
    log(`error: ${guard.reason}`);
    return { code: 2, summary: null };
  }
  log(`target: ${guard.target} | mode: ${args.apply ? 'APPLY' : 'dry run'}`);

  const read = await readOwnerRows(client, args);
  if (read.error) {
    if (isMissingValueHashColumn(read.error)) {
      log('error: tenant_field_meta.value_hash is missing. Apply docs/supabase/tenant_field_confirm_v2.sql first.');
      return { code: 3, summary: null };
    }
    log(`error: reading tenant_field_meta: ${read.error.message || read.error}`);
    return { code: 4, summary: null };
  }

  const byTenant = new Map();
  for (const row of read.rows) {
    if (!byTenant.has(row.tenant_id)) byTenant.set(row.tenant_id, []);
    byTenant.get(row.tenant_id).push(row);
  }
  const tenantIds = [...byTenant.keys()];
  const tenants = new Map();
  for (let i = 0; i < tenantIds.length; i += 100) {
    const { data, error } = await client.from('tenants').select('*').in('id', tenantIds.slice(i, i + 100));
    if (error) {
      log(`error: reading tenants: ${error.message || error}`);
      return { code: 4, summary: null };
    }
    for (const t of data || []) tenants.set(t.id, t);
  }

  const missingIds = [];
  for (const tenantId of tenantIds) {
    const n = servicesMissingIds(tenants.get(tenantId));
    if (n) missingIds.push({ tenant_id: tenantId, rows: n });
  }
  if (missingIds.length) {
    log(`warning: services rows without a stable id (run services_catalog_stable_ids.sql first; a service hash includes its id):`);
    for (const m of missingIds) log(`  ${m.tenant_id}: ${m.rows} row(s)`);
    if (args.apply && !args.allowMissingIds) {
      log('error: refusing --apply while services rows lack ids. Pass --allow-missing-ids to override.');
      return { code: 2, summary: { missingIds } };
    }
  }

  const summary = { missingIds, tenants: [], totals: { owner_rows: 0, to_write: 0, written: 0, unchanged: 0, kept_existing: 0, skipped_empty: 0, unresolved: 0, write_errors: 0 } };
  const samples = [];
  const unresolved = [];
  for (const tenantId of tenantIds) {
    const counts = { tenant_id: tenantId, owner_rows: 0, to_write: 0, written: 0, unchanged: 0, kept_existing: 0, skipped_empty: 0, unresolved: 0, write_errors: 0 };
    const tenant = tenants.get(tenantId);
    for (const row of byTenant.get(tenantId)) {
      counts.owner_rows += 1;
      const path = String(row.field_path || '').trim();
      if (!tenant) {
        counts.unresolved += 1;
        unresolved.push({ tenant_id: tenantId, field_path: path, reason: 'tenant_not_found' });
        continue;
      }
      const value = factValueForPath(path, tenant);
      if (value === undefined) {
        counts.unresolved += 1;
        unresolved.push({ tenant_id: tenantId, field_path: path, reason: 'unknown_path' });
        continue;
      }
      const rowPath = leafRowPath(path);
      if (value === null && (namesARow(path) || (rowPath && factValueForPath(rowPath, tenant) === null))) {
        counts.unresolved += 1;
        unresolved.push({ tenant_id: tenantId, field_path: path, reason: 'row_not_found' });
        continue;
      }
      if (isEmptyFactValue(path, value)) {
        counts.skipped_empty += 1;
        continue;
      }
      const hash = hashFactValue(value).toLowerCase();
      const existing = String(row.value_hash || '').trim().toLowerCase();
      if (existing) {
        if (existing === hash) counts.unchanged += 1;
        else counts.kept_existing += 1;
        continue;
      }
      counts.to_write += 1;
      if (samples.length < args.sample) samples.push({ tenant_id: tenantId, field_path: path, value_hash: hash });
      if (args.apply) {
        const { error } = await client
          .from('tenant_field_meta')
          .update({ value_hash: hash })
          .eq('tenant_id', tenantId)
          .eq('field_path', path)
          .eq('source', 'owner')
          .is('value_hash', null);
        if (error) {
          counts.write_errors += 1;
          log(`write error ${tenantId} ${path}: ${error.message || error}`);
        } else counts.written += 1;
      }
    }
    summary.tenants.push(counts);
    for (const k of Object.keys(summary.totals)) summary.totals[k] += counts[k];
    log(
      `${tenantId}: owner_rows=${counts.owner_rows} to_write=${counts.to_write}` +
        (args.apply ? ` written=${counts.written} write_errors=${counts.write_errors}` : '') +
        ` unchanged=${counts.unchanged} kept_existing=${counts.kept_existing} skipped_empty=${counts.skipped_empty} unresolved=${counts.unresolved}`
    );
  }
  // Sample prints paths and hashes only, never the values (they include owner phones).
  if (samples.length) {
    log(`sample (${samples.length}):`);
    for (const s of samples) log(`  ${s.tenant_id} ${s.field_path} ${s.value_hash}`);
  }
  if (unresolved.length) {
    log(`unresolved (${unresolved.length}):`);
    for (const u of unresolved) log(`  ${u.tenant_id} ${u.field_path} ${u.reason}`);
  }
  log(`totals: ${JSON.stringify(summary.totals)}`);
  summary.samples = samples;
  summary.unresolved = unresolved;
  return { code: summary.totals.write_errors ? 1 : 0, summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  // Guard and argument checks run before any client exists.
  if (args.help || args.errors.length || !targetGuard(supabaseUrl, args).ok) {
    const { code } = await runBackfill({ client: null, supabaseUrl, args });
    process.exit(code);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.log('error: SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(2);
  }
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(supabaseUrl, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { code } = await runBackfill({ client, supabaseUrl, args });
  process.exit(code);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(4);
  });
}

module.exports = {
  STAGING_REF,
  PROD_REF,
  parseArgs,
  targetGuard,
  isEmptyFactValue,
  isMissingValueHashColumn,
  runBackfill,
};
