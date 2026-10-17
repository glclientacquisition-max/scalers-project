#!/usr/bin/env node
// Docs hygiene: every docs/**/*.md has owner + last_reviewed frontmatter (error),
// and last_reviewed older than DOCS_STALE_DAYS (default 90) prints a warning.
// Archived docs and generated reference files are exempt from the staleness warning.
// Usage: node scripts/docs/check-docs.js [--today YYYY-MM-DD]
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const LANES = new Set(['platform', 'voice', 'brain', 'desk', 'ops-billing']);
const days = Number(process.env.DOCS_STALE_DAYS || 90);
const ti = process.argv.indexOf('--today');
const today = ti > 0 ? new Date(process.argv[ti + 1] + 'T00:00:00Z') : new Date();
const gh = Boolean(process.env.GITHUB_ACTIONS);

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
let errors = 0, warnings = 0;
for (const f of walk(path.join(root, 'docs')).sort()) {
  const r = path.relative(root, f).split(path.sep).join('/');
  const s = fs.readFileSync(f, 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---\n/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) { const kv = line.match(/^([a-z_]+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].trim(); }
  if (!m || !fm.owner || !fm.last_reviewed) { errors++; console.log(`${gh ? `::error file=${r}::` : 'ERROR '}${r}: missing owner/last_reviewed frontmatter`); continue; }
  if (!LANES.has(fm.owner)) { errors++; console.log(`${gh ? `::error file=${r}::` : 'ERROR '}${r}: owner "${fm.owner}" is not one of ${[...LANES].join(', ')}`); }
  if (fm.last_reviewed === 'generated' || fm.status === 'archived') continue;
  const d = new Date(fm.last_reviewed + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) { errors++; console.log(`${gh ? `::error file=${r}::` : 'ERROR '}${r}: bad last_reviewed "${fm.last_reviewed}"`); continue; }
  const age = Math.floor((today - d) / 86400000);
  if (age > days) { warnings++; console.log(`${gh ? `::warning file=${r}::` : 'WARN '}${r}: last_reviewed ${fm.last_reviewed} (${age} days, owner ${fm.owner})`); }
}
console.log(`docs check: ${errors} errors, ${warnings} stale (>${days} days) warnings`);
process.exit(errors ? 1 : 0);
