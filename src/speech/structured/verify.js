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

const SPOKEN_CHAR = /[\p{L}\p{N}]/u;
const MARKUP = /###|[*_`#<>{}[\]\\|]|^\s*[-•]\s/;
const NEGATES_COVERAGE =
  /\b(outside|beyond|don'?t (?:cover|reach|serve|go)|do not (?:cover|reach|serve|go)|not (?:cover|reach|serve)|can'?t (?:reach|come)|cannot (?:reach|come)|no coverage|hatufiki|hatufanyi kazi|haturuki|nje ya)\b/i;
const ASSERTS_COVERAGE =
  /\b(we (?:do )?(?:cover|reach|serve|come to|go to|work in)|yes,? we cover|tunafika|tunafanya kazi|tunahudumia|tuko)\b/i;
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
  /\s*(?:[,;:]|\s—\s|\s-\s)\s*|\s+(?=(?:but|although|though|since|because|while|whereas|lakini|ila|kwani|kwa sababu|ingawa)\b)/i;

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

  const cited = [];
  for (const row of Array.isArray(ctx.factsUsed) ? ctx.factsUsed : []) {
    const entry = ctx.table?.byId?.get(String(row?.id || ''));
    if (entry) cited.push(entry);
  }
  const allowed = new Set(statedNumbers(ctx.callerText || ''));
  for (const entry of cited) for (const n of entry.numbers) allowed.add(n);
  for (const n of statedNumbers(text)) {
    if (!allowed.has(n)) {
      problems.push({ code: 'unbacked_number', detail: `${n} is not in a cited fact or the caller's words` });
    }
  }

  if (ctx.table?.coverageAreas?.length) {
    // Judge each clause on its own: "Nakuru is outside our area since we
    // work in Nairobi only" negates Nakuru, not Nairobi.
    const seen = new Set();
    for (const clause of coverageClauses(text)) {
      const negates = NEGATES_COVERAGE.test(clause);
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
  return { ok: problems.length === 0, problems };
}

/** A grounded line to speak in place of a sentence that failed, or ''. */
function dataLineFor(sentence, problems, { table, pack }) {
  const codes = new Set(problems.map((p) => p.code));
  const coverage = problems.find((p) => p.code === 'coverage_contradiction' || p.code === 'coverage_unbacked');
  if (coverage?.place) {
    const place = titleName(coverage.place);
    return coverage.code === 'coverage_contradiction' ? pack.coveredLine(place) : pack.notCoveredLine(place);
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

module.exports = { verifySay, dataLineFor, placesIn };
