'use strict';
// Per-area terms from Settings › Locations (tenants.service_areas, #667/#672):
// how an area is served, the fee and the time. The voice server used to read
// only the coverage id mirror (business_policies.coverage_areas), so the fee
// never reached a call.
//
// A fee is spoken only when the owner set and confirmed that area (source
// 'owner' and confirmed true), the same rule as Desk's prompt compiler
// (dashboard/src/lib/serviceAreas.ts feeText). Any other fee is "confirmed on
// callback". Never a guess.
//
// Wording: home services say "travel fee" (ada ya usafiri); shops say
// "delivery fee" (ada ya delivery). Other verticals follow the area's mode.

const { parseCoverageAreas } = require('./coverageAreas');
const { countiesForPlace, normalizePlaceKey } = require('./kenyaPlaces');

const MODES = new Set(['visit', 'delivery', 'pickup']);
const FEE_MODES = new Set(['free', 'fixed', 'ask']);
const MAX_KSH = 1000000;

/** VOICE_AREA_FEES=on|1|true|yes turns area fees on. Default off. */
function areaFeesEnabled(env) {
  return /^(1|true|on|yes)$/i.test(String((env ? env.VOICE_AREA_FEES : process.env.VOICE_AREA_FEES) || '').trim());
}

function titleName(name) {
  if (name === 'muranga') return "Murang'a";
  return String(name || '').replace(/\b[a-z]+/g, (w) => (w === 'cbd' ? 'CBD' : w.charAt(0).toUpperCase() + w.slice(1)));
}

function ksh(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_KSH ? n : null;
}

function asObject(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
}

/** 'travel' for home services, 'delivery' for shops, else by the area's mode. */
function feeKind(vertical, mode) {
  const v = String(vertical || '').toLowerCase();
  if (v === 'home_services') return 'travel';
  if (v === 'retail') return 'delivery';
  return mode === 'visit' ? 'travel' : 'delivery';
}

/**
 * Normalized area terms, or null when Locations was never saved.
 * @param {unknown} raw tenants.service_areas
 * @param {{ vertical?: string }} [opts]
 * @returns {{ areas: Array<{ id: string, name: string, mode: string, kind: 'travel'|'delivery', feeMode: string, feeKsh: number|null, eta: string|null, trusted: boolean }> } | null}
 */
function readAreaTerms(raw, opts = {}) {
  // VOICE_AREA_FEES (default off): off reads no terms, so every caller of
  // profile.areaTerms behaves exactly as before #769.
  if (!areaFeesEnabled(opts.env)) return null;
  const obj = asObject(raw);
  if (!obj || !Array.isArray(obj.areas)) return null;
  const valid = new Set(parseCoverageAreas(obj.areas.map((a) => (a && typeof a === 'object' ? a.id : null))));
  const seen = new Set();
  const areas = [];
  for (const a of obj.areas) {
    if (!a || typeof a !== 'object') continue;
    const id = String(a.id || '').trim().toLowerCase();
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    const modes = (Array.isArray(a.modes) ? a.modes : []).map(String).filter((m) => MODES.has(m));
    const fee = ksh(a.fee_ksh);
    let feeMode = FEE_MODES.has(a.fee_mode) ? a.fee_mode : 'ask';
    if (feeMode === 'fixed' && fee == null) feeMode = 'ask';
    const trusted = a.source === 'owner' && a.confirmed === true;
    const mode = modes[0] || (obj.reach === 'deliver' ? 'delivery' : 'visit');
    areas.push({
      id,
      name: titleName(id.slice(id.indexOf(':') + 1)),
      mode,
      kind: feeKind(opts.vertical, mode),
      feeMode: trusted ? feeMode : 'ask',
      feeKsh: trusted && feeMode === 'fixed' ? fee : null,
      eta: String(a.eta ?? '').trim().slice(0, 40) || null,
      trusted,
    });
  }
  return { areas };
}

/** The area a caller's place falls in: a listed place first, then a listed county. */
function matchArea(place, terms) {
  const list = terms?.areas || [];
  if (!list.length) return null;
  const phrase = normalizePlaceKey(place);
  if (!phrase) return null;
  const byName = new Map(list.filter((a) => a.id.startsWith('place:')).map((a) => [a.id.slice(6), a]));
  if (byName.has(phrase)) return byName.get(phrase);
  const tokens = phrase.split(' ').filter((w) => w.length >= 4);
  for (let i = 0; i < tokens.length; i += 1) {
    if (i + 1 < tokens.length && byName.has(`${tokens[i]} ${tokens[i + 1]}`)) return byName.get(`${tokens[i]} ${tokens[i + 1]}`);
    if (byName.has(tokens[i])) return byName.get(tokens[i]);
  }
  const counties = new Map(list.filter((a) => a.id.startsWith('county:')).map((a) => [a.id.slice(7), a]));
  if (!counties.size) return null;
  const hit = countiesForPlace(place).find((c) => counties.has(c));
  return hit ? counties.get(hit) : null;
}

const money = (n) => `KSh ${Number(n).toLocaleString('en-US')}`;
const pesa = (n) => `shilingi ${Number(n).toLocaleString('en-US')}`;
const NOUN = { travel: { en: 'travel fee', sw: 'ada ya usafiri' }, delivery: { en: 'delivery fee', sw: 'ada ya delivery' } };
const noun = (area, sw) => NOUN[area.kind === 'travel' ? 'travel' : 'delivery'][sw ? 'sw' : 'en'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const speakable = (area) => area.trusted && (area.feeMode === 'free' || (area.feeMode === 'fixed' && area.feeKsh != null));

/** Prompt words for one area's fee: "KSh 300 travel fee", "no travel fee", "travel fee confirmed on callback". */
function feePhrase(area) {
  const n = noun(area, false);
  if (!speakable(area)) return `${n} confirmed on callback`;
  if (area.feeMode === 'free') return `no ${n}`;
  return `${money(area.feeKsh)} ${n}`;
}

/** "Kileleshwa (KSh 300 travel fee, same day)". */
function areaWithTerms(area) {
  const eta = area.eta ? `, ${area.eta.charAt(0).toLowerCase()}${area.eta.slice(1)}` : '';
  return `${area.name} (${feePhrase(area)}${eta})`;
}

/**
 * Coverage list for the prompt, each area with its terms when Locations has them.
 * Ids without saved terms stay as plain names.
 */
function formatCoverageWithTerms(coverageIds, terms) {
  const byId = new Map((terms?.areas || []).map((a) => [a.id, a]));
  return parseCoverageAreas(coverageIds)
    .map((id) => (byId.has(id) ? areaWithTerms(byId.get(id)) : titleName(id.slice(id.indexOf(':') + 1))))
    .join(', ');
}

/** One spoken sentence for the area's fee, in the caller's language. */
function feeSentence(area, language = 'en') {
  const sw = isSw(language);
  const n = noun(area, sw);
  if (!speakable(area)) {
    return sw ? `Timu itakuthibitishia ${n} watakapokupigia.` : `The team will confirm the ${n} when they call you back.`;
  }
  if (area.feeMode === 'free') return sw ? `Hakuna ${n}.` : `There is no ${n}.`;
  return sw ? `${cap(n)} ni ${pesa(area.feeKsh)}.` : `The ${n} there is ${money(area.feeKsh)}.`;
}

const SW_ETA = [[/^same[ -]?day$/i, 'siku hiyo hiyo'], [/^next[ -]?day$/i, 'siku inayofuata'], [/^within 24 ?h(ou)?rs?$/i, 'ndani ya saa 24'], [/^(1|one)[- ]2 days$/i, 'ndani ya siku 1 hadi 2']];
function swEta(eta) { const hit = SW_ETA.find(([re]) => re.test(eta)); return hit ? hit[1] : null; }
function isSw(language) {
  const l = String(language || 'en').toLowerCase();
  return l === 'sw' || l === 'sheng' || l.startsWith('swahili');
}

/** One spoken line for a covered area with its fee and time. */
function coveredAreaLine(area, language = 'en') {
  const sw = isSw(language);
  const eta = area.eta ? String(area.eta).trim() : '';
  const head = sw ? `Ndiyo, tunafika ${area.name}.` : area.mode === 'visit' ? `Yes, we come to ${area.name}.` : `Yes, we deliver to ${area.name}.`;
  const when = !eta ? '' : sw ? (swEta(eta) ? ` Tunakuja ${swEta(eta)}.` : ` Muda: ${eta}.`) : ` Timing: ${eta.toLowerCase()}.`;
  return `${head} ${feeSentence(area, language)}${when}`;
}

/** The structured terms check_coverage returns for a matched area. */
function areaTermsValue(area) {
  return {
    name: area.name,
    mode: area.mode,
    fee_kind: area.kind,
    fee_mode: speakable(area) ? area.feeMode : 'ask',
    fee_ksh: speakable(area) && area.feeMode === 'fixed' ? area.feeKsh : null,
    eta: area.eta,
    fee_confirmed: area.trusted,
  };
}

/** Facts the speech check may hear: owner-confirmed fees and times only. */
function speakableAreaFacts(terms) {
  return (terms?.areas || [])
    .filter((a) => a.trusted)
    .map((a) => ({ name: a.name, fee_ksh: speakable(a) && a.feeMode === 'fixed' ? a.feeKsh : null, eta: a.eta }));
}

module.exports = {
  areaFeesEnabled,
  readAreaTerms,
  matchArea,
  feeKind,
  feePhrase,
  feeSentence,
  areaWithTerms,
  formatCoverageWithTerms,
  coveredAreaLine,
  areaTermsValue,
  speakableAreaFacts,
};
