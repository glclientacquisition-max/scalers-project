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
});

/**
 * @typedef {Object} NotifyEvent
 * @property {string} kind        One of EVENTS
 * @property {string} businessName
 * @property {string} [title]     Short label, e.g. "HOLD / PICKUP"
 * @property {Array<[string, string]>} fields  Ordered label/value rows
 * @property {string} [action]    What the owner should do next
 * @property {string} [recordingUrl]
 * @property {{ name?: string, phone?: string, reason?: string }} [caller]
 * @property {{ name?: string, role?: string, phone?: string }} [teammate]
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

module.exports = {
  EVENTS,
  renderEventText,
  renderEventSubject,
  leadEvent,
};
