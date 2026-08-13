// Ensure required escalate tool fires when Brain already decided ESCALATE + name is known.

const { entityValue } = require('./entityExtraction');

/**
 * When next-best-action is ESCALATE and the caller name is known, inject an
 * escalate payload if the model only spoke contact details without a marker.
 * @returns {object} parsed tool payload (possibly with escalate filled in)
 */
function ensureRequiredEscalate(parsed, state = {}, capabilities = {}) {
  const next = parsed && typeof parsed === 'object' ? { ...parsed } : {};
  if (!capabilities.escalate) return next;
  if (next.escalate && typeof next.escalate === 'object') return next;

  const action = String(state.resolution?.nextBestAction || '');
  const needsEscalate =
    action === 'ESCALATE' ||
    (String(state.intent || '') === 'human' &&
      Boolean(state.handoff?.requested) &&
      !(Array.isArray(state.goal?.missingSlots) && state.goal.missingSlots.length));

  if (!needsEscalate) return next;

  const name = String(
    state.caller?.name || entityValue(state.entities?.name) || ''
  ).trim();
  if (!name) return next;

  const reason =
    String(
      state.handoff?.reason ||
        state.goal?.description ||
        'Caller requested a human'
    ).trim() || 'Caller requested a human';

  const reasonLower = reason.toLowerCase();
  const teammate = /\b(manager|boss|owner|supervisor)\b/.test(reasonLower)
    ? 'manager'
    : 'General queries';

  next.escalate = {
    teammate,
    name,
    reason: reason.slice(0, 400),
  };
  return next;
}

/**
 * Hard turn directive when escalate must fire now.
 */
function formatEscalateActionDirective(state = {}) {
  const action = String(state.resolution?.nextBestAction || '');
  if (action !== 'ESCALATE') return '';
  const name = String(
    state.caller?.name || entityValue(state.entities?.name) || ''
  ).trim();
  if (!name) return '';
  return [
    'REQUIRED ACTION THIS TURN (do not read aloud):',
    `Caller name is known (${name}). Append the escalate ###TOOL### marker now.`,
    'Do not only share a WhatsApp or phone number — the escalate tool must fire so the team is notified.',
    'Spoken line: say only that you will try to send the request to the team.',
  ].join('\n');
}

module.exports = {
  ensureRequiredEscalate,
  formatEscalateActionDirective,
};
