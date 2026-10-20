'use strict';
// Spoken compile for every fact we say to a caller. Desk files stay raw.
// Catalogue, coverage, locations, hours, policies, and FAQ answers share
// one mouth: EN/SW openers, money and clocks as words, no invented services
// or policy text.

const { compileSpokenCatalogue, joinList } = require('./spokenCatalogue');
const { listedAreaFee, listedAreaNames } = require('./listedAreas');
const { speakMoney } = require('../speech/spokenForms');
const { normalizePolicies } = require('./businessPolicies');
const { normalizeLocations } = require('./businessLocations');
const { parseHoursSchedule } = require('./businessHours');
const { expandSpokenForms } = require('../speech/spokenForms');
const { speakSwClock } = require('../speech/swahiliTime');

const POLICY_KEYS = [
  'payment',
  'returns',
  'delivery',
  'deposit',
  'cancellation',
  'warranty',
  'other',
];

function isSw(language) {
  const lang = String(language || 'en').toLowerCase();
  return lang === 'sw' || lang === 'sheng' || lang.startsWith('swahili');
}

function speakClock(hhmm, language = 'en') {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return String(hhmm || '').trim();
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (isSw(language)) return speakSwClock(hour, minute);
  const ap = hour >= 12 ? 'PM' : 'AM';
  const h12 = ((hour + 11) % 12) + 1;
  if (!minute) return `${h12} ${ap}`;
  return `${h12}:${String(minute).padStart(2, '0')} ${ap}`;
}

/**
 * Owner prose, spoken. Expands KSh, clocks, and identifiers. Does not
 * translate the sentence or add facts.
 */
function speakFileLine(text, language = 'en') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return expandSpokenForms(raw, isSw(language) ? 'sw' : 'en').replace(/\s+/g, ' ').trim();
}

function coverageNames(profile = {}) {
  const fromListed = listedAreaNames(profile);
  if (fromListed.length) return fromListed;
  return normalizeLocations(profile.businessLocations)
    .map((loc) => loc.label || loc.address)
    .filter(Boolean);
}

function compileSpokenCoverage(profile = {}, opts = {}) {
  const names = coverageNames(profile);
  const cap = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 4;
  const more = names.length > cap;
  const shown = names.slice(0, cap);
  return {
    names: shown,
    more,
    all: names,
    opener(language) {
      const list = joinList(shown, language);
      if (!list) {
        return isSw(language)
          ? 'Uko wapi? Nitaangalia orodha ya maeneo yetu.'
          : "Which place are you in? I'll check our service areas.";
      }
      if (isSw(language)) {
        return more
          ? `Tunahudumia ${list}. Pia tuna maeneo mengine. Uko wapi?`
          : `Tunahudumia ${list}. Uko wapi?`;
      }
      return more
        ? `We serve ${list}. We also cover other listed areas. Which place are you in?`
        : `We serve ${list}. Which place are you in?`;
    },
  };
}

function compileSpokenLocations(profile = {}) {
  const locs = normalizeLocations(profile.businessLocations).slice(0, 2);
  const labels = (language) =>
    locs
      .map((loc) => speakFileLine([loc.label, loc.address, loc.landmark].filter(Boolean).join(', '), language))
      .filter(Boolean);
  return {
    labels,
    opener(language) {
      const list = joinList(labels(language), language);
      if (!list) return '';
      return isSw(language) ? `Tupate ${list}.` : `We are at ${list}.`;
    },
  };
}

function compileSpokenHours(profile = {}) {
  const parsed = parseHoursSchedule(profile.hoursSchedule);
  return {
    opener(language) {
      const sw = isSw(language);
      if (!parsed) return sw ? 'Sina masaa kwenye rekodi.' : "I don't have our hours on file.";
      const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const openDays = keys.map((key) => parsed.days[key]).filter((day) => day && day.open && day.close);
      if (!openDays.length) return sw ? 'Tuko fungwa.' : "We're closed.";
      const first = openDays[0];
      const same =
        openDays.length === 7 &&
        openDays.every((day) => day.open === first.open && day.close === first.close);
      const open = speakClock(first.open, language);
      const close = speakClock(first.close, language);
      if (sw) {
        return same
          ? `Tuko wazi kila siku kuanzia ${open} hadi ${close}.`
          : `Tuko wazi kuanzia ${open} hadi ${close}.`;
      }
      return same
        ? `We're open every day from ${open} to ${close}.`
        : `We're open from ${open} to ${close}.`;
    },
  };
}

function homeVisit(profile = {}) {
  const v = String(profile.vertical || profile.businessType || '').toLowerCase();
  return v.includes('home');
}

function compileSpokenAreaFee(profile = {}, place, language = 'en') {
  const hit = listedAreaFee(profile, place);
  if (!hit) return '';
  const sw = isSw(language);
  const travel = homeVisit(profile);
  const noun = sw ? (travel ? 'ada ya usafiri' : 'ada ya delivery') : (travel ? 'travel fee' : 'delivery fee');
  if (!hit.listed) {
    return sw
      ? `${hit.name} haiko kwenye orodha ya maeneo yetu.`
      : `${hit.name} isn't on our list of service areas.`;
  }
  if (hit.trusted && hit.feeMode === 'free') {
    return sw ? `Hakuna ${noun} kwenda ${hit.name}.` : `There is no ${noun} to ${hit.name}.`;
  }
  if (hit.trusted && hit.feeMode === 'fixed' && hit.feeKsh != null) {
    const money = speakMoney(hit.feeKsh, sw ? 'sw' : 'en');
    return sw
      ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} kwenda ${hit.name} ni ${money}.`
      : `The ${noun} to ${hit.name} is ${money}.`;
  }
  return sw
    ? `${hit.name} iko kwenye orodha. Timu itathibitisha ada ukibook.`
    : `${hit.name} is on our list. The team confirms the fee when you book.`;
}

function unknownPolicy(line) {
  return /don't have that on file|Sina hiyo kwenye rekodi/.test(String(line || ''));
}

function knownAreaFee(line) {
  return /\b(shillings|shilingi)\b|no travel fee to|Hakuna ada ya/i.test(String(line || ''));
}

/** Named-area fee if Locations has it; else the delivery sentence we already file. */
function compileSpokenVisitFee(profile = {}, place, language = 'en') {
  const delivery = compileSpokenPolicies(profile).line('delivery', language);
  if (place) {
    const fee = compileSpokenAreaFee(profile, place, language);
    if (knownAreaFee(fee)) return fee;
    if (!unknownPolicy(delivery)) return delivery;
    return fee;
  }
  return unknownPolicy(delivery) ? '' : delivery;
}

function compileSpokenPolicies(profile = {}) {
  const p = normalizePolicies(profile.businessPolicies);
  const rows = [];
  for (const key of POLICY_KEYS) {
    if (!p[key]) continue;
    rows.push({
      key,
      en: speakFileLine(p[key], 'en'),
      sw: speakFileLine(p[key], 'sw'),
    });
  }
  if (p.extra && typeof p.extra === 'object') {
    for (const [label, text] of Object.entries(p.extra)) {
      if (!text) continue;
      rows.push({
        key: label,
        en: speakFileLine(text, 'en'),
        sw: speakFileLine(text, 'sw'),
      });
    }
  }
  return {
    rows,
    line(key, language) {
      const row = rows.find((item) => item.key === key);
      if (!row) return isSw(language) ? 'Sina hiyo kwenye rekodi.' : "I don't have that on file.";
      return isSw(language) ? row.sw : row.en;
    },
  };
}

function compileSpokenFaqs(profile = {}, opts = {}) {
  const cap = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 4;
  const rows = (Array.isArray(profile.faqs) ? profile.faqs : [])
    .map((row) => ({
      question: String(row?.question || '').trim(),
      answer: String(row?.answer || '').trim(),
    }))
    .filter((row) => row.question && row.answer)
    .slice(0, cap)
    .map((row) => ({
      question: row.question,
      en: speakFileLine(row.answer, 'en'),
      sw: speakFileLine(row.answer, 'sw'),
    }));
  return { rows };
}

function compileSpokenShop(profile = {}, opts = {}) {
  return {
    catalogue: compileSpokenCatalogue(profile, opts),
    coverage: compileSpokenCoverage(profile, opts),
    locations: compileSpokenLocations(profile),
    hours: compileSpokenHours(profile),
    policies: compileSpokenPolicies(profile),
    faqs: compileSpokenFaqs(profile, opts),
    speakLine: speakFileLine,
  };
}

module.exports = {
  speakFileLine,
  compileSpokenCoverage,
  compileSpokenLocations,
  compileSpokenHours,
  compileSpokenPolicies,
  compileSpokenAreaFee,
  compileSpokenVisitFee,
  compileSpokenFaqs,
  compileSpokenShop,
};
