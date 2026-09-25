/**
 * Pure Usage meter math. Home and Usage share runwayDaysAtPace.
 * Live-transfer outbound is a second calls row (src/db.js persistOutboundTransferLeg).
 */

/**
 * @param {unknown} summary
 * @returns {Record<string, unknown>}
 */
function parseCallSummary(summary) {
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    return /** @type {Record<string, unknown>} */ (summary);
  }
  if (typeof summary !== "string" || !summary) return {};
  try {
    const parsed = JSON.parse(summary);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * @param {unknown} summary
 */
function isLiveTransferSummary(summary) {
  const meta = parseCallSummary(summary);
  return meta.kind === "live_transfer" && meta.direction === "outbound";
}

/**
 * @param {{ duration_seconds?: number | null, ai_processing_minutes?: number | null }[]} rows
 */
function minutesFromCallRows(rows) {
  let seconds = 0;
  let minutesFromCol = 0;
  let usedAiCol = false;
  for (const row of rows) {
    seconds += Math.max(0, Number(row.duration_seconds) || 0);
    if (
      row.ai_processing_minutes != null &&
      Number.isFinite(Number(row.ai_processing_minutes))
    ) {
      minutesFromCol += Number(row.ai_processing_minutes);
      usedAiCol = true;
    }
  }
  return {
    seconds,
    minutes: usedAiCol
      ? Math.round(minutesFromCol * 10) / 10
      : Math.round((seconds / 60) * 10) / 10,
  };
}

/**
 * @param {{
 *   duration_seconds?: number | null,
 *   ai_processing_minutes?: number | null,
 *   summary?: unknown,
 * }[]} rows
 */
function splitCallMinutes(rows) {
  const inbound = [];
  const transfer = [];
  for (const row of rows) {
    if (isLiveTransferSummary(row.summary)) transfer.push(row);
    else inbound.push(row);
  }
  const inb = minutesFromCallRows(inbound);
  const xfer = minutesFromCallRows(transfer);
  return {
    inboundSeconds: inb.seconds,
    transferSeconds: xfer.seconds,
    inboundMinutes: inb.minutes,
    transferMinutes: xfer.minutes,
    seconds: inb.seconds + xfer.seconds,
    minutes: Math.round((inb.minutes + xfer.minutes) * 10) / 10,
  };
}

/**
 * @param {number} inboundMinutes
 * @param {number} transferMinutes
 * @param {number} inboundRate
 * @param {number} transferRate
 */
function estimatedCallCostKes(
  inboundMinutes,
  transferMinutes,
  inboundRate,
  transferRate
) {
  return Math.round(
    Number(inboundMinutes || 0) * Number(inboundRate || 0) +
      Number(transferMinutes || 0) * Number(transferRate || 0)
  );
}

/**
 * Days prepaid lasts at the current spend pace.
 * Pass spentKesThisMonth when Usage already has call cost. Home omits it and
 * uses minutes * inboundRate.
 *
 * @param {{
 *   minutesThisMonth: number,
 *   dayOfMonth: number,
 *   balanceKes: number,
 *   spentKesThisMonth?: number,
 *   inboundRate?: number,
 * }} opts
 * @returns {number | null}
 */
function runwayDaysAtPace(opts) {
  const day = Math.max(1, Number(opts.dayOfMonth) || 1);
  const spent = opts.spentKesThisMonth;
  const rate = Number(opts.inboundRate || 0);
  const kesPerDay =
    spent != null && Number.isFinite(Number(spent))
      ? Number(spent) / day
      : (Number(opts.minutesThisMonth) / day) * rate;
  if (kesPerDay <= 0 || Number(opts.balanceKes) <= 0) return null;
  return Math.max(0, Math.round(Number(opts.balanceKes) / kesPerDay));
}

module.exports = {
  isLiveTransferSummary,
  minutesFromCallRows,
  splitCallMinutes,
  estimatedCallCostKes,
  runwayDaysAtPace,
};
