#!/usr/bin/env node
/**
 * One-off: create missing contacts from distinct calls.caller_number.
 *
 * Default is dry-run. Write only with --apply.
 * Does not update calls, service_requests, or appointments.
 *
 * Usage:
 *   node scripts/backfill-contacts-from-calls.js
 *   node scripts/backfill-contacts-from-calls.js --dry-run
 *   node scripts/backfill-contacts-from-calls.js --apply
 */

const { normalizeKenyaE164 } = require('../src/conversation/liveTransferReady');

function parseSummaryName(summary) {
  if (!summary) return null;
  let parsed = summary;
  if (typeof summary === 'string') {
    try {
      parsed = JSON.parse(summary);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const name = String(parsed.name || '').trim();
  return name || null;
}

function normalizeContactPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'unknown') return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

function planTenantContacts(calls, existingContacts) {
  const existingPhones = new Set();
  for (const row of existingContacts || []) {
    const key = normalizeContactPhone(row.phone);
    if (key) existingPhones.add(key);
  }

  /** @type {Map<string, { phone: string, name: string|null, nameAt: string }>} */
  const byPhone = new Map();
  let scanned = 0;
  for (const call of calls || []) {
    scanned += 1;
    const phone = normalizeContactPhone(call.caller_number);
    if (!phone) continue;
    const createdAt = String(call.created_at || '');
    const name = parseSummaryName(call.summary);
    const prev = byPhone.get(phone);
    if (!prev) {
      byPhone.set(phone, {
        phone,
        name,
        nameAt: name ? createdAt : '',
      });
      continue;
    }
    if (name && (!prev.nameAt || createdAt > prev.nameAt)) {
      prev.name = name;
      prev.nameAt = createdAt;
    }
  }

  const create = [];
  let skipped = 0;
  for (const row of byPhone.values()) {
    if (existingPhones.has(row.phone)) {
      skipped += 1;
      continue;
    }
    create.push({ phone: row.phone, name: row.name });
  }

  return { scanned, distinctPhones: byPhone.size, create, skipped };
}

async function fetchAll(supabase, table, select, filters) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (typeof filters === 'function') query = filters(query);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  require('dotenv').config();
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply') && !args.has('--dry-run');
  const mode = apply ? 'apply' : 'dry-run';

  const { supabase } = require('../src/lib/supabaseClient');

  const { data: tenants, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, business_name')
    .order('created_at', { ascending: true });
  if (tenantErr) throw tenantErr;

  const list = tenants || [];
  console.log(`[backfill-contacts] mode=${mode} tenants=${list.length}`);

  let totalCreate = 0;
  let totalSkipped = 0;
  let totalScanned = 0;

  for (const tenant of list) {
    const [calls, contacts] = await Promise.all([
      fetchAll(
        supabase,
        'calls',
        'caller_number, summary, created_at',
        (q) => q.eq('tenant_id', tenant.id)
      ),
      fetchAll(
        supabase,
        'contacts',
        'id, phone',
        (q) => q.eq('tenant_id', tenant.id)
      ),
    ]);

    const plan = planTenantContacts(calls, contacts);
    totalScanned += plan.scanned;
    totalSkipped += plan.skipped;
    totalCreate += plan.create.length;

    console.log(
      `[backfill-contacts] tenant=${tenant.id} name=${JSON.stringify(tenant.business_name || '')}` +
        ` calls_scanned=${plan.scanned} distinct_phones=${plan.distinctPhones}` +
        ` would_create=${plan.create.length} skipped_existing=${plan.skipped}`
    );

    if (!apply || plan.create.length === 0) continue;

    const now = new Date().toISOString();
    for (const row of plan.create) {
      const { error } = await supabase.from('contacts').insert({
        tenant_id: tenant.id,
        phone: row.phone,
        name: row.name,
        updated_at: now,
      });
      if (error && /duplicate|unique/i.test(error.message)) continue;
      if (error) throw error;
    }
  }

  console.log(
    `[backfill-contacts] done mode=${mode} calls_scanned=${totalScanned}` +
      ` contacts_${apply ? 'created' : 'would_create'}=${totalCreate}` +
      ` skipped_existing=${totalSkipped}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-contacts] failed:', err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  parseSummaryName,
  normalizeContactPhone,
  planTenantContacts,
};
