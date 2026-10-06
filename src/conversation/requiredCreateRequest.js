// Ensure CREATE_REQUEST tools fire when Brain already decided slots are complete.

const { entityValue } = require('./entityExtraction');
const { offeredVertical } = require('./vertical');
const { isVisitClassEscalateReason } = require('./playbooks/homeServices');
const { appendVisitNotes } = require('./visitLocation');
const { looksLikeLeaveIt, looksLikeNonConsentAck } = require('./callCorrectives');
const { clockPhrase, dayCue } = require('./visitTime');
const { formatDayOnlyWhen, parseAbsoluteWhenDate } = require('./appointmentHours');
const { numbersIn } = require('./numberWords');
const { callbackNotesWithoutClock, heldMessageCallerName } = require('./messageOnly');

const REQUEST_INTENTS = new Set([
  'hold',
  'hold_or_pickup',
  'order',
  'booking',
  'book_visit',
  'cancellation',
  'cancel',
  'reschedule',
]);

function clean(value, max = 400) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function slotsComplete(state = {}) {
  return !Array.isArray(state.goal?.missingSlots) || state.goal.missingSlots.length === 0;
}

function isHomeVisit(state = {}) {
  return offeredVertical(state.vertical) === 'home_services';
}

function isShop(state = {}) {
  return offeredVertical(state.vertical) === 'retail';
}

function slot(state, keys) {
  for (const key of keys) {
    const value = entityValue(state?.entities?.[key]);
    if (value) return value;
  }
  return '';
}

function callerName(state = {}) {
  return clean(
    state.caller?.name || entityValue(state.entities?.name),
    120
  );
}

function callerPhone(state = {}) {
  return clean(state.caller?.phone || entityValue(state.entities?.phone), 40);
}

function intentId(state = {}) {
  return String(state.intent || '').toLowerCase();
}

function isCancellationIntent(state = {}) {
  const intent = intentId(state);
  if (intent === 'reschedule') return false;
  if (intent !== 'cancellation' && intent !== 'cancel') return false;
  const text = String(state.goal?.description || '').toLowerCase();
  if (/\b(reschedule|move|change |badilisha|ahirisha)\b/i.test(text)) return false;
  return true;
}

function buildAppointment(state = {}) {
  return {
    serviceName: slot(state, ['service', 'product', 'requestedItem']),
    name: callerName(state),
    phone: callerPhone(state),
    whenText: slot(state, ['when']),
    landmark: slot(state, ['location', 'landmark']),
    notes: appendVisitNotes(clean(state.goal?.description, 400), state.visitPlace || {}),
  };
}

function buildAppointmentUpdate(state = {}) {
  const cancel = isCancellationIntent(state);
  const reference = entityValue(state.entities?.reference);
  return {
    appointmentId: reference && /^[0-9a-f-]{8,}$/i.test(reference) ? reference : '',
    status: cancel ? 'cancelled' : '',
    whenText: cancel ? '' : slot(state, ['when']),
    landmark: slot(state, ['location', 'landmark']),
    notes: clean(state.goal?.description, 400),
    serviceName: slot(state, ['service', 'product', 'requestedItem']),
    phone: callerPhone(state),
  };
}

function buildServiceRequest(state = {}) {
  const intent = intentId(state);
  let type = 'enquiry';
  if (intent === 'hold' || intent === 'hold_or_pickup') type = 'hold';
  else if (intent === 'order') type = 'order';
  return {
    type,
    name: callerName(state),
    phone: callerPhone(state),
    item: slot(state, ['product', 'requestedItem', 'service']),
    quantity: slot(state, ['quantity']),
    whenText: slot(state, ['when']),
    notes: clean(state.goal?.description, 400),
  };
}

/** Day known, time never given. Save the visit as a callback note, not a calendar slot. */

function clockKey(text) {
  const hit = String(text || '').match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  if (!hit) return '';
  const hour = String(Number(hit[1]));
  const minute = hit[2] && Number(hit[2]) ? String(Number(hit[2])).padStart(2, '0') : '';
  const ap = hit[3].replace(/\./g, '').toLowerCase();
  return minute ? `${hour}:${minute}${ap}` : `${hour}${ap}`;
}

function callerSaidClock(state, whenText) {
  const wanted = clockKey(whenText);
  if (!wanted) return false;
  const turns = (state?.conversation?.answersReceived || []).join(' ');
  if (clockKey(turns) === wanted) return true;
  const hour = Number(String(wanted).match(/^(\d{1,2})/)?.[1]);
  if (!hour) return false;
  // "12" then a noon confirm is that hour. "6 seats" is not 6 AM.
  const bare = new RegExp(
    `(?:^|\\b(?:at|saa)\\s+)${hour}\\b(?!\\s*(?:seats?|kiti|viti|coaches?))|\\b${hour}\\b(?!\\s*(?:seats?|kiti|viti|coaches?|\d))`,
    'i'
  );
  return bare.test(turns);
}

function stripClock(whenText) {
  return String(whenText || '')
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function planNow(state, capabilities) {
  const raw = capabilities?.now || state?.now;
  const date = raw instanceof Date ? raw : raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

const PERIOD_WORD = /\b(morning|asubuhi|afternoon|mchana|evening|jioni)\b/i;

function mentionsRefusedClock(whenText, state) {
  const clock = clockPhrase(whenText);
  if (!clock) return false;
  return (state?.actions?.refusedHours || []).some((item) => clockPhrase(item) === clock);
}

function withoutRefusedClock(text, state) {
  let out = String(text || '');
  for (const item of state?.actions?.refusedHours || []) {
    const clock = String(item || '').match(/\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/i);
    if (!clock) continue;
    const phrase = clock[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    out = out.replace(new RegExp(`\\b(?:at\\s+)?${phrase}\\b`, 'ig'), ' ');
  }
  return clean(out);
}

function buildVisitCallback(state = {}) {
  const service = slot(state, ['service', 'product', 'requestedItem']);
  const place = slot(state, ['location', 'landmark']);
  let whenText = slot(state, ['when']);
  if (mentionsRefusedClock(whenText, state)) whenText = dayCue(whenText);
  return {
    type: 'callback',
    name: callerName(state),
    phone: callerPhone(state),
    item: service || 'visit',
    quantity: '',
    whenText,
    notes: clean(
      [
        'Visit time to confirm.',
        place ? `Place: ${place}.` : '',
        withoutRefusedClock(state.goal?.description || '', state),
      ]
        .filter(Boolean)
        .join(' '),
      400
    ),
  };
}

function latestCallerTurn(state = {}) {
  return String((state.conversation?.answersReceived || []).slice(-1)[0] || '');
}

/** Okay, Sawa, Then, or leave it. Not consent unless it answered a confirm ask. */
function ackWithoutConsent(state = {}) {
  if (state.conversation?.leaveIt) return true;
  if (state.conversation?.consentAck) return false;
  const latest = latestCallerTurn(state);
  return (
    Boolean(state.conversation?.nonConsentAck) ||
    looksLikeNonConsentAck(latest) ||
    looksLikeLeaveIt(latest)
  );
}

function callerSaidNumber(state = {}, value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return true;
  const digits = raw.match(/\d+/g) || [];
  if (!digits.length) return true;
  const turns = (state.conversation?.answersReceived || []).join('. ');
  const said = numbersIn(turns);
  if (/\b(?:one|moja)\b/i.test(turns)) said.add('1');
  return digits.every((d) => said.has(d.replace(/^0+(?=\d)/, '')));
}

/**
 * Tool contract for every playbook. Applied to Gemini's own markers and to
 * injected ones. An acknowledgment never fires a save. A quantity the caller
 * never said is dropped. A visit with a day but no time is not a calendar row.
 */
function shouldBlockHomeVisitClassEscalate(state = {}, escalatePayload) {
  if (offeredVertical(state.vertical) !== 'home_services') return false;
  if (String(state.intent || '') === 'booking') return true;
  const reason = String(
    escalatePayload?.reason || state.handoff?.reason || state.goal?.description || ''
  );
  return isVisitClassEscalateReason(reason);
}

function guardToolPlan(parsed, state = {}, capabilities = {}) {
  const next = parsed && typeof parsed === 'object' ? { ...parsed } : {};
  if (next.escalate && shouldBlockHomeVisitClassEscalate(state, next.escalate)) {
    delete next.escalate;
    next.visitClassEscalateBlocked = true;
  }
  if (ackWithoutConsent(state)) {
    delete next.serviceRequest;
    delete next.appointment;
    delete next.appointmentUpdate;
    delete next.escalate;
    next.consentBlocked = true;
    return next;
  }
  if (next.appointment && typeof next.appointment === 'object') {
    const whenText = String(next.appointment.whenText || next.appointment.when_text || '');
    if (mentionsRefusedClock(whenText, state)) delete next.appointment;
  }
  if (next.serviceRequest && typeof next.serviceRequest === 'object') {
    const whenText = String(next.serviceRequest.whenText || next.serviceRequest.when_text || '');
    if (mentionsRefusedClock(whenText, state)) {
      if (state.conversation?.timeWaived) {
        next.serviceRequest = {
          ...next.serviceRequest,
          whenText: dayCue(whenText),
          notes: withoutRefusedClock(next.serviceRequest.notes || '', state),
        };
      } else {
        delete next.serviceRequest;
      }
    }
  }
  if (next.serviceRequest && typeof next.serviceRequest === 'object') {
    const request = { ...next.serviceRequest };
    if (!callerSaidNumber(state, request.quantity)) request.quantity = '';
    next.serviceRequest = request;
  }
  if (next.appointment && typeof next.appointment === 'object') {
    let whenText = String(next.appointment.whenText || next.appointment.when_text || '');
    if (clockPhrase(whenText) && !callerSaidClock(state, whenText)) {
      whenText = stripClock(whenText);
      next.appointment = {
        ...next.appointment,
        whenText,
        when_text: whenText,
        windowStart: '',
        windowEnd: '',
        window_start: '',
        window_end: '',
      };
    }
    const hasDay = Boolean(dayCue(whenText) || parseAbsoluteWhenDate(whenText));
    const bareDay = Boolean(whenText) && hasDay && !clockPhrase(whenText) && !PERIOD_WORD.test(whenText);
    if (bareDay && state.conversation?.timeWaived) {
      const day = formatDayOnlyWhen(whenText, planNow(state, capabilities));
      next.appointment = {
        ...next.appointment,
        whenText: day || whenText,
        when_text: day || whenText,
        windowStart: '',
        windowEnd: '',
        window_start: '',
        window_end: '',
      };
    } else if (bareDay) {
      next.needsVisitTime = whenText;
      delete next.appointment;
    }
  }
  return next;
}

function appointmentReady(payload) {
  return Boolean(
    payload.serviceName && payload.name && payload.whenText && payload.landmark
  );
}

function holdReady(payload) {
  if (payload.type === 'order') {
    return Boolean(payload.item && payload.name);
  }
  if (payload.type === 'hold') {
    return Boolean(payload.item && payload.name && payload.whenText);
  }
  return Boolean(payload.item || payload.notes);
}

function updateReady(payload) {
  return Boolean(payload.status || payload.whenText || payload.landmark || payload.notes);
}

/**
 * When next-best-action is CREATE_REQUEST and slots are complete, inject the
 * visit or hold payload if the model spoke without a tool marker.
 * Invalid payloads still go through toolExecution validators (no fake rows).
 */
function ensureRequiredCreateRequest(parsed, state = {}, capabilities = {}) {
  const next = parsed && typeof parsed === 'object' ? { ...parsed } : {};
  if (capabilities.messageOnly || state.messageOnly) {
    delete next.appointment;
    delete next.appointmentUpdate;
    const type = String(next.serviceRequest?.type || '').trim().toLowerCase();
    if (next.serviceRequest && type !== 'callback') delete next.serviceRequest;
    if (next.serviceRequest) {
      const notes = String(next.serviceRequest.notes || '').trim();
      const item = String(next.serviceRequest.item || '').trim();
      const whenText = String(
        next.serviceRequest.whenText || next.serviceRequest.when_text || ''
      ).trim();
      const held = heldMessageCallerName(state.caller);
      next.serviceRequest = {
        ...next.serviceRequest,
        whenText: '',
        when_text: '',
        when: '',
        name: held || next.serviceRequest.name,
        notes: callbackNotesWithoutClock(notes, whenText, item),
      };
    }
    return next;
  }
  const action = String(state.resolution?.nextBestAction || '');
  if (action !== 'CREATE_REQUEST') return next;
  if (!slotsComplete(state)) return next;
  if (ackWithoutConsent(state)) return next;
  if (!REQUEST_INTENTS.has(intentId(state))) return next;

  if (isHomeVisit(state)) {
    const cancelVisit =
      intentId(state) === 'cancellation' ||
      intentId(state) === 'cancel' ||
      intentId(state) === 'reschedule';
    if (capabilities.confirmVisit === false && !cancelVisit) {
      if (next.appointment) delete next.appointment;
      if (!capabilities.createServiceRequest || next.serviceRequest) return next;
      const payload = buildAppointment(state);
      next.serviceRequest = {
        type: 'enquiry',
        name: payload.name,
        item: payload.serviceName,
        notes: [payload.whenText, payload.landmark, payload.notes].filter(Boolean).join('. '),
      };
      return next;
    }
    if (next.appointment || next.appointmentUpdate) return next;
    if (state.conversation?.timeWaived && intentId(state) === 'booking') {
      if (!capabilities.createServiceRequest || next.serviceRequest) return next;
      next.serviceRequest = buildVisitCallback(state);
      return next;
    }
    if (intentId(state) === 'cancellation' || intentId(state) === 'cancel' || intentId(state) === 'reschedule') {
      if (!capabilities.updateAppointment) return next;
      const payload = buildAppointmentUpdate(state);
      if (!updateReady(payload)) return next;
      next.appointmentUpdate = payload;
      return next;
    }
    if (!capabilities.createAppointment) return next;
    const payload = buildAppointment(state);
    if (!appointmentReady(payload)) return next;
    next.appointment = payload;
    return next;
  }

  if (!isShop(state)) return next;
  if (next.serviceRequest && capabilities.placeHold === false) {
    const locked = String(next.serviceRequest.type || '').toLowerCase();
    if (locked === 'hold' || locked === 'order' || locked === 'hold_or_pickup') {
      next.serviceRequest = { ...next.serviceRequest, type: 'enquiry' };
    }
  }
  if (next.serviceRequest) return next;
  if (!capabilities.createServiceRequest) return next;
  const payload = buildServiceRequest(state);
  if (capabilities.placeHold === false && (payload.type === 'hold' || payload.type === 'order')) {
    payload.type = 'enquiry';
  }
  if (!holdReady(payload)) return next;
  next.serviceRequest = payload;
  return next;
}

function formatCreateRequestDirective(state = {}) {
  if (state.messageOnly) return '';
  const action = String(state.resolution?.nextBestAction || '');
  if (action !== 'CREATE_REQUEST' || !slotsComplete(state)) return '';

  const homeVisit = isHomeVisit(state);
  const shop = isShop(state);
  if (!homeVisit && !shop) return '';
  const cancel =
    intentId(state) === 'cancellation' ||
    intentId(state) === 'cancel' ||
    intentId(state) === 'reschedule';
  const tool = homeVisit
    ? cancel
      ? 'update_appointment'
      : state.conversation?.timeWaived
        ? 'create_service_request'
        : 'create_appointment'
    : 'create_service_request';

  return [
    'REQUIRED ACTION THIS TURN (do not read aloud):',
    `Slots are complete. Append the ${tool} ###TOOL### marker now.`,
    'Spoken line: speak nothing, or only Okay / Sawa. Never say booked, saved, held, moved, or cancelled. The backend speaks the outcome.',
  ].join('\n');
}

module.exports = {
  buildVisitCallback,
  ensureRequiredCreateRequest,
  formatCreateRequestDirective,
  guardToolPlan,
};
