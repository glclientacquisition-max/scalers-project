// Derive a persistable call resolution from live Brain state + tool outcomes.

const { INTENT_ALIASES, normalizePrimaryIntent } = require('./intentTaxonomy');
const { deriveInboxPurpose, intentFromTools } = require('./inboxPurpose');

const RESOLUTIONS = new Set([
  'resolved',
  'needs_human',
  'abandoned',
  'unresolved',
  'unknown',
]);

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

function clean(value, max = 240) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
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
  const intent = intentFromTools(results, rawIntent);

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
    resolution = 'resolved';
    const appointmentOk = results.some(
      (r) =>
        (r.action === 'create_appointment' ||
          r.action === 'update_appointment') &&
        (r.status === 'succeeded' || r.status === 'updated')
    );
    if (appointmentOk) {
      const updated = results.find(
        (r) => r.action === 'update_appointment' && r.status === 'succeeded'
      );
      note = updated
        ? `Visit updated (${updated.appointmentStatus || 'updated'})`
        : 'Visit request saved';
    } else {
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
    }
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

  const inboxPurpose = deriveInboxPurpose({
    brainState: state,
    toolResults: results,
    resolution,
    primaryIntent: intent,
  });

  return {
    resolution,
    primaryIntent: intent,
    resolutionNote: note || null,
    inboxPurpose,
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
