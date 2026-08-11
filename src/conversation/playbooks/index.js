// Vertical playbook router — returns live prompt guidance for the active pack.

const { parseVertical } = require('../vertical');
const { parseHandoffMode } = require('../handoffMode');
const { formatRetailPlaybookForPrompt } = require('./retail');

/**
 * @param {object} [profile]
 * @returns {string} playbook block or empty string
 */
function formatPlaybookForPrompt(profile = {}) {
  const vertical = parseVertical(profile.vertical);
  const handoffMode = parseHandoffMode(profile.handoffMode);

  if (vertical === 'retail') {
    return formatRetailPlaybookForPrompt({ handoffMode });
  }

  // Home services / hospitality packs land later; general uses core rules only.
  return '';
}

module.exports = {
  formatPlaybookForPrompt,
};
