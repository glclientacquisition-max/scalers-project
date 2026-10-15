// Test helpers for BRAIN_CONFIRMED_COVERAGE (strict rule: coverage is a fact
// only with an explicit owner row on policies.coverage_areas, plus a matching
// value_hash when FACT_HASH_MODE=on).
//
// - ownerCoverage(profile): the same profile with an owner tenant_field_meta
//   row for its coverage list (hash included), merged into any fieldMeta it has.
//   With the flag off the row changes nothing (P0 already reads no row as owner).
// - withCoverageFlag(value, fn): run fn with the flag pinned. Used only for
//   tests of a flag-off path that the strict rule removes on purpose
//   (Delivery / location-note coverage, bare Okay or Sawa as consent). Their
//   flag-on twins live in tests/confirmedCoverage.test.js.

const { hashFactValue, factValueForPath, tenantRowFromProfile } = require('../../src/conversation/factHash');

function ownerCoverage(profile = {}) {
  const value = factValueForPath('policies.coverage_areas', tenantRowFromProfile(profile));
  const row = { source: 'owner', confirmed_at: '2026-10-01T09:00:00Z' };
  if (value !== undefined) row.value_hash = hashFactValue(value);
  const base = profile.fieldMeta && typeof profile.fieldMeta === 'object' ? profile.fieldMeta : { loaded: true, byPath: {} };
  return {
    ...profile,
    fieldMeta: { ...base, byPath: { ...(base.byPath || {}), 'policies.coverage_areas': row } },
  };
}

function withCoverageFlag(value, fn) {
  const prior = process.env.BRAIN_CONFIRMED_COVERAGE;
  const restore = () => {
    if (prior === undefined) delete process.env.BRAIN_CONFIRMED_COVERAGE;
    else process.env.BRAIN_CONFIRMED_COVERAGE = prior;
  };
  if (value == null) delete process.env.BRAIN_CONFIRMED_COVERAGE;
  else process.env.BRAIN_CONFIRMED_COVERAGE = value;
  let out;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

/** Shorthand: run fn on the flag-off (legacy) path. */
const flagOff = (fn) => () => withCoverageFlag(null, fn);

module.exports = { ownerCoverage, withCoverageFlag, flagOff };
