/* eslint-disable @typescript-eslint/no-require-imports -- node:test and the reconcile script load this with require() */
const { collectedFromCheckout, collectionIdentity, eventAmountKes } = require("./webhook");
const { assertBachsAllowed, assertLiveTenant, bachsMode } = require("./provider");

/**
 * Retry stored unreadable checkout reads. Does not sweep open attempts.
 * In live mode the Bachs gate and the tenant allowlist both apply.
 * A readable total is settled once. The retry flag is cleared only after
 * that settle. An unreadable read stays stored for the next run.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   listEvents: () => Promise<Array<{ eventKey: string, payload?: object }>>,
 *   clearRetry: (eventKey: string) => Promise<void>,
 *   findAttempt: (checkoutId: string) => Promise<{ tenantId: string, invoiceId: string } | null>,
 *   getCheckout: (checkoutId: string) => Promise<object | null>,
 *   settle: (input: object) => Promise<{ review?: boolean, noop?: boolean }>,
 * }} input
 */
async function retryStoredReads(input) {
  const env = input.env || process.env;
  const live = bachsMode(env) === "live";
  if (live) assertBachsAllowed(env);

  const events = await input.listEvents();
  const rows = [];
  for (const event of events || []) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const checkoutId = data.checkout_id || data.checkoutId || null;
    if (!checkoutId || !event.eventKey) continue;
    const attempt = await input.findAttempt(String(checkoutId));
    if (!attempt) continue;
    if (live) {
      try {
        assertLiveTenant(attempt.tenantId, env);
      } catch (err) {
        if (err && err.code === "bachs_live_refused") {
          rows.push({ kind: "retry_skipped", detail: String(checkoutId), reason: "live_not_allowlisted" });
          continue;
        }
        throw err;
      }
    }
    let remote;
    try {
      remote = await input.getCheckout(String(checkoutId));
    } catch {
      rows.push({ kind: "retry_unreadable", detail: String(checkoutId) });
      continue;
    }
    const collected = collectedFromCheckout(remote);
    if (!collected || collected.unreadable || collected.currencyIssue || collected.cents == null) {
      rows.push({ kind: "retry_unreadable", detail: String(checkoutId) });
      continue;
    }
    const settled = await input.settle({
      provider: "bachs",
      checkoutId: String(checkoutId),
      totalKes: collected.totalKes || "0",
      tenantId: attempt.tenantId,
      invoiceId: attempt.invoiceId,
      identity: collectionIdentity(data, String(checkoutId)),
      eventAmountKes: eventAmountKes(data),
      raw: payload,
      settledAmountMinor: null,
      settledCurrency: null,
      feeMinor: null,
    });
    await input.clearRetry(event.eventKey);
    rows.push({
      kind: settled && settled.review ? "retry_review" : "retry_settled",
      detail: String(checkoutId),
      noop: Boolean(settled && settled.noop),
    });
  }
  return { ok: true, rows };
}

module.exports = { retryStoredReads };
