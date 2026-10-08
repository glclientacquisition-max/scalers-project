// Which tenant facts the voice path may speak, and whether the live Gemini
// prompt carries each one. Used by tests and by scripts/check-tenant-prompt.js
// against a read-only tenant snapshot.

const { tenantProfileFromRow } = require('../tenantProfile');
const { indexFieldMeta, factServices, factPolicyMap, policyKeyLabel } = require('./provenance');
const { readCoverageAreas, formatCoverageList } = require('./coverageAreas');
const { formatScheduleSummary } = require('./businessHours');

/**
 * @param {{ tenant: object, field_meta?: object[] }} snapshot
 */
function profileFromSnapshot(snapshot = {}) {
  const row = snapshot.tenant || snapshot;
  const fieldMeta = Array.isArray(snapshot.field_meta) ? indexFieldMeta(snapshot.field_meta) : null;
  return tenantProfileFromRow(row, { fieldMeta });
}

/**
 * Facts the prompt must carry: label plus the literal text to find.
 * Derived from the data, never from one tenant.
 */
function expectedPromptFacts(profile = {}) {
  const out = [];
  const fieldMeta = profile.fieldMeta || null;
  const coverage = readCoverageAreas(profile.businessPolicies) || [];
  for (const name of formatCoverageList(coverage).split(', ').filter(Boolean)) {
    out.push({ kind: 'coverage', text: name });
  }
  const hours = formatScheduleSummary(profile.hoursSchedule) || String(profile.businessHours || '').trim();
  if (hours) {
    const first = hours.split(/[.;]/)[0].trim();
    if (first) out.push({ kind: 'hours', text: first });
  }
  for (const row of factServices(profile.servicesCatalog, fieldMeta)) {
    const name = String(row?.name || '').trim();
    if (name) out.push({ kind: 'service', text: name });
  }
  const split = factPolicyMap(profile.businessPolicies, fieldMeta);
  for (const [key, value] of Object.entries(split.policies)) {
    if (key === 'coverage_areas') continue;
    const firstLine = String(value).split('\n')[0].trim();
    if (firstLine) out.push({ kind: `policy:${policyKeyLabel(key)}`, text: firstLine });
  }
  return out;
}

/**
 * @returns {{ prompt: string, expected: object[], missing: object[] }}
 */
function checkPromptFacts(profile, prompt) {
  const expected = expectedPromptFacts(profile);
  const missing = expected.filter((fact) => !prompt.includes(fact.text));
  return { prompt, expected, missing };
}

module.exports = { profileFromSnapshot, expectedPromptFacts, checkPromptFacts };
