// Build curated Soniox STT session context from tenant profile.
// Context improves recognition of brand/product/place names (hearing path).
// Keep terms short and tenant-scoped — do not dump a global gazetteer.

const { normalizeServices } = require('../conversation/liveKnowledge');
const { normalizeLocations } = require('../conversation/businessLocations');

/** Soft cap — Soniox context biasing degrades with huge unrelated term lists. */
const MAX_STT_TERMS = Number(process.env.SONIOX_STT_CONTEXT_MAX_TERMS || 40);

/**
 * @param {string} value
 * @returns {string}
 */
function cleanTerm(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prefer longer phrases first; drop near-duplicates (case-insensitive).
 * @param {string[]} values
 * @param {number} [max]
 * @returns {string[]}
 */
function curateTerms(values, max = MAX_STT_TERMS) {
  const seen = new Set();
  const out = [];
  const sorted = [...values]
    .map(cleanTerm)
    .filter((t) => t.length >= 2 && t.length <= 80)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  for (const term of sorted) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    // Skip if a longer kept term already contains this as a whole-word-ish substring
    // and this is a short fragment (avoid "Hotel" when "Ngong Hills Hotel" is present).
    if (term.length <= 5) {
      let redundant = false;
      for (const kept of out) {
        if (kept.toLowerCase().includes(key) && kept.length > term.length + 2) {
          redundant = true;
          break;
        }
      }
      if (redundant) continue;
    }
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Collect catalog / place / people names callers are likely to say.
 * @param {object} [tenant]
 * @returns {string[]}
 */
function collectTenantTerms(tenant = {}) {
  const terms = [];

  const businessName = cleanTerm(tenant.businessName || tenant.business_name);
  const agentName = cleanTerm(tenant.agentName || tenant.agent_name);
  if (businessName) terms.push(businessName);
  if (agentName) terms.push(agentName);

  for (const svc of normalizeServices(tenant.servicesCatalog || tenant.services_catalog)) {
    if (svc.name) terms.push(svc.name);
  }

  for (const loc of normalizeLocations(tenant.businessLocations || tenant.business_locations)) {
    if (loc.label) terms.push(loc.label);
    if (loc.landmark) terms.push(loc.landmark);
  }

  const team = Array.isArray(tenant.teamDirectory)
    ? tenant.teamDirectory
    : Array.isArray(tenant.team_directory)
      ? tenant.team_directory
      : [];
  for (const member of team) {
    const name = cleanTerm(member?.name);
    if (name) terms.push(name);
  }

  // Tenant TTS lexicon match strings that look like plain phrases (not regex).
  const lexicon = Array.isArray(tenant.ttsLexicon)
    ? tenant.ttsLexicon
    : Array.isArray(tenant.tts_lexicon)
      ? tenant.tts_lexicon
      : [];
  for (const entry of lexicon) {
    const match = cleanTerm(entry?.match);
    if (!match) continue;
    if (/[\\^$*+?()[\]{}|.]/.test(match)) continue;
    terms.push(match);
    const say = cleanTerm(entry?.say);
    if (say && say !== match) terms.push(say);
  }

  return curateTerms(terms);
}

/**
 * Build Soniox realtime `context` object for session-open config.
 * Uses structured `general` (key/value array) per Soniox docs — not a bare string.
 *
 * @param {object} [tenant] - getTenantProfile()-shaped object (camelCase) or raw row
 * @returns {{ general: Array<{key: string, value: string}>, terms: string[] } | null}
 */
function buildSttContext(tenant) {
  if (!tenant || typeof tenant !== 'object') return null;

  const businessName = cleanTerm(tenant.businessName || tenant.business_name);
  const agentName = cleanTerm(tenant.agentName || tenant.agent_name) || 'Receptionist';
  const vertical = cleanTerm(tenant.vertical) || 'general';
  const terms = collectTenantTerms(tenant);

  if (!businessName && !terms.length) return null;

  const general = [
    {
      key: 'domain',
      value: 'Customer service phone receptionist',
    },
    {
      key: 'setting',
      value: 'Inbound phone call in Kenya',
    },
    {
      key: 'languages',
      value:
        'Callers may speak English, Swahili, or code-switch between them (and Sheng).',
    },
  ];
  if (businessName) {
    general.push({ key: 'organization', value: businessName });
  }
  if (agentName) {
    general.push({ key: 'agent', value: agentName });
  }
  if (vertical && vertical !== 'general') {
    general.push({ key: 'vertical', value: vertical });
  }

  return { general, terms };
}

/**
 * Env gate for A/B: SONIOX_STT_CONTEXT=off disables injection.
 * @returns {boolean}
 */
function isSttContextEnabled() {
  const raw = String(process.env.SONIOX_STT_CONTEXT || 'on').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
}

module.exports = {
  buildSttContext,
  collectTenantTerms,
  curateTerms,
  isSttContextEnabled,
  MAX_STT_TERMS,
};
