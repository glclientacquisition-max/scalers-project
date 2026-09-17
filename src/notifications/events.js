// Notification event model. One shape for every post-call alert.
// Voice builds an event; dispatch renders per channel and sends.

const { sanitizeStoredCallerName } = require('../conversation/callerNameQuality');
const {
  appointmentTitle,
  renderCallerText: renderCallerTemplate,
  renderStaffSubject,
  renderStaffText,
  serviceRequestTitle,
  staffAction,
} = require('./templates');

const EVENTS = Object.freeze({
  LEAD: 'lead',
  ESCALATION: 'escalation',
  SERVICE_REQUEST: 'service_request',
  APPOINTMENT: 'appointment',
  WALLET_LOW: 'wallet_low',
  WALLET_EMPTY: 'wallet_empty',
  OUTAGE_SPEECH: 'outage_speech',
  OUTAGE_LLM: 'outage_llm',
  CALLER_APPOINTMENT: 'caller_appointment',
  CALLER_APPOINTMENT_CONFIRMED: 'caller_appointment_confirmed',
  CALLER_APPOINTMENT_CANCELLED: 'caller_appointment_cancelled',
  CALLER_APPOINTMENT_RESCHEDULED: 'caller_appointment_rescheduled',
  CALLER_HOLD: 'caller_hold',
  CALLER_HOLD_UPDATED: 'caller_hold_updated',
  CALLER_ORDER: 'caller_order',
  CALLER_CALLBACK: 'caller_callback',
});

/**
 * @typedef {Object} NotifyEvent
 * @property {string} kind        One of EVENTS
 * @property {string} businessName
 * @property {string} [title]     Short label, e.g. "HOLD / PICKUP"
 * @property {Array<[string, string]>} fields  Ordered label/value rows
 * @property {string} [action]    What the owner should do next
 * @property {string} [recordingUrl]
 * @property {string} [callUrl]   Deep link to the desk call detail
 * @property {{ name?: string, phone?: string, reason?: string }} [caller]
 * @property {{ name?: string, role?: string, phone?: string }} [teammate]
 * @property {string} [when]      Visit / hold time text for caller confirmations
 * @property {string} [item]      Held item for caller confirmations
 */

/**
 * Render an event as plain text for SMS / WhatsApp / email body.
 * @param {NotifyEvent} event
 * @returns {string}
 */
function renderEventText(event) {
  return renderStaffText(event);
}

/**
 * Render an event as an email subject.
 * @param {NotifyEvent} event
 * @returns {string}
 */
function renderEventSubject(event) {
  return renderStaffSubject(event);
}

/**
 * Render a caller confirmation. Name is gated. No "your call was important".
 * @param {NotifyEvent} event
 * @returns {string}
 */
function renderCallerText(event) {
  const name = displayOwnerCallerName(event?.caller?.name) || '';
  return renderCallerTemplate({
    ...event,
    caller: { ...(event.caller || {}), name },
  });
}

/**
 * Build the canonical lead event from a call row.
 */
function leadEvent({ businessName, name, reason, callerNumber, recordingUrl } = {}) {
  return {
    kind: EVENTS.LEAD,
    businessName,
    fields: [
      ['Name', name],
      ['Phone', callerNumber],
      ['Reason', reason],
    ],
    recordingUrl,
    caller: { name, phone: callerNumber, reason },
  };
}

/**
 * Name that is safe to put on an owner SMS. Null means print "Caller" or skip the lead.
 */
function displayOwnerCallerName(raw) {
  const name = sanitizeStoredCallerName(raw);
  if (!name || name.length < 2 || name.length > 40) return null;
  if (!/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,3}$/u.test(name)) {
    return null;
  }
  return name;
}

function reviewOf(call) {
  return call && call.owner_review && typeof call.owner_review === 'object'
    ? call.owner_review
    : {};
}

function ownerIntent(call) {
  const review = reviewOf(call);
  const intent = String(
    review.primary_intent || call.primary_intent || ''
  ).trim();
  if (!intent || intent === 'general_enquiry') return null;
  return intent;
}

function ownerReason(call) {
  const review = reviewOf(call);
  return (
    String(review.reason || call.reason || '')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

function isInternalResolutionNote(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  return /permitted end-call action|ask for that one slot|attempt direct resolution|close naturally|resolve from knowledge|the goal needs|the caller goal is complete/i.test(
    raw
  );
}

function ownerOutcome(call) {
  const note = String(call.resolution_note || '').trim();
  if (!note || isInternalResolutionNote(note)) return null;
  return note;
}

/**
 * Staff lead. Reason is the owner sentence. No Summary dump. No Want card.
 */
function ownerLeadEvent(call = {}, businessName) {
  const name = displayOwnerCallerName(call.name) || null;
  const reason = ownerReason(call);
  const fields = [
    ['Name', name],
    ['Phone', call.from_number || call.caller_number],
    ['Reason', reason],
  ];
  const intent = ownerIntent(call);
  if (intent) fields.push(['Intent', intent]);
  const outcome = ownerOutcome(call);
  if (outcome) fields.push(['Outcome', outcome]);
  return {
    kind: EVENTS.LEAD,
    businessName,
    fields,
    recordingUrl: call.recording_url,
    callUrl: call.callUrl || call.call_url || null,
    caller: {
      name,
      phone: call.from_number || call.caller_number,
      reason,
    },
  };
}

function serviceRequestEvent(request = {}, businessName) {
  const type = String(request.request_type || 'enquiry').toLowerCase();
  return {
    kind: EVENTS.SERVICE_REQUEST,
    title: serviceRequestTitle(type),
    businessName,
    fields: [
      ['Item', request.item],
      ['Qty', request.quantity],
      ['When', request.when_text],
      ['Caller', request.caller_name],
      ['Phone', request.caller_phone],
      ['Notes', request.notes],
    ],
    action: staffAction(EVENTS.SERVICE_REQUEST),
    caller: {
      name: request.caller_name,
      phone: request.caller_phone,
    },
  };
}

function appointmentEvent(appointment = {}, businessName, kind = 'created') {
  const status = String(appointment.status || 'requested').toLowerCase();
  return {
    kind: EVENTS.APPOINTMENT,
    title: appointmentTitle(kind, status),
    businessName,
    fields: [
      ['Service', appointment.service_name],
      ['When', appointment.when_text],
      ['Where', appointment.address_landmark],
      ['Caller', appointment.caller_name],
      ['Phone', appointment.caller_phone],
      ['Notes', appointment.notes],
      ['Status', status],
    ],
    action: staffAction(EVENTS.APPOINTMENT),
    caller: {
      name: appointment.caller_name,
      phone: appointment.caller_phone,
    },
  };
}

function shouldSendOwnerLead(call = {}) {
  return Boolean(displayOwnerCallerName(call.name) && ownerReason(call));
}

/**
 * Mid-call name capture during a visit must not text the owner a lead dump.
 * Hangup still sends a lead if no visit notify marked the call.
 */
function shouldDeferOwnerLeadForVisit({
  midCall = false,
  brainIntent = '',
  goalStatus = '',
} = {}) {
  if (!midCall) return false;
  if (String(goalStatus || '').toLowerCase() === 'completed') return false;
  const intent = String(brainIntent || '').toLowerCase();
  return intent === 'booking' || intent === 'cancellation';
}

module.exports = {
  EVENTS,
  renderEventText,
  renderEventSubject,
  renderCallerText,
  leadEvent,
  ownerLeadEvent,
  serviceRequestEvent,
  appointmentEvent,
  displayOwnerCallerName,
  shouldSendOwnerLead,
  shouldDeferOwnerLeadForVisit,
};
