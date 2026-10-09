'use strict';

// Spoken facts for the structured mouth (VOICE_SPOKEN_FACTS).
//
// Voice's src/speech/spokenFacts (voice/sw-clock-time, #633) renders every
// spoken time, day and price from stored values and guards a reply against
// the stored facts. This adapter uses it when it is on the branch; until then
// only the backed-numbers fix below runs.
//
// Flag on only when VOICE_SPOKEN_FACTS is exactly 'on':
//   - a caller-file visit stored as a card line ("Carpet Cleaning | past 9 Oct
//     Friday 9 October 2026, 9 AM | requested | Kitengela") becomes a full
//     vis fact, so a spoken "9" is backed (HD_d199dbbf6b79 t2/t3 regenerated
//     on unbacked_number: vis:1 was just "visit");
//   - with the module present the vis fact also carries the rendered phrases
//     (en / sw / sheng) and its minutes, and verify checks visit times.
// Flag off: exactly as before.

const FLAG = 'VOICE_SPOKEN_FACTS';
const MODULE = '../spokenFacts';
const GUARD_MODULE = '../spokenFacts/guard';

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};
const VISIT_WORDS =
  /\b(?:ziara|visit|appointment|booking|miadi|nimehifadhi|nimehamisha|saved|moved|rescheduled|tufike|tutafika|we'?ll come)\b/i;

function spokenFactsOn(env = process.env) {
  return (env || {})[FLAG] === 'on';
}

function optional(path, name) {
  try {
    return require(path);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(name)) return null;
    throw err;
  }
}

let cache;
function modules() {
  if (cache !== undefined) return cache;
  const facts = optional(MODULE, 'spokenFacts');
  const guard = facts ? optional(GUARD_MODULE, 'guard') : null;
  cache =
    facts && typeof facts.renderFact === 'function' && guard && typeof guard.guardSpokenFacts === 'function'
      ? { renderFact: facts.renderFact, guardSpokenFacts: guard.guardSpokenFacts }
      : null;
  return cache;
}

/** 'voice' when the spokenFacts module is loaded, else 'none'. */
function spokenFactsSourceKind() {
  return modules() ? 'voice' : 'none';
}

/** Minutes since midnight (EAT) and an ISO instant from a stored when-text. */
function parseWhen(text) {
  const raw = String(text || '');
  const clock = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s?[Mm]\b/);
  if (!clock) return { minutes: null, iso: null };
  const hour = Number(clock[1]);
  if (!(hour >= 1 && hour <= 12)) return { minutes: null, iso: null };
  const minutes = ((hour % 12) + (/p/i.test(clock[3]) ? 12 : 0)) * 60 + Number(clock[2] || 0);
  const date = raw.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!date) return { minutes, iso: null };
  const ms = Date.UTC(Number(date[3]), MONTHS[date[2].toLowerCase()], Number(date[1]), 0, minutes) - 3 * 3600 * 1000;
  return { minutes, iso: new Date(ms).toISOString() };
}

function isoMinutes(iso) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 3 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * One open visit as a fact. Flag off: the old object read, unchanged.
 * @returns {{ label: string, text: string, minutes?: number, spoken?: object }}
 */
function visitFact(visit, { env, now } = {}) {
  if (!spokenFactsOn(env)) {
    const label = String(visit?.service || visit?.serviceName || visit?.item || 'visit').trim();
    const when = String(visit?.whenText || visit?.when || visit?.window || '').trim();
    return { label, text: [label, when].filter(Boolean).join(', ') };
  }
  let label;
  let when;
  let iso = null;
  if (typeof visit === 'string') {
    const parts = visit.split('|').map((part) => part.trim()).filter(Boolean);
    label = parts[0] || 'visit';
    when = parts.slice(1).join(', ');
  } else {
    label = String(visit?.service || visit?.serviceName || visit?.item || 'visit').trim();
    when = String(visit?.whenText || visit?.when || visit?.window || '').trim();
    iso = visit?.window_start || visit?.windowStart || null;
  }
  const parsed = parseWhen(when);
  const minutes = iso ? isoMinutes(iso) : parsed.minutes;
  iso = iso || parsed.iso;
  const fact = { label, text: [label, when].filter(Boolean).join(', ') };
  const mods = modules();
  if (mods && Number.isFinite(minutes)) fact.minutes = minutes;
  if (mods && iso) {
    const slot = { type: 'datetime', iso, tz: 'Africa/Nairobi', precision: 'time' };
    const opts = now ? { now } : {};
    const spoken = {
      en: mods.renderFact(slot, 'en', opts),
      sw: mods.renderFact(slot, 'sw', opts),
      sheng: mods.renderFact(slot, 'sheng', opts),
    };
    if (spoken.en && spoken.sw) {
      fact.spoken = spoken;
      // Rendered phrases in the fact back the numbers they carry ("saa tatu").
      fact.text += `. Say it as: en "${spoken.en}"; sw "${spoken.sw}"`;
    }
  }
  return fact;
}

/**
 * Visit-time guard for one sentence. Returns null when it does not apply.
 * A Kiswahili clock slip is fixed in place; a time that names no open visit
 * (and is not in the caller's words) is a time_mismatch.
 */
function checkVisitTimes(sentence, { table, locked, callerNumbers, env } = {}) {
  if (!spokenFactsOn(env)) return null;
  const mods = modules();
  if (!mods || !VISIT_WORDS.test(String(sentence || ''))) return null;
  const times = (table?.entries || [])
    .filter((entry) => entry.kind === 'visit' && Number.isFinite(entry.minutes))
    .map((entry) => entry.minutes);
  if (!times.length) return null;
  const lang = locked === 'sw' ? 'sw' : 'en';
  const checked = mods.guardSpokenFacts(String(sentence), { lang, times });
  const allowed = callerNumbers instanceof Set ? callerNumbers : new Set();
  const { statedNumbers } = require('./numbers');
  const mismatches = checked.mismatches.filter(
    (miss) => miss.kind === 'time' && ![...statedNumbers(miss.said)].some((n) => allowed.has(n))
  );
  return { text: checked.text, fixed: checked.text !== String(sentence), mismatches };
}

/** A code line for a visit whose spoken time was wrong, or ''. */
function visitTimeLine(sentence, table, packCode) {
  const visits = (table?.entries || []).filter((entry) => entry.kind === 'visit' && entry.spoken);
  if (!visits.length) return '';
  let pick = visits.length === 1 ? visits[0] : null;
  if (!pick) {
    const lower = String(sentence || '').toLowerCase();
    const hits = visits.filter((entry) =>
      entry.label.toLowerCase().split(/[^a-z0-9]+/).some((word) => word.length > 3 && lower.includes(word))
    );
    if (hits.length === 1) pick = hits[0];
  }
  if (!pick) return '';
  const label = pick.label.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (packCode === 'sw') return `Ziara yako ya ${label} ni ${pick.spoken.sw}.`;
  if (packCode === 'sheng') return `Visit yako ya ${label} ni ${pick.spoken.sheng}.`;
  return `Your ${label} visit is ${pick.spoken.en}.`;
}

function resetSpokenFactsCache() {
  cache = undefined;
}

module.exports = {
  FLAG,
  spokenFactsOn,
  spokenFactsSourceKind,
  visitFact,
  checkVisitTimes,
  visitTimeLine,
  parseWhen,
  resetSpokenFactsCache,
};
