#!/usr/bin/env node
/**
 * One-off: rewrite stored Kenya mobiles to E.164 on contacts, calls,
 * service_requests, and appointments.
 *
 * Default is dry-run. Write only with --apply.
 * Unique conflicts are skipped (two rows already share one number).
 *
 * Usage:
 *   node scripts/backfill-phone-e164.js
 *   node scripts/backfill-phone-e164.js --dry-run
 *   node scripts/backfill-phone-e164.js --apply
 */

const { normalizeKenyaE164 } = require('../src/conversation/liveTransferReady');

function normalizeContactPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

function planPhoneRewrites(rows, field) {
  const updates = [];
  let scanned = 0;
  let already = 0;
  for (const row of rows || []) {
    scanned += 1;
    const current = String(row[field] || '').trim();
    if (!current) continue;
    const next = normalizeContactPhone(current);
    if (!next || next === current) {
      already += 1;
      continue;
    }
    updates.push({ id: row.id, from: current, to: next });
  }
  return { scanned, already, updates };
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

async function applyUpdates(supabase, table, field, updates, apply) {
  let written = 0;
  let skipped = 0;
  if (!apply) return { written, skipped };
  for (const row of updates) {
    const { error } = await supabase
      .from(table)
      .update({ [field]: row.to })
      .eq('id', row.id);
    if (error && /duplicate|unique/i.test(error.message || '')) {
      skipped += 1;
      continue;
    }
    if (error) throw error;
    written += 1;
  }
  return { written, skipped };
}

async function main() {
  require('dotenv').config();
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply') && !args.has('--dry-run');
  const mode = apply ? 'apply' : 'dry-run';
  const { supabase } = require('../src/lib/supabaseClient');

  const jobs = [
    { table: 'contacts', field: 'phone', select: 'id, phone' },
    { table: 'calls', field: 'caller_number', select: 'id, caller_number' },
    { table: 'service_requests', field: 'caller_phone', select: 'id, caller_phone' },
    { table: 'appointments', field: 'caller_phone', select: 'id, caller_phone' },
  ];

  console.log(`[backfill-phone-e164] mode=${mode}`);
  for (const job of jobs) {
    const rows = await fetchAll(supabase, job.table, job.select);
    const plan = planPhoneRewrites(rows, job.field);
    const result = await applyUpdates(supabase, job.table, job.field, plan.updates, apply);
    console.log(
      `[backfill-phone-e164] ${job.table}.${job.field} scanned=${plan.scanned}` +
        ` already_e164=${plan.already} would_write=${plan.updates.length}` +
        (apply ? ` wrote=${result.written} unique_skip=${result.skipped}` : '')
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-phone-e164] failed:', err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  normalizeContactPhone,
  planPhoneRewrites,
};
