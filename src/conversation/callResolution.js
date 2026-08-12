// Derive a persistable call resolution from live Brain state + tool outcomes.

const RESOLUTIONS = new Set([
  'resolved',
  'needs_human',
  'abandoned',
  'unresolved',
  'unknown',
]);

/** Map runtime intent ids onto desk-facing taxonomy. */
const INTENT_ALIASES = Object.freeze({
  hold: 'hold_or_pickup',
  hold_or_pickup: 'hold_or_pickup',
  hours: 'hours_open',
  hours_open: 'hours_open',
  location: 'directions',
  directions: 'directions',
  order: 'order_enquiry',
  order_enquiry: 'order_enquiry',
  price: 'price',
  availability: 'availability',
  policy: 'policy',
  human: 'human',
  product_inquiry: 'product_inquiry',
  general_enquiry: 'general_enquiry',
  booking: 'booking',
  cancellation: 'cancellation',
  complaint: 'complaint',
});

const DIRECT_ANSWER_INTENTS = new Set([
  'hours',
  'hours_open',
  'location',
  'directions',
  'price',
  'availability',
  'policy',
  'product_inquiry',
  'general_enquiry',
]);

function clean(value, max = 240) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizePrimaryIntent(raw) {
  const key = clean(raw, 80).toLowerCase();
  if (!key || key === 'unknown') return null;
  return INTENT_ALIASES[key] || key;
}

/**
 * @param {{
 *   brainState?: object|null,
 *   toolResults?: Array<{action?: string, status?: string, requestType?: string}>,
 *   turnCount?: number,
 *   callStatus?: string,
 * }} opts
 */
function deriveCallResolution(opts = {}) {
  const state = opts.brainState || {};
  const results = Array.isArray(opts.toolResults)
    ? opts.toolResults
    : Array.isArray(state.actions?.lastResults)
      ? state.actions.lastResults
      : [];
  const turnCount = Number(
    opts.turnCount != null
      ? opts.turnCount
      : state.conversation?.turnCount || 0
  );
  const rawIntent = state.intent || opts.primaryIntent || '';
  const intent = normalizePrimaryIntent(rawIntent);

  const requestOk = results.some(
    (r) =>
      r.action === 'create_service_request' &&
      (r.status === 'succeeded' || r.status === 'updated')
  );
  const escalateOk = results.some(
    (r) => r.action === 'escalate' && r.status === 'succeeded'
  );
  const escalateAttempted = results.some((r) => r.action === 'escalate');
  const handoff =
    Boolean(state.handoff?.requested || state.handoff?.required) ||
    escalateAttempted;

  const missingSlots = Array.isArray(state.goal?.missingSlots)
    ? state.goal.missingSlots
    : [];
  const answeredDirect =
    DIRECT_ANSWER_INTENTS.has(String(state.intent || '').toLowerCase()) &&
    missingSlots.length === 0 &&
    turnCount >= 1 &&
    (state.resolution?.nextBestAction === 'ANSWER' ||
      state.resolution?.nextBestAction === 'END' ||
      state.goal?.status === 'completed' ||
      state.resolution?.status === 'resolved');

  let resolution = 'unknown';
  let note = '';

  if (escalateOk || (handoff && !requestOk)) {
    resolution = 'needs_human';
    note = escalateOk
      ? 'Escalated to the team'
      : 'Caller needed a human';
  } else if (requestOk) {
    resolution = 'resolved';
    const type = results.find(
      (r) =>
        r.action === 'create_service_request' &&
        (r.status === 'succeeded' || r.status === 'updated')
    )?.requestType;
    const typeNote =
      type === 'hold' || type === 'hold_or_pickup'
        ? 'hold'
        : type || null;
    note = typeNote ? `Request saved (${typeNote})` : 'Request saved';
  } else if (
    state.resolution?.status === 'resolved' ||
    state.resolution?.nextBestAction === 'END' ||
    state.goal?.status === 'completed' ||
    answeredDirect
  ) {
    resolution = 'resolved';
    note = clean(
      state.resolution?.reason ||
        (intent ? `Answered ${intent}` : 'Caller question answered'),
      200
    );
  } else if (turnCount <= 1) {
    resolution = 'abandoned';
    note = 'Very short call — little conversation';
  } else if (state.resolution?.status === 'unresolved') {
    resolution = 'unresolved';
    note = clean(state.resolution?.reason || 'Goal not completed', 200);
  }

  if (!RESOLUTIONS.has(resolution)) resolution = 'unknown';

  return {
    resolution,
    primaryIntent: intent,
    resolutionNote: note || null,
  };
}

function parseResolution(raw) {
  const v = clean(raw, 40).toLowerCase();
  return RESOLUTIONS.has(v) ? v : null;
}

module.exports = {
  RESOLUTIONS,
  INTENT_ALIASES,
  deriveCallResolution,
  normalizePrimaryIntent,
  parseResolution,
};
