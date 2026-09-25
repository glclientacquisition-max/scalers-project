// Deterministic resolution ladder.
// The LLM interprets language; this module decides the safest useful action class.

const { ACTIONS, authorizeAction } = require('./brainPolicy');
const { returningFileUsable, speakerPendingOnFile } = require('./callerMemory');
const {
  looksLikeExistingVisitTalk,
  looksLikePastBookingTalk,
} = require('./visitTalk');

const DIRECT_ANSWER_INTENTS = new Set([
  'hours',
  'location',
  'price',
  'availability',
  'policy',
]);

const REQUEST_INTENTS = new Set(['hold', 'order', 'booking', 'cancellation']);

function determineNextBestAction({ state, capabilities = {} } = {}) {
  const intent = String(state?.intent || 'unknown');
  const repairCount = Number(state?.repair?.failureCount || 0);
  const missingSlots = Array.isArray(state?.goal?.missingSlots)
    ? state.goal.missingSlots
    : [];

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

  if (repairCount > 0) {
    return {
      action: ACTIONS.REPAIR,
      reason:
        repairCount === 1
          ? 'Use a contextual clarification based on what was already understood.'
          : 'Simplify the question or explanation; do not repeat the same wording.',
    };
  }

  const nameCollision = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision.filter(Boolean)
    : [];
  if (nameCollision.length >= 2 && state?.caller?.nameConfirmed !== true) {
    return {
      action: ACTIONS.ASK_CLARIFICATION,
      slot: 'name_spelling',
      reason: `Heard a collision name; ask once: ${nameCollision.join(' or ')}?`,
    };
  }

  if (intent === 'unknown' || intent === 'general_enquiry') {
    const returning = state?.returning;
    if (speakerPendingOnFile(returning) && state?.caller?.nameConfirmed !== true) {
      return {
        action: ACTIONS.ASK_CLARIFICATION,
        slot: 'name',
        reason: returning.sharedLine
          ? 'Shared line. Ask who is speaking. Do not use the file name.'
          : 'Phone file is a candidate. Ask who is speaking before using the file name or visit.',
      };
    }
    const said = String(state?.goal?.description || '');
    const latest = String(
      (state?.conversation?.answersReceived || []).slice(-1)[0] || ''
    );
    const followUp =
      intent === 'unknown' ||
      Boolean(state?.conversation?.phatic) ||
      looksLikeExistingVisitTalk(said) ||
      looksLikeExistingVisitTalk(latest);
    if (followUp && returning?.nextVisit && returningFileUsable(returning)) {
      return {
        action: ACTIONS.ANSWER,
        reason:
          'Unique returning line with an open visit. Speak to that visit. Do not start a new book or re-ask the name. If they want it moved, collect only the new when.',
      };
    }
    const pastTalk =
      looksLikePastBookingTalk(said) ||
      looksLikePastBookingTalk(latest) ||
      looksLikeExistingVisitTalk(said) ||
      looksLikeExistingVisitTalk(latest);
    if (
      pastTalk &&
      Array.isArray(returning?.recentBookings) &&
      returning.recentBookings.length &&
      returningFileUsable(returning)
    ) {
      return {
        action: ACTIONS.ANSWER,
        reason:
          'Returning file has recent bookings. Speak to the matching past job. Do not read them as a list. Do not start a new book unless they ask for a new job.',
      };
    }
    if (intent === 'unknown' && returning?.lastReason && returningFileUsable(returning)) {
      return {
        action: ACTIONS.ANSWER,
        reason:
          'Unique returning line. Use last reason unless they have a new ask. Do not re-ask the name.',
      };
    }
  }

  if (intent === 'unknown') {
    return {
      action: ACTIONS.ASK_CLARIFICATION,
      reason: 'The caller goal is not established; ask one useful question.',
    };
  }

  if (missingSlots.length) {
    return {
      action: ACTIONS.ASK_CLARIFICATION,
      slot: missingSlots[0],
      reason: `The goal needs ${missingSlots[0]}; name what you already have, then ask for that one slot only.`,
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
    const said = String(state?.goal?.description || '');
    const latest = String(
      (state?.conversation?.answersReceived || []).slice(-1)[0] || ''
    );
    const fileTalk =
      looksLikeExistingVisitTalk(said) ||
      looksLikeExistingVisitTalk(latest) ||
      looksLikePastBookingTalk(said) ||
      looksLikePastBookingTalk(latest);
    const returning = state?.returning;
    if (
      fileTalk &&
      returningFileUsable(returning) &&
      (returning?.nextVisit ||
        (Array.isArray(returning?.recentBookings) && returning.recentBookings.length))
    ) {
      return {
        action: ACTIONS.ANSWER,
        reason: returning?.nextVisit
          ? 'Unique returning line with an open visit. Speak to that visit. Do not start a new book or re-ask the name. If they want it moved, collect only the new when.'
          : 'Returning file has recent bookings. Speak to the matching past job. Do not read them as a list. Do not start a new book unless they ask for a new job.',
      };
    }
    const request = authorizeAction(ACTIONS.CREATE_REQUEST, capabilities);
    const homeVisit =
      String(state?.vertical || '').toLowerCase() === 'home_services';
    const visitReason =
      intent === 'cancellation'
        ? 'Slots are complete. Append update_appointment and speak nothing. Do not tell the caller it is moved or cancelled; the backend speaks the outcome.'
        : 'Slots are complete. Append create_appointment and speak nothing. Do not tell the caller it is booked; the backend speaks the outcome.';
    return request.allowed
      ? {
          action: ACTIONS.CREATE_REQUEST,
          reason: homeVisit
            ? visitReason
            : 'Slots are complete. Append the tool and speak nothing. Do not tell the caller it is booked, moved, or saved; the backend speaks the outcome.',
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
