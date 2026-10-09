// Check one say[] sentence against the locked language, the tenant facts it
// cites, and the caller's own words. This replaces the regex filter stack on
// the structured path: it never edits a sentence. It returns problems; the
// turn engine then regenerates once, or speaks a data line or a repair line,
// and traces why. Nothing is dropped silently.

const { analyzeCallerLanguage, ENGLISH_JOB_LOANWORDS } = require('../../conversation/language');
const { bindSpokenPlace, canonicalPlaceName } = require('../../conversation/kenyaPlaces');
const { gateCallerFileSpeech } = require('../callerFileSpeech');
const { statedNumbers } = require('./numbers');
const { isOutcomeClaim } = require('../spokenStreamBuffer');
const { teamConfirmCoverageLine } = require('./coverageSource');
const { checkVisitTimes, visitTimeLine } = require('./spokenFactsSource');

const SPOKEN_CHAR = /[\p{L}\p{N}]/u;
const MARKUP = /###|[*_`#<>{}[\]\\|]|^\s*[-•]\s/;
const NEGATES_COVERAGE =
  /\b(outside|beyond|don'?t (?:cover|reach|serve|go)|do not (?:cover|reach|serve|go)|not (?:cover|reach|serve)|can'?t (?:reach|come)|cannot (?:reach|come)|no coverage|hatufiki|hatufanyi kazi|haturuki|nje ya)\b/i;
const ASSERTS_COVERAGE =
  /\b(we (?:do )?(?:cover|reach|serve|come to|go to|work in)|yes,? we cover|tunafika|tunafanya kazi|tunahudumia|tuko)\b/i;
// A coverage claim with no place: "we serve the surrounding areas".
const AREA_TALK = /\b(?:areas?|coverage|maeneo|eneo)\b/i;
// Looser claim words, used only when no owner-confirmed list exists:
// "we only serve", "we also reach".
const LOOSE_CLAIM = /\bwe\s+(?:\w+\s+){0,2}?(?:cover|serve|reach)\b|\btunahudumia\b|\btunafika\b/i;
const NAME_ASK =
  /\b(may i have your name|what(?:'s| is) your name|am i speaking with|naongea na|ninaongea na|jina lako ni nani|niambie jina)\b/i;
const LOANWORDS = new Set(ENGLISH_JOB_LOANWORDS.map((word) => String(word).toLowerCase()));

function withoutLoanwords(text) {
  return String(text || '')
    .split(/\s+/)
    .filter((word) => !LOANWORDS.has(word.toLowerCase().replace(/[^\p{L}]/gu, '')))
    .join(' ');
}

/** The sentence is plainly in another language than the lock. */
function languageProblem(sentence, locked) {
  const evidence = analyzeCallerLanguage(sentence);
  if (locked === 'en') {
    const other = evidence.language === 'sw' || evidence.language === 'sheng';
    if (other && evidence.confidence >= 0.7) return `written in ${evidence.language}`;
    // Caller-turn confidence is low on one marker word. A sentence with no
    // English evidence and several ordinary (lower-case) words is not English;
    // a greeting with the business name ("Karibu Done and Dusted") is.
    const ordinary = String(sentence).split(/\s+/).filter((w) => /^[a-z]/.test(w.replace(/^[^\p{L}]+/u, ''))).length;
    if (other && Number(evidence.scores?.en || 0) === 0 && Number(evidence.scores?.sw || 0) >= 1 && ordinary >= 4) {
      return `written in ${evidence.language}`;
    }
    return null;
  }
  // sw / sheng: English job nouns are allowed. Judge the rest.
  const rest = analyzeCallerLanguage(withoutLoanwords(sentence));
  if (rest.language === 'en' && rest.confidence >= 0.7 && Number(rest.scores?.sw || 0) === 0) {
    return 'written in en';
  }
  return null;
}

const CLAUSE_BREAK =
  /\s*(?:[,;:]|\s—\s|\s-\s)\s*|\s+(?=(?:but|although|though|since|because|while|whereas|except|apart from|other than|lakini|ila|kwani|kwa sababu|ingawa|isipokuwa|mbali na)\b)/i;

// "outside Nairobi" / "nje ya Nairobi" names a reference point, not a claim
// about that place. HD_23445a4f780c: the caller asked "kama niko outside
// Nairobi"; a reply listing the nearby areas we reach was read as denying
// Nairobi and Syokimau, and the whole reply became "Ndiyo, tunafika Syokimau."
const PLACE_REFERENCE =
  /\b(?:outside(?:\s+of)?|beyond|nje\s+ya)\s+((?:the\s+)?(?:county\s+of\s+|city\s+of\s+|kaunti\s+ya\s+|jiji\s+la\s+|mji\s+wa\s+)?[\p{L}'-]+(?:\s+[\p{L}'-]+)?)/giu;
// A clause about where the caller is ("if you're outside...", "kama uko nje
// ya...") describes the caller, not our coverage.
const CALLER_LOCATION_LEAD =
  /^(?:(?:and|so|na|sasa)\s+)?(?:if|when|in case|for (?:those|anyone|people|customers)|kama|ukiwa|iwapo|endapo|kwa wale|kwa watu)\b.{0,40}?\b(?:you(?:'re| are)?|you live|you stay|uko|unaishi|unakaa|mko|wako|they(?:'re| are)?|located|living|based)\b/i;

/** The clause with "outside <place>" spans removed, and whether any were. */
function withoutPlaceReferences(clause) {
  let stripped = false;
  const text = String(clause || '').replace(PLACE_REFERENCE, (whole, tail) => {
    const words = String(tail).split(/\s+/);
    // "outside Nairobi county" or "nje ya Nairobi": a place follows. "outside
    // our area" / "nje ya maeneo yetu" is a real coverage negation; keep it.
    for (let n = words.length; n >= 1; n -= 1) {
      const head = words.slice(0, n).join(' ');
      if (placesIn(head).length) {
        stripped = true;
        return ` ${words.slice(n).join(' ')} `;
      }
    }
    return whole;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), stripped };
}

function coverageClauses(sentence) {
  return String(sentence || '')
    .split(CLAUSE_BREAK)
    .map((part) => part.trim())
    .filter(Boolean);
}

function placesIn(sentence) {
  const found = new Set(bindSpokenPlace(sentence));
  // A one-letter STT spelling ("Kitengele") still names the place.
  for (const word of String(sentence).split(/\s+/)) {
    const one = canonicalPlaceName(word.replace(/[^\p{L}]/gu, ''));
    if (one) found.add(one);
  }
  return [...found];
}

function titleName(name) {
  return String(name || '').replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/**
 * @param {string} sentence
 * @param {{
 *   locked: string,
 *   table: ReturnType<import('./facts').buildFactTable>,
 *   factsUsed?: Array<{kind?: string, id?: string}>,
 *   callerText?: string,
 *   state?: object,
 *   nameConfirmed?: boolean,
 * }} ctx
 * @returns {{ ok: boolean, problems: Array<{ code: string, detail: string }> }}
 */
function verifySay(sentence, ctx) {
  const problems = [];
  const text = String(sentence || '').trim();
  if (!SPOKEN_CHAR.test(text)) {
    return { ok: false, problems: [{ code: 'empty', detail: 'no spoken words' }] };
  }
  if (MARKUP.test(text)) problems.push({ code: 'markup', detail: 'markup or tool marker in a spoken sentence' });

  const lang = languageProblem(text, ctx.locked);
  if (lang) problems.push({ code: 'language', detail: `locked ${ctx.locked}, ${lang}` });

  const allowedCaller = new Set(statedNumbers(ctx.callerText || ''));
  // VOICE_SPOKEN_FACTS: a Kiswahili clock slip is fixed in place; a visit
  // time that names no open visit is a time_mismatch (spokenFactsSource).
  let fixed = null;
  const timeCheck = checkVisitTimes(text, { table: ctx.table, locked: ctx.locked, callerNumbers: allowedCaller, env: ctx.env });
  if (timeCheck) {
    if (timeCheck.fixed) fixed = timeCheck.text;
    for (const miss of timeCheck.mismatches) {
      problems.push({ code: 'time_mismatch', detail: `${miss.said} is not an open visit time` });
    }
  }
  const checkedText = fixed || text;

  const cited = [];
  for (const row of Array.isArray(ctx.factsUsed) ? ctx.factsUsed : []) {
    const entry = ctx.table?.byId?.get(String(row?.id || ''));
    if (entry) cited.push(entry);
  }
  const allowed = new Set(allowedCaller);
  for (const entry of cited) for (const n of entry.numbers) allowed.add(n);
  for (const n of statedNumbers(checkedText)) {
    if (!allowed.has(n)) {
      problems.push({ code: 'unbacked_number', detail: `${n} is not in a cited fact or the caller's words` });
    }
  }

  if (ctx.table?.coverageAreas?.length) {
    // Judge each clause on its own: "Nakuru is outside our area since we
    // work in Nairobi only" negates Nakuru, not Nairobi.
    const seen = new Set();
    for (const raw of coverageClauses(text)) {
      const callerLocation = CALLER_LOCATION_LEAD.test(raw);
      const { text: clause } = withoutPlaceReferences(raw);
      const negates = !callerLocation && NEGATES_COVERAGE.test(clause);
      const asserts = ASSERTS_COVERAGE.test(clause);
      for (const place of placesIn(clause)) {
        if (seen.has(place)) continue;
        const covered = ctx.table.isCovered(place);
        if (covered && negates) {
          seen.add(place);
          problems.push({ code: 'coverage_contradiction', detail: `${titleName(place)} is in coverage`, place });
        } else if (covered === false && asserts && !negates) {
          seen.add(place);
          problems.push({ code: 'coverage_unbacked', detail: `${titleName(place)} is not in coverage`, place });
        }
      }
    }
  } else if (ctx.table?.coverageGate?.gated && !ctx.table.coverageGate.confirmed) {
    // BRAIN_CONFIRMED_COVERAGE on, no owner-confirmed list: no coverage claim
    // either way, and no area list (HD_23445a4f780c t8, t9, t11).
    const seen = new Set();
    for (const raw of coverageClauses(text)) {
      const callerLocation = CALLER_LOCATION_LEAD.test(raw);
      const { text: clause } = withoutPlaceReferences(raw);
      const negates = !callerLocation && NEGATES_COVERAGE.test(clause);
      const asserts = ASSERTS_COVERAGE.test(clause) || LOOSE_CLAIM.test(clause);
      if (!negates && !asserts) continue;
      const places = placesIn(clause);
      if (!places.length && AREA_TALK.test(clause) && !seen.has('')) {
        seen.add('');
        problems.push({ code: 'coverage_unconfirmed', detail: 'states the service area without an owner-confirmed list', place: '' });
      }
      for (const place of places) {
        if (seen.has(place)) continue;
        seen.add(place);
        problems.push({ code: 'coverage_unconfirmed', detail: `${titleName(place)} coverage is not owner-confirmed`, place });
      }
    }
  }

  if (ctx.state) {
    const gated = gateCallerFileSpeech(text, ctx.state);
    if (!gated.speak || gated.reason === 'trimmed') {
      problems.push({ code: 'privacy_unbound', detail: 'names the caller file before the speaker is confirmed' });
    }
  }
  // Sentences are spoken before tools run. A saved or booked outcome is
  // confirmed from the tool result (formatToolConfirmation), never claimed.
  if (isOutcomeClaim(text)) {
    problems.push({ code: 'outcome_claim', detail: 'claims a booking or save before the tool result' });
  }
  if (ctx.nameConfirmed && NAME_ASK.test(text)) {
    problems.push({ code: 'name_confirmed', detail: 'asks a name that is already confirmed' });
  }
  return fixed ? { ok: problems.length === 0, problems, fixed } : { ok: problems.length === 0, problems };
}

/** The caller named this place in their own words. */
function callerNamedPlace(callerText, place) {
  const key = String(place || '').toLowerCase();
  if (!key || !String(callerText || '').trim()) return false;
  return placesIn(String(callerText)).some((p) => String(p).toLowerCase() === key);
}

/**
 * A grounded line to speak in place of a sentence that failed, or ''.
 * A coverage line ("Ndiyo, tunafika X.") replaces the reply only for a place
 * the caller named; otherwise it answers a question nobody asked.
 */
function dataLineFor(sentence, problems, { table, pack, callerText = '' }) {
  const codes = new Set(problems.map((p) => p.code));
  if (codes.has('coverage_unconfirmed')) {
    // "I'll have the team confirm {place}" for the place the caller named.
    const named = problems.find((p) => p.code === 'coverage_unconfirmed' && p.place && callerNamedPlace(callerText, p.place));
    const asked = named ? named.place : placesIn(String(callerText || '')).slice(-1)[0];
    if (asked) return teamConfirmCoverageLine(titleName(asked), pack?.code);
  }
  const coverage = problems.find(
    (p) =>
      (p.code === 'coverage_contradiction' || p.code === 'coverage_unbacked') &&
      p.place &&
      callerNamedPlace(callerText, p.place)
  );
  if (coverage) {
    const place = titleName(coverage.place);
    return coverage.code === 'coverage_contradiction' ? pack.coveredLine(place) : pack.notCoveredLine(place);
  }
  if (codes.has('time_mismatch')) {
    const line = visitTimeLine(sentence, table, pack?.code);
    if (line) return line;
  }
  if (codes.has('unbacked_number') && table?.entries?.length) {
    const words = new Set(
      String(sentence)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter((word) => word.length > 2)
    );
    let best = null;
    let bestHits = 0;
    for (const entry of table.entries) {
      if (entry.kind !== 'service' || !entry.price) continue;
      const nameWords = entry.label.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      const hits = nameWords.filter((word) => words.has(word) || words.has(word.replace(/s$/, ''))).length;
      if (hits > bestHits) {
        best = entry;
        bestHits = hits;
      }
    }
    if (best && bestHits >= 1) {
      return pack.priceLine(best.label.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), best.price);
    }
  }
  return '';
}

module.exports = { verifySay, dataLineFor, placesIn, callerNamedPlace };
