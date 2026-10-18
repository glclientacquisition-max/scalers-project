const { dispatchAlert } = require("../notifications/dispatch");

function noticesSendEnabled(env = process.env) {
  const raw = env === process.env ? process.env.BILLING_NOTICES_SEND : env.BILLING_NOTICES_SEND;
  return String(raw || "").trim().toLowerCase() === "on";
}

/**
 * Claims billing_notices and sends them on the existing notify path.
 * Does nothing unless BILLING_NOTICES_SEND=on. Kinds that start with
 * platform_ are platform billed, so they do not burn message credits.
 *
 * @param {{ claim: Function, settle: Function, dispatch?: Function, env?: NodeJS.ProcessEnv }} input
 */
async function sendClaimedBillingNotices(input) {
  if (!noticesSendEnabled(input.env)) {
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
        ledger: { tenantId: row.tenant_id, kind: row.kind },
      });
      const ok = Boolean(result && result.channel);
      await input.settle(row.id, ok ? "sent" : "failed", result && result.notifySendId, ok ? null : "not sent");
      if (ok) sent += 1;
    } catch {
      await input.settle(row.id, "failed", null, "send failed");
    }
  }
  return { sent, skipped: false };
}

module.exports = { noticesSendEnabled, sendClaimedBillingNotices };
