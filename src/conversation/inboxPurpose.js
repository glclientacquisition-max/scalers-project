// Owner-facing Inbox purpose. Derived from tools first, then Brain intent, then resolution.
// Desk stamps (Job / Hold / Human / Missed / Answered) must follow this module.

const { normalizePrimaryIntent } = require('./intentTaxonomy');

const PURPOSES = new Set(['job', 'hold', 'human', 'missed', 'answered']);

const JOB_INTENTS = new Set([
  'book_visit',
  'booking',
  'reschedule',
  'cancel',
  'cancellation',
]);

const HOLD_INTENTS = new Set([
  'hold',
  'hold_or_pickup',
  'order',
  'order_enquiry',
  'enquiry',
  'callback',
]);

const HUMAN_INTENTS = new Set([
  'human',
  'emergency',
  'complaint',
  'escalate',
  'handoff',
]);

const ANSWER_INTENTS = new Set([
  'hours',
  'hours_open',
  'location',
  'directions',
  'price',
  'price_band',
  'availability',
  'policy',
  'product_inquiry',
  'service_inquiry',
  'service_area',
  'general_enquiry',
  'other',
]);

function listResults(opts = {}) {
  const state = opts.brainState || {};
  if (Array.isArray(opts.toolResults)) return opts.toolResults;
  if (Array.isArray(state.actions?.lastResults)) return state.actions.lastResults;
  return [];
}

function toolOk(result, actions) {
  if (!result || !actions.includes(result.action)) return false;
  return result.status === 'succeeded' || result.status === 'updated';
}

function parsePurpose(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return PURPOSES.has(key) ? key : null;
}

/**
 * Prefer what the receptionist actually did on the call.
 */
function intentFromTools(results, currentIntent) {
  const appointment = results.find((r) =>
    toolOk(r, ['create_appointment', 'update_appointment'])
  );
  if (appointment) return 'book_visit';

  const request = results.find((r) => toolOk(r, ['create_service_request']));
  if (request) {
    const type = String(
      request.requestType || request.value?.type || ''
    ).toLowerCase();
    if (type === 'order') return 'order_enquiry';
    if (type === 'callback') return 'callback';
    if (type === 'enquiry' || type === 'other') return 'enquiry';
    return 'hold_or_pickup';
  }

  const escalate = results.find(
    (r) => r.action === 'escalate' && r.status === 'succeeded'
  );
  if (escalate) {
    const current = normalizePrimaryIntent(currentIntent);
    if (!current || ANSWER_INTENTS.has(current) || current === 'general_enquiry') {
      return 'human';
    }
  }
  return normalizePrimaryIntent(currentIntent);
}

/**
 * @param {{
 *   brainState?: object|null,
 *   toolResults?: Array<object>,
 *   resolution?: string|null,
 *   primaryIntent?: string|null,
 * }} opts
 * @returns {'job'|'hold'|'human'|'missed'|'answered'}
 */
function deriveInboxPurpose(opts = {}) {
  const state = opts.brainState || {};
  const results = listResults(opts);
  const appointmentOk = results.some((r) =>
    toolOk(r, ['create_appointment', 'update_appointment'])
  );
  const requestOk = results.some((r) => toolOk(r, ['create_service_request']));
  const escalateOk = results.some(
    (r) => r.action === 'escalate' && r.status === 'succeeded'
  );
  const escalateAttempted = results.some((r) => r.action === 'escalate');
  const handoff =
    Boolean(state.handoff?.requested || state.handoff?.required) ||
    escalateAttempted;

  if (appointmentOk) return 'job';
  if (requestOk) return 'hold';
  if (escalateOk || (handoff && !requestOk && !appointmentOk)) return 'human';

  const intent =
    intentFromTools(results, opts.primaryIntent || state.intent) ||
    normalizePrimaryIntent(opts.primaryIntent || state.intent);
  if (HUMAN_INTENTS.has(intent)) return 'human';
  if (JOB_INTENTS.has(intent)) return 'job';
  if (HOLD_INTENTS.has(intent)) return 'hold';

  const resolution = String(opts.resolution || state.resolution?.status || '')
    .trim()
    .toLowerCase();
  if (resolution === 'needs_human') return 'human';
  if (resolution === 'abandoned' || resolution === 'unresolved') return 'missed';
  if (resolution === 'resolved' || ANSWER_INTENTS.has(intent)) return 'answered';
  return 'missed';
}

module.exports = {
  PURPOSES,
  JOB_INTENTS,
  HOLD_INTENTS,
  HUMAN_INTENTS,
  ANSWER_INTENTS,
  parsePurpose,
  intentFromTools,
  deriveInboxPurpose,
};
