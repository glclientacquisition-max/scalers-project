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
  if (v === 'home_services' || v === 'homeservices' || v === 'home_service') {
    return 'home_services';
  }
  if (v === 'hospitality' || v === 'hotel' || v === 'hotels') return 'hospitality';
  if (v === 'retail') return 'retail';
  if (VERTICALS.has(v)) return v;
  return 'general';
}

module.exports = { parseVertical };
