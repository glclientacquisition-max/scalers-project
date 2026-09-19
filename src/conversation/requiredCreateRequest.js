// Ensure CREATE_REQUEST tools fire when Brain already decided slots are complete.

const { entityValue } = require('./entityExtraction');

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
  return String(state.vertical || '').toLowerCase() === 'home_services';
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
    landmark: slot(state, ['landmark']),
    notes: clean(state.goal?.description, 400),
  };
}

function buildAppointmentUpdate(state = {}) {
  const cancel = isCancellationIntent(state);
  const reference = entityValue(state.entities?.reference);
  return {
    appointmentId: reference && /^[0-9a-f-]{8,}$/i.test(reference) ? reference : '',
    status: cancel ? 'cancelled' : '',
    whenText: cancel ? '' : slot(state, ['when']),
    landmark: slot(state, ['landmark']),
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
  const action = String(state.resolution?.nextBestAction || '');
  if (action !== 'CREATE_REQUEST') return next;
  if (!slotsComplete(state)) return next;
  if (!REQUEST_INTENTS.has(intentId(state))) return next;

  if (isHomeVisit(state)) {
    if (next.appointment || next.appointmentUpdate) return next;
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

  if (next.serviceRequest) return next;
  if (!capabilities.createServiceRequest) return next;
  const payload = buildServiceRequest(state);
  if (!holdReady(payload)) return next;
  next.serviceRequest = payload;
  return next;
}

function formatCreateRequestDirective(state = {}) {
  const action = String(state.resolution?.nextBestAction || '');
  if (action !== 'CREATE_REQUEST' || !slotsComplete(state)) return '';

  const homeVisit = isHomeVisit(state);
  const cancel =
    intentId(state) === 'cancellation' ||
    intentId(state) === 'cancel' ||
    intentId(state) === 'reschedule';
  const tool = homeVisit
    ? cancel
      ? 'update_appointment'
      : 'create_appointment'
    : 'create_service_request';

  return [
    'REQUIRED ACTION THIS TURN (do not read aloud):',
    `Slots are complete. Append the ${tool} ###TOOL### marker now.`,
    'Spoken line: speak nothing, or only Okay / Sawa. Never say booked, saved, held, moved, or cancelled. The backend speaks the outcome.',
  ].join('\n');
}

module.exports = {
  ensureRequiredCreateRequest,
  formatCreateRequestDirective,
};
