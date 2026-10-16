'use strict';
// Per-area terms from Settings › Locations (tenants.service_areas, #667/#672):
// how an area is served (visit / delivery / pickup), the fee and the time.
// The voice server used to read only the coverage id mirror
// (business_policies.coverage_areas), so the fee never reached a call.
//
// A fee is quoted only when the owner set and confirmed that area
// (source 'owner' and confirmed true), the same rule as Desk's prompt
// compiler (dashboard/src/lib/serviceAreas.ts feeText). Anything else is
// "the team confirms the fee on the callback". Never a guess.

const { parseCoverageAreas } = require('./coverageAreas');
const { countiesForPlace, normalizePlaceKey } = require('./kenyaPlaces');

const MODES = new Set(['visit', 'delivery', 'pickup']);
const FEE_MODES = new Set(['free', 'fixed', 'ask']);
const MAX_KSH = 1000000;

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

/**
 * Normalized area terms, or null when Locations was never saved.
 * @returns {{ areas: Array<{ id: string, name: string, mode: string, feeMode: string, feeKsh: number|null, eta: string|null, trusted: boolean }> } | null}
 */
function readAreaTerms(raw) {
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
    const eta = String(a.eta ?? '').trim().slice(0, 40) || null;
    areas.push({
      id,
      name: titleName(id.slice(id.indexOf(':') + 1)),
      mode: modes[0] || (obj.reach === 'deliver' ? 'delivery' : 'visit'),
      feeMode,
      feeKsh: feeMode === 'fixed' ? fee : null,
      eta,
      trusted: a.source === 'owner' && a.confirmed === true,
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

/** Fee words for one area: "KSh 300 travel fee", "no travel fee", "fee confirmed on callback". */
function feePhrase(area, language = 'en') {
  const sw = language === 'sw';
  const visit = area.mode !== 'delivery';
  if (!area.trusted || area.feeMode === 'ask' || (area.feeMode === 'fixed' && area.feeKsh == null)) {
    return sw ? 'bei inathibitishwa na timu' : 'fee confirmed on callback';
  }
  if (area.feeMode === 'free') {
    if (sw) return visit ? 'hakuna ada ya usafiri' : 'delivery ni bure';
    return visit ? 'no travel fee' : 'free delivery';
  }
  if (sw) return visit ? `ada ya usafiri ${pesa(area.feeKsh)}` : `delivery ${pesa(area.feeKsh)}`;
  return visit ? `${money(area.feeKsh)} travel fee` : `${money(area.feeKsh)} delivery`;
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

const SW_ETA = [[/^same[ -]?day$/i, 'siku hiyo hiyo'], [/^next[ -]?day$/i, 'siku inayofuata'], [/^within 24 ?h(ou)?rs?$/i, 'ndani ya saa 24'], [/^(1|one)[- ]2 days$/i, 'ndani ya siku 1 hadi 2']];
function swEta(eta) { const hit = SW_ETA.find(([re]) => re.test(eta)); return hit ? hit[1] : null; }

/** One spoken line for a covered area with its fee and time. */
function coveredAreaLine(area, language = 'en') {
  const sw = language === 'sw';
  const visit = area.mode !== 'delivery';
  const eta = area.eta ? String(area.eta).trim() : '';
  let fee;
  if (!area.trusted || area.feeMode === 'ask' || area.feeKsh == null && area.feeMode === 'fixed') {
    fee = sw ? 'Timu itakuthibitishia bei watakapokupigia.' : 'The team will confirm the fee when they call you back.';
  } else if (area.feeMode === 'free') {
    fee = sw ? (visit ? 'Hakuna ada ya usafiri.' : 'Delivery ni bure.') : visit ? 'There is no travel fee.' : 'Delivery is free.';
  } else {
    fee = sw
      ? visit ? `Ada ya usafiri ni ${pesa(area.feeKsh)}.` : `Delivery ni ${pesa(area.feeKsh)}.`
      : visit ? `The travel fee there is ${money(area.feeKsh)}.` : `Delivery there is ${money(area.feeKsh)}.`;
  }
  const head = sw ? `Ndiyo, tunafika ${area.name}.` : visit ? `Yes, we come to ${area.name}.` : `Yes, we deliver to ${area.name}.`;
  const when = !eta ? '' : sw ? (swEta(eta) ? ` Tunakuja ${swEta(eta)}.` : ` Muda: ${eta}.`) : ` Timing: ${eta.toLowerCase()}.`;
  return `${head} ${fee}${when}`;
}

/** The structured terms check_coverage returns for a matched area. */
function areaTermsValue(area) {
  return {
    name: area.name,
    mode: area.mode,
    fee_mode: area.trusted ? area.feeMode : 'ask',
    fee_ksh: area.trusted && area.feeMode === 'fixed' ? area.feeKsh : null,
    eta: area.eta,
    fee_confirmed: area.trusted,
  };
}

module.exports = { readAreaTerms, matchArea, feePhrase, areaWithTerms, formatCoverageWithTerms, coveredAreaLine, areaTermsValue };
