// Structured, call-local Brain state.
// This is conversation memory, not tenant knowledge or long-term customer memory.

const {
  entityValue,
  isBackchannelOrFragment,
  isHearAgainSignal,
  applyCallerNameConfirmation,
} = require('./entityExtraction');
const { missingGoalSlots, formatGoalRequirementsForPrompt, formatVisitSopForPrompt, formatControlVoiceForPrompt } = require('./goalModel');
const { looksLikePhaticCallerTurn, looksLikePaceOnlyTurn } = require('./dynamicSpeech');
const { looksLikeFileRead, hasReadableFile, spokenFileRead } = require('./fileRead');
const {
  ackIsConsent,
  looksLikeLeaveIt,
  looksLikeNonConsentAck,
  looksLikeUrgentContact,
} = require('./callCorrectives');
const { mergeWorkResults } = require('./callResolution');
const { evaluateAppointmentHours } = require('./appointmentHours');
const { defaultHoursSchedule } = require('./businessHours');
const {
  isHomeVisitState,
  mergeTimeAnswer,
  timeAskCount,
  clockPhrase,
  dayCue,
  whenHasClockTime,
  whenNeedsClockTime,
  whenValue,
} = require('./visitTime');
const {
  applyLiveCallerFile,
  formatReturningFileForCallState,
  returningFileUsable,
  seedCallerFromMemory,
  speakerPendingOnFile,
  returningFileFromCard,
} = require('./callerMemory');
const {
  isMessageOnlyMode,
  messageFileOwnerName,
  messageNamePlausible,
  reconcileMessageOnlyName,
} = require('./messageOnly');
const {
  looksLikeExistingVisitTalk,
  looksLikePastBookingTalk,
} = require('./visitTalk');
const {
  looksLikeTrueHomeEmergency,
  looksLikeVisitClassCleaningUrgency,
} = require('./playbooks/homeServices');
const {
  coverageAskPlace,
  decideVisitPlace,
  foldCanonicalPlace,
  isLocationRefusal,
  preferVisitPlace,
} = require('./visitLocation');
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

function looksLikeHomeVisitAsk(value) {
  if (
    /\b(clean (my|the|our)|need (a |my )?(clean|carpet|couch|sofa|mattress|upholstery)|carpet clean|mattress clean|house clean|airbnb clean|sofa clean|couch clean)\b/.test(
      value
    )
  ) {
    return true;
  }
  if (
    /\b(carpet|couch|sofa|mattress|house|upholstery|airbnb)\s+clean(?:ing)?\b/.test(value) &&
    !/\b(how much|price|bei|gharama|cost|do you|mnatoa|mnafanya)\b/.test(value)
  ) {
    return true;
  }
  // Live pack #13: Nataka cleaning kesho. Job nouns may stay English.
  if (
    /\b(nataka|ninataka|naomba)\b/.test(value) &&
    /\b(clean|cleaning|carpet|couch|sofa|mattress|airbnb|upholstery|visit|ziara|huduma)\b/.test(
      value
    )
  ) {
    return true;
  }
  if (
    /\bkesho\b/.test(value) &&
    /\b(clean|cleaning|carpet|couch|sofa|mattress|airbnb|ziara)\b/.test(value)
  ) {
    return true;
  }
  return (
    /\b(come (over|by|tomorrow|today|kesho)|fix|repair|plumb|install)\b/.test(value) &&
    /\b(tomorrow|today|tonight|kesho|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s*(am|pm)|o'?clock|saa)\b/.test(
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
  if (vertical === 'home_services' && looksLikeVisitClassCleaningUrgency(value)) {
    return 'booking';
  }
  if (vertical === 'home_services' && looksLikeTrueHomeEmergency(value)) {
    return 'human';
  }
  // Human / complaint before other patterns so "talk to the manager" wins.
  if (looksLikeUrgentContact(value)) return 'human';
  if (
    /\b(human|person|owner|manager|boss|agent|speak to|talk to|kuongea na|let me speak|connect( me)?( to)?|forward( this call)?( to)?|transfer)\b/i.test(
      value
    )
  ) {
    return 'human';
  }
  if (looksLikeCancelOrReschedule(value)) return 'cancellation';
  // "Previous booking" / "which ones do I have" is a file read, not a new visit.
  if (looksLikeFileRead(value)) return 'general_enquiry';
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
  // "Location is Barnabas" is a slot fill, not a where-are-you ask.
  if (
    !/\b(location|landmark|address)\s+(is|ni|:)\b/.test(value) &&
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
  const state = {
    version: 2,
    vertical: String(profile.vertical || 'general'),
    caller: {
      name: caller.name || null,
      phone: caller.phone || null,
      nameConfirmed: Boolean(caller.nameConfirmed),
      nameCollision: Array.isArray(caller.nameCollision) ? caller.nameCollision : null,
      fileNameAsked: null,
      fileNameAskSpoken: false,
      messageNameAskSpoken: false,
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
      nonConsentAck: false,
      consentAck: false,
      leaveIt: false,
      pendingHour: null,
      timeWaived: false,
      locationDetailAsked: false,
      areaAsked: false,
      locationRefusals: 0,
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
      refusedHours: [],
      refusedPlaces: [],
    },
    messageOnly: isMessageOnlyMode(profile.afterHoursMode),
  };
  if (state.messageOnly) {
    const owner = messageFileOwnerName(profile, state.returning);
    if (owner && messageNamePlausible(owner)) {
      // The greeting may say this. It is not spoken until that audio
      // finishes, or until the caller-turn gate says it. A barge of the
      // greeting must still ask here, and must not reach the model.
      state.caller.fileNameAsked = owner;
      state.caller.fileNameAskSpoken = false;
    } else {
      state.caller.messageNameAskSpoken = true;
    }
  }
  return state;
}

function observeCallerTurn(state, input = {}) {
  let next = structuredClone(state || createBrainState(input.profile));
  if (input.profile && input.profile.afterHoursMode != null) {
    next.messageOnly = isMessageOnlyMode(input.profile.afterHoursMode);
  }
  const text = String(input.text || '').trim();
  if (!next.returning && input.profile?.callerMemory) {
    next.returning = returningFileFromCard(input.profile.callerMemory);
  }
  let inferredIntent = inferIntent(text, {
    vertical: next.vertical || input.profile?.vertical,
    returning: next.returning,
  });
  const vertical = String(next.vertical || input.profile?.vertical || '').toLowerCase();
  if (
    vertical === 'home_services' &&
    inferredIntent === 'human' &&
    looksLikeVisitClassCleaningUrgency(text) &&
    !looksLikeTrueHomeEmergency(text)
  ) {
    inferredIntent = 'booking';
  }
  const previousWasMeaningful = MEANINGFUL_INTENTS.has(next.intent);
  const fillingVisitPlace =
    next.intent === 'booking' &&
    inferredIntent === 'location' &&
    /\b(location|landmark|address)\s+(is|ni|:)\b/.test(text) &&
    Array.isArray(next.goal.missingSlots) &&
    (next.goal.missingSlots.includes('location') ||
      next.goal.missingSlots.includes('landmark'));
  const paceOnly = looksLikePaceOnlyTurn(text);
  const preserveActiveIntent =
    previousWasMeaningful &&
    next.intent !== 'unknown' &&
    (next.goal.status === 'active' || next.handoff?.requested) &&
    (fillingVisitPlace ||
      paceOnly ||
      (inferredIntent === 'general_enquiry' &&
        (next.goal.missingSlots.length > 0 ||
          next.handoff?.requested ||
          isBackchannelOrFragment(text) ||
          looksLikeNonConsentAck(text) ||
          looksLikeLeaveIt(text) ||
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
  // Okay after "Should I continue?" is a yes. Okay anywhere else is a filler.
  next.conversation.consentAck = ackIsConsent(next.conversation.questionsAsked, text);
  next.conversation.nonConsentAck =
    looksLikeNonConsentAck(text) && !next.conversation.consentAck;
  next.conversation.leaveIt = looksLikeLeaveIt(text);
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
  const previousWhen = entityValue(state?.entities?.when);
  const incomingWhen = entityValue(next.entities?.when);
  if (
    previousWhen &&
    incomingWhen &&
    incomingWhen !== previousWhen &&
    dayCue(previousWhen) &&
    !dayCue(incomingWhen) &&
    whenHasClockTime(incomingWhen)
  ) {
    next.entities.when = {
      ...(typeof next.entities.when === 'object' ? next.entities.when : {}),
      value: `${dayCue(previousWhen)} ${incomingWhen}`.trim(),
      source: 'caller_explicit',
      confidence: 0.9,
      confirmed: false,
    };
  }
  const { collectKnownCallerNames } = require('./callerNameMatch');
  const memoryCard = input.profile?.callerMemory || {};
  const fileOwnerName = next.returning?.sharedLine
    ? ''
    : String(
        memoryCard.fileOwnerName ||
          memoryCard.name ||
          next.returning?.fileOwnerName ||
          ''
      ).trim();
  const askedFileName = String(state?.caller?.fileNameAsked || '').trim();
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
      fileNameJustAsked: Boolean(askedFileName),
      pendingFileName:
        askedFileName ||
        input.profile?.callerMemory?.fileOwnerName ||
        input.profile?.callerMemory?.name ||
        next.returning?.fileOwnerName ||
        next.returning?.name ||
        null,
      fileOwnerName,
      lastAgentText: input.lastAgentText,
    }
  );
  next.entities = { ...next.entities, ...nameResolution.entities };
  next.caller.name = nameResolution.name || null;
  next.caller.nameConfirmed = Boolean(nameResolution.nameConfirmed);
  next.caller.nameCollision = nameResolution.nameCollision || null;
  if (next.messageOnly) {
    const reconciled = reconcileMessageOnlyName({
      previousCaller: state?.caller || {},
      text,
      resolution: nameResolution,
      profile: input.profile,
      returning: next.returning,
    });
    next.caller.name = reconciled.name;
    next.caller.nameConfirmed = reconciled.nameConfirmed;
    next.caller.fileNameAsked = reconciled.fileNameAsked;
    next.caller.fileNameAskSpoken = reconciled.fileNameAskSpoken;
    next.caller.messageNameAskSpoken = reconciled.messageNameAskSpoken;
    if (reconciled.entitiesName) next.entities.name = reconciled.entitiesName;
    else delete next.entities.name;
  } else if (!next.caller.name) {
    delete next.entities.name;
  }
  applyLiveCallerFile(input.profile, next);
  if (!next.messageOnly) {
    next.caller.fileNameAsked = ownedFileAsk(next.returning, next.caller);
  }
  if (!Boolean(state?.caller?.nameConfirmed) && next.caller.nameConfirmed) {
    const prior = (next.conversation.answersReceived || []).slice(0, -1);
    const askedRows = prior.some(
      (row) =>
        looksLikeFileRead(row) ||
        looksLikePastBookingTalk(row) ||
        /\bupcoming\b/i.test(String(row || ''))
    );
    if (askedRows) next.conversation.speakFileRead = true;
  }
  next.conversation.fileReadSentence =
    spokenFileRead({
      text,
      state: next,
      language: next.language?.current,
    }) || '';
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

  const homeVertical =
    String(input.profile?.vertical || next.vertical || '').toLowerCase() ===
    'home_services';
  const homeVisit = homeVertical && next.intent === 'booking';
  if (homeVertical) {
    const askedPlace = coverageAskPlace(text);
    if (askedPlace) {
      const foldedAsk = foldCanonicalPlace(askedPlace, input.profile) || askedPlace;
      next.entities.location = {
        value: foldedAsk,
        source: 'caller_explicit',
        confidence: 0.9,
        confirmed: false,
      };
    }
  }
  if (homeVisit && isLocationRefusal(text)) {
    next.conversation.locationRefusals =
      Number(next.conversation.locationRefusals || 0) + 1;
  }
  if (homeVertical) {
    const incoming =
      entityValue(next.entities?.location) || entityValue(next.entities?.landmark);
    const previous =
      entityValue(state?.entities?.location) || entityValue(state?.entities?.landmark);
    const lastAsk = (next.conversation.questionsAsked || []).slice(-1)[0];
    const place = foldCanonicalPlace(
      lastAsk === 'area' && previous && incoming && !/[\s,]/.test(incoming.trim())
        ? `${incoming.trim()}, ${previous}`
        : preferVisitPlace(previous, incoming, text),
      input.profile
    );
    const keptSpecific = Boolean(place && incoming && place !== incoming);
    if (keptSpecific) {
      next.entities.location = {
        value: place,
        source: 'caller_explicit',
        confidence: 0.9,
        confirmed: false,
      };
      if (state?.intent === 'booking') {
        next.intent = 'booking';
        next.goal.primary = 'make_booking_request';
      }
    }
    if (next.intent === 'booking' || keptSpecific) {
      next.visitPlace = decideVisitPlace(place, {
        profile: input.profile || {},
        detailAsked: Boolean(next.conversation.locationDetailAsked),
        areaAsked: Boolean(next.conversation.areaAsked),
        refusals: Number(next.conversation.locationRefusals || 0),
      });
    } else {
      next.visitPlace = null;
    }
    if (
      next.visitPlace?.blocked === 'outside' ||
      next.visitPlace?.blocked === 'refused'
    ) {
      rememberRefusedPlace(
        next,
        place || entityValue(next.entities?.location) || entityValue(next.entities?.landmark)
      );
    }
  } else {
    next.visitPlace = null;
  }
  next = applyVisitTimeAnswer(next, text, input.profile || {});
  const slotProfile = {
    ...(input.profile || {}),
    vertical: input.profile?.vertical || next.vertical,
  };
  next.goal.missingSlots = missingGoalSlots(next, slotProfile);
  next = applySpokenClockRefusal(next, input.profile || {}, input.now || new Date());
  next.goal.missingSlots = missingGoalSlots(next, slotProfile);
  return next;
}

/**
 * Time slot ladder for home visits. Ask 1: what time. Ask 2: morning or
 * afternoon. A bare hour waits for its half of the day. After two asks with
 * no time, waive to a callback note. Never loop the same ask.
 */
const BARE_NO = /^(?:no|nope|nah|hapana|siyo|sio)[.!]?$/i;
const PERIOD_WORD = /\b(morning|asubuhi|afternoon|mchana|evening|jioni)\b/i;

function applyVisitTimeAnswer(state, text, profile = {}) {
  const next = state;
  const asked = timeAskCount(next);
  const lastAsk = (next.conversation.questionsAsked || []).slice(-1)[0];
  const answeringTime = lastAsk === 'time' || next.conversation.pendingHour != null;
  const homeVisit = isHomeVisitState(next, profile);
  if (text && /\b(any ?time|anytime|whenever|wakati wowote|saa yoyote)\b/i.test(text) && !clockPhrase(text)) {
    const waivedWhen = whenValue(next);
    if (waivedWhen && dayCue(waivedWhen)) {
      next.conversation.timeWaived = true;
      next.conversation.pendingHour = null;
    }
  }
  if (!homeVisit || !text) return next;
  const when = whenValue(next);
  if (when && clockPhrase(when) && BARE_NO.test(text)) {
    const clock = clockPhrase(when);
    const refused = (next.actions?.refusedHours || []).some(
      (item) => clockPhrase(item) === clock
    );
    if (refused) {
      const day = dayCue(when);
      if (day) {
        next.entities.when = {
          value: day,
          source: 'caller_explicit',
          confidence: 0.9,
          confirmed: false,
        };
      }
      return next;
    }
  }
  // A period replaces a stored clock. "tomorrow morning" is not "tomorrow 7:00 AM".
  if (when && clockPhrase(when) && PERIOD_WORD.test(text) && !clockPhrase(text)) {
    const period = PERIOD_WORD.exec(text)[1].toLowerCase();
    const day = dayCue(when) || dayCue(text) || '';
    next.conversation.pendingHour = null;
    next.entities.when = {
      value: `${day} ${period}`.trim(),
      source: 'caller_explicit',
      confidence: 0.9,
      confirmed: true,
    };
    return next;
  }
  if (answeringTime && when && !whenHasClockTime(when)) {
    const merged = mergeTimeAnswer({
      when,
      pendingHour: next.conversation.pendingHour ?? null,
      text,
    });
    if (merged.changed) {
      next.conversation.pendingHour = merged.pendingHour;
      if (merged.when !== when) {
        next.entities.when = {
          value: merged.when,
          source: 'caller_explicit',
          confidence: 0.9,
          confirmed: true,
        };
      }
      return next;
    }
  }
  const noPreference = TIME_NO_PREFERENCE.test(text);
  if (
    answeringTime &&
    (asked >= 2 || (asked >= 1 && noPreference)) &&
    whenNeedsClockTime(next, profile)
  ) {
    next.conversation.timeWaived = true;
    next.conversation.pendingHour = null;
  }
  return next;
}

const TIME_NO_PREFERENCE =
  /\b(any ?time|anytime|whenever|any (?:is|time is) fine|don'?t (?:know|mind|care)|not sure|wakati wowote|saa yoyote|sijui|yoyote)\b/i;

/**
 * Refuse an outside-hours clock on the turn it is said, before a tool runs.
 * A complete visit still waits for the tool result. Coverage speech wins.
 * A period is not a clock.
 */
function applySpokenClockRefusal(state, profile = {}, now = new Date()) {
  const next = state;
  if (!next.conversation) next.conversation = {};
  next.conversation.clockRefusedThisTurn = false;
  next.conversation.hoursBlock = null;
  if (!isHomeVisitState(next, profile)) return next;
  const when = whenValue(next);
  if (!when || !clockPhrase(when)) return next;
  const blocked = String(next.visitPlace?.blocked || '');
  const coverageBlocks =
    blocked === 'outside' || blocked === 'unknown_coverage' || blocked === 'refused';
  const missing = Array.isArray(next.goal?.missingSlots) ? next.goal.missingSlots : [];
  const toolWillRun =
    !coverageBlocks &&
    missing.length === 0 &&
    !next.conversation.timeWaived &&
    String(next.intent || '') === 'booking';
  if (toolWillRun) return next;
  const hours = evaluateAppointmentHours({
    whenText: when,
    schedule: profile.hoursSchedule || defaultHoursSchedule(),
    now,
  });
  if (hours.code !== 'outside_hours') return next;
  if (!next.actions) next.actions = {};
  if (!Array.isArray(next.actions.refusedHours)) next.actions.refusedHours = [];
  if (!next.actions.refusedHours.includes(when)) next.actions.refusedHours.push(when);
  const day = dayCue(when);
  if (day) {
    next.entities.when = {
      value: day,
      source: 'caller_explicit',
      confidence: 0.9,
      confirmed: false,
    };
  } else if (next.entities && next.entities.when) {
    delete next.entities.when;
  }
  if (!coverageBlocks) {
    next.conversation.clockRefusedThisTurn = true;
    next.conversation.hoursBlock = {
      code: 'outside_hours',
      beforeOpen: Boolean(hours.beforeOpen),
      openLabel: hours.openLabel || '',
      closeLabel: hours.closeLabel || '',
      weekdayLong: hours.weekdayLong || '',
    };
  }
  return next;
}

function rememberRefusedPlace(state, place) {
  const text = String(place || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  if (!state.actions) state.actions = {};
  if (!Array.isArray(state.actions.refusedPlaces)) state.actions.refusedPlaces = [];
  const known = state.actions.refusedPlaces.some(
    (row) => String(row).toLowerCase() === text.toLowerCase()
  );
  if (!known) state.actions.refusedPlaces.push(text);
}

function setNextBestAction(state, decision = {}) {
  const next = structuredClone(state || createBrainState());
  next.resolution.nextBestAction = String(decision.action || 'DISCOVER');
  next.resolution.reason = String(decision.reason || '');
  if (decision.slot) {
    next.resolution.targetSlot = String(decision.slot);
    next.conversation.questionsAsked.push(String(decision.slot));
    next.conversation.questionsAsked = next.conversation.questionsAsked.slice(-8);
    const askedPlace = String(decision.slot).toLowerCase();
    if (
      (askedPlace === 'location' || askedPlace === 'landmark') &&
      (entityValue(next.entities?.location) || entityValue(next.entities?.landmark))
    ) {
      next.conversation.locationDetailAsked = true;
    }
    if (askedPlace === 'area') next.conversation.areaAsked = true;
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
            call_id: result.record.call_id || null,
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
  if (!Array.isArray(next.actions.refusedHours)) next.actions.refusedHours = [];
  if (!Array.isArray(next.actions.refusedPlaces)) next.actions.refusedPlaces = [];
  for (const result of safeResults) {
    if (result?.status === 'invalid' && result?.code === 'outside_coverage') {
      rememberRefusedPlace(
        next,
        result.value?.landmark ||
          result.value?.address_landmark ||
          result.value?.location
      );
    }
    if (result?.status === 'invalid' && result?.code === 'outside_hours') {
      const whenText = String(
        result.value?.whenText || result.value?.when_text || result.hours?.whenText || ''
      ).trim();
      if (whenText && !next.actions.refusedHours.includes(whenText)) {
        next.actions.refusedHours.push(whenText);
      }
      const current = whenValue(next);
      const refusedClock = clockPhrase(whenText);
      if (current && refusedClock && clockPhrase(current) === refusedClock) {
        const day = dayCue(current);
        if (day) {
          next.entities.when = {
            value: day,
            source: 'caller_explicit',
            confidence: 0.9,
            confirmed: false,
          };
        }
      }
    }
  }
  if (next.actions.refusedHours.length) {
    next.goal.missingSlots = missingGoalSlots(next, { vertical: next.vertical });
  }
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

function ownedFileAsk(returning, caller) {
  if (!returning || caller?.nameConfirmed === true) return null;
  if (returning.identityBound || returning.sharedLine) return null;
  const who = String(returning.fileOwnerName || returning.name || '').trim();
  return who || null;
}

function formatNameConfirmForPrompt(state) {
  if (state?.messageOnly) {
    const locked = String(state?.caller?.name || '').trim();
    if (state?.caller?.nameConfirmed && locked) {
      return `- Caller name: ${locked} (confirmed). Use this spelling. Do not ask for the name again. The callback uses this name. Do not read a visit.`;
    }
    const pending = String(state?.caller?.fileNameAsked || '').trim();
    if (state?.caller?.fileNameAskSpoken && pending) {
      return `- File name already asked: ${pending}. Use ${pending}. Do not ask for a name. Do not say May I have your name. A yes or "my name is ${pending}" locks it. Do not read open visits, holds, or callbacks. Do not say nothing is open.`;
    }
    if (locked) {
      return `- Caller name is known (${locked}). Do not ask for the name again. Do not confirm a compliment. Take the message. Do not read a visit.`;
    }
    return '- Name was already asked once. Do not ask again. Save a name only after they say a plausible one. A compliment is not a name. Do not read a visit.';
  }
  const name = String(state?.caller?.name || '').trim();
  const pair = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision.filter(Boolean)
    : [];
  if (pair.length >= 2) {
    const heard = name || pair[0];
    return `- Name collision: heard ${heard}. Ask once: ${pair.join(' or ')}? Do not guess. Do not append save_caller_info until they pick one or spell it.`;
  }
  if (!name) {
    const pending = String(state?.caller?.fileNameAsked || '').trim();
    if (pending) {
      if (state?.caller?.fileNameAskSpoken === true) {
        return `- File name already asked: ${pending}. Use ${pending}. Do not ask for a name. Do not say May I have your name. Continue the next missing slot (day, time, place). A yes or "my name is ${pending}" locks it. Do not read open visits, holds, or callbacks unless they ask. Do not say nothing is open.`;
      }
      return `- Ask once, in these words: Am I speaking with ${pending}? Do not greet them as that name. Do not talk about visits yet. Do not say nothing is open. A yes means ${pending}.`;
    }
    const missing = Array.isArray(state?.goal?.missingSlots) ? state.goal.missingSlots : [];
    if (missing.includes('name')) {
      return '- Caller name: not on file. Ask once for their name. Do not ask again after they give one.';
    }
    return '';
  }
  if (state?.caller?.nameConfirmed) {
    return `- Caller name: ${name} (confirmed). Use this spelling. Do not ask for the name again. Do not ask if the name is right. You may append save_caller_info with this confirmed name.`;
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

function pendingFileAskHidesEmptyDenial(state) {
  const pending = String(state?.caller?.fileNameAsked || '').trim();
  if (!pending || state?.caller?.nameConfirmed === true) return false;
  const latest = String((state?.conversation?.answersReceived || []).slice(-1)[0] || '');
  return !looksLikeFileRead(latest);
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
    formatReturningFileForCallState(
      value.messageOnly
        ? {
            ...(value.returning || {}),
            openVisits: [],
            nextVisit: null,
            recentBookings: [],
          }
        : value.returning,
      {
        fileNameAskSpoken: value.caller?.fileNameAskSpoken === true,
        messageOnly: value.messageOnly === true,
      }
    ),
    value.conversation?.nonConsentAck
      ? '- Acknowledgment only (Then, Okay, Sawa, or leave it). Not a quantity, a time, or a yes. Do not invent a count. Do not say a visit or order is saved.'
      : '',
    value.conversation?.consentAck
      ? '- The caller answered your confirm ask with Okay. That is a yes. Proceed with the tool. Do not ask again.'
      : '',
    value.conversation?.timeWaived
      ? '- No visit time after two asks. Do not ask again. Save a callback note with the day via create_service_request. The team confirms the time. Do not say booked.'
      : '',
    value.conversation?.phatic
      ? value.messageOnly
        ? value.caller?.fileNameAskSpoken
          ? `- Phatic turn: one short well, then take a message. File name ${value.caller.fileNameAsked} already asked. Do not ask for a name. Do not read a visit. Do not say nothing is open.`
          : '- Phatic turn: one short well, then take a message. The name was already asked. Do not ask again. Do not read a visit. Do not invent a time.'
        : value.caller?.fileNameAsked
        ? value.caller?.fileNameAskSpoken === true
          ? `- Phatic turn: one short well, then offer help. File name ${value.caller.fileNameAsked} already asked. Do not ask for a name. Do not talk about visits yet. Do not say nothing is open.`
          : `- Phatic turn: one short well, then ask once: Am I speaking with ${value.caller.fileNameAsked}? Do not talk about visits yet. Do not say nothing is open.`
        : speakerPendingOnFile(value.returning)
        ? '- Phatic turn: one short well, then offer help. Do not ask who is speaking. Do not use the file name. Do not list services.'
        : value.returning?.nextVisit && returningFileUsable(value.returning)
          ? '- Phatic turn: one short well, then the open visit. Do not list services or start a new book.'
          : '- Phatic turn: they only greeted or asked how you are. One short well, then offer help. Do not ask who is speaking. Do not list services, prices, or jobs.'
      : '',
    (value.messageOnly && String(value.caller?.fileNameAsked || '').trim()) ||
    hasReadableFile(value) ||
    pendingFileAskHidesEmptyDenial(value)
      ? ''
      : '- FILE: nothing is saved for this speaker. Do not talk as if a booking, order, or hold exists. If they ask again, or sound confused, repeat that nothing is saved. Do not offer to reschedule or cancel.',
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
  looksLikeHomeEmergency: looksLikeTrueHomeEmergency,
  looksLikeBookingIntent,
  looksLikeCancelOrReschedule,
  looksLikePastBookingTalk,
  observeCallerTurn,
  setNextBestAction,
  recordRepairFailure,
  recordActionResults,
  formatNameConfirmForPrompt,
  formatBrainStateForPrompt,
  ownedFileAsk,
};
