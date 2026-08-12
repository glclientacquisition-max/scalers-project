// Goal requirements and slot completeness for universal receptionist jobs.

const { normalizeLocations } = require('./businessLocations');
const { entityValue } = require('./entityExtraction');

const GOAL_REQUIREMENTS = Object.freeze({
  price: [{ slot: 'subject', anyOf: ['product', 'service', 'requestedItem'] }],
  availability: [{ slot: 'subject', anyOf: ['product', 'service', 'requestedItem'] }],
  hold: [
    { slot: 'subject', anyOf: ['product', 'service', 'requestedItem'] },
    { slot: 'name', anyOf: ['name'] },
    { slot: 'when', anyOf: ['when'] },
  ],
  order: [
    { slot: 'subject', anyOf: ['product', 'service', 'requestedItem'] },
    { slot: 'name', anyOf: ['name'] },
  ],
  booking: [
    { slot: 'service', anyOf: ['service', 'product', 'requestedItem'] },
    { slot: 'name', anyOf: ['name'] },
    { slot: 'when', anyOf: ['when'] },
  ],
  cancellation: [
    { slot: 'name', anyOf: ['name'] },
    { slot: 'when_or_reference', anyOf: ['when', 'reference'] },
  ],
  human: [{ slot: 'name', anyOf: ['name'] }],
});

function hasAnyEntity(entities, keys) {
  return keys.some((key) => Boolean(entityValue(entities?.[key])));
}

function missingGoalSlots(state, profile = {}) {
  const intent = String(state?.intent || 'unknown');
  const requirements = [...(GOAL_REQUIREMENTS[intent] || [])];
  if (intent === 'location') {
    const locations = normalizeLocations(profile.businessLocations);
    if (locations.length > 1) {
      requirements.push({ slot: 'branch', anyOf: ['branch'] });
    }
  }
  return requirements
    .filter((requirement) => !hasAnyEntity(state?.entities || {}, requirement.anyOf))
    .map((requirement) => requirement.slot);
}

function clarificationForSlot(slot) {
  const hints = {
    subject: 'Ask which exact product or service they mean.',
    service: 'Ask which service they want.',
    name: 'Ask for the caller name; confirm once if unclear.',
    when: 'Ask for the preferred date or time.',
    when_or_reference: 'Ask for the booking time or reference that identifies it.',
    branch: 'Ask which branch or location they mean.',
  };
  return hints[slot] || `Ask for ${slot}.`;
}

function formatGoalRequirementsForPrompt(state) {
  const missing = Array.isArray(state?.goal?.missingSlots)
    ? state.goal.missingSlots
    : [];
  if (!missing.length) {
    return 'Required goal slots: complete. Do not ask for information that is not needed.';
  }
  return [
    `Missing required goal slots: ${missing.join(', ')}.`,
    `Ask only for the first missing slot now: ${clarificationForSlot(missing[0])}`,
  ].join(' ');
}

module.exports = {
  GOAL_REQUIREMENTS,
  hasAnyEntity,
  missingGoalSlots,
  clarificationForSlot,
  formatGoalRequirementsForPrompt,
};
