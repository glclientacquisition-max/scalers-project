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
        await assertLiveTenant(attempt.tenantId, env, input.readLiveTenant);
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

/**
 * Live mode reads open checkouts and applies charge.amount_paid as the
 * running total. A business that is not allowlisted is skipped. Sandbox and
 * off do not sweep here. An unreadable read is skipped. A second run of the
 * same total does nothing.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   listAttempts: () => Promise<Array<{ tenantId: string, invoiceId: string, checkoutId: string }>>,
 *   getCheckout: (checkoutId: string) => Promise<object | null>,
 *   settleTotal: (input: object) => Promise<{ noop?: boolean }>,
 *   readLiveTenant?: (tenantId: string, env: NodeJS.ProcessEnv) => Promise<boolean>,
 * }} input
 */
async function sweepOpenCheckouts(input) {
  const env = input.env || process.env;
  if (bachsMode(env) !== "live") return { ok: true, rows: [] };
  assertBachsAllowed(env);
  const attempts = await input.listAttempts();
  const rows = [];
  for (const attempt of attempts || []) {
    const checkoutId = attempt && attempt.checkoutId ? String(attempt.checkoutId) : "";
    if (!checkoutId || !attempt.tenantId || !attempt.invoiceId) continue;
    try {
      await assertLiveTenant(attempt.tenantId, env, input.readLiveTenant);
    } catch (err) {
      if (err && err.code === "bachs_live_refused") {
        rows.push({ kind: "sweep_skipped", detail: checkoutId, reason: "live_not_allowlisted" });
        continue;
      }
      throw err;
    }
    let remote;
    try {
      remote = await input.getCheckout(checkoutId);
    } catch {
      rows.push({ kind: "sweep_unreadable", detail: checkoutId });
      continue;
    }
    const collected = collectedFromCheckout(remote);
    if (!collected || collected.unreadable || collected.currencyIssue || collected.cents == null || collected.cents <= 0n) {
      rows.push({ kind: "sweep_unread", detail: checkoutId });
      continue;
    }
    try {
      const settled = await input.settleTotal({
        provider: "bachs",
        checkoutId,
        totalKes: collected.totalKes || "0",
        tenantId: attempt.tenantId,
        invoiceId: attempt.invoiceId,
        raw: {},
      });
      rows.push({
        kind: "sweep_settled",
        detail: checkoutId,
        noop: Boolean(settled && settled.noop),
      });
    } catch {
      rows.push({ kind: "sweep_failed", detail: checkoutId });
    }
  }
  return { ok: true, rows };
}

module.exports = { retryStoredReads, sweepOpenCheckouts };
