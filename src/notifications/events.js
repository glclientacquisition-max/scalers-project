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

const BLOCKED_OWNER_NAMES = new Set([
  'calling',
  'callings',
  'haijawekwa',
  'caller',
  'customer',
  'unknown',
  'test',
  'user',
]);

function cleanOwnerName(raw) {
  return String(raw || '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Name that is safe to put on an owner SMS. Null means print "Caller" or skip the lead.
 */
function displayOwnerCallerName(raw) {
  const name = cleanOwnerName(raw);
  if (!name || name.length < 2 || name.length > 40) return null;
  const lower = name.toLowerCase();
  if (BLOCKED_OWNER_NAMES.has(lower)) return null;
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

function isWeakBrainSummary(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (
    /how are you doing|mm-hm|mbona unakwama|still there|is there anything else|which cleaning service do i need|i'd like to make a booking for tomorrow, but/i.test(
      lower
    )
  ) {
    return true;
  }
  const goalMatch = /goal:\s*(.*)$/i.exec(raw);
  const goal = goalMatch
    ? goalMatch[1]
        .replace(/\.\s*products:.*$/i, '')
        .replace(/\.\s*actions:.*$/i, '')
        .trim()
    : '';
  if (goal && /^(uh|um|eh|best|evening|hello|hi|mm-hm|mm hm)\b/i.test(goal)) {
    return true;
  }
  if (goal && goal.split(/\s+/).length <= 3 && /[?]$/.test(goal)) return true;
  return false;
}

function ownerSummary(call, reason) {
  const review = reviewOf(call);
  const raw = String(call.brain_summary || '').trim();
  if (!raw || isWeakBrainSummary(raw)) return null;
  const reasonLc = String(reason || review.reason || '').trim().toLowerCase();
  if (reasonLc && raw.toLowerCase().includes(reasonLc)) return null;
  return raw;
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
 * Build an owner lead event that is actionable without opening the desk.
 * Prefers hangup owner_review. Drops live Brain dump that repeats greetings.
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
  const summary = ownerSummary(call, reason);
  if (summary) fields.push(['Summary', summary]);
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

function shouldSendOwnerLead(call = {}) {
  return Boolean(displayOwnerCallerName(call.name) && ownerReason(call));
}

module.exports = {
  EVENTS,
  renderEventText,
  renderEventSubject,
  renderCallerText,
  leadEvent,
  ownerLeadEvent,
  displayOwnerCallerName,
  shouldSendOwnerLead,
};
