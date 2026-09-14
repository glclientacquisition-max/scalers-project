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
  cancellation: [{ slot: 'when_or_reference', anyOf: ['when', 'reference'] }],
  human: [{ slot: 'name', anyOf: ['name'] }],
});

function hasAnyEntity(entities, keys) {
  return keys.some((key) => Boolean(entityValue(entities?.[key])));
}

function slotFilled(state, requirement) {
  if (requirement.slot === 'name' && String(state?.caller?.name || '').trim()) {
    return true;
  }
  return hasAnyEntity(state?.entities || {}, requirement.anyOf);
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
  const vertical = String(profile.vertical || state?.vertical || '').toLowerCase();
  if (intent === 'booking' && vertical === 'home_services') {
    requirements.push({ slot: 'landmark', anyOf: ['landmark'] });
  }
  return requirements
    .filter((requirement) => !slotFilled(state, requirement))
    .map((requirement) => requirement.slot);
}

function visitSopSlotValue(state, slot) {
  if (slot === 'name') {
    return String(state?.caller?.name || '').trim() || entityValue(state?.entities?.name);
  }
  if (slot === 'service') {
    return (
      entityValue(state?.entities?.service) ||
      entityValue(state?.entities?.product) ||
      entityValue(state?.entities?.requestedItem)
    );
  }
  return entityValue(state?.entities?.[slot]);
}

function formatVisitSopForPrompt(state) {
  const vertical = String(state?.vertical || '').toLowerCase();
  if (vertical !== 'home_services' || String(state?.intent || '') !== 'booking') {
    return '';
  }
  const order = ['service', 'name', 'when', 'landmark'];
  const parts = order.map((slot) => {
    const value = visitSopSlotValue(state, slot);
    return value ? `${slot}=${value}` : `${slot}=missing`;
  });
  const pair = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision.filter(Boolean)
    : [];
  if (pair.length >= 2 && state?.caller?.nameConfirmed !== true) {
    return `- Visit SOP: ${parts.join(' | ')}. Ask once: ${pair.join(' or ')}? Do not guess the spelling.`;
  }
  const next = order.find((slot) => !visitSopSlotValue(state, slot));
  const nextLine = next
    ? `Ask only for ${next}. Never re-ask a filled slot.`
    : 'Slots complete. Append create_appointment and speak nothing.';
  return `- Visit SOP: ${parts.join(' | ')}. ${nextLine}`;
}

function clarificationForSlot(slot) {
  const hints = {
    subject: 'Ask which exact product or service they mean.',
    service: 'Ask which service they want.',
    name: 'Ask for the caller name only if none is on file. If a name is already known, skip this slot.',
    when: 'Ask for the preferred date or time.',
    when_or_reference: 'Ask for the booking time or reference that identifies it.',
    branch: 'Ask which branch or location they mean.',
    landmark: 'Ask for a nearby landmark or address so the visit can be found.',
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
    'Do not re-ask a slot that CALL STATE already has.',
  ].join(' ');
}

module.exports = {
  GOAL_REQUIREMENTS,
  hasAnyEntity,
  missingGoalSlots,
  clarificationForSlot,
  formatGoalRequirementsForPrompt,
  formatVisitSopForPrompt,
};
