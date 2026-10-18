#!/usr/bin/env node
'use strict';

/**
 * BRAIN_NAME_FOLD backfill report. READ ONLY: nothing is written anywhere.
 *
 * Lists contacts whose stored alternate_names fold into the primary name
 * (STT spellings of one person, src/conversation/nameFold.js), and whether
 * the line stops counting as shared once BRAIN_NAME_FOLD=on. No row needs
 * rewriting: the fold is applied when the card is read.
 *
 * Usage:
 *   1. Run REPORT_SQL (SELECT only) on the project, e.g. Supabase SQL editor
 *      or MCP execute_sql, and save the rows as JSON.
 *   2. node scripts/name-fold-backfill-report.js rows.json [--label prod]
 *   Or: node scripts/name-fold-backfill-report.js --sql   (prints the SQL)
 */

const fs = require('node:fs');
const { namesFold } = require('../src/conversation/nameFold');

const REPORT_SQL = `select c.id, c.tenant_id, c.phone, c.name,
       c.metadata->'alternate_names' as alternate_names,
       c.metadata->'name_locked' as name_locked,
       c.metadata->'single_person' as single_person,
       c.metadata->'alternate_names_dismissed' as alternate_names_dismissed
  from contacts c
 where jsonb_typeof(c.metadata->'alternate_names') = 'array'
   and jsonb_array_length(c.metadata->'alternate_names') > 0
 order by c.updated_at desc nulls last;`;

function maskPhone(phone) {
  const p = String(phone || '');
  return p.length > 6 ? `${p.slice(0, 4)}…${p.slice(-3)}` : p;
}

function classify(row) {
  const primary = String(row.name || '').trim();
  const dismissed = new Set(
    (Array.isArray(row.alternate_names_dismissed) ? row.alternate_names_dismissed : [])
      .map((d) => String(typeof d === 'string' ? d : d?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const alts = (Array.isArray(row.alternate_names) ? row.alternate_names : [])
    .map((a) => String(a?.name || '').trim())
    .filter((a) => a && !dismissed.has(a.toLowerCase()));
  const folded = primary ? alts.filter((a) => namesFold(a, primary)) : [];
  const others = alts.filter((a) => !folded.includes(a));
  const locked = Boolean(row.name_locked) || row.single_person === true;
  return {
    id: row.id,
    tenant: row.tenant_id,
    phone: maskPhone(row.phone),
    name: primary || null,
    folded,
    others,
    sharedBefore: alts.length > 0,
    sharedAfter: !locked && others.length > 0,
  };
}

function report(rows, label = '') {
  const all = rows.map(classify);
  const withFold = all.filter((r) => r.folded.length);
  const out = {
    label,
    contactsWithAlternates: all.length,
    contactsWithFoldedAlternates: withFold.length,
    stopSharedLine: withFold.filter((r) => r.sharedBefore && !r.sharedAfter).length,
    stillSharedOtherName: withFold.filter((r) => r.sharedAfter).length,
    rows: withFold,
  };
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--sql')) {
    process.stdout.write(`${REPORT_SQL}\n`);
    process.exit(0);
  }
  const file = args.find((a) => !a.startsWith('--'));
  const li = args.indexOf('--label');
  const label = li >= 0 ? args[li + 1] : '';
  if (!file) {
    console.error('usage: name-fold-backfill-report.js rows.json [--label name] | --sql');
    process.exit(2);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(JSON.stringify(report(Array.isArray(rows) ? rows : rows.rows || [], label), null, 2));
}

module.exports = { REPORT_SQL, classify, report };
