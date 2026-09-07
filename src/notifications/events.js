// Notification event model. One shape for every post-call alert.
// Voice builds an event; dispatch renders per channel and sends.

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
  CALLER_HOLD: 'caller_hold',
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

function line(label, value) {
  if (value == null || String(value).trim() === '') return null;
  return `${label}: ${String(value).trim()}`;
}

/**
 * Render an event as plain text for SMS / WhatsApp / email body.
 * @param {NotifyEvent} event
 * @returns {string}
 */
function renderEventText(event) {
  const title = event.title || defaultTitle(event.kind);
  const lines = [`${title}${event.businessName ? ` — ${event.businessName}` : ''}`];
  for (const [label, value] of event.fields || []) {
    const row = line(label, value);
    if (row) lines.push(row);
  }
  if (event.recordingUrl) lines.push(`Recording: ${event.recordingUrl}`);
  if (event.callUrl) lines.push(`Open call: ${event.callUrl}`);
  if (event.action) lines.push(event.action);
  return lines.filter(Boolean).join('\n');
}

function defaultTitle(kind) {
  switch (kind) {
    case EVENTS.LEAD:
      return 'New missed-call lead';
    case EVENTS.ESCALATION:
      return 'Escalation';
    case EVENTS.SERVICE_REQUEST:
      return 'Request';
    case EVENTS.APPOINTMENT:
      return 'Visit request';
    case EVENTS.WALLET_LOW:
      return 'Scalers wallet running low';
    case EVENTS.WALLET_EMPTY:
      return 'Scalers prepaid empty';
    case EVENTS.OUTAGE_SPEECH:
      return 'Scalers line downtime';
    case EVENTS.OUTAGE_LLM:
      return 'Scalers line taking names only';
    default:
      return 'Scalers alert';
  }
}

/**
 * Render an event as an email subject.
 * @param {NotifyEvent} event
 * @returns {string}
 */
function renderEventSubject(event) {
  const title = event.title || defaultTitle(event.kind);
  return `${title}${event.businessName ? ` — ${event.businessName}` : ''}`;
}

/**
 * Render a caller confirmation. Not generic: business name, the specific
 * thing captured, and the next step. No "your call was important".
 * @param {NotifyEvent} event
 * @returns {string}
 */
function renderCallerText(event) {
  const business = String(event.businessName || '').trim() || 'We';
  const name = String(event.caller?.name || '').trim();
  const hi = name ? `Hi ${name}, ` : 'Hi, ';
  switch (event.kind) {
    case EVENTS.CALLER_APPOINTMENT: {
      const when = String(event.when || '').trim();
      const service = String(event.item || '').trim();
      const what = service ? `your ${service} visit` : 'your visit';
      const at = when ? ` for ${when}` : '';
      return `${hi}${business} here. We have ${what}${at}. We will confirm shortly.`;
    }
    case EVENTS.CALLER_HOLD: {
      const item = String(event.item || '').trim();
      const what = item ? `we have held ${item} for you` : 'we have held your item';
      return `${hi}${business} here. ${what}. We will confirm shortly.`;
    }
    case EVENTS.CALLER_CALLBACK:
      return `${hi}${business} here. The team will call you back.`;
    default:
      return `${hi}${business} here. We have your request. We will confirm shortly.`;
  }
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
 * Build an owner lead event that is actionable without opening the desk.
 * Uses the persisted Brain summary + intent + resolution when present.
 */
function ownerLeadEvent(call = {}, businessName) {
  const fields = [
    ['Name', call.name],
    ['Phone', call.from_number || call.caller_number],
    ['Reason', call.reason],
  ];
  if (call.primary_intent) fields.push(['Intent', call.primary_intent]);
  if (call.brain_summary) fields.push(['Summary', call.brain_summary]);
  if (call.resolution_note) fields.push(['Outcome', call.resolution_note]);
  return {
    kind: EVENTS.LEAD,
    businessName,
    fields,
    recordingUrl: call.recording_url,
    callUrl: call.callUrl || call.call_url || null,
    caller: {
      name: call.name,
      phone: call.from_number || call.caller_number,
      reason: call.reason,
    },
  };
}

module.exports = {
  EVENTS,
  renderEventText,
  renderEventSubject,
  renderCallerText,
  leadEvent,
  ownerLeadEvent,
};
