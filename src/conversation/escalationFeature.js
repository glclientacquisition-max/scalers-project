/**
 * Escalation feature contract — single source of truth for product + code.
 *
 * Job: when a caller needs a human, capture identity + reason, notify the right
 * teammate over the best available channel, confirm honestly on the phone, and
 * leave a desk trail the owner can act on.
 *
 * This module is intentionally small: stages, prerequisites, and notify outcome
 * shaping. Speech strings stay in toolExecution / dynamicSpeech.
 */

/** Ordered lifecycle stages (MVP). */
const ESCALATION_STAGES = Object.freeze([
  'idle', // no human request yet
  'human_requested', // caller asked for a person/role
  'need_name', // cannot notify until caller name is known
  'ready', // name + reason known; escalate tool should fire
  'notifying', // dispatch in flight
  'notified', // at least one live channel delivered (sms/wa/email)
  'desk_only', // saved on call; no live channel delivered (soft success)
  'failed', // hard failure (rare — prefer desk_only)
]);

/** Notify channel preference for private beta. */
const NOTIFY_CHANNEL_ORDER = Object.freeze(['sms', 'whatsapp', 'email', 'desk_note']);

/**
 * Derive the current escalation stage from Brain state + last notify result.
 * @param {object} [state]
 * @param {object|null} [notifyResult]
 */
function deriveEscalationStage(state = {}, notifyResult = null) {
  if (notifyResult?.ok && notifyResult.soft) return 'desk_only';
  if (notifyResult?.ok && !notifyResult.soft) return 'notified';
  if (notifyResult && notifyResult.ok === false) return 'failed';

  const intent = String(state.intent || '');
  const handoff = Boolean(state.handoff?.requested || state.handoff?.required);
  const action = String(state.resolution?.nextBestAction || '');
  const name = String(state.caller?.name || '').trim();
  const missing = Array.isArray(state.goal?.missingSlots) ? state.goal.missingSlots : [];
  const needsHuman = intent === 'human' || handoff || action === 'ESCALATE' || action === 'TRANSFER';

  if (!needsHuman) return 'idle';
  if (!name || missing.includes('name')) return 'need_name';
  if (action === 'ESCALATE' || action === 'TRANSFER') return 'ready';
  return 'human_requested';
}

/**
 * Normalize dispatch results into a stable outcome for desk + speech.
 * @param {{ ok: boolean, soft?: boolean, channel?: string|null, reason?: string, sent?: Array }} outcome
 */
function shapeEscalationNotifyOutcome(outcome = {}) {
  const channels = [];
  if (Array.isArray(outcome.sent)) {
    for (const item of outcome.sent) {
      if (item?.channel) {
        channels.push({
          channel: String(item.channel),
          role: item.role || null,
          to: item.to || null,
        });
      }
    }
  } else if (outcome.channel) {
    for (const part of String(outcome.channel).split(',')) {
      const channel = part.trim();
      if (channel) channels.push({ channel, role: null, to: null });
    }
  }

  const soft =
    Boolean(outcome.soft) ||
    (channels.length > 0 && channels.every((c) => c.channel === 'desk_note'));
  const ok = Boolean(outcome.ok);
  return {
    ok,
    soft: ok ? soft : false,
    stage: ok ? (soft ? 'desk_only' : 'notified') : 'failed',
    channels,
    reason: outcome.reason || null,
    at: new Date().toISOString(),
  };
}

/**
 * Product rules used by prompts / docs generators.
 */
function escalationMvpRules() {
  return {
    job: 'Route a human request to a real teammate with an honest caller confirm and a desk trail.',
    requiredBeforeNotify: ['caller_name', 'reason'],
    neverClaim: ['live_transfer_unless_executed', 'sms_sent_unless_provider_ok'],
    channelOrder: [...NOTIFY_CHANNEL_ORDER],
    softSuccessWhen: 'desk note saved but no SMS/WA/email delivered',
    teammateSource: 'tenants.team_directory only — never invent staff',
  };
}

module.exports = {
  ESCALATION_STAGES,
  NOTIFY_CHANNEL_ORDER,
  deriveEscalationStage,
  shapeEscalationNotifyOutcome,
  escalationMvpRules,
};
