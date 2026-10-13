// "Do you go outside these areas?" -> "Yes, anywhere in Kenya".
// Stored as business_policies.coverage_outside = { anywhere_kenya: true, fee_ksh }
// (mirrored by the dashboard from tenants.service_areas). Listed areas keep
// their own terms; any other Kenyan place is covered on these terms.

const { readCoverageAreas, coveredByAreas } = require('./coverageAreas');
const { countiesForPlace } = require('./kenyaPlaces');

const FOREIGN =
  /\b(?:uganda|kampala|entebbe|jinja|tanzania|dar(?:\s+es\s+salaam)?|arusha|moshi|dodoma|zanzibar|mwanza|rwanda|kigali|burundi|bujumbura|ethiopia|addis(?:\s+ababa)?|somalia|mogadishu|south\s+sudan|juba|sudan|khartoum|congo|drc|goma|kinshasa|dubai|uae|saudi|qatar|doha|london|uk|england|usa|america|canada|india|china|south\s+africa|johannesburg|nigeria|lagos|ghana|accra|europe|abroad)\b/i;

function policiesObject(policies) {
  if (typeof policies === 'string') {
    try {
      return JSON.parse(policies);
    } catch {
      return null;
    }
  }
  return policies && typeof policies === 'object' && !Array.isArray(policies) ? policies : null;
}

/** { feeKsh } when the owner said "Yes, anywhere in Kenya", else null. */
function readCoverageOutside(policies) {
  const obj = policiesObject(policies);
  const raw = obj && obj.coverage_outside;
  if (!raw || typeof raw !== 'object' || raw.anywhere_kenya !== true) return null;
  const n = Number(raw.fee_ksh);
  const feeKsh = raw.fee_ksh != null && raw.fee_ksh !== '' && Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
  return { feeKsh };
}

function isForeignPlace(text) {
  return FOREIGN.test(String(text || ''));
}

/**
 * listed | kenya | outside_kenya | unknown_place (Yes only)
 * listed | outside | unknown (No: the old list rules).
 */
function coverageDetail(text, profile = {}) {
  const selected = readCoverageAreas(profile.businessPolicies);
  if (selected && selected.length && coveredByAreas(text, selected)) return 'listed';
  const outside = readCoverageOutside(profile.businessPolicies);
  if (!outside) {
    if (!selected || !selected.length) return 'unknown';
    return countiesForPlace(text).length ? 'outside' : 'unknown';
  }
  if (isForeignPlace(text)) return 'outside_kenya';
  if (countiesForPlace(text).length) return 'kenya';
  return 'unknown_place';
}

function lang(language) {
  const l = String(language || 'en').toLowerCase();
  if (l === 'sheng') return 'sheng';
  return l === 'sw' || l.startsWith('swahili') ? 'sw' : 'en';
}

const money = (n) => `KSh ${Number(n).toLocaleString('en-US')}`;

/** "Yes, we cover Kisumu. " + the fee, or the team calls back. Home services: always a travel-price callback. */
function kenyaCoverageLine({ place, feeKsh = null, homeServices = false, language = 'en' }) {
  const l = lang(language);
  const name = String(place || '').trim();
  if (l === 'en') {
    if (homeServices) return `Yes, we cover ${name}. The team will call you back with the travel price.`;
    if (feeKsh != null) return `Yes, we cover ${name}. Delivery there is ${money(feeKsh)}.`;
    return `Yes, we cover ${name}. The team will call you back with the fee.`;
  }
  const yes = l === 'sheng' ? `Ndio, tunafika ${name}.` : `Ndiyo, tunafika ${name}.`;
  if (homeServices) return `${yes} Timu itakupigia na bei ya usafiri.`;
  if (feeKsh != null) return `${yes} Delivery ni shilingi ${Number(feeKsh).toLocaleString('en-US')}.`;
  return `${yes} Timu itakupigia na bei.`;
}

function outsideKenyaLine(language = 'en') {
  const l = lang(language);
  if (l === 'sw') return 'Samahani, tunahudumia Kenya pekee. Naweza kukuachia ujumbe kwa timu yetu?';
  if (l === 'sheng') return 'Sorry, tunafanya Kenya pekee. Naweza andika hii kwa team?';
  return 'Sorry, we only cover Kenya. Should I note it for the team?';
}

function whichCountyLine(language = 'en') {
  const l = lang(language);
  if (l === 'sw') return 'Hapo ni kaunti gani?';
  if (l === 'sheng') return 'Hiyo ni county gani?';
  return 'Which county is that in?';
}

function noteJobQuestion(language = 'en') {
  const l = lang(language);
  if (l === 'sw') return 'Nikuandikie kazi yako kwa timu?';
  if (l === 'sheng') return 'Niandike job yako kwa team?';
  return 'Should I note the job for them?';
}

module.exports = {
  readCoverageOutside,
  isForeignPlace,
  coverageDetail,
  kenyaCoverageLine,
  outsideKenyaLine,
  whichCountyLine,
  noteJobQuestion,
};
