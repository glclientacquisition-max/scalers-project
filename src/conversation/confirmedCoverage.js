// Confirmed-areas rule (BRAIN_CONFIRMED_COVERAGE, Phase 0 of the escalation
// system). Staging call HD_23445a4f780c spoke the D&D seed coverage list
// ("Ndiyo, tunafika Syokimau", "we only serve Nairobi, ... Syokimau") although
// no owner had confirmed it.
//
// With the flag on:
//   - Coverage is claimed (in-area or out-of-area) only from the owner-
//     confirmed coverage list (GIGO readFact 'locations.coverage_areas', which
//     already follows FACT_HASH_MODE: hash mode needs a matching value_hash).
//   - A place that matches only an unconfirmed list, or no list, gets
//     "I'll have the team confirm {place}." No "we cover", no "we don't
//     cover", no callback time. The place becomes an open need for the owner.
//   - A bare Okay / Sawa / OK is not a yes to the "note it for the team"
//     offer. An explicit yes is (see callCorrectives.ackIsConsent).
// With the flag off nothing here changes behaviour.

const FLAG = 'BRAIN_CONFIRMED_COVERAGE';

/** On only when the env value is exactly 'on'. */
function confirmedCoverageEnabled(env = process.env) {
  return Boolean(env) && env[FLAG] === 'on';
}

/**
 * The owner-confirmed coverage list, or { confirmed: false }.
 * Lazy require: factReaders -> provenance would cycle at load time.
 * @returns {{ confirmed: boolean, areas: string[]|null, reason: string|null }}
 */
function confirmedCoverageReading(profile = {}, opts = {}) {
  const { readFact } = require('./gigo/factReaders');
  const { lookupFieldMeta } = require('./provenance');
  const reading = readFact(profile || {}, 'locations.coverage_areas', opts);
  if (reading.status === 'known' && Array.isArray(reading.value) && reading.value.length) {
    // Stricter than the P0 default (no meta row reads as owner): coverage needs
    // an explicit owner row. Hash mode already needs one with a matching hash.
    const meta = lookupFieldMeta(profile?.fieldMeta || null, 'policies.coverage_areas');
    const ownerRow = Boolean(meta && (meta.source === 'owner' || meta.confirmed_at || meta.confirmed_by));
    if (!ownerRow) return { confirmed: false, areas: null, reason: 'no_owner_row' };
    return { confirmed: true, areas: reading.value, reason: null };
  }
  return { confirmed: false, areas: null, reason: reading.reason || 'unconfirmed' };
}

/**
 * Coverage areas a speech or prompt layer may state as fact.
 * Flag off: the stored picker list (today's behaviour). Flag on: the
 * confirmed list only, else null.
 */
function speakableCoverageAreas(profile = {}, opts = {}) {
  const { readCoverageAreas } = require('./coverageAreas');
  if (!confirmedCoverageEnabled(opts.env)) return readCoverageAreas(profile?.businessPolicies);
  const reading = confirmedCoverageReading(profile, opts);
  return reading.confirmed ? reading.areas : null;
}

function langOf(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sheng') return 'sheng';
  if (lang === 'sw' || lang.startsWith('swahili')) return 'sw';
  return 'en';
}

/** "I'll have the team confirm {place}." No yes/no claim, no callback time. */
function teamConfirmCoverageLine(place, language = 'en') {
  const where = String(place || '').trim();
  const lang = langOf(language);
  if (lang === 'sw') {
    return where
      ? `Nitaiomba timu yetu ithibitishe eneo la ${where}.`
      : 'Nitaiomba timu yetu ithibitishe eneo hilo.';
  }
  if (lang === 'sheng') {
    return where ? `Nitaambia team ithibitishe ${where}.` : 'Nitaambia team ithibitishe hiyo area.';
  }
  return where ? `I'll have the team confirm ${where}.` : "I'll have the team confirm that area.";
}

/**
 * Record (once per place) an open coverage need on brain state.
 * Shape follows docs/specs/handoff-record.md needs[].
 */
function recordCoverageNeed(state, place, turn = null) {
  const where = String(place || '').trim();
  if (!state || typeof state !== 'object' || !where) return state;
  if (!Array.isArray(state.needs)) state.needs = [];
  const key = where.toLowerCase();
  const already = state.needs.some(
    (need) => need && need.kind === 'coverage_confirm' && String(need.place || '').toLowerCase() === key
  );
  if (already) return state;
  state.needs.push({
    kind: 'coverage_confirm',
    text: `Confirm whether we serve ${where}`,
    place: where,
    status: 'open',
    open_reason: 'coverage_unconfirmed',
    outcome: null,
    created_turn: Number.isFinite(Number(turn)) ? Number(turn) : null,
  });
  return state;
}

/** Owner-facing lines for the call summary: open coverage needs. */
function openCoverageNeedLines(state) {
  const needs = Array.isArray(state?.needs) ? state.needs : [];
  return needs
    .filter((need) => need && need.kind === 'coverage_confirm' && need.status === 'open')
    .map((need) => `Confirm coverage: ${need.place}`);
}

// Explicit yes to the note-for-the-team offer. Okay / Sawa / OK / Poa / Eeh
// alone are acknowledgements (the tenant prompt says so); an explicit word
// anywhere in a short reply is consent ("Okay, sure", "Sawa, ndio").
const EXPLICIT_YES =
  /\b(?:yes|yeah|yep|yup|yah|sure|please|please do|go ahead|do it|do that|note it|ndio|ndiyo|naam|tafadhali|andika)\b/;
const EXPLICIT_NO =
  /\b(?:no|nope|don'?t|do not|not now|hapana|la|usi\w*|sitaki|leave it)\b/;

function looksLikeExplicitYes(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[?.!,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.split(' ').length > 8) return false;
  if (EXPLICIT_NO.test(t)) return false;
  return EXPLICIT_YES.test(t);
}

/** Prompt rule when the flag is on. `confirmed`: an owner-confirmed list is in POLICIES. */
function confirmedCoveragePromptRule(confirmed) {
  return confirmed
    ? 'COVERAGE RULE (owner-confirmed): Only the Coverage line is the service area. Delivery text and location notes are not coverage. A place the Coverage line cannot place: say "I\'ll have the team confirm {place}." Do not promise a callback time.'
    : 'COVERAGE RULE: The owner has not confirmed any service area. Never say we cover, we serve, or we do not cover a place, and never list areas. Say "I\'ll have the team confirm {place}." (Kiswahili: "Nitaiomba timu yetu ithibitishe eneo la {place}.") Do not promise a callback time.';
}

module.exports = {
  FLAG,
  confirmedCoveragePromptRule,
  confirmedCoverageEnabled,
  confirmedCoverageReading,
  speakableCoverageAreas,
  teamConfirmCoverageLine,
  recordCoverageNeed,
  openCoverageNeedLines,
  looksLikeExplicitYes,
};
