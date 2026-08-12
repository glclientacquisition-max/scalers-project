// Structured, call-local Brain state.
// This is conversation memory, not tenant knowledge or long-term customer memory.

const GOAL_BY_INTENT = Object.freeze({
  hours: 'learn_business_hours',
  location: 'find_business_location',
  price: 'learn_price',
  availability: 'check_availability',
  policy: 'learn_business_policy',
  order: 'place_order_or_request',
  booking: 'make_booking_request',
  cancellation: 'cancel_or_change_request',
  human: 'speak_to_human',
  complaint: 'resolve_problem',
  general_enquiry: 'resolve_enquiry',
});

function inferIntent(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (/\b(open|closed|hours|mnafungua|mnafunga|mpaka saa)\b/.test(value)) {
    return 'hours';
  }
  if (/\b(where|location|directions?|address|landmark|mko wapi|uko wapi)\b/.test(value)) {
    return 'location';
  }
  if (/\b(how much|price|cost|bei|gharama)\b/.test(value)) return 'price';
  if (/\b(in stock|available|availability|do you have|stock|bado iko)\b/.test(value)) {
    return 'availability';
  }
  if (/\b(return|refund|exchange|warranty|policy|payment|deposit|delivery)\b/.test(value)) {
    return 'policy';
  }
  if (/\b(order|buy|purchase|hold|reserve|pickup|pick up|nataka kununua)\b/.test(value)) {
    return 'order';
  }
  if (/\b(book|booking|appointment|reservation|schedule|miadi)\b/.test(value)) {
    return 'booking';
  }
  if (/\b(cancel|reschedule|change my|move my)\b/.test(value)) return 'cancellation';
  if (/\b(human|person|owner|manager|boss|agent|speak to|talk to|kuongea na)\b/.test(value)) {
    return 'human';
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
  return {
    version: 1,
    vertical: String(profile.vertical || 'general'),
    caller: {
      name: null,
      phone: null,
    },
    language: {
      current: 'unknown',
      detected: 'unknown',
      confidence: 0,
      switchCount: 0,
    },
    goal: {
      primary: null,
      description: null,
      status: 'unknown',
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
    },
    actions: {
      completedFingerprints: [],
      lastResults: [],
    },
  };
}

function observeCallerTurn(state, input = {}) {
  const next = structuredClone(state || createBrainState());
  const text = String(input.text || '').trim();
  const intent = String(input.intent || inferIntent(text));
  const previousLanguage = next.language.current;
  const currentLanguage = String(input.resolvedLanguage || previousLanguage || 'unknown');
  const detectedLanguage = String(input.detectedLanguage || 'unknown');

  next.conversation.turnCount += 1;
  next.conversation.stage = next.goal.status === 'unknown' ? 'discovery' : 'understanding';
  if (text) next.conversation.answersReceived.push(text);
  next.conversation.answersReceived = next.conversation.answersReceived.slice(-8);

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

  next.intent = intent;
  next.goal.primary = GOAL_BY_INTENT[intent] || 'resolve_enquiry';
  next.goal.description = text || next.goal.description;
  next.goal.status = 'active';
  next.handoff.requested = intent === 'human';

  if (input.entities && typeof input.entities === 'object') {
    next.entities = { ...next.entities, ...input.entities };
  }
  return next;
}

function setNextBestAction(state, decision = {}) {
  const next = structuredClone(state || createBrainState());
  next.resolution.nextBestAction = String(decision.action || 'DISCOVER');
  next.resolution.reason = String(decision.reason || '');
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
  }));
  for (const result of safeResults) {
    if (result.status === 'succeeded' && result.fingerprint) {
      if (!next.actions.completedFingerprints.includes(result.fingerprint)) {
        next.actions.completedFingerprints.push(result.fingerprint);
      }
    }
    if (result.action === 'save_caller_info' && result.status === 'succeeded') {
      if (result.name) next.caller.name = String(result.name);
    }
    if (
      (result.action === 'create_service_request' || result.action === 'escalate') &&
      result.status === 'succeeded'
    ) {
      next.resolution.status = 'resolved';
      next.goal.status = 'completed';
      next.conversation.stage = 'confirmation';
    }
  }
  next.actions.completedFingerprints = next.actions.completedFingerprints.slice(-20);
  return next;
}

function formatBrainStateForPrompt(state) {
  const value = state || createBrainState();
  const entities = Object.entries(value.entities || {})
    .filter(([, entityValue]) => entityValue != null && String(entityValue).trim())
    .map(([key, entityValue]) => `${key}=${String(entityValue).trim()}`)
    .join(', ');
  return [
    'CALL STATE (structured; update your understanding from the caller, do not read aloud):',
    `- Stage: ${value.conversation.stage}`,
    `- Intent: ${value.intent}`,
    `- Caller goal: ${value.goal.primary || 'unknown'} — ${value.goal.description || 'not established'}`,
    `- Goal status: ${value.goal.status}`,
    `- Entities: ${entities || '(none confirmed)'}`,
    `- Language: ${value.language.current} (detected ${value.language.detected}, confidence ${value.language.confidence})`,
    `- Repair failures: ${value.repair.failureCount}`,
    `- Handoff requested: ${value.handoff.requested ? 'yes' : 'no'}`,
    `- Resolution: ${value.resolution.status}`,
    `- NEXT BEST ACTION: ${value.resolution.nextBestAction} — ${value.resolution.reason}`,
  ].join('\n');
}

module.exports = {
  GOAL_BY_INTENT,
  createBrainState,
  inferIntent,
  observeCallerTurn,
  setNextBestAction,
  recordRepairFailure,
  recordActionResults,
  formatBrainStateForPrompt,
};
