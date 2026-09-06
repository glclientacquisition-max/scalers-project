// Billing rules for live transfer. SautiKit charges the workspace for the
// inbound DID leg and for a separate outbound PSTN leg (conference join).
// Scalers must not eat that outbound cost, and must not double-charge the
// inbound call_id (charge_call_to_wallet is idempotent per call id).

const DEFAULT_RATE = 15;

function envTransferRateKesPerMin() {
  const n = Number(process.env.WALLET_TRANSFER_RATE_KES_PER_MINUTE);
  if (Number.isFinite(n) && n >= 0) return n;
  const inbound = Number(process.env.WALLET_RATE_KES_PER_MINUTE);
  if (Number.isFinite(inbound) && inbound >= 0) return inbound;
  return DEFAULT_RATE;
}

function envAllowBetaOutbound() {
  return /^(1|true|on|yes)$/i.test(
    String(process.env.VOICE_LIVE_TRANSFER_BETA_OUTBOUND || '').trim()
  );
}

function billableMinutesFromSeconds(durationSeconds) {
  const s = Math.max(0, Number(durationSeconds) || 0);
  if (s <= 0) return 0;
  return Math.round((s / 60) * 10) / 10;
}

function parseEnforcement(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'off' || v === 'soft' || v === 'hard') return v;
  return null;
}

/**
 * Whether Scalers may POST /v1/calls (SautiKit starts billing the workspace).
 * Beta (enforcement off) defaults to no: callback SMS stays, workspace is not
 * opened to unbounded outbound PSTN. Staging lab sets VOICE_LIVE_TRANSFER_BETA_OUTBOUND=on.
 *
 * @param {{ billingEnforcement?: string, walletBalanceKes?: number, rateKesPerMin?: number }} [opts]
 */
function canOriginateOutboundTransfer({
  billingEnforcement,
  walletBalanceKes,
  rateKesPerMin,
} = {}) {
  const enforcement = parseEnforcement(billingEnforcement);
  if (enforcement === 'off') {
    if (envAllowBetaOutbound()) {
      return { ok: true, reason: 'beta_lab_outbound' };
    }
    return { ok: false, reason: 'beta_no_outbound' };
  }
  if (enforcement === 'hard') {
    const rate = Number.isFinite(Number(rateKesPerMin))
      ? Number(rateKesPerMin)
      : envTransferRateKesPerMin();
    const wallet = Number(walletBalanceKes);
    const minKes = Math.max(1, Math.round(rate));
    if (Number.isFinite(wallet) && wallet < minKes) {
      return { ok: false, reason: 'wallet_too_low' };
    }
  }
  if (enforcement === 'soft' || enforcement === 'hard') {
    return { ok: true, reason: 'prepaid' };
  }
  return { ok: true, reason: 'enforcement_unknown' };
}

/**
 * Two SautiKit CDRs → two Scalers call rows → two ledger debits.
 * Unanswered outbound is 0 minutes (SautiKit does not bill it; we must not).
 */
function planTransferLegCharges({
  inboundDurationSeconds,
  outboundDurationSeconds,
  outboundStatus,
} = {}) {
  const outboundTerminal = String(outboundStatus || '').toLowerCase();
  const outboundAnswered = outboundTerminal === 'complete' || outboundTerminal === 'completed';
  const inboundMinutes = billableMinutesFromSeconds(inboundDurationSeconds);
  const outboundMinutes = outboundAnswered
    ? billableMinutesFromSeconds(outboundDurationSeconds)
    : 0;
  return {
    inbound: { minutes: inboundMinutes, ledgerKind: 'call_charge', role: 'inbound' },
    outbound: {
      minutes: outboundMinutes,
      ledgerKind: 'call_charge',
      role: 'outbound_transfer',
      rateKesPerMin: envTransferRateKesPerMin(),
    },
    doNotFoldOutboundIntoInbound: true,
  };
}

module.exports = {
  envTransferRateKesPerMin,
  envAllowBetaOutbound,
  billableMinutesFromSeconds,
  canOriginateOutboundTransfer,
  planTransferLegCharges,
};
