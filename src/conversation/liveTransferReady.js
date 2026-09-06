// Tenant + hours + directory gates for live Dial. Executor flag is separate.

const { parseHandoffMode } = require('./handoffMode');
const { parseAgentTools } = require('./agentTools');
const { openClosedStatus } = require('./businessHours');
const { normalizeTeam } = require('./liveKnowledge');
const { resolveEscalation } = require('./escalation');
const {
  canOriginateOutboundTransfer,
  envTransferRateKesPerMin,
} = require('../billing/liveTransferLegs');

function envLiveTransferIgnoreHours() {
  return /^(1|true|on|yes)$/i.test(
    String(process.env.VOICE_LIVE_TRANSFER_IGNORE_HOURS || '').trim()
  );
}

function envLiveTransferExecutorEnabled() {
  return /^(1|true|on|yes)$/i.test(String(process.env.VOICE_LIVE_TRANSFER || '').trim());
}

/**
 * Kenya mobiles (and 254 landlines) to E.164. Returns null if not dialable.
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeKenyaE164(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (/^[17]\d{8}$/.test(digits)) {
    digits = `254${digits}`;
  }
  if (!/^254\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

function teamHasDialablePhone(teamDirectory) {
  return normalizeTeam(teamDirectory).some((row) => Boolean(normalizeKenyaE164(row.phone)));
}

function liveTransferDestination(teamDirectory, query) {
  const { teammate, match, requested } = resolveEscalation(teamDirectory, query);
  const phone = normalizeKenyaE164(teammate?.phone);
  if (!teammate || !phone) return null;
  return {
    name: teammate.name,
    role: teammate.role,
    phone,
    match,
    requested,
  };
}

/**
 * Whether Brain may authorize TRANSFER on this call.
 * Preference (`handoff_mode`) is not enough; executor + open hours + a directory phone required.
 *
 * @param {{ profile?: object, executorEnabled?: boolean, now?: Date }} [opts]
 */
function liveTransferReady({ profile = {}, executorEnabled, now } = {}) {
  const executorOn =
    typeof executorEnabled === 'boolean' ? executorEnabled : envLiveTransferExecutorEnabled();
  if (!executorOn) {
    return { ready: false, reason: 'executor_off' };
  }
  if (parseHandoffMode(profile.handoffMode) !== 'live_transfer') {
    return { ready: false, reason: 'handoff_callback' };
  }
  const tools = parseAgentTools(profile.agentTools);
  if (!tools.escalate) {
    return { ready: false, reason: 'escalate_off' };
  }
  const open = openClosedStatus(profile.hoursSchedule, now || new Date());
  if (open !== 'open' && !envLiveTransferIgnoreHours()) {
    return { ready: false, reason: 'closed_or_unknown' };
  }
  if (!teamHasDialablePhone(profile.teamDirectory)) {
    return { ready: false, reason: 'no_destination' };
  }
  if (profile.billingEnforcement != null || profile.walletBalanceKes != null) {
    const bill = canOriginateOutboundTransfer({
      billingEnforcement: profile.billingEnforcement,
      walletBalanceKes: profile.walletBalanceKes,
      rateKesPerMin: envTransferRateKesPerMin(),
    });
    if (!bill.ok) {
      return { ready: false, reason: bill.reason };
    }
  }
  return { ready: true, reason: 'ok' };
}

module.exports = {
  envLiveTransferExecutorEnabled,
  envLiveTransferIgnoreHours,
  normalizeKenyaE164,
  teamHasDialablePhone,
  liveTransferDestination,
  liveTransferReady,
};
