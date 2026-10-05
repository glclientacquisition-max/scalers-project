// Goal requirements and slot completeness for universal receptionist jobs.

const { normalizeLocations } = require('./businessLocations');
const { entityValue } = require('./entityExtraction');
const { returningFileUsable } = require('./callerMemory');
const { decideVisitPlace } = require('./visitLocation');
const {
  hasConcreteUrgentNeed,
  looksLikeUrgentContact,
} = require('./callCorrectives');
const { whenNeedsClockTime } = require('./visitTime');

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

function wantsNewWhenForChange(state) {
  const text = String(state?.goal?.description || '').toLowerCase();
  if (/\b(cancel|cancelled|sitaki|futa)\b/i.test(text)) return false;
  return /\b(reschedule|move|change |badilisha|ahirisha)\b/i.test(text);
}

function hasAnyEntity(entities, keys) {
  return keys.some((key) => Boolean(entityValue(entities?.[key])));
}

/** File name the code already asked aloud; keep using it for slots. */
function spokenFileName(state) {
  if (state?.caller?.nameConfirmed === true) return '';
  if (state?.caller?.fileNameAskSpoken !== true) return '';
  return String(state?.caller?.fileNameAsked || '').trim();
}

function slotFilled(state, requirement) {
  if (requirement.slot === 'name') {
    if (String(state?.caller?.name || '').trim()) return true;
    // After the file-name ask was spoken, do not treat the file as nameless.
    // Message only uses the same ask, so a later callback does not ask again.
    if (spokenFileName(state)) return true;
  }
  return hasAnyEntity(state?.entities || {}, requirement.anyOf);
}

function missingGoalSlots(state, profile = {}) {
  const intent = String(state?.intent || 'unknown');
  const requirements = [...(GOAL_REQUIREMENTS[intent] || [])];
  // A product order needs a count before it is saved. Never guess one.
  if (intent === 'order' && entityValue(state?.entities?.product)) {
    requirements.splice(2, 0, { slot: 'quantity', anyOf: ['quantity'] });
  }
  if (intent === 'location') {
    const locations = normalizeLocations(profile.businessLocations);
    if (locations.length > 1) {
      requirements.push({ slot: 'branch', anyOf: ['branch'] });
    }
  }
  const vertical = String(profile.vertical || state?.vertical || '').toLowerCase();
  const homeVisit = intent === 'booking' && vertical === 'home_services';
  const visitDecision = homeVisit ? homeVisitDecision(state, profile) : null;
  if (intent === 'cancellation' && wantsNewWhenForChange(state)) {
    return ['when'].filter((slot) => !slotFilled(state, { slot, anyOf: ['when'] }));
  }
  const missing = requirements
    .filter((requirement) => !slotFilled(state, requirement))
    .map((requirement) => requirement.slot);
  if (visitDecision?.ask) {
    const slot = visitDecision.askArea ? 'area' : 'location';
    if (!missing.includes(slot)) missing.push(slot);
  }
  if (intent === 'human' && urgentContactNeedsReason(state) && !missing.includes('reason')) {
    missing.push('reason');
  }
  if (
    homeVisit &&
    !missing.includes('when') &&
    whenNeedsClockTime(state, { ...profile, vertical: vertical || profile.vertical })
  ) {
    missing.push('time');
  }
  return missing;
}

/**
 * "Contact me urgently" needs a name and a need before notify. The name turn
 * ("Dennis.") is not the need. Any concrete turn from the urgent ask onward is.
 */
function urgentContactNeedsReason(state) {
  const desc = String(state?.goal?.description || '');
  const turns = Array.isArray(state?.conversation?.answersReceived)
    ? state.conversation.answersReceived
    : [];
  const urgentAt = turns.findIndex((turn) => looksLikeUrgentContact(turn));
  if (urgentAt < 0 && !looksLikeUrgentContact(desc)) return false;
  if (entityValue(state?.entities?.reason)) return false;
  const name = String(state?.caller?.name || '').trim().toLowerCase();
  const candidates = [desc, ...turns.slice(Math.max(0, urgentAt))];
  return !candidates.some((turn) => {
    const clean = String(turn || '').trim().toLowerCase().replace(/[.!?]+$/, '');
    if (!clean || clean === name) return false;
    return hasConcreteUrgentNeed(turn);
  });
}

function homeVisitDecision(state, profile = {}) {
  if (state?.visitPlace) return state.visitPlace;
  const place =
    entityValue(state?.entities?.location) || entityValue(state?.entities?.landmark);
  return decideVisitPlace(place, {
    profile,
    detailAsked: Boolean(state?.conversation?.locationDetailAsked),
    areaAsked: Boolean(state?.conversation?.areaAsked),
    refusals: Number(state?.conversation?.locationRefusals || 0),
  });
}

function visitSopSlotValue(state, slot) {
  if (slot === 'name') {
    return (
      String(state?.caller?.name || '').trim() ||
      entityValue(state?.entities?.name) ||
      spokenFileName(state) ||
      ''
    );
  }
  if (slot === 'service') {
    return (
      entityValue(state?.entities?.service) ||
      entityValue(state?.entities?.product) ||
      entityValue(state?.entities?.requestedItem)
    );
  }
  if (slot === 'location') {
    return (
      entityValue(state?.entities?.location) || entityValue(state?.entities?.landmark)
    );
  }
  return entityValue(state?.entities?.[slot]);
}

function formatVisitSopForPrompt(state) {
  if (state?.messageOnly) return '';
  const vertical = String(state?.vertical || '').toLowerCase();
  if (vertical !== 'home_services' || String(state?.intent || '') !== 'booking') {
    return '';
  }
  const order = ['service', 'name', 'when', 'location'];
  const decision = state.visitPlace || null;
  const parts = order.map((slot) => {
    const value = visitSopSlotValue(state, slot);
    if (slot === 'location' && decision?.quality === 'area_only' && value) {
      return `location=${value} (area only)`;
    }
    if (slot === 'location' && decision?.ask && !value) return 'location=missing';
    return value ? `${slot}=${value}` : `${slot}=missing`;
  });
  const pair = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision.filter(Boolean)
    : [];
  if (pair.length >= 2 && state?.caller?.nameConfirmed !== true) {
    return `- Visit SOP: ${parts.join(' | ')}. Ask once: ${pair.join(' or ')}? Do not guess the spelling.`;
  }
  const job = visitSopSlotValue(state, 'service');
  let nextLine = '';
  if (decision?.blocked === 'outside') {
    nextLine =
      'Outside POLICIES/LOCATIONS. Do not create_appointment. Decline or offer a callback note. Never say landmark.';
  } else if (decision?.blocked === 'unknown_coverage') {
    nextLine =
      'Coverage is not on file. Do not invent it. Do not create_appointment. Offer to note it for the owner. Never say landmark.';
  } else if (decision?.blocked === 'refused') {
    nextLine =
      'They refused a location twice. Escalate or log an enquiry. Do not create_appointment. Never say landmark.';
  } else if (decision?.confirmAccess) {
    nextLine =
      'Area is in coverage. Append create_appointment and note confirm access. Speak nothing. Never say landmark.';
  } else {
    const next = order.find((slot) => {
      if (slot === 'location') return !decision?.bookable;
      return !visitSopSlotValue(state, slot);
    });
    if (next === 'location' && decision?.askArea) {
      nextLine =
        'You have a landmark but not the area. Ask once which area or estate it is in. Do not refuse. Never say landmark.';
    } else if (next === 'location' && decision?.quality === 'area_only') {
      nextLine =
        'You have the area. Ask once which building, gate, or junction. Never say landmark.';
    } else if (next === 'name') {
      const pending = String(state?.caller?.fileNameAsked || '').trim();
      const spoken = spokenFileName(state);
      if (spoken) {
        nextLine = job
          ? `Name ${job} in one clause, then ask only for the next missing slot. Use ${spoken}. Do not ask for a name. Never say landmark.`
          : `Use ${spoken}. Do not ask for a name. Ask only for the next missing slot. Never say landmark.`;
      } else {
        nextLine = pending
          ? `Ask once: Am I speaking with ${pending}? Do not ask for a different name. Do not talk about visits yet. Never say landmark.`
          : 'No name is on file. Ask once for their name. Do not ask again after they give one. Never say landmark.';
      }
    } else if (next) {
      nextLine = job
        ? `Name ${job} in one clause, then ask only for ${next}. Never re-ask a filled slot. Never say landmark.`
        : `Ask only for ${next}. Never re-ask a filled slot. Never say landmark.`;
    } else {
      nextLine =
        'Slots complete. Append create_appointment and speak nothing. Never say landmark.';
    }
  }
  return `- Visit SOP: ${parts.join(' | ')}. ${nextLine}`;
}

function clarificationForSlot(slot) {
  const hints = {
    subject: 'Name the product or service you heard, then ask which exact one they mean.',
    service: 'Name the job if you have it, then ask which service they want.',
    name: 'Ask for the caller name only if none is on file. If a name is already known, skip this slot.',
    reason: 'Ask what they need in one short question. Do not recite the service list.',
    when: 'Name the job you have, then ask for the day and time.',
    when_or_reference: 'Name the open visit if you have it, then ask for the new time or the visit to cancel.',
    branch: 'Ask which branch or location they mean.',
    time: 'You have the day. Ask only what time that day, or morning or afternoon. Do not invent a time. Do not call the tool yet.',
    location:
      'Name the job and time you have, then ask where we should come: "Where should we come?" If you already have an area, ask once which building, gate, or junction. Never say landmark.',
    landmark:
      'Name the job and time you have, then ask where we should come: "Where should we come?" If you already have an area, ask once which building, gate, or junction. Never say landmark.',
    area:
      'You have the place but cannot tell which area it is in. Ask once: "Which area is that in?" Do not refuse. Do not call the tool yet. Never say landmark.',
  };
  return hints[slot] || `Ask for ${slot}.`;
}

function formatControlVoiceForPrompt(state) {
  if (state?.messageOnly) {
    return '- Control: answer services, price, hours, and where the business is. Do not collect a booking.';
  }
  const job =
    visitSopSlotValue(state, 'service') ||
    entityValue(state?.entities?.product) ||
    entityValue(state?.entities?.requestedItem) ||
    (state?.returning && returningFileUsable(state.returning)
      ? state.returning.nextVisit || state.returning.lastReason
      : '');
  const missing = Array.isArray(state?.goal?.missingSlots)
    ? state.goal.missingSlots
    : [];
  const next = missing[0];
  if (job && next) {
    return `- Control: you have ${job}. Say that, then ask only for ${next}. No holding lines.`;
  }
  if (job && !next) {
    return `- Control: you have ${job}. Speak nothing if a tool will fire. Backend confirms.`;
  }
  return '- Control: name what you understood, then one next step. No holding lines.';
}

function formatGoalRequirementsForPrompt(state) {
  if (state?.messageOnly) {
    const pending = String(state?.caller?.fileNameAsked || '').trim();
    const locked = state?.caller?.nameConfirmed ? String(state?.caller?.name || '').trim() : '';
    const nameLine = locked
      ? `The name is ${locked}. Do not ask for it again.`
      : pending && state?.caller?.fileNameAskSpoken
        ? `File name already asked: ${pending}. Use ${pending}. Do not ask for a name. Do not say May I have your name.`
        : 'The name was already asked once. Do not ask again. A compliment is not a name.';
    return `Message only. Answer services, prices, hours, and where the business is from the file. Do not ask which service to book, a day, a time, or a place. If they want a visit, say you will take a message and the team will call them. ${nameLine} Do not read a visit.`;
  }
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
  spokenFileName,
  GOAL_REQUIREMENTS,
  hasAnyEntity,
  missingGoalSlots,
  clarificationForSlot,
  formatGoalRequirementsForPrompt,
  formatVisitSopForPrompt,
  formatControlVoiceForPrompt,
};
