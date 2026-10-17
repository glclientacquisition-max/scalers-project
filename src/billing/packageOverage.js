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

function isEnforced(enforcement) {
  const mode = String(enforcement || "off").trim().toLowerCase();
  return mode === "soft" || mode === "hard";
}

/**
 * Inbound gate at the package minute cap.
 * Beta (`billing_enforcement` off or unknown) never rejects: usage keeps
 * metering and ops get the 80% / 100% notices instead. Only soft / hard with
 * on-demand off stop a new call once included minutes are used.
 */
function inboundOpen({
  minutesIncluded = 0,
  secondsUsed = 0,
  onDemand = false,
  enforcement = "off",
} = {}) {
  const includedMinutes = Math.max(0, Math.round(Number(minutesIncluded) || 0));
  if (includedMinutes <= 0) return { open: true, reason: "no_package_minutes" };
  const used = Math.max(0, Math.round(Number(secondsUsed) || 0));
  if (used < includedMinutes * 60) return { open: true, reason: "included" };
  if (onDemand) return { open: true, reason: "on_demand" };
  if (!isEnforced(enforcement)) return { open: true, reason: "beta_over_cap" };
  return { open: false, reason: "package_exhausted" };
}

/** Highest usage notice crossed: 0, 80, or 100 (percent of included minutes). */
function packageUsageThreshold({ minutesIncluded = 0, secondsUsed = 0 } = {}) {
  const includedSeconds = Math.max(0, Math.round(Number(minutesIncluded) || 0)) * 60;
  if (includedSeconds <= 0) return 0;
  const used = Math.max(0, Math.round(Number(secondsUsed) || 0));
  if (used >= includedSeconds) return 100;
  if (used * 100 >= includedSeconds * 80) return 80;
  return 0;
}

module.exports = {
  billableTalkSeconds,
  quoteCallOverage,
  inboundOpen,
  isEnforced,
  packageUsageThreshold,
};
