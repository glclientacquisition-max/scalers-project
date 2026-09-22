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

/**
 * Pack the phone is allowed to finish. Hospitality stays stored;
 * runtime job is general until a reservation pack exists.
 * @param {unknown} raw
 * @returns {'retail'|'home_services'|'general'}
 */
function offeredVertical(raw) {
  const v = parseVertical(raw);
  if (v === 'retail' || v === 'home_services') return v;
  return 'general';
}

module.exports = { parseVertical, offeredVertical };
