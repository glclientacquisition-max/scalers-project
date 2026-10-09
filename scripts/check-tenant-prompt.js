#!/usr/bin/env node
// Build the live Gemini prompt from a read-only tenant snapshot and check that
// every fact the voice path may speak is in it (coverage, hours, services,
// confirmed policies).
//
// Usage: node scripts/check-tenant-prompt.js --file tenant.json [--print]
// The file is { tenant: <tenants row>, field_meta: [<tenant_field_meta rows>] }.

const fs = require('node:fs');
const path = require('node:path');
const { buildSystemPrompt } = require('../src/prompts');
const { profileFromSnapshot, checkPromptFacts } = require('../src/conversation/promptFacts');

function main(argv) {
  const at = argv.indexOf('--file');
  const file = at >= 0 ? argv[at + 1] : null;
  if (!file) {
    console.error('usage: node scripts/check-tenant-prompt.js --file tenant.json [--print]');
    return 2;
  }
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const profile = profileFromSnapshot(snapshot);
  const prompt = buildSystemPrompt(profile);
  const { expected, missing } = checkPromptFacts(profile, prompt);
  if (argv.includes('--print')) console.log(prompt);
  const byKind = {};
  for (const fact of expected) byKind[fact.kind] = (byKind[fact.kind] || 0) + 1;
  console.log(`${profile.businessName}: ${expected.length} facts (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')})`);
  for (const fact of missing) console.log(`MISSING ${fact.kind}: ${fact.text}`);
  console.log(missing.length ? `FAIL ${missing.length} missing` : 'PASS every fact is in the prompt');
  return missing.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
