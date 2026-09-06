// Vertical playbook router — returns live prompt guidance for the active pack.

const { parseVertical } = require('../vertical');
const { parseHandoffMode } = require('../handoffMode');
const { formatRetailPlaybookForPrompt, classifyRetailIntent } = require('./retail');
const {
  formatHomeServicesPlaybookForPrompt,
  classifyHomeIntent,
} = require('./homeServices');

const HOME_TO_BRAIN = Object.freeze({
  hours_open: 'hours',
  directions: 'location',
  service_inquiry: 'product_inquiry',
  price_band: 'price',
  service_area: 'location',
  book_visit: 'booking',
  reschedule: 'cancellation',
  cancel: 'cancellation',
  emergency: 'human',
  human: 'human',
});

const RETAIL_TO_BRAIN = Object.freeze({
  hours_open: 'hours',
  directions: 'location',
  product_inquiry: 'product_inquiry',
  price: 'price',
  availability: 'availability',
  hold_or_pickup: 'hold',
  order_enquiry: 'order',
  policy: 'policy',
  human: 'human',
});

/**
 * Map a live utterance through the active vertical playbook onto Brain intent ids.
 * Returns null when the pack has no match so the generic classifier can run.
 */
function inferVerticalBrainIntent(utterance, verticalRaw) {
  const text = String(utterance || '').trim();
  if (!text) return null;
  const vertical = parseVertical(verticalRaw);
  if (vertical === 'home_services') {
    const home = classifyHomeIntent(text);
    return HOME_TO_BRAIN[home] || null;
  }
  if (vertical === 'retail') {
    const retail = classifyRetailIntent(text);
    return RETAIL_TO_BRAIN[retail] || null;
  }
  return null;
}

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
  if (vertical === 'home_services') {
    return formatHomeServicesPlaybookForPrompt({ handoffMode });
  }

  // Hospitality pack lands later; general uses core rules only.
  return '';
}

module.exports = {
  formatPlaybookForPrompt,
  inferVerticalBrainIntent,
  HOME_TO_BRAIN,
  RETAIL_TO_BRAIN,
};
