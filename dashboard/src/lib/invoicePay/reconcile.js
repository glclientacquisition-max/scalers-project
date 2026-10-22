/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { PROD_REF, assertBachsAllowed, bachsMode } = require("./provider");

const DISAGREE = new Set(["status_disagreement", "provider_disagreement", "overpaid", "issue"]);

const PENDING_MS = 30 * 60 * 1000;

const SUCCESS = new Set(["succeeded", "paid", "complete", "completed", "success", "accepted", "overpaid"]);

/**
 * Report only. Does not change attempts, payments, or invoices.
 * @param {{ attempts: object[], invoices: object[], payments: object[], providerStatuses?: Record<string, string>, now?: number }} input
 */
function reconciliationReport(input) {
  const now = input.now ?? Date.now();
  const payments = input.payments || [];
  const invoices = input.invoices || [];
  const attempts = input.attempts || [];
  const credits = input.credits || [];
  const providerStatuses = input.providerStatuses || {};
  const rows = [];

  const paymentForCheckout = (checkoutId) => {
    if (!checkoutId) return null;
    return (
      payments.find((p) => p.providerRef === checkoutId || p.billRef === checkoutId) || null
    );
  };

  for (const attempt of attempts) {
    const created = new Date(attempt.createdAt).getTime();
    if (attempt.status === "pending" && Number.isFinite(created) && now - created > PENDING_MS) {
      rows.push({
        kind: "pending_timeout",
        attemptId: attempt.id,
        invoiceId: attempt.invoiceId,
        paymentId: null,
        detail: "Pending for more than 30 minutes",
      });
    }
    if (attempt.status === "succeeded" && attempt.checkoutSessionId && !paymentForCheckout(attempt.checkoutSessionId)) {
      rows.push({
        kind: "status_disagreement",
        attemptId: attempt.id,
        invoiceId: attempt.invoiceId,
        paymentId: null,
        detail: "Attempt succeeded with no payment",
      });
    }
    if (attempt.status === "pending" && attempt.checkoutSessionId) {
      const payment = paymentForCheckout(attempt.checkoutSessionId);
      if (payment) {
        rows.push({
          kind: "status_disagreement",
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          paymentId: payment.id,
          detail: "Payment recorded while the attempt is still pending",
        });
      }
    }
    if (attempt.status === "issue") {
      rows.push({
        kind: "issue",
        attemptId: attempt.id,
        invoiceId: attempt.invoiceId,
        paymentId: paymentForCheckout(attempt.checkoutSessionId)?.id || null,
        detail: "Payment needs a check",
      });
    }
    const providerStatus = attempt.checkoutSessionId ? providerStatuses[attempt.checkoutSessionId] : null;
    if (providerStatus) {
      const normalized = String(providerStatus).toLowerCase();
      const providerPaid = SUCCESS.has(normalized);
      const localPaid = attempt.status === "succeeded";
      if (providerPaid !== localPaid && attempt.status !== "issue") {
        rows.push({
          kind: "provider_disagreement",
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          paymentId: null,
          detail: `Provider payment status ${providerStatus} does not match ${attempt.status}`,
        });
      }
      if (normalized === "overpaid") {
        rows.push({
          kind: "overpaid",
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          paymentId: paymentForCheckout(attempt.checkoutSessionId)?.id || null,
          detail: "Payer sent more than the checkout",
        });
      }
    }
    if (
      attempt.status === "cancelled" ||
      attempt.status === "superseded" ||
      attempt.status === "failed" ||
      attempt.status === "pending_unattached"
    ) {
      const cancelledPayment = paymentForCheckout(attempt.checkoutSessionId);
      const credited = credits.some(
        (credit) =>
          credit.providerRef === attempt.checkoutSessionId ||
          credit.idempotencyKey === `cancelled:bachs:${attempt.checkoutSessionId}`
      );
      if (credited) {
        rows.push({
          kind: "credited_cancelled",
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          paymentId: cancelledPayment ? cancelledPayment.id : null,
          detail: "Collected on a cancelled checkout and credited",
        });
      } else if (cancelledPayment && cancelledPayment.matchStatus === "issue") {
        rows.push({
          kind: "status_disagreement",
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          paymentId: cancelledPayment.id,
          detail: "Collected on a cancelled checkout with no credit",
        });
      }
    }
    const payment = paymentForCheckout(attempt.checkoutSessionId);
    const rawStatus = payment && payment.raw && payment.raw.data && payment.raw.data.status;
    if (String(rawStatus || "").toLowerCase() === "overpaid" && !rows.some((row) => row.kind === "overpaid" && row.attemptId === attempt.id)) {
      rows.push({
        kind: "overpaid",
        attemptId: attempt.id,
        invoiceId: attempt.invoiceId,
        paymentId: payment.id,
        detail: "Payer sent more than the checkout",
      });
    }
  }

  for (const invoice of invoices) {
    const matched = payments.some(
      (p) => p.invoiceId === invoice.id && ["matched", "partial", "over"].includes(p.matchStatus)
    );
    const zeroCredit = credits.some((credit) => credit.idempotencyKey === `invoice-credit:${invoice.id}`);
    if (invoice.status === "paid" && !matched && !zeroCredit && Number(invoice.totalKes) > 0) {
      rows.push({
        kind: "status_disagreement",
        attemptId: null,
        invoiceId: invoice.id,
        paymentId: null,
        detail: "Invoice paid without a matched payment",
      });
    }
    const total = Number(invoice.totalKes);
    const paid = Number(invoice.amountPaidKes);
    if (invoice.status === "open" && total > 0 && paid >= total) {
      rows.push({
        kind: "status_disagreement",
        attemptId: null,
        invoiceId: invoice.id,
        paymentId: null,
        detail: "Invoice open but the amount paid covers the total",
      });
    }
  }

  return rows;
}

/**
 * True only for sandbox, or live when the Bachs gate allows a request.
 * Off, mock, and a closed live gate do not call Bachs.
 * @param {NodeJS.ProcessEnv} [env]
 */
function bachsReadsAllowed(env) {
  let mode;
  try {
    mode = bachsMode(env);
  } catch {
    return false;
  }
  if (mode !== "sandbox" && mode !== "live") return false;
  try {
    assertBachsAllowed(env);
    return true;
  } catch {
    return false;
  }
}

function remoteLabel(row, remote) {
  if (remote == null) return "missing_bachs";
  const status = String(remote.paymentStatus || "").toLowerCase();
  const remotePaid = SUCCESS.has(status);
  const localPaid = row.localStatus === "succeeded" || row.hasPayment === true;
  if (remotePaid && localPaid) return "matched";
  if (remotePaid && !localPaid) return "missing_ours";
  if (!remotePaid && localPaid) return "mismatch";
  return null;
}

/**
 * Report counts. remotes null means Bachs was not called, so only local
 * disagreements count as mismatch.
 * @param {{ rows?: object[], remotes?: Record<string, object | null> | null }} [input]
 */
function reconciliationCounts(input = {}) {
  const counts = { matched: 0, mismatch: 0, missing_ours: 0, missing_bachs: 0 };
  const remotes = input.remotes;
  for (const row of input.rows || []) {
    const checkoutId = row && row.checkoutId;
    if (remotes && checkoutId && Object.prototype.hasOwnProperty.call(remotes, checkoutId)) {
      const label = remoteLabel(row, remotes[checkoutId]);
      if (label) counts[label] += 1;
      continue;
    }
    if (row && DISAGREE.has(row.kind)) counts.mismatch += 1;
  }
  return counts;
}

/**
 * Report only. listRows is billing_payment_reconciliation. getCheckout is
 * called only when BACHS_MODE is sandbox or an allowed live mode.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   listRows: () => Promise<object[]>,
 *   loadAttempts?: (ids: string[]) => Promise<object[]>,
 *   getCheckout?: (checkoutId: string) => Promise<object | null>,
 * }} input
 */
async function billingReconcileReport(input) {
  const sqlRows = (await input.listRows()) || [];
  if (!bachsReadsAllowed(input.env)) {
    return reconciliationCounts({ rows: sqlRows, remotes: null });
  }
  const ids = [...new Set(sqlRows.map((row) => row.attemptId).filter(Boolean))];
  const attempts = ids.length && input.loadAttempts ? await input.loadAttempts(ids) : [];
  const byId = new Map((attempts || []).map((row) => [row.id, row]));
  /** @type {Record<string, object | null>} */
  const remotes = {};
  const rows = [];
  for (const row of sqlRows) {
    const attempt = row.attemptId ? byId.get(row.attemptId) : null;
    const checkoutId = attempt && attempt.checkoutSessionId;
    if (!checkoutId || typeof input.getCheckout !== "function") {
      rows.push(row);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(remotes, checkoutId)) {
      try {
        remotes[checkoutId] = await input.getCheckout(checkoutId);
      } catch {
        rows.push(row);
        continue;
      }
    }
    rows.push({
      ...row,
      checkoutId,
      localStatus: attempt.status,
      hasPayment: Boolean(row.paymentId) || attempt.status === "succeeded",
    });
  }
  return reconciliationCounts({ rows, remotes });
}

function assertNotProductionUrl(url) {
  if (String(url || "").includes(PROD_REF)) {
    const err = new Error("refusing production database");
    err.code = "prod_refused";
    throw err;
  }
}

module.exports = {
  PENDING_MS,
  reconciliationReport,
  reconciliationCounts,
  bachsReadsAllowed,
  billingReconcileReport,
  assertNotProductionUrl,
};
