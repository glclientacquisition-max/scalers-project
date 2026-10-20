const { dispatchAlert } = require("../notifications/dispatch");
const { effectivePaymentEnv } = require("./billingRuntimeSettingsDb");

function noticesSendEnabled(env = process.env) {
  const raw = env && env !== process.env
    ? env.BILLING_NOTICES_SEND
    : process.env.BILLING_NOTICES_SEND;
  return String(raw || "").trim().toLowerCase() === "on";
}

function ledgerAlreadySent(result) {
  if (!result || typeof result !== "object") return false;
  const reason = String(result.reason || "");
  return reason === "instance_already_sent" || reason === "already_sent";
}

/**
 * Claims billing_notices and sends them on the existing notify path.
 * Does nothing unless BILLING_NOTICES_SEND=on. Kinds that start with
 * platform_ are platform billed, so they do not burn message credits.
 *
 * ledger.keyBase is the notice idempotency_key. That key does not change
 * when a stale sending row is claimed again, so the notify ledger blocks
 * a second send. A replay that finds the send already on the ledger
 * settles the notice sent.
 *
 * @param {{ claim: Function, settle: Function, dispatch?: Function, env?: NodeJS.ProcessEnv }} input
 */
async function sendClaimedBillingNotices(input) {
  const base = input.env || process.env;
  let env = base;
  if (!input.skipRuntimeOverlay) {
    try {
      const { supabase } = require("../lib/supabaseClient");
      env = await effectivePaymentEnv(base, supabase);
    } catch {
      env = base;
    }
  }
  if (!noticesSendEnabled(env)) {
    return { sent: 0, skipped: true, reason: "BILLING_NOTICES_SEND is off" };
  }
  const dispatch = input.dispatch || dispatchAlert;
  const rows = await input.claim();
  let sent = 0;
  for (const row of rows || []) {
    const email = row.channel === "email" ? row.recipient : row.fallback && row.fallback.email;
    const phone = row.channel === "email" ? undefined : row.recipient;
    try {
      const result = await dispatch({
        to: phone,
        email,
        body: row.body,
        subject: row.title,
        kind: row.kind,
        ledger: {
          tenantId: row.tenant_id,
          kind: row.kind,
          keyBase: row.idempotency_key,
        },
      });
      const ok = Boolean(result && result.channel) || ledgerAlreadySent(result);
      await input.settle(
        row.id,
        ok ? "sent" : "failed",
        result && result.notifySendId,
        ok ? null : "not sent"
      );
      if (ok) sent += 1;
    } catch {
      await input.settle(row.id, "failed", null, "send failed");
    }
  }
  return { sent, skipped: false };
}

module.exports = { noticesSendEnabled, sendClaimedBillingNotices, ledgerAlreadySent };
