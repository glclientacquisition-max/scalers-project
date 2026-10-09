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
 *
 * hasPackage comes from tenant_subscriptions.status ('active' = true,
 * 'cancelled' or no row = false). No package is explicit and is NEVER
 * unlimited: included minutes are then only this period's grants, and 0
 * included minutes is a cap of 0. Only an unknown package state (lookup
 * failed, hasPackage null/undefined) with 0 minutes fails open.
 *
 * Past the included minutes (or with none):
 *   on-demand on               -> answer (on_demand / on_demand_no_package)
 *   beta (enforcement off)     -> answer, metered not charged
 *                                 (beta_over_cap / beta_no_package)
 *   enforced, on-demand off    -> refuse (package_exhausted / no_package)
 */
function inboundOpen({
  minutesIncluded = 0,
  secondsUsed = 0,
  onDemand = false,
  enforcement = "off",
  hasPackage = null,
} = {}) {
  const includedMinutes = Math.max(0, Math.round(Number(minutesIncluded) || 0));
  const known = hasPackage === true || hasPackage === false;
  if (!known && includedMinutes <= 0) return { open: true, reason: "package_unknown" };
  const used = Math.max(0, Math.round(Number(secondsUsed) || 0));
  if (used < includedMinutes * 60) return { open: true, reason: "included" };
  const none = hasPackage === false;
  if (onDemand) return { open: true, reason: none ? "on_demand_no_package" : "on_demand" };
  if (!isEnforced(enforcement)) return { open: true, reason: none ? "beta_no_package" : "beta_over_cap" };
  return { open: false, reason: none ? "no_package" : "package_exhausted" };
}

const REJECT_XML = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

/**
 * Caller-facing XML when inboundOpen refuses (package_exhausted / no_package).
 * Default is #631's <Reject/>. PACKAGE_REFUSAL_VOICEMAIL=1 switches to the
 * plan's no-stream polite message + voicemail (<= 60 s) + hangup. Keep it off
 * until Voice confirms SautiKit honours <Say>/<Record> on this path and wires
 * the recording callback to the owner alert.
 */
function packageRefusalXml({ businessName = "", env = process.env } = {}) {
  if (String(env.PACKAGE_REFUSAL_VOICEMAIL || "") !== "1") return REJECT_XML;
  const name = String(businessName || "")
    .replace(/[<>&"']/g, "")
    .trim()
    .slice(0, 80);
  const who = name ? `${name} can't take your call right now` : "We can't take your call right now";
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' +
    `  <Say>Thank you for calling. ${who}. Please leave your name, number and a short message after the tone, and they will get back to you.</Say>\n` +
    '  <Record maxLength="60" playBeep="true"/>\n' +
    "  <Hangup/>\n</Response>"
  );
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
  packageRefusalXml,
  isEnforced,
  packageUsageThreshold,
};
