// VOICE_COVERAGE_SINGLE_SOURCE (HD_513dfb2fa73f): one source of truth for
// "do you cover X". The coverage check (visitLocation.decideVisitPlace) is the
// only judge. The model may state coverage only when that verdict says so.
//
// 1. Town aliases: a short name a caller says ("Rongai") matches a listed
//    multi-word place ("place:ongata rongai") when it is that place's
//    distinctive word. The prompt list and the check now agree.
// 2. Speech: a coverage claim the verdict does not back is replaced with the
//    honest line plus a callback-note offer, in the caller's language.
// 3. Downgrade: a visit saved as an enquiry (site visits not confirmed by the
//    owner) is told to the caller as a request the team will confirm.

const GENERIC_PLACE_WORDS = new Set([
  'town', 'city', 'cbd', 'centre', 'center', 'estate', 'road', 'north', 'south',
  'east', 'west', 'upper', 'lower', 'new', 'old', 'phase', 'stage', 'area',
]);

// Spoken short forms that are not the last word of the listed name.
const EXTRA_ALIASES = Object.freeze({
  ongata: 'ongata rongai',
  'rongai ongata': 'ongata rongai',
});

function coverageSingleSourceEnabled() {
  const raw = String(process.env.VOICE_COVERAGE_SINGLE_SOURCE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

/**
 * True when a caller phrase names a listed place by a short alias.
 * @param {string} phrase normalised caller phrase (lower case, spaced)
 * @param {Set<string>} places listed place names (from place:<name> ids)
 */
function aliasPlaceMatch(phrase, places) {
  const text = String(phrase || '').toLowerCase().trim();
  if (!text || !places || !places.size) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    for (const span of [tokens[i], tokens[i + 1] ? `${tokens[i]} ${tokens[i + 1]}` : '']) {
      if (span && EXTRA_ALIASES[span] && places.has(EXTRA_ALIASES[span])) return true;
    }
  }
  for (const place of places) {
    const words = place.split(' ').filter(Boolean);
    if (words.length < 2) continue;
    const distinctive = words.filter((w) => w.length >= 4 && !GENERIC_PLACE_WORDS.has(w));
    if (!distinctive.length) continue;
    const last = distinctive[distinctive.length - 1];
    if (tokens.includes(last)) return true;
  }
  return false;
}

/** inside | outside | unknown | '' (no place heard yet) from the check alone. */
function coverageVerdict(state) {
  const vp = state?.visitPlace;
  if (!vp || typeof vp !== 'object') return '';
  const blocked = String(vp.blocked || '');
  if (blocked === 'outside') return 'outside';
  if (blocked === 'unknown_coverage') return 'unknown';
  const coverage = String(vp.coverage || '');
  if (coverage === 'inside' || coverage === 'outside') return coverage;
  if (coverage === 'unknown') return 'unknown';
  return '';
}

const POSITIVE_CLAIM =
  /\b(?:(?:is|are|falls?|lies?)\s+(?:well\s+)?(?:within|inside|in)\s+(?:our\s+)?(?:coverage|service)(?:\s+area)?|we\s+(?:do\s+)?(?:cover|serve|reach|come\s+to|go\s+to)\b|(?:it'?s|that'?s)\s+covered|tunafika|tunahudumia|iko\s+ndani\s+ya\s+(?:eneo|maeneo))/i;
const NEGATIVE_CLAIM =
  /\b(?:outside\s+(?:of\s+)?our\s+(?:coverage|service)|(?:do\s+not|don'?t)\s+(?:cover|serve|reach)|hatufiki|liko\s+nje|iko\s+nje)\b/i;

function splitSentences(text) {
  return String(text || '').match(/[^.!?]+[.!?]*\s*/g) || [];
}

function langOf(language) {
  const l = String(language || 'en').toLowerCase();
  if (l === 'sheng') return 'sheng';
  return l === 'sw' || l.startsWith('swahili') ? 'sw' : 'en';
}

/**
 * Replace coverage claims the check does not back.
 * @returns {{ text: string, changed: boolean, reason: string }}
 */
function guardCoverageClaim(text, { state, language } = {}) {
  const input = String(text || '');
  if (!coverageSingleSourceEnabled() || !input.trim()) return { text: input, changed: false, reason: '' };
  const verdict = coverageVerdict(state);
  // No place heard yet: a general "we cover Nairobi and Kiambu" stays the model's.
  if (!verdict) return { text: input, changed: false, reason: '' };
  const { outsideCoverageSpeech, unsureCoverageSpeech } = require('./visitLocation');
  let changed = false;
  let reason = '';
  let replaced = false;
  const out = [];
  for (const sentence of splitSentences(input)) {
    const positive = POSITIVE_CLAIM.test(sentence) && !NEGATIVE_CLAIM.test(sentence);
    const negative = NEGATIVE_CLAIM.test(sentence);
    if (positive && verdict !== 'inside') {
      changed = true;
      reason = `coverage_claim_${verdict || 'none'}`;
      if (!replaced) {
        out.push(
          `${verdict === 'outside' ? outsideCoverageSpeech(langOf(language)) : unsureCoverageSpeech(langOf(language))} `
        );
        replaced = true;
      }
      continue;
    }
    if (negative && verdict === 'inside') {
      changed = true;
      reason = 'coverage_denial_inside';
      continue;
    }
    out.push(sentence);
  }
  if (!changed) return { text: input, changed: false, reason: '' };
  // An honest coverage line ends the turn: drop a booking question after it.
  let joined = out.join('').replace(/\s+/g, ' ').trim();
  if (replaced) {
    const honest = verdict === 'outside'
      ? outsideCoverageSpeech(langOf(language))
      : unsureCoverageSpeech(langOf(language));
    joined = honest;
  }
  return { text: joined, changed, reason };
}

/** Prompt rule: the model never judges coverage from the list itself. */
function coverageSourcePromptRule() {
  return 'COVERAGE SOURCE: The system checks the caller\'s area against this list, including short names (Rongai = Ongata Rongai). Never tell the caller an area is or is not covered unless the turn guidance gives the coverage result. If the result is outside or unknown, say so plainly and offer to note it for the team.';
}

/** Next-best-action reason when the check says outside (callback note allowed). */
function outsideReason() {
  return 'Coverage check: outside. Say the area is outside our coverage and offer to note it for the team. Do not create_appointment. Never say landmark.';
}

/** Spoken line when a visit was saved as an enquiry because site visits are not confirmed. */
function visitDowngradeLine(language = 'en') {
  const lang = langOf(language);
  if (lang === 'sw') return 'Sawa, nimehifadhi ombi lako la ziara. Timu itakupigia kuthibitisha.';
  if (lang === 'sheng') return 'Poa, nime-save visit request yako. Team itakupigia ku-confirm.';
  return "Okay, I've noted your visit request. The team will call you to confirm it.";
}

module.exports = {
  coverageSingleSourceEnabled,
  aliasPlaceMatch,
  coverageVerdict,
  guardCoverageClaim,
  coverageSourcePromptRule,
  outsideReason,
  visitDowngradeLine,
  POSITIVE_CLAIM,
  NEGATIVE_CLAIM,
};
