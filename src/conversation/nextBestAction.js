// Deterministic resolution ladder.
// The LLM interprets language; this module decides the safest useful action class.

const { ACTIONS, authorizeAction } = require('./brainPolicy');
const { returningFileUsable, speakerPendingOnFile } = require('./callerMemory');
const {
  looksLikeExistingVisitTalk,
  looksLikePastBookingTalk,
} = require('./visitTalk');
const { looksLikePaceOnlyTurn } = require('./dynamicSpeech');
const { looksLikeFileRead, hasReadableFile } = require('./fileRead');
const {
  looksLikeLeaveIt,
  looksLikeNonConsentAck,
} = require('./callCorrectives');
const { callerTurnKinds } = require('./messageOnly');
const {
  looksLikeOpenVisitLookup,
  looksLikeVisitReviewMore,
} = require('./openLineSpeech');

const DIRECT_ANSWER_INTENTS = new Set([
  'hours',
  'location',
  'price',
  'availability',
  'policy',
]);

const REQUEST_INTENTS = new Set(['hold', 'order', 'booking', 'cancellation']);

function visitFileReadDecision(state) {
  const returning = state?.returning;
  if (!returningFileUsable(returning)) return null;
  const hasOpen =
    Boolean(returning.hasOpenRows) ||
    (Array.isArray(returning.openVisits) && returning.openVisits.length > 0) ||
    (Array.isArray(returning.openRequests) && returning.openRequests.length > 0);
  // History-only files fall through to the recent-bookings reason (#538).
  if (!hasOpen) return null;
  const said = String(state?.goal?.description || '');
  const latest = String((state?.conversation?.answersReceived || []).slice(-1)[0] || '');
  const asked = [said, latest].some(
    (line) => looksLikeOpenVisitLookup(line) || looksLikeVisitReviewMore(line)
  );
  if (!asked) return null;
  return {
    action: ACTIONS.ANSWER,
    reason:
      'They asked what they have. The backend speaks the open visit rows. Do not ask which visit to update or cancel. Do not treat this as a reschedule.',
  };
}

function phoneFileHasOpenRows(state) {
  const file = state?.returning;
  if (!file || typeof file !== 'object') return false;
  if (file.hasOpenRows) return true;
  if (Array.isArray(file.openVisits) && file.openVisits.length) return true;
  if (Array.isArray(file.openRequests) && file.openRequests.length) return true;
  return false;
}

function determineNextBestAction({ state, capabilities = {} } = {}) {
  const intent = String(state?.intent || 'unknown');
  const repairCount = Number(state?.repair?.failureCount || 0);
  const missingSlots = Array.isArray(state?.goal?.missingSlots)
    ? state.goal.missingSlots
    : [];

  const latestUtterance = String(
    (state?.conversation?.answersReceived || []).slice(-1)[0] ||
      state?.goal?.description ||
      ''
  );
  const openRowsOnFile = phoneFileHasOpenRows(state);
  if (looksLikeFileRead(latestUtterance) && !hasReadableFile(state) && !openRowsOnFile) {
    return {
      action: ACTIONS.ANSWER,
      reason:
        'Nothing saved for this speaker. Do not use the file name. Say you do not have a booking, order, or hold. Do not list services. Do not invent one. Do not ask for a new slot.',
    };
  }

  const asksAboutFile =
    looksLikePastBookingTalk(latestUtterance) ||
    looksLikeExistingVisitTalk(latestUtterance);
  if (
    asksAboutFile &&
    speakerPendingOnFile(state?.returning) &&
    state?.caller?.nameConfirmed !== true
  ) {
    if (openRowsOnFile) {
      return {
        action: ACTIONS.ANSWER,
        reason:
          'Name is not confirmed. Say only that you need to confirm who is speaking. Do not mention open visits, holds, history, or rows on this number. Do not start a new booking.',
      };
    }
    return {
      action: ACTIONS.ANSWER,
      reason:
        'Name is unknown. Do not use the file name, open visit, or history. Say you do not have their bookings. Do not list services. Ask their name only if you are about to save something.',
    };
  }

  if (state?.messageOnly && REQUEST_INTENTS.has(intent)) {
    const askedFact = callerTurnKinds(latestUtterance).knowledge;
    if (askedFact) {
      return {
        action: ACTIONS.ANSWER,
        reason:
          'Message only. Answer the fact from the file. Do not ask which service to book, a day, a time, or a place.',
      };
    }
    const pending = String(state?.caller?.fileNameAsked || '').trim();
    const asked =
      state?.caller?.nameConfirmed === true ||
      state?.caller?.fileNameAskSpoken === true ||
      state?.caller?.messageNameAskSpoken === true;
    return {
      action: ACTIONS.CAPTURE,
      reason: asked
        ? `Message only. Do not ask which service to book, a day, a time, or a place. Say you will take a message and the team will call. Do not ask for the name again.${pending ? ` Use ${pending}.` : ''}`
        : 'Message only. Do not ask which service to book, a day, a time, or a place. Say you will take a message and the team will call. Ask for a name only if it is missing.',
    };
  }

  if (looksLikePaceOnlyTurn(latestUtterance)) {
    return {
      action: ACTIONS.ANSWER,
      reason: 'Pace request only. Keep the current job. Do not restart the SOP.',
    };
  }

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

  const fileRead = visitFileReadDecision(state);
  if (fileRead) return fileRead;

  if (intent === 'unknown' || intent === 'general_enquiry') {
    const returning = state?.returning;
    const said = String(state?.goal?.description || '');
    const latest = String(
      (state?.conversation?.answersReceived || []).slice(-1)[0] || ''
    );
    if (state?.conversation?.phatic && speakerPendingOnFile(returning)) {
      const pending = String(state?.caller?.fileNameAsked || '').trim();
      if (pending && !returning?.sharedLine) {
        if (state?.caller?.fileNameAskSpoken === true) {
          return {
            action: ACTIONS.ANSWER,
            reason:
              `File name ${pending} already asked. One short well, then offer help. Do not ask for a name. Do not talk about visits yet. Do not say nothing is open. Do not list services.`,
          };
        }
        return {
          action: ACTIONS.ASK_CLARIFICATION,
          slot: 'name',
          reason: `Ask once: Am I speaking with ${pending}? Do not talk about visits yet. Do not say nothing is open. Do not list services.`,
        };
      }
      return {
        action: ACTIONS.ANSWER,
        reason:
          'They greeted or asked how you are. One short well, then offer help. Do not ask who is speaking. Do not use the file name. Do not list services.',
      };
    }
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

  const placeGate = String(state?.visitPlace?.blocked || '');
  const ackOnly =
    !state?.conversation?.consentAck &&
    (looksLikeNonConsentAck(latestUtterance) || looksLikeLeaveIt(latestUtterance));
  if (placeGate === 'outside') {
    return {
      action: ACTIONS.ANSWER,
      reason: ackOnly
        ? 'Out of coverage. Callback note only. Okay, Sawa, or leave it is not a booking. Do not create_appointment. Do not say you will serve them tomorrow.'
        : 'The area is outside POLICIES/LOCATIONS. Do not create_appointment. Say the area is outside our coverage. Do not offer a callback. Never say landmark.',
    };
  }
  if (placeGate === 'unknown_coverage') {
    return {
      action: ACTIONS.ANSWER,
      reason:
        'Coverage is not on file and the location is only an area. Do not invent coverage. Do not create_appointment. Offer to note it for the owner. Never say landmark.',
    };
  }
  if (placeGate === 'refused') {
    const escalation = authorizeAction(ACTIONS.ESCALATE, capabilities);
    return escalation.allowed
      ? {
          action: ACTIONS.ESCALATE,
          reason:
            'The caller refused a location twice. Escalate. Do not save a visit. Never say landmark.',
        }
      : {
          action: ACTIONS.CAPTURE,
          reason:
            'The caller refused a location twice. Log an enquiry. Do not save a visit. Never say landmark.',
        };
  }

  if (ackOnly) {
    const quantityKnown = Boolean(
      state?.entities?.quantity &&
        String(
          typeof state.entities.quantity === 'object'
            ? state.entities.quantity.value
            : state.entities.quantity
        ).trim()
    );
    if ((intent === 'order' || intent === 'hold') && !quantityKnown) {
      return {
        action: ACTIONS.ASK_CLARIFICATION,
        slot: 'quantity',
        reason:
          'Then, Okay, or Sawa is not a quantity. Ask how many. Do not invent a count. Do not say the order is saved.',
      };
    }
    if (missingSlots.length) {
      return {
        action: ACTIONS.ASK_CLARIFICATION,
        slot: missingSlots[0],
        reason:
          'Acknowledgment is not consent. Ask for the missing fact. Do not invent a time or a booking.',
      };
    }
    if (REQUEST_INTENTS.has(intent)) {
      return {
        action: ACTIONS.ASK_CLARIFICATION,
        slot: 'confirm',
        reason:
          'Okay, Sawa, or leave it is not a yes. Confirm the facts. Do not lock the visit or order. Do not say it is saved.',
      };
    }
  }

  if (missingSlots.length) {
    if (missingSlots[0] === 'name' && state?.caller?.nameConfirmed !== true) {
      const pending = String(state?.caller?.fileNameAsked || '').trim();
      // Code already spoke the file-name ask. Do not tell Gemini to ask again
      // or treat the file as nameless — keep using the pending name.
      if (
        pending &&
        state?.caller?.fileNameAskSpoken === true &&
        !state?.returning?.sharedLine
      ) {
        const rest = missingSlots.filter((slot) => slot !== 'name');
        if (rest.length) {
          return {
            action: ACTIONS.ASK_CLARIFICATION,
            slot: rest[0],
            reason: `File name ${pending} already asked. Use ${pending}. Do not ask for a name. Do not say May I have your name. Ask only for ${rest[0]}.`,
          };
        }
        return {
          action: ACTIONS.ASK_CLARIFICATION,
          reason: `File name ${pending} already asked. Use ${pending}. Do not ask for a name. Continue the booking.`,
        };
      }
      if (pending && !state?.returning?.sharedLine) {
        return {
          action: ACTIONS.ASK_CLARIFICATION,
          slot: 'name',
          reason: `Ask once: Am I speaking with ${pending}? Do not ask for a different name. Do not talk about visits yet. Do not say nothing is open.`,
        };
      }
      return {
        action: ACTIONS.ASK_CLARIFICATION,
        slot: 'name',
        reason:
          'No name is on file. Ask once for their name. Do not ask again after they give one.',
      };
    }
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
