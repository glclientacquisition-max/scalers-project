// Structured, call-local Brain state.
// This is conversation memory, not tenant knowledge or long-term customer memory.

const {
  entityValue,
  isBackchannelOrFragment,
  isHearAgainSignal,
  applyCallerNameConfirmation,
} = require('./entityExtraction');
const { missingGoalSlots, formatGoalRequirementsForPrompt, formatVisitSopForPrompt, formatControlVoiceForPrompt } = require('./goalModel');
const { looksLikePhaticCallerTurn } = require('./dynamicSpeech');
const { mergeWorkResults } = require('./callResolution');
const {
  applyLiveCallerFile,
  formatReturningFileForCallState,
  returningFileUsable,
  seedCallerFromMemory,
  speakerPendingOnFile,
  returningFileFromCard,
} = require('./callerMemory');
const {
  looksLikeExistingVisitTalk,
  looksLikePastBookingTalk,
} = require('./visitTalk');
const {
  isRepairSignal,
  applyRepairObservation,
  markRepairProgress,
  formatRepairForPrompt,
} = require('./conversationRepair');

const MEANINGFUL_INTENTS = new Set([
  'hours',
  'location',
  'price',
  'availability',
  'policy',
  'hold',
  'order',
  'booking',
  'cancellation',
  'human',
  'complaint',
  'product_inquiry',
]);

const GOAL_BY_INTENT = Object.freeze({
  hours: 'learn_business_hours',
  location: 'find_business_location',
  price: 'learn_price',
  availability: 'check_availability',
  policy: 'learn_business_policy',
  hold: 'reserve_for_pickup',
  order: 'place_order_or_request',
  booking: 'make_booking_request',
  cancellation: 'cancel_or_change_request',
  human: 'speak_to_human',
  complaint: 'resolve_problem',
  product_inquiry: 'find_product',
  general_enquiry: 'resolve_enquiry',
});

function looksLikeHomeEmergency(value) {
  if (
    /\b(burst(\s+pipe)?|flood(ing)?|gas leak|electric shock|live wire|on fire|water everywhere|hatari)\b/.test(
      value
    )
  ) {
    return true;
  }
  return (
    /\bemergency\b/.test(value) &&
    /\b(pipe|flood|leak|shock|wire|fire|gas|power)\b/.test(value)
  );
}

function looksLikeHomeVisitAsk(value) {
  if (
    /\b(clean (my|the|our)|need (a |my )?(clean|carpet|couch|sofa|mattress|upholstery)|carpet clean|mattress clean|house clean|airbnb clean|sofa clean|couch clean)\b/.test(
      value
    )
  ) {
    return true;
  }
  return (
    /\b(come (over|by|tomorrow|today)|fix|repair|plumb|install)\b/.test(value) &&
    /\b(tomorrow|today|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s*(am|pm)|o'?clock|saa)\b/.test(
      value
    )
  );
}

function looksLikeBookingIntent(value, vertical = '') {
  if (
    /\b(booking|appointment|reservation|schedule|miadi|book me)\b/.test(value)
  ) {
    return true;
  }
  if (
    /\b(want to book|need to book|please book|can you book|could you book|i'd like to book|i would like to book)\b/.test(
      value
    )
  ) {
    return true;
  }
  if (/\bbook (a |an |the )?(visit|appointment|slot|time|call)\b/.test(value)) {
    return true;
  }
  if (String(vertical || '').toLowerCase() === 'home_services' && looksLikeHomeVisitAsk(value)) {
    return true;
  }
  // Verb "book" plus a time window. Do not steal bookstore "which book / the book".
  return (
    /\bbook\b/.test(value) &&
    /\b(tomorrow|today|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s*(am|pm)|o'?clock|saa)\b/.test(
      value
    ) &&
    !/\b(which book|what book|this book|that book|the book|books)\b/.test(value)
  );
}

function looksLikeCancelOrReschedule(value) {
  return /\b(cancel|cancelled|cancellation|reschedule|change my|move my|move (the |that |my )?(visit|appointment|booking|ziara)|change (the )?(time|date|appointment|visit)|badilisha|ahirisha|sitaki hiyo|futa (appointment|booking|ziara))\b/i.test(
    value
  );
}

function inferIntent(text, opts = {}) {
  const value = String(text || '').trim().toLowerCase();
  const vertical = String(opts.vertical || '').toLowerCase();
  if (!value) return 'unknown';
  // Human / complaint before other patterns so "talk to the manager" wins.
  if (
    /\b(human|person|owner|manager|boss|agent|speak to|talk to|kuongea na|let me speak|connect( me)?( to)?|forward( this call)?( to)?|transfer)\b/i.test(
      value
    )
  ) {
    return 'human';
  }
  if (looksLikeHomeEmergency(value)) {
    return 'human';
  }
  if (looksLikeCancelOrReschedule(value)) return 'cancellation';
  if (opts.returning?.nextVisit && looksLikeExistingVisitTalk(value)) {
    return 'general_enquiry';
  }
  if (
    Array.isArray(opts.returning?.recentBookings) &&
    opts.returning.recentBookings.length &&
    (looksLikePastBookingTalk(value) || looksLikeExistingVisitTalk(value))
  ) {
    return 'general_enquiry';
  }
  // Appointment-style booking: check BEFORE location so "book carpet cleaning... landmark is Barnabas"
  // is classified as booking rather than being hijacked by "landmark" into location.
  if (looksLikeBookingIntent(value, vertical)) {
    return 'booking';
  }
  // Hours: opening/closing phrasing (avoid treating "book" noun as booking).
  if (
    /\b(open|closed|opening|closing|hours|working\s*hours|mnafungua|mnafunga|mpaka saa|what time.*(open|close)|when.*(open|close))\b/.test(
      value
    )
  ) {
    return 'hours';
  }
  // "Landmark is Barnabas" is a slot fill, not a where-are-you ask.
  if (
    !/\b(landmark|address)\s+(is|ni|:)\b/.test(value) &&
    /\b(where|location|directions?|address|landmark|mko wapi|uko wapi)\b/.test(value)
  ) {
    return 'location';
  }
  if (/\b(how much|price|cost|bei|gharama|pesa gani)\b/.test(value)) return 'price';
  if (/\b(in stock|available|availability|do you have|stock|bado iko)\b/.test(value)) {
    return 'availability';
  }
  if (/\b(return|refund|exchange|warranty|policy|payment|deposit|delivery|shipping)\b/.test(value)) {
    return 'policy';
  }
  if (/\b(hold|reserve|pickup|pick up|weka|nitapita|nitakuja)\b/.test(value)) {
    return 'hold';
  }
  if (/\b(order|buy|purchase|nataka kununua|ninaorder)\b/.test(value)) {
    return 'order';
  }
  if (
    /\b(recommend|suggestion|which book|what book|do you sell|mnauza|children'?s? books?|genre|philosophy)\b/.test(
      value
    )
  ) {
    return 'product_inquiry';
  }
  if (/\b(complain|complaint|angry|upset|problem|wrong|bad service|not happy)\b/.test(value)) {
    return 'complaint';
  }
  return 'general_enquiry';
}

function languageConfidence(detected) {
  if (detected === 'en' || detected === 'sw' || detected === 'sheng') return 0.8;
  if (detected === 'mixed') return 0.6;
  return 0;
}

function createBrainState(profile = {}) {
  const caller = seedCallerFromMemory(
    {
      name: null,
      phone: null,
      nameConfirmed: false,
    },
    profile.callerMemory
  );
  return {
    version: 2,
    vertical: String(profile.vertical || 'general'),
    caller: {
      name: caller.name || null,
      phone: caller.phone || null,
      nameConfirmed: Boolean(caller.nameConfirmed),
      nameCollision: Array.isArray(caller.nameCollision) ? caller.nameCollision : null,
    },
    returning: returningFileFromCard(profile.callerMemory),
    language: {
      current: 'unknown',
      detected: 'unknown',
      confidence: 0,
      pending: null,
      pendingCount: 0,
      switchCount: 0,
    },
    goal: {
      primary: null,
      description: null,
      status: 'unknown',
      missingSlots: [],
    },
    intent: 'unknown',
    entities: {},
    confirmedFacts: [],
    unknowns: [],
    conversation: {
      stage: 'greeting',
      turnCount: 0,
      questionsAsked: [],
      answersReceived: [],
      hearAgain: false,
      phatic: false,
    },
    emotion: {
      state: 'neutral',
      intensity: 'low',
      confidence: 0,
    },
    resolution: {
      status: 'unresolved',
      nextBestAction: 'DISCOVER',
      reason: 'Awaiting the caller goal.',
    },
    handoff: {
      requested: false,
      required: false,
      reason: null,
    },
    repair: {
      failureCount: 0,
      strategy: 'none',
      lastTrigger: null,
      lastAgentText: null,
    },
    actions: {
      completedFingerprints: [],
      lastResults: [],
      savedWork: [],
      openHolds: [],
    },
  };
}

function observeCallerTurn(state, input = {}) {
  let next = structuredClone(state || createBrainState(input.profile));
  const text = String(input.text || '').trim();
  if (!next.returning && input.profile?.callerMemory) {
    next.returning = returningFileFromCard(input.profile.callerMemory);
  }
  const inferredIntent = inferIntent(text, {
    vertical: next.vertical || input.profile?.vertical,
    returning: next.returning,
  });
  const previousWasMeaningful = MEANINGFUL_INTENTS.has(next.intent);
  const fillingBookingLandmark =
    next.intent === 'booking' &&
    inferredIntent === 'location' &&
    Array.isArray(next.goal.missingSlots) &&
    next.goal.missingSlots.includes('landmark');
  const preserveActiveIntent =
    previousWasMeaningful &&
    next.intent !== 'unknown' &&
    (next.goal.status === 'active' || next.handoff?.requested) &&
    (fillingBookingLandmark ||
      (inferredIntent === 'general_enquiry' &&
        (next.goal.missingSlots.length > 0 ||
          next.handoff?.requested ||
          isBackchannelOrFragment(text) ||
          text.split(/\s+/).length <= 3)));
  const intent = String(
    input.intent || (preserveActiveIntent ? next.intent : inferredIntent)
  );
  const previousIntent = next.intent;
  const previousEntityKeys = new Set(Object.keys(next.entities || {}));

  next.conversation.turnCount += 1;
  next.conversation.stage = next.goal.status === 'unknown' ? 'discovery' : 'understanding';
  next.conversation.hearAgain = isHearAgainSignal(text);
  next.conversation.phatic = looksLikePhaticCallerTurn(text);
  if (text) next.conversation.answersReceived.push(text);
  next.conversation.answersReceived = next.conversation.answersReceived.slice(-8);

  if (input.languageState && typeof input.languageState === 'object') {
    next.language = {
      ...next.language,
      ...input.languageState,
    };
  } else {
    const previousLanguage = next.language.current;
    const currentLanguage = String(
      input.resolvedLanguage || previousLanguage || 'unknown'
    );
    const detectedLanguage = String(input.detectedLanguage || 'unknown');
    next.language.detected = detectedLanguage;
    next.language.confidence = languageConfidence(detectedLanguage);
    if (
      previousLanguage !== 'unknown' &&
      currentLanguage !== 'unknown' &&
      previousLanguage !== currentLanguage
    ) {
      next.language.switchCount += 1;
    }
    next.language.current = currentLanguage;
  }

  next.intent = intent;
  next.goal.primary = GOAL_BY_INTENT[intent] || 'resolve_enquiry';
  const usableGoalText =
    text && !isBackchannelOrFragment(text) && !looksLikePhaticCallerTurn(text)
      ? text
      : '';
  if (
    usableGoalText &&
    (!next.goal.description ||
      next.goal.status === 'unknown' ||
      (previousIntent !== 'unknown' &&
        previousIntent !== intent &&
        !isBackchannelOrFragment(next.goal.description || '')))
  ) {
    next.goal.description = usableGoalText;
  }
  next.goal.status = 'active';
  next.handoff.requested = intent === 'human';

  if (input.entities && typeof input.entities === 'object') {
    next.entities = { ...next.entities, ...input.entities };
  }
  const { collectKnownCallerNames } = require('./callerNameMatch');
  const nameResolution = applyCallerNameConfirmation(
    {
      caller: state?.caller || next.caller,
      entities: state?.entities || {},
    },
    text,
    next.entities,
    {
      knownNames: collectKnownCallerNames({
        profile: input.profile,
        state: state || next,
      }),
    }
  );
  next.entities = { ...next.entities, ...nameResolution.entities };
  next.caller.name = nameResolution.name || null;
  next.caller.nameConfirmed = Boolean(nameResolution.nameConfirmed);
  next.caller.nameCollision = nameResolution.nameCollision || null;
  applyLiveCallerFile(input.profile, next);
  if (next.caller.name && !entityValue(next.entities.name)) {
    next.entities.name = {
      value: next.caller.name,
      source: 'caller_state',
      confidence: 0.9,
      confirmed: next.caller.nameConfirmed,
    };
  }
  if (entityValue(next.entities.phone)) next.caller.phone = entityValue(next.entities.phone);

  if (
    next.intent === 'cancellation' &&
    next.returning?.nextVisit &&
    !entityValue(next.entities.reference)
  ) {
    next.entities.reference = {
      value: next.returning.nextVisit,
      source: 'caller_memory',
      confidence: 0.9,
      confirmed: true,
    };
  }

  const addedEntity = Object.keys(next.entities).some(
    (key) => !previousEntityKeys.has(key)
  );
  if (isRepairSignal(text)) {
    next = applyRepairObservation(next, {
      text,
      lastAgentText: input.lastAgentText,
    });
  } else if (addedEntity && next.repair.failureCount > 0) {
    next = markRepairProgress(next);
  }

  next.goal.missingSlots = missingGoalSlots(next, {
    ...(input.profile || {}),
    vertical: input.profile?.vertical || next.vertical,
  });
  return next;
}

function setNextBestAction(state, decision = {}) {
  const next = structuredClone(state || createBrainState());
  next.resolution.nextBestAction = String(decision.action || 'DISCOVER');
  next.resolution.reason = String(decision.reason || '');
  if (decision.slot) {
    next.resolution.targetSlot = String(decision.slot);
    next.conversation.questionsAsked.push(String(decision.slot));
    next.conversation.questionsAsked = next.conversation.questionsAsked.slice(-8);
  } else {
    next.resolution.targetSlot = null;
  }
  if (decision.action === 'END') {
    next.resolution.status = 'resolved';
    next.goal.status = 'completed';
    next.conversation.stage = 'closing';
  } else if (decision.action === 'ESCALATE' || decision.action === 'TRANSFER') {
    next.handoff.required = true;
    next.handoff.reason = String(decision.reason || 'Human requested or required.');
    next.conversation.stage = 'action';
  } else if (decision.action === 'ANSWER') {
    next.conversation.stage = 'resolution';
  } else if (decision.action === 'ASK_CLARIFICATION') {
    next.conversation.stage = 'discovery';
  } else if (decision.action === 'APOLOGIZE_AND_REPAIR') {
    next.conversation.stage = 'repair';
  } else if (decision.action === 'CREATE_REQUEST' || decision.action === 'CAPTURE') {
    next.conversation.stage = 'action';
  }
  return next;
}

function recordRepairFailure(state) {
  const next = structuredClone(state || createBrainState());
  next.repair.failureCount += 1;
  return next;
}

function recordActionResults(state, results = []) {
  const next = structuredClone(state || createBrainState());
  const safeResults = Array.isArray(results) ? results : [];
  next.actions.lastResults = safeResults.map((result) => ({
    action: String(result.action || ''),
    status: String(result.status || ''),
    ...(result.requestType
      ? { requestType: String(result.requestType) }
      : {}),
    ...(result.appointmentStatus
      ? { appointmentStatus: String(result.appointmentStatus) }
      : {}),
    ...(result.requestStatus
      ? { requestStatus: String(result.requestStatus) }
      : {}),
    ...(result.record && typeof result.record === 'object'
      ? {
          record: {
            status: result.record.status || null,
            service_name: result.record.service_name || null,
          },
        }
      : {}),
    ...(result.value && typeof result.value === 'object'
      ? {
          value: {
            type: result.value.type || null,
            item: result.value.item || null,
            whenText: result.value.whenText || result.value.when_text || null,
            notes: result.value.notes || null,
            name: result.value.name || null,
            serviceName:
              result.value.serviceName ||
              result.value.service_name ||
              result.value.service ||
              null,
          },
        }
      : {}),
    ...(result.soft ? { soft: true } : {}),
  }));
  if (!Array.isArray(next.actions.savedWork)) next.actions.savedWork = [];
  next.actions.savedWork = mergeWorkResults(
    next.actions.savedWork,
    next.actions.lastResults
  );
  if (!Array.isArray(next.actions.openHolds)) next.actions.openHolds = [];
  for (const result of safeResults) {
    if (
      (result.status === 'succeeded' || result.status === 'updated') &&
      result.fingerprint
    ) {
      if (!next.actions.completedFingerprints.includes(result.fingerprint)) {
        next.actions.completedFingerprints.push(result.fingerprint);
      }
    }
    if (
      result.action === 'create_service_request' &&
      (result.status === 'succeeded' || result.status === 'updated') &&
      result.identity
    ) {
      const holdRow = {
        identity: String(result.identity),
        id: result.id || null,
        fingerprint: result.fingerprint || null,
        whenText: result.value?.whenText || result.value?.when_text || null,
        item: result.value?.item || null,
        name: result.value?.name || null,
      };
      const idx = next.actions.openHolds.findIndex(
        (row) => row.identity === holdRow.identity
      );
      if (idx >= 0) next.actions.openHolds[idx] = holdRow;
      else next.actions.openHolds.push(holdRow);
      next.actions.openHolds = next.actions.openHolds.slice(-10);
    }
    if (result.action === 'save_caller_info' && result.status === 'succeeded') {
      if (result.name) next.caller.name = String(result.name);
      next.caller.nameConfirmed = true;
    }
    if (
      (result.action === 'create_service_request' ||
        result.action === 'create_appointment' ||
        result.action === 'update_appointment' ||
        result.action === 'escalate') &&
      (result.status === 'succeeded' || result.status === 'updated')
    ) {
      next.resolution.status = 'resolved';
      next.goal.status = 'completed';
      next.conversation.stage = 'confirmation';
    }
  }
  next.actions.completedFingerprints = next.actions.completedFingerprints.slice(-20);
  return next;
}

function formatNameConfirmForPrompt(state) {
  const name = String(state?.caller?.name || '').trim();
  const pair = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision.filter(Boolean)
    : [];
  if (pair.length >= 2) {
    const heard = name || pair[0];
    return `- Name collision: heard ${heard}. Ask once: ${pair.join(' or ')}? Do not guess. Do not append save_caller_info until they pick one or spell it.`;
  }
  if (!name) return '';
  if (state?.caller?.nameConfirmed) {
    return `- Caller name: ${name} (confirmed). Speak this spelling once in the next line. Do not ask for the name again. Do not ask if the name is right. You may append save_caller_info with this confirmed name.`;
  }
  return `- Caller name is known (${name}). Do not ask for the name again. Do not ask "is that right?". Continue the next missing slot. Do not append save_caller_info until they confirm, correct, or continue.`;
}

function formatHearAgainForPrompt(state) {
  if (!state?.conversation?.hearAgain) return '';
  const pair = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision.filter(Boolean)
    : [];
  if (pair.length >= 2) {
    return `- Hear-again: they missed the last line. Ask once: ${pair.join(' or ')}? Do not guess. Do not save, book, or call a tool.`;
  }
  const missing = Array.isArray(state?.goal?.missingSlots)
    ? state.goal.missingSlots
    : [];
  const name = String(state?.caller?.name || '').trim();
  const nextSlot = missing.find((slot) => slot !== 'name' || !name) || missing[0];
  if (name && nextSlot && nextSlot !== 'name') {
    return `- Hear-again: they missed the last line. Ask only for ${nextSlot} more clearly. Do not re-ask the name. Do not save, book, or call a tool.`;
  }
  return '- Hear-again: caller did not hear the last line. Repeat that question more clearly. Do not save, book, or call a tool.';
}

function formatBrainStateForPrompt(state) {
  const value = state || createBrainState();
  const entities = Object.entries(value.entities || {})
    .filter(([, rawEntity]) => Boolean(entityValue(rawEntity)))
    .map(([key, rawEntity]) => {
      const value = entityValue(rawEntity);
      const confirmed =
        rawEntity && typeof rawEntity === 'object'
          ? rawEntity.confirmed
            ? 'confirmed'
            : 'unconfirmed'
          : 'legacy';
      return `${key}=${value} (${confirmed})`;
    })
    .join(', ');
  return [
    'CALL STATE (structured; update your understanding from the caller, do not read aloud):',
    `- Stage: ${value.conversation.stage}`,
    `- Intent: ${value.intent}`,
    `- Caller goal: ${value.goal.primary || 'unknown'} — ${value.goal.description || 'not established'}`,
    `- Goal status: ${value.goal.status}`,
    `- ${formatGoalRequirementsForPrompt(value)}`,
    formatVisitSopForPrompt(value),
    formatControlVoiceForPrompt(value),
    `- Entities: ${entities || '(none confirmed)'}`,
    `- Language: ${value.language.current} (detected ${value.language.detected}, confidence ${value.language.confidence})`,
    `- Repair failures: ${value.repair.failureCount}`,
    `- ${formatRepairForPrompt(value)}`,
    formatNameConfirmForPrompt(value),
    formatHearAgainForPrompt(value),
    formatReturningFileForCallState(value.returning),
    value.conversation?.phatic
      ? speakerPendingOnFile(value.returning)
        ? '- Phatic turn: one short well, then who is calling. Do not list services.'
        : value.returning?.nextVisit && returningFileUsable(value.returning)
          ? '- Phatic turn: one short well, then the open visit. Do not list services or start a new book.'
          : '- Phatic turn: they only greeted or asked how you are. One short well, then How can I help. Do not list services, prices, or jobs.'
      : '',
    `- Handoff requested: ${value.handoff.requested ? 'yes' : 'no'}`,
    `- Resolution: ${value.resolution.status}`,
    `- NEXT BEST ACTION: ${value.resolution.nextBestAction} — ${value.resolution.reason}`,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  GOAL_BY_INTENT,
  createBrainState,
  inferIntent,
  looksLikeHomeEmergency,
  looksLikeBookingIntent,
  looksLikeCancelOrReschedule,
  looksLikePastBookingTalk,
  observeCallerTurn,
  setNextBestAction,
  recordRepairFailure,
  recordActionResults,
  formatNameConfirmForPrompt,
  formatBrainStateForPrompt,
};
