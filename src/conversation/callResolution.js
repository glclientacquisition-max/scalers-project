// Derive a persistable call resolution from live Brain state + tool outcomes.

const RESOLUTIONS = new Set([
  'resolved',
  'needs_human',
  'abandoned',
  'unresolved',
  'unknown',
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
  const intent = clean(state.intent || opts.primaryIntent || '', 80) || null;

  const requestOk = results.some(
    (r) =>
      r.action === 'create_service_request' && r.status === 'succeeded'
  );
  const escalateOk = results.some(
    (r) => r.action === 'escalate' && r.status === 'succeeded'
  );
  const escalateAttempted = results.some((r) => r.action === 'escalate');
  const handoff =
    Boolean(state.handoff?.requested || state.handoff?.required) ||
    escalateAttempted;

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
        r.action === 'create_service_request' && r.status === 'succeeded'
    )?.requestType;
    note = type ? `Request saved (${type})` : 'Request saved';
  } else if (
    state.resolution?.status === 'resolved' ||
    state.resolution?.nextBestAction === 'END' ||
    state.goal?.status === 'completed'
  ) {
    resolution = 'resolved';
    note = clean(state.resolution?.reason || 'Caller question answered', 200);
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
    primaryIntent: intent && intent !== 'unknown' ? intent : null,
    resolutionNote: note || null,
  };
}

function parseResolution(raw) {
  const v = clean(raw, 40).toLowerCase();
  return RESOLUTIONS.has(v) ? v : null;
}

module.exports = {
  RESOLUTIONS,
  deriveCallResolution,
  parseResolution,
};
