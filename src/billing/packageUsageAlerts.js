// Ops notice when a beta tenant (billing_enforcement off) reaches 80% and
// 100% of its included package minutes. Beta never rejects a call at the cap
// (packageOverage.inboundOpen), so this is how ops learn about it.
//
// Dedupe: one notice per tenant, threshold, and package period.
// - In-memory Set stops repeats inside one Voice process.
// - Durable marker: a `platform_ops_notices` row with status 'resolved' and
//   kind `package_minutes_<pct>:<tenantId>:<periodKey>`. Desk only lists
//   open/acked notices, so these markers never show on the Admin board.
// If the notices table is missing, dedupe is in-memory only (one notice per
// threshold per process start).

const { packageUsageThreshold, isEnforced } = require('./packageOverage');

/** @type {Set<string>} */
const sentKeys = new Set();

function periodKey(periodStart) {
  if (!periodStart) return 'none';
  const ms = Date.parse(periodStart);
  if (!Number.isFinite(ms)) return String(periodStart).slice(0, 32);
  return new Date(ms).toISOString().slice(0, 10);
}

function markerKind(pct, tenantId, period) {
  return `package_minutes_${pct}:${tenantId}:${period}`;
}

function noticeText({ pct, businessName, minutesIncluded, secondsUsed }) {
  const who = String(businessName || 'A business').trim();
  const usedMin = Math.round((Number(secondsUsed) || 0) / 6) / 10;
  const subject =
    pct >= 100
      ? `Scalers ops: ${who} used all package minutes`
      : `Scalers ops: ${who} at ${pct}% of package minutes`;
  const lines = [
    `${who} has used ${usedMin} of ${minutesIncluded} included minutes (${pct}%).`,
    'Billing is in beta (enforcement off), so calls keep being answered and metered. Nothing is charged.',
    pct >= 100
      ? 'Decide in Super Admin > Businesses: move to a bigger package, turn on on-demand, or leave in beta.'
      : 'No action needed yet. You will get one more notice at 100%.',
  ];
  return { subject, body: lines.join('\n') };
}

function defaultDeps() {
  const db = require('../db');
  const { notePlatformOpsEvent } = require('../notifications/platformOpsAlert');
  return {
    hasMarker: db.hasPlatformOpsMarker,
    putMarker: db.putPlatformOpsMarker,
    send: notePlatformOpsEvent,
  };
}

/**
 * @param {{ tenantId: string, businessName?: string|null, minutesIncluded?: number,
 *   secondsUsed?: number, enforcement?: string|null, periodStart?: string|null }} usage
 * @param {{ hasMarker?: Function, putMarker?: Function, send?: Function }} [deps]
 * @returns {Promise<{ sent: number[], skipped: string|null }>}
 */
async function maybeAlertPackageUsage(usage, deps) {
  if (!usage?.tenantId) return { sent: [], skipped: 'no_tenant' };
  if (isEnforced(usage.enforcement)) return { sent: [], skipped: 'enforced' };
  const top = packageUsageThreshold(usage);
  if (!top) return { sent: [], skipped: 'below_80' };

  const d = { ...defaultDepsLazy(deps), ...(deps || {}) };
  const period = periodKey(usage.periodStart);
  // Jumping straight past 100% sends only the 100% notice and marks 80% too.
  const pcts = top >= 100 ? [100, 80] : [80];
  const sent = [];

  for (const pct of pcts) {
    const kind = markerKind(pct, usage.tenantId, period);
    if (sentKeys.has(kind)) continue;
    sentKeys.add(kind);
    let seen = false;
    try {
      seen = Boolean(await d.hasMarker(kind));
    } catch (err) {
      console.warn('[package-usage] marker read failed:', err?.message || err);
    }
    if (seen) continue;

    const isCovered = pct === 80 && top >= 100;
    let ok = true;
    if (!isCovered) {
      const { subject, body } = noticeText({ ...usage, pct });
      const res = await d.send({ kind: 'platform_ops_package', subject, body });
      ok = Boolean(res?.ok);
      if (ok) sent.push(pct);
      else {
        sentKeys.delete(kind); // retry on a later call
        console.warn(
          `[package-usage] ${pct}% notice not sent tenant=${usage.tenantId} reason=${res?.reason || 'unknown'}`
        );
      }
    }
    if (ok) {
      try {
        await d.putMarker(kind, `${pct}% of ${usage.minutesIncluded} included minutes`);
      } catch (err) {
        console.warn('[package-usage] marker write failed:', err?.message || err);
      }
    }
  }
  return { sent, skipped: null };
}

function defaultDepsLazy(deps) {
  if (deps && deps.hasMarker && deps.putMarker && deps.send) return {};
  return defaultDeps();
}

/** Tests only. */
function resetPackageUsageAlerts() {
  sentKeys.clear();
}

module.exports = {
  maybeAlertPackageUsage,
  markerKind,
  periodKey,
  noticeText,
  resetPackageUsageAlerts,
};
