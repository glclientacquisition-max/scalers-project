// Business vertical pack id for playbooks / prompt shaping.

const VERTICALS = new Set(['general', 'retail', 'home_services', 'hospitality']);

/**
 * @param {unknown} raw
 * @returns {'general'|'retail'|'home_services'|'hospitality'}
 */
function parseVertical(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'retail' || v === 'shop' || v === 'shops') return 'retail';
  if (v === 'home_services' || v === 'homeservices' || v === 'home_service') {
    return 'home_services';
  }
  if (v === 'hospitality' || v === 'hotel' || v === 'hotels') return 'hospitality';
  if (VERTICALS.has(v)) return v;
  return 'general';
}

const { resolveBusinessType } = require('./businessType');

/**
 * Resolved business type for call packs (retail, home_services, general).
 * @param {unknown} raw vertical string or { business_type, vertical }
 * @returns {'retail'|'home_services'|'general'}
 */
function offeredVertical(raw) {
  const input =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : { vertical: raw };
  return resolveBusinessType(input);
}

module.exports = { parseVertical, offeredVertical };
