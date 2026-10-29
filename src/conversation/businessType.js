// Canonical business type for Voice (mirror of dashboard/src/lib/businessType.ts).

/** @typedef {'retail'|'home_services'|'general'} BusinessType */

/** @param {unknown} raw @returns {BusinessType|null} */
function parseBusinessType(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'retail' || v === 'shop' || v === 'shops') return 'retail';
  if (v === 'home_services' || v === 'homeservices' || v === 'home_service') {
    return 'home_services';
  }
  if (v === 'general' || v === 'other') return 'general';
  return null;
}

/** @param {unknown} vertical @returns {BusinessType} */
function verticalToBusinessType(vertical) {
  const v = String(vertical ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'retail' || v === 'shop' || v === 'shops') return 'retail';
  if (v === 'home_services' || v === 'homeservices' || v === 'home_service') {
    return 'home_services';
  }
  return 'general';
}

/**
 * @param {{ business_type?: unknown, vertical?: unknown }} input
 * @returns {BusinessType}
 */
function resolveBusinessType(input = {}) {
  const direct = parseBusinessType(input.business_type);
  if (direct) return direct;
  return verticalToBusinessType(input.vertical);
}

/** @param {BusinessType} type */
function verticalForBusinessType(type) {
  return type;
}

/** @param {BusinessType} type */
function isRetailBusinessType(type) {
  return type === 'retail';
}

/** @param {BusinessType} type */
function isHomeVisitBusinessType(type) {
  return type === 'home_services';
}

/** @param {BusinessType} type */
function usesServicesCallFlow(type) {
  return type === 'home_services' || type === 'general';
}

module.exports = {
  parseBusinessType,
  verticalToBusinessType,
  resolveBusinessType,
  verticalForBusinessType,
  isRetailBusinessType,
  isHomeVisitBusinessType,
  usesServicesCallFlow,
};
