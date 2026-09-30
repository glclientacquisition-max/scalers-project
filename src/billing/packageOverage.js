/**
 * Package minute math. Postgres `consume_call_seconds` is the ledger.
 * Keep quoteCallOverage in step with docs/supabase/package_minute_consume.sql.
 *
 * Included seconds are already paid. Past the cap with on-demand off:
 * do not answer another call, do not debit. On-demand on and enforcement
 * not off: answer and debit overage seconds at the rate card.
 * Enforcement off still does not debit.
 */

function billableTalkSeconds({ outboundUnanswered, durationSeconds, minutes } = {}) {
  if (outboundUnanswered) return 0;
  const secs = Number(durationSeconds);
  if (Number.isFinite(secs) && secs > 0) return Math.max(0, Math.round(secs));
  const mins = Number(minutes);
  if (Number.isFinite(mins) && mins > 0) return Math.max(0, Math.round(mins * 60));
  return 0;
}

function quoteCallOverage({
  usedSeconds = 0,
  includedMinutes = 0,
  deltaSeconds = 0,
  enforcement = "off",
  onDemand = false,
  kesPerSecond = 0,
} = {}) {
  const used = Math.max(0, Math.round(Number(usedSeconds) || 0));
  const includedSeconds = Math.max(0, Math.round(Number(includedMinutes) || 0)) * 60;
  const delta = Math.max(0, Math.round(Number(deltaSeconds) || 0));
  const room = Math.max(0, includedSeconds - used);
  const overageSeconds = Math.max(0, delta - room);
  const meterSeconds = delta;
  const paid = String(enforcement || "off") !== "off";
  let reason = overageSeconds > 0 ? "cap" : "included";
  let debitKes = 0;
  if (!paid) {
    reason = "beta";
  } else if (overageSeconds > 0 && onDemand) {
    reason = "on_demand";
    const rate = Number(kesPerSecond);
    const raw = overageSeconds * (Number.isFinite(rate) && rate > 0 ? rate : 0);
    debitKes = Math.round(raw * 100) / 100;
    if (debitKes < 0) debitKes = 0;
  }
  return { meterSeconds, overageSeconds, debitKes, reason };
}

function inboundOpen({ minutesIncluded = 0, secondsUsed = 0, onDemand = false } = {}) {
  const includedMinutes = Math.max(0, Math.round(Number(minutesIncluded) || 0));
  if (includedMinutes <= 0) return { open: true, reason: "no_package_minutes" };
  const used = Math.max(0, Math.round(Number(secondsUsed) || 0));
  if (used < includedMinutes * 60) return { open: true, reason: "included" };
  if (onDemand) return { open: true, reason: "on_demand" };
  return { open: false, reason: "package_exhausted" };
}

module.exports = {
  billableTalkSeconds,
  quoteCallOverage,
  inboundOpen,
};
