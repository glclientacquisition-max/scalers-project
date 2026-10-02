// Ensure required escalate tool fires when Brain already decided ESCALATE + name is known.

const { entityValue } = require('./entityExtraction');
const {
  hasConcreteUrgentNeed,
  looksLikeUrgentContact,
} = require('./callCorrectives');
const { offeredVertical } = require('./vertical');
const { isVisitClassEscalateReason } = require('./playbooks/homeServices');

const GENERIC_REASON = /requested a human|human requested|live transfer is unavailable/i;

/**
 * The team should read what the caller needs, not why the Brain escalated.
 * Picks the latest concrete caller turn after the human/urgent ask.
 */
function statedNeed(state = {}) {
  const turns = Array.isArray(state.conversation?.answersReceived)
    ? state.conversation.answersReceived
    : [];
  const name = String(state.caller?.name || '').trim().toLowerCase();
  const askAt = turns.findIndex((turn) => looksLikeUrgentContact(turn));
  const scan = turns.slice(Math.max(0, askAt));
  for (let i = scan.length - 1; i >= 0; i -= 1) {
    const turn = String(scan[i] || '').trim();
    const clean = turn.toLowerCase().replace(/[.!?]+$/, '');
    if (!clean || clean === name) continue;
    if (hasConcreteUrgentNeed(turn)) return turn.slice(0, 200);
  }
  return '';
}

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
    action === 'TRANSFER' ||
    (String(state.intent || '') === 'human' &&
      Boolean(state.handoff?.requested) &&
      !(Array.isArray(state.goal?.missingSlots) && state.goal.missingSlots.length));

  if (!needsEscalate) return next;

  if (
    offeredVertical(state.vertical) === 'home_services' &&
    (String(state.intent || '') === 'booking' ||
      isVisitClassEscalateReason(state.handoff?.reason || state.goal?.description || ''))
  ) {
    return next;
  }

  const name = String(
    state.caller?.name || entityValue(state.entities?.name) || ''
  ).trim();
  if (!name) return next;

  const decided = String(
    state.handoff?.reason || state.goal?.description || ''
  ).trim();
  const need = decided && !GENERIC_REASON.test(decided) ? '' : statedNeed(state);
  const reason = need
    ? `Caller says: ${need}`
    : decided || 'Caller requested a human';

  const reasonLower = reason.toLowerCase();
  let teammate = 'General queries';
  if (/\bfloor\s*manager\b/.test(reasonLower)) teammate = 'Floor Manager';
  else if (/\b(manager|boss|owner|supervisor)\b/.test(reasonLower)) {
    teammate = 'manager';
  }

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
  const name = String(
    state.caller?.name || entityValue(state.entities?.name) || ''
  ).trim();
  const intent = String(state.intent || '');
  const handoffRequested = Boolean(state.handoff?.requested);

  if ((action === 'ESCALATE' || action === 'TRANSFER') && name) {
    const connect = action === 'TRANSFER';
    return [
      'REQUIRED ACTION THIS TURN (do not read aloud):',
      `Caller name is known (${name}). Append the escalate ###TOOL### marker now.`,
      connect
        ? 'Spoken line: say only that you will try to connect them. Never claim the transfer is done.'
        : 'Do not only share a WhatsApp or phone number — the escalate tool must fire so the team is notified.',
      connect
        ? ''
        : 'Spoken line: speak nothing. Do not say you sent, passed, or forwarded anything. Do not describe what you sent.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Human asked for, name still missing — speak the ask; do not claim notify yet.
  if (
    (action === 'ASK_CLARIFICATION' || action === 'ESCALATE') &&
    (intent === 'human' || handoffRequested) &&
    !name
  ) {
    return [
      'REQUIRED ACTION THIS TURN:',
      'Caller asked for a human / manager but name is missing.',
      'Ask only for their name in one short sentence.',
      'Do NOT append escalate until the name is known.',
      'Do not invent that you already notified anyone.',
    ].join('\n');
  }

  return '';
}

module.exports = {
  ensureRequiredEscalate,
  formatEscalateActionDirective,
};
