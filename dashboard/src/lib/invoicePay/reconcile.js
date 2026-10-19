/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { PROD_REF } = require("./provider");

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
  assertNotProductionUrl,
};
