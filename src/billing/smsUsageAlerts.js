// Ops notice when a tenant reaches 80% and 100% of its included package SMS.
// Mirrors packageUsageAlerts.js (#631 minute notices): ops email only,
// one notice per tenant, threshold and package period.
//
// Dedupe (same as minutes):
// - In-memory Set stops repeats inside one Voice process.
// - Durable marker: a `platform_ops_notices` row with status 'resolved' and
//   kind `package_sms_<pct>:<tenantId>:<periodKey>`. Desk only lists
//   open/acked notices, so these markers never show on the Admin board.
//
// Unlike minutes, SMS notices also go out for enforced tenants: with
// on-demand off their tenant SMS stop at the allowance and staff alerts fall
// back to WhatsApp/email, which ops need to know. The owner-facing warning is
// the Desk banner (tenant_billing_state), not this module.
//
// Trigger: after every tenant-billed SMS reservation in Voice
// (sendLedger.sendReserved -> db.checkSmsUsageAlertsForTenant). A refused
// reservation (allowance used up) also checks, so 100% is never missed.

const { isEnforced } = require('./packageOverage');
const { periodKey } = require('./packageUsageAlerts');

/** @type {Set<string>} */
const sentKeys = new Set();

/** 0, 80 or 100. No included SMS (no package) -> 0: nothing to warn about. */
function smsUsageThreshold({ smsIncluded = 0, smsUsed = 0 } = {}) {
  const included = Math.max(0, Math.round(Number(smsIncluded) || 0));
  if (included <= 0) return 0;
  const used = Math.max(0, Math.round(Number(smsUsed) || 0));
  if (used >= included) return 100;
  if (used * 100 >= included * 80) return 80;
  return 0;
}

function markerKind(pct, tenantId, period) {
  return `package_sms_${pct}:${tenantId}:${period}`;
}

function noticeText({ pct, businessName, smsIncluded, smsUsed, enforcement, onDemand }) {
  const who = String(businessName || 'A business').trim();
  const used = Math.max(0, Math.round(Number(smsUsed) || 0));
  const subject =
    pct >= 100
      ? `Scalers ops: ${who} used all package SMS`
      : `Scalers ops: ${who} at ${pct}% of package SMS`;
  let effect;
  if (!isEnforced(enforcement)) {
    effect = 'Billing is in beta (enforcement off), so texts keep going out and are counted. Nothing is charged.';
  } else if (onDemand) {
    effect = 'On-demand is on, so texts past the allowance keep going out and are billed at the on-demand SMS rate.';
  } else {
    effect = 'On-demand is off, so business texts stop at the allowance and staff alerts fall back to WhatsApp or email.';
  }
  const lines = [
    `${who} has used ${used} of ${smsIncluded} included SMS (${pct}%).`,
    effect,
    pct >= 100
      ? 'Decide in Super Admin > Businesses: move to a bigger package, turn on on-demand, or leave as is.'
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

function defaultDepsLazy(deps) {
  if (deps && deps.hasMarker && deps.putMarker && deps.send) return {};
  return defaultDeps();
}

/**
 * @param {{ tenantId: string, businessName?: string|null, smsIncluded?: number,
 *   smsUsed?: number, enforcement?: string|null, onDemand?: boolean,
 *   periodStart?: string|null }} usage
 * @param {{ hasMarker?: Function, putMarker?: Function, send?: Function }} [deps]
 * @returns {Promise<{ sent: number[], skipped: string|null }>}
 */
async function maybeAlertSmsUsage(usage, deps) {
  if (!usage?.tenantId) return { sent: [], skipped: 'no_tenant' };
  const top = smsUsageThreshold(usage);
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
      console.warn('[sms-usage] marker read failed:', err?.message || err);
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
        sentKeys.delete(kind); // retry on a later send
        console.warn(
          `[sms-usage] ${pct}% notice not sent tenant=${usage.tenantId} reason=${res?.reason || 'unknown'}`
        );
      }
    }
    if (ok) {
      try {
        await d.putMarker(kind, `${pct}% of ${usage.smsIncluded} included SMS`);
      } catch (err) {
        console.warn('[sms-usage] marker write failed:', err?.message || err);
      }
    }
  }
  return { sent, skipped: null };
}

/** Tests only. */
function resetSmsUsageAlerts() {
  sentKeys.clear();
}

module.exports = {
  maybeAlertSmsUsage,
  smsUsageThreshold,
  markerKind,
  noticeText,
  resetSmsUsageAlerts,
};
