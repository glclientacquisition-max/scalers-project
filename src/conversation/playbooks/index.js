// Vertical playbook router — returns live prompt guidance for the active pack.

const { parseVertical } = require('../vertical');
const { parseHandoffMode } = require('../handoffMode');
const {
  holdOrdersEnabled,
  confirmedSlotEnabled,
  factServices,
} = require('../provenance');
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

  if (vertical === 'retail') {
    return formatRetailPlaybookForPrompt({
      handoffMode,
      placeHold: holdOrdersEnabled(profile),
    });
  }
  if (vertical === 'home_services') {
    return formatHomeServicesPlaybookForPrompt({
      handoffMode,
      confirmVisit: factServices(profile.servicesCatalog, profile.fieldMeta || null).length > 0,
      confirmedSlot: confirmedSlotEnabled(profile),
    });
  }

  // Hospitality and general have no completion pack yet.
  return '';
}

module.exports = {
  formatPlaybookForPrompt,
};
