// Which coverage areas the structured mouth may state (BRAIN_CONFIRMED_COVERAGE).
//
// Brain's src/conversation/confirmedCoverage.js (brain/escalation-handoff,
// 88f42cdf) owns the rule: with the flag on, coverage is claimed in or out
// only from an owner-confirmed policies.coverage_areas. Until that module is
// on this branch, this adapter mirrors its contract behind the same flag:
//   - flag on only when BRAIN_CONFIRMED_COVERAGE is exactly 'on';
//   - confirmed only with an explicit owner row in fieldMeta for
//     policies.coverage_areas (source 'owner', or confirmed_at/confirmed_by);
//   - otherwise nothing is speakable and the place goes to
//     "I'll have the team confirm {place}."
// When the Brain module is present it is used instead (FACT_HASH_MODE aware).
// Flag off: the stored list, exactly as before.

const { normalizePolicies } = require('../../conversation/businessPolicies');
const { parseCoverageAreas } = require('../../conversation/coverageAreas');

const FLAG = 'BRAIN_CONFIRMED_COVERAGE';
const BRAIN_MODULE = '../../conversation/confirmedCoverage';

let brainCache;
function brainModule() {
  if (brainCache !== undefined) return brainCache;
  try {
    const mod = require(BRAIN_MODULE);
    brainCache = mod && typeof mod.speakableCoverageAreas === 'function' ? mod : null;
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('confirmedCoverage')) {
      brainCache = null;
    } else {
      throw err;
    }
  }
  return brainCache;
}

/** 'brain' when Brain's module is loaded, else 'mirror'. */
function coverageSourceKind() {
  return brainModule() ? 'brain' : 'mirror';
}

function confirmedCoverageOn(env = process.env) {
  const brain = brainModule();
  if (brain && typeof brain.confirmedCoverageEnabled === 'function') return brain.confirmedCoverageEnabled(env);
  return Boolean(env) && env[FLAG] === 'on';
}

/** The stored picker list, as facts.js read it before the flag. */
function storedCoverageAreas(profile = {}) {
  const policies = normalizePolicies(profile?.businessPolicies);
  return Array.isArray(policies.coverage_areas) ? policies.coverage_areas : [];
}

function mirrorSpeakable(profile = {}) {
  const areas = parseCoverageAreas(storedCoverageAreas(profile));
  if (!areas.length) return null;
  const byPath = profile?.fieldMeta?.byPath;
  const meta = byPath && typeof byPath === 'object' ? byPath['policies.coverage_areas'] : null;
  const ownerRow = Boolean(meta && (meta.source === 'owner' || meta.confirmed_at || meta.confirmed_by));
  return ownerRow ? areas : null;
}

/**
 * Coverage the mouth may state for this call.
 * @returns {{ gated: boolean, confirmed: boolean, areas: string[] }}
 *   gated false: flag off, areas is the stored list (today's behaviour).
 *   gated true: areas is the owner-confirmed list, or [] when unconfirmed.
 */
function speakableCoverage(profile = {}, opts = {}) {
  const env = opts.env || process.env;
  if (!confirmedCoverageOn(env)) {
    return { gated: false, confirmed: false, areas: storedCoverageAreas(profile) };
  }
  let list = null;
  const brain = brainModule();
  if (brain) {
    try {
      list = brain.speakableCoverageAreas(profile, { ...opts, env });
    } catch {
      list = null; // fail closed: nothing speakable
    }
  } else {
    list = mirrorSpeakable(profile);
  }
  const areas = parseCoverageAreas(Array.isArray(list) ? list : []);
  return { gated: true, confirmed: areas.length > 0, areas };
}

function langOf(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sheng') return 'sheng';
  if (lang === 'sw' || lang.startsWith('swahili')) return 'sw';
  return 'en';
}

/** "I'll have the team confirm {place}." No claim either way, no callback time. */
function teamConfirmCoverageLine(place, language = 'en') {
  const brain = brainModule();
  if (brain && typeof brain.teamConfirmCoverageLine === 'function') {
    return brain.teamConfirmCoverageLine(place, language);
  }
  const where = String(place || '').trim();
  const lang = langOf(language);
  if (lang === 'sw') {
    return where ? `Nitaiomba timu yetu ithibitishe eneo la ${where}.` : 'Nitaiomba timu yetu ithibitishe eneo hilo.';
  }
  if (lang === 'sheng') {
    return where ? `Nitaambia team ithibitishe ${where}.` : 'Nitaambia team ithibitishe hiyo area.';
  }
  return where ? `I'll have the team confirm ${where}.` : "I'll have the team confirm that area.";
}

/** Tests only: forget the cached module lookup. */
function resetCoverageSourceForTests(mod) {
  brainCache = mod === undefined ? undefined : mod;
}

module.exports = {
  FLAG,
  confirmedCoverageOn,
  coverageSourceKind,
  speakableCoverage,
  storedCoverageAreas,
  teamConfirmCoverageLine,
  resetCoverageSourceForTests,
};
