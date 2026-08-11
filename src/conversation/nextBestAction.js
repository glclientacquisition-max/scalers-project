// Deterministic resolution ladder.
// The LLM interprets language; this module decides the safest useful action class.

const { ACTIONS, authorizeAction } = require('./brainPolicy');

const DIRECT_ANSWER_INTENTS = new Set([
  'hours',
  'location',
  'price',
  'availability',
  'policy',
]);

const REQUEST_INTENTS = new Set(['order', 'booking', 'cancellation']);

function determineNextBestAction({ state, capabilities = {} } = {}) {
  const intent = String(state?.intent || 'unknown');
  const repairCount = Number(state?.repair?.failureCount || 0);

  if (state?.resolution?.status === 'resolved' || state?.goal?.status === 'completed') {
    return {
      action: ACTIONS.END,
      reason: 'The caller goal is complete; close naturally without adding another task.',
    };
  }

  if (repairCount >= 3) {
    const escalation = authorizeAction(ACTIONS.ESCALATE, capabilities);
    return escalation.allowed
      ? {
          action: ACTIONS.ESCALATE,
          reason: 'Three repair attempts failed; offer a human handoff.',
        }
      : {
          action: ACTIONS.CAPTURE,
          reason: 'Three repair attempts failed and escalation is unavailable; offer to save a concise message.',
        };
  }

  if (intent === 'unknown') {
    return {
      action: ACTIONS.ASK_CLARIFICATION,
      reason: 'The caller goal is not established; ask one useful question.',
    };
  }

  if (intent === 'human' || state?.handoff?.requested) {
    const transfer = authorizeAction(ACTIONS.TRANSFER, capabilities);
    if (transfer.allowed) {
      return { action: ACTIONS.TRANSFER, reason: 'The caller explicitly requested a human.' };
    }
    const escalation = authorizeAction(ACTIONS.ESCALATE, capabilities);
    if (escalation.allowed) {
      return {
        action: ACTIONS.ESCALATE,
        reason: 'The caller explicitly requested a human; live transfer is unavailable.',
      };
    }
    return {
      action: ACTIONS.CAPTURE,
      reason: 'The caller requested a human, but transfer and escalation are unavailable.',
    };
  }

  if (DIRECT_ANSWER_INTENTS.has(intent)) {
    return {
      action: ACTIONS.ANSWER,
      reason: 'Attempt direct resolution from relevant live ground truth before any capture or handoff.',
    };
  }

  if (REQUEST_INTENTS.has(intent)) {
    const request = authorizeAction(ACTIONS.CREATE_REQUEST, capabilities);
    return request.allowed
      ? {
          action: ACTIONS.CREATE_REQUEST,
          reason: 'Collect only required details, confirm them, then request the authorized action.',
        }
      : {
          action: ACTIONS.CAPTURE,
          reason: 'The requested business action is unavailable; offer a message without promising completion.',
        };
  }

  if (intent === 'complaint') {
    return {
      action: ACTIONS.ANSWER,
      reason: 'Acknowledge briefly and attempt resolution before escalating.',
    };
  }

  return {
    action: ACTIONS.ANSWER,
    reason: 'Resolve from knowledge; clarify once only if a specific fact is missing.',
  };
}

module.exports = {
  DIRECT_ANSWER_INTENTS,
  REQUEST_INTENTS,
  determineNextBestAction,
};
