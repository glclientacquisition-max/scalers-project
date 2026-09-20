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
  booking: 'book_visit',
  book_visit: 'book_visit',
  cancellation: 'cancel',
  cancel: 'cancel',
  reschedule: 'reschedule',
  service_inquiry: 'service_inquiry',
  service_area: 'service_area',
  price_band: 'price_band',
  emergency: 'emergency',
  complaint: 'complaint',
});

const DIRECT_ANSWER_INTENTS = new Set([
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
]);

/** K1 exact Product hangup / tool-save line while a visit is still requested. */
const VISIT_REQUESTED_NOTE = 'Visit request saved — confirm on desk.';
const VISIT_CONFIRMED_NOTE = 'Visit confirmed';
const HOLD_OPEN_NOTE = 'Hold saved; awaiting owner Done.';
const HOLD_DONE_NOTE = 'Hold done';

function resultStatus(row, fallback = '') {
  return String(
    row?.appointmentStatus ||
      row?.requestStatus ||
      row?.record?.status ||
      fallback ||
      ''
  ).toLowerCase();
}

function lastOkResult(results, actions) {
  const wanted = new Set(actions);
  const rows = (Array.isArray(results) ? results : []).filter(
    (row) =>
      wanted.has(row?.action) &&
      (row.status === 'succeeded' || row.status === 'updated')
  );
  return rows.length ? rows[rows.length - 1] : null;
}

function visitHonestyNote(results) {
  const row = lastOkResult(results, [
    'create_appointment',
    'update_appointment',
  ]);
  const status = resultStatus(row, 'requested');
  if (status === 'confirmed') return VISIT_CONFIRMED_NOTE;
  if (status === 'cancelled') {
    return `Visit updated (${status})`;
  }
  if (status === 'done') return `Visit updated (${status})`;
  return VISIT_REQUESTED_NOTE;
}

function holdHonestyNote(results) {
  const row = lastOkResult(results, ['create_service_request']);
  const status = resultStatus(row, 'open');
  const type = String(
    row?.requestType || row?.value?.type || ''
  ).toLowerCase();
  const isHold = !type || type === 'hold' || type === 'hold_or_pickup';
  if (isHold) {
    return status === 'fulfilled' ? HOLD_DONE_NOTE : HOLD_OPEN_NOTE;
  }
  const typeNote = type || null;
  return typeNote ? `Request saved (${typeNote})` : 'Request saved';
}

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

function resultOk(results, actions) {
  const wanted = new Set(actions);
  return (Array.isArray(results) ? results : []).some(
    (row) =>
      wanted.has(row?.action) &&
      (row.status === 'succeeded' || row.status === 'updated')
  );
}

/**
 * Hangup persist intent: saved work outranks the last spoken turn.
 * Live NBA still uses last-turn intent so a follow-up FAQ can be answered.
 */
function highWaterPrimaryIntent({ liveIntent, results = [] } = {}) {
  if (resultOk(results, ['escalate'])) return 'human';

  const visitOk = (Array.isArray(results) ? results : []).some(
    (row) =>
      (row.action === 'create_appointment' ||
        row.action === 'update_appointment') &&
      row.status === 'succeeded'
  );
  if (visitOk) {
    const cancelledOnly = results.some(
      (row) =>
        row.action === 'update_appointment' &&
        row.status === 'succeeded' &&
        String(row.appointmentStatus || '').toLowerCase() === 'cancelled'
    );
    const created = results.some(
      (row) => row.action === 'create_appointment' && row.status === 'succeeded'
    );
    if (cancelledOnly && !created) return 'cancel';
    return 'book_visit';
  }

  const request = (Array.isArray(results) ? results : []).find(
    (row) =>
      row.action === 'create_service_request' &&
      (row.status === 'succeeded' || row.status === 'updated')
  );
  if (request) {
    const type = String(
      request.requestType || request.value?.type || ''
    ).toLowerCase();
    if (type === 'order') return 'order_enquiry';
    if (type === 'enquiry') return 'order_enquiry';
    if (type === 'callback') return 'callback';
    return 'hold_or_pickup';
  }

  return normalizePrimaryIntent(liveIntent);
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
  const intent = highWaterPrimaryIntent({
    liveIntent: rawIntent,
    results,
  });

  const requestOk = results.some(
    (r) =>
      (r.action === 'create_service_request' ||
        r.action === 'create_appointment' ||
        r.action === 'update_appointment') &&
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
    // Receptionist finished the save. Needs you still owns Confirm / Hold Done.
    // Resolution stays an existing outcome; the note must not claim a closed book.
    resolution = 'resolved';
    const appointmentOk = results.some(
      (r) =>
        (r.action === 'create_appointment' ||
          r.action === 'update_appointment') &&
        r.status === 'succeeded'
    );
    note = appointmentOk ? visitHonestyNote(results) : holdHonestyNote(results);
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
  VISIT_REQUESTED_NOTE,
  VISIT_CONFIRMED_NOTE,
  HOLD_OPEN_NOTE,
  HOLD_DONE_NOTE,
  deriveCallResolution,
  highWaterPrimaryIntent,
  normalizePrimaryIntent,
  parseResolution,
  resultStatus,
  visitHonestyNote,
  holdHonestyNote,
};
