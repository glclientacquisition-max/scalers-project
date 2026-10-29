// Vertical playbook router — returns live prompt guidance for the active pack.

const { resolveBusinessType, isHomeVisitBusinessType } = require('../businessType');
const { parseHandoffMode } = require('../handoffMode');
const { evaluateCapabilityGates } = require('../capabilityGates');
const { formatRetailPlaybookForPrompt } = require('./retail');
const {
  formatHomeServicesPlaybookForPrompt,
} = require('./homeServices');

/**
 * @param {object} [profile]
 * @returns {string} playbook block or empty string
 */
function formatPlaybookForPrompt(profile = {}) {
  const type = resolveBusinessType({
    business_type: profile.businessType,
    vertical: profile.vertical,
  });
  const handoffMode = parseHandoffMode(profile.handoffMode);
  const gates = evaluateCapabilityGates(profile);

  if (type === 'retail') {
    return formatRetailPlaybookForPrompt({
      handoffMode,
      placeHold: gates.holds.allowed,
    });
  }
  if (type === 'home_services' || type === 'general') {
    return formatHomeServicesPlaybookForPrompt({
      handoffMode,
      confirmVisit: isHomeVisitBusinessType(type) && gates.site_visits.allowed,
      confirmedSlot: gates.booking_slots.allowed,
    });
  }

  return '';
}

module.exports = {
  formatPlaybookForPrompt,
};
