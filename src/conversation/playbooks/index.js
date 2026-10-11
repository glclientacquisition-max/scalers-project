// Vertical playbook router — returns live prompt guidance for the active pack.

const { parseVertical } = require('../vertical');
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
  const vertical = parseVertical(profile.vertical);
  const handoffMode = parseHandoffMode(profile.handoffMode);
  const gates = evaluateCapabilityGates(profile);

  if (vertical === 'retail') {
    return formatRetailPlaybookForPrompt({
      handoffMode,
      placeHold: gates.holds.allowed,
    });
  }
  if (vertical === 'home_services') {
    return formatHomeServicesPlaybookForPrompt({
      handoffMode,
      confirmVisit: gates.site_visits.allowed,
      confirmedSlot: gates.booking_slots.allowed,
    });
  }

  // Hospitality and general have no completion pack yet.
  return '';
}

module.exports = {
  formatPlaybookForPrompt,
};
