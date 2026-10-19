/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { toCents } = require("./money");
const { verifyBachsRequest } = require("./signature");

const KES_PAIRS = [
  ["charged_amount", "charged_currency"],
  ["presentment_amount", "presentment_currency"],
  ["local_amount", "local_currency"],
  ["amount_local", "local_currency"],
  ["source_amount", "source_currency"],
  ["amount", "currency"],
];

function feeOf(data) {
  const raw = data.processing_fee ?? data.fee ?? data.fees ?? data.fee_usd ?? null;
  const namedCurrency = data.processing_fee_currency || data.fee_currency || null;
  if (raw && typeof raw === "object") {
    return {
      amount: raw.amount ?? raw.processing_fee ?? null,
      currency: raw.currency || namedCurrency || (data.fee_usd != null ? "USD" : null),
    };
  }
  if (raw == null || raw === "") return { amount: null, currency: null };
  let currency = namedCurrency;
  if (!currency && data.fee_usd != null && data.processing_fee == null && data.fee == null && data.fees == null) {
    currency = "USD";
  }
  return { amount: raw, currency };
}

/**
 * Pull the KES charge, the USD settlement, and the fee when Bachs sends them.
 * A fee is recorded only when the payload includes one. We do not invent 3.5%.
 * @param {Record<string, unknown>} data
 */
function extractCharge(data) {
  const source = data || {};
  let kes = null;
  let other = null;
  for (const [amountKey, currencyKey] of KES_PAIRS) {
    if (source[amountKey] == null || source[currencyKey] == null || source[currencyKey] === "") continue;
    const currency = String(source[currencyKey]).trim().toUpperCase();
    const pair = { amount: source[amountKey], currency };
    if (currency === "KES" && !kes) kes = pair;
    else if (!other) other = pair;
  }

  let settledAmount = source.settlement_amount ?? source.settled_amount ?? null;
  let settledCurrency = source.settlement_currency ?? source.settled_currency ?? null;
  if (source.amount_usd != null && settledAmount == null) {
    settledAmount = source.amount_usd;
    settledCurrency = "USD";
  }
  if (kes && other && other.currency === "USD" && settledAmount == null) {
    settledAmount = other.amount;
    settledCurrency = "USD";
  }
  if (!kes && other && other.currency === "USD" && settledAmount == null) {
    settledAmount = other.amount;
    settledCurrency = "USD";
  }

  const fee = feeOf(source);
  return { kes, other, settledAmount, settledCurrency, feeAmount: fee.amount, feeCurrency: fee.currency };
}

function collectionOutcome(status) {
  const s = String(status || "").toLowerCase();
  if (s === "overpaid") return "overpaid";
  if (s === "succeeded" || s === "accepted" || s === "paid" || s === "complete" || s === "completed") return "paid";
  return null;
}

/**
 * collection.succeeded records SUCCEEDED, ACCEPTED, and OVERPAID.
 * OVERPAID still records the payment, and the reconciliation report flags it.
 * checkout.completed applies only when payment_status is paid.
 * @param {{ attempt: { amountKes: string }, charge: ReturnType<typeof extractCharge>, type: string, status?: unknown, paymentStatus?: unknown }} input
 * @returns {{ action: 'apply' | 'apply_overpaid' | 'issue' | 'wait' | 'ignore', reason?: string }}
 */
function decidePayment(input) {
  const type = input.type;
  const terminal = type === "collection.succeeded" || type === "collection.underpaid";
  if (type === "collection.underpaid") {
    const got = toCents(input.charge.kes && input.charge.kes.amount);
    if (got != null && got > 0n) return { action: "apply_partial" };
    return { action: "issue", reason: "underpaid" };
  }
  if (type !== "collection.succeeded" && type !== "checkout.completed") return { action: "ignore" };

  let overpaid = false;
  if (type === "checkout.completed") {
    if (String(input.paymentStatus || "").toLowerCase() !== "paid") return { action: "wait" };
  } else {
    const outcome = collectionOutcome(input.status);
    if (!outcome) return { action: "ignore" };
    overpaid = outcome === "overpaid";
  }

  const kes = input.charge.kes;
  if (!kes) {
    if (overpaid) return { action: "issue", reason: "overpaid" };
    if (terminal) return { action: "issue", reason: input.charge.other ? "currency" : "amount" };
    return { action: "wait" };
  }
  const got = toCents(kes.amount);
  const expected = toCents(input.attempt.amountKes);
  if (got == null || got <= 0n) {
    if (terminal || overpaid) return { action: "issue", reason: overpaid ? "overpaid" : "amount" };
    return { action: "wait" };
  }
  if (expected != null && got >= expected) {
    if (overpaid || got > expected) return { action: "apply_overpaid", reason: overpaid ? "overpaid" : "amount" };
    return { action: "apply" };
  }
  if (overpaid) return { action: "apply_partial" };
  if (terminal && got > 0n) return { action: "apply_partial", reason: "amount" };
  return { action: "wait" };
}

function firstText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** M-Pesa receipt when Bachs puts one on the collection. Absent on the sandbox payloads we have seen. */
function receiptOf(data) {
  const source = data || {};
  const details = source.payment_method_details && typeof source.payment_method_details === "object"
    ? source.payment_method_details
    : {};
  const bags = [details.mpesa, details.momo, details.momo_kes, details.mobile_money, details];
  const keys = ["mpesa_receipt", "mpesa_receipt_number", "receipt_number", "receipt", "trans_id", "transaction_id"];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const key of keys) {
      const found = firstText(bag[key]);
      if (found) return found;
    }
  }
  return firstText(source.mpesa_receipt) || firstText(source.mpesa_receipt_number) || firstText(source.receipt_number);
}

function chargeIdOf(data) {
  const source = data || {};
  const charge = source.charge && typeof source.charge === "object" ? source.charge : {};
  return (
    firstText(source.charge_id) ||
    firstText(source.chargeId) ||
    firstText(source.payment_id) ||
    firstText(source.paymentId) ||
    firstText(charge.payment_id) ||
    firstText(charge.charge_id) ||
    firstText(charge.id)
  );
}

/**
 * The collection id is the M-Pesa receipt, else the Bachs charge or payment id,
 * else the checkout id when that is all Bachs sent.
 * A receipt amount is that collection. Otherwise amount_paid, then the KES
 * charge, is the authoritative total for that id.
 * @param {Record<string, unknown>} data
 * @param {string | null} checkoutId
 */
function collectionReport(data, checkoutId) {
  const source = data || {};
  const receipt = receiptOf(source);
  const chargeId = chargeIdOf(source);
  const ref = receipt || chargeId || (checkoutId ? String(checkoutId) : null);
  const charge = extractCharge(source);
  let amount = null;
  if (receipt) {
    amount = charge.kes ? String(charge.kes.amount) : null;
  } else {
    const paid = source.amount_paid != null
      ? source.amount_paid
      : source.charge && typeof source.charge === "object"
        ? source.charge.amount_paid
        : null;
    if (paid != null && String(paid).trim() !== "") amount = String(paid);
    else if (charge.kes) amount = String(charge.kes.amount);
  }
  return { ref, amount, receipt, chargeId, cumulative: !receipt };
}

function minorUnits(amount) {
  const cents = toCents(amount);
  if (cents == null || cents < 0n) return null;
  if (cents > BigInt(2147483647)) return null;
  return Number(cents);
}

/**
 * Verify the signature, store the event once, and apply or issue the payment once.
 * A retry that already has a payment row does not apply again.
 * A retry whose first attempt stored the event and then failed still applies.
 * @param {{ rawBody: string, headers: Record<string, string | undefined>, secret: string, ledger: object, now?: number }} input
 */
async function handlePayWebhook(input) {
  if (!input.secret) return { status: 401, body: { ok: false, error: "invalid signature" } };
  if (!verifyBachsRequest({ rawBody: input.rawBody, headers: input.headers, secret: input.secret, now: input.now })) {
    return { status: 401, body: { ok: false, error: "invalid signature" } };
  }

  let payload;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid json" } };
  }
  const eventId = payload && payload.id;
  const type = payload && payload.type;
  if (!eventId || !type) return { status: 400, body: { ok: false, error: "missing event" } };

  const recorded = await input.ledger.recordEvent({
    provider: "bachs",
    eventKey: String(eventId),
    payload,
  });

  const data = (payload && payload.data) || {};
  const checkoutId = data.checkout_id || data.checkoutId || null;
  const attempt = checkoutId ? await input.ledger.findAttemptByCheckout(String(checkoutId)) : null;

  if (type === "checkout.expired") {
    if (attempt && attempt.status === "pending") {
      await input.ledger.markAttempt(attempt.id, { status: "cancelled", raw: payload });
    }
    return { status: 200, body: { ok: true, duplicate: recorded.attempts > 1 } };
  }
  if (type === "collection.failed") {
    if (attempt && attempt.status === "pending") {
      await input.ledger.markAttempt(attempt.id, { status: "failed", raw: payload });
    }
    return { status: 200, body: { ok: true, duplicate: recorded.attempts > 1 } };
  }

  if (!attempt) {
    return { status: 200, body: { ok: true, unmatched: true, duplicate: recorded.attempts > 1 } };
  }

  const charge = extractCharge(data);
  const report = collectionReport(data, checkoutId ? String(checkoutId) : null);
  const checkoutRef = checkoutId ? String(checkoutId) : null;
  const collectionRef = report.ref || checkoutRef;
  const decisionCharge = report.amount
    ? { ...charge, kes: { amount: report.amount, currency: "KES" } }
    : charge;
  const feeMinor = charge.feeAmount == null ? null : minorUnits(charge.feeAmount);
  const settledMinor = charge.settledAmount == null ? null : minorUnits(charge.settledAmount);
  const common = {
    provider: "bachs",
    providerRef: collectionRef,
    tenantId: attempt.tenantId,
    invoiceId: attempt.invoiceId,
    raw: payload,
    settledAmountMinor: settledMinor,
    settledCurrency: charge.settledCurrency || null,
    feeMinor,
    feeAmount: charge.feeAmount == null ? null : String(charge.feeAmount),
    feeCurrency: charge.feeCurrency || null,
    providerAmount: charge.kes ? String(charge.kes.amount) : charge.other ? String(charge.other.amount) : null,
    providerCurrency: charge.kes ? "KES" : charge.other ? charge.other.currency : null,
    attemptId: attempt.id,
  };

  const displaced =
    attempt.status === "cancelled" ||
    attempt.status === "superseded" ||
    ((attempt.status === "failed" || attempt.status === "pending_unattached") && attempt.livePart !== true);
  if (displaced) {
    const already = await input.ledger.findPaymentByRef("bachs", checkoutRef);
    if (already) {
      return { status: 200, body: { ok: true, duplicate: true, action: "apply" } };
    }
    const amountKes = decisionCharge.kes ? String(decisionCharge.kes.amount) : null;
    if (amountKes && toCents(amountKes) != null && toCents(amountKes) > 0n) {
      await input.ledger.recordIssue({
        ...common,
        providerRef: checkoutRef,
        amountKes,
        reason: "cancelled",
      });
      if (typeof input.ledger.creditCancelled === "function") {
        await input.ledger.creditCancelled({
          provider: "bachs",
          providerRef: checkoutRef,
          amountKes,
          tenantId: attempt.tenantId,
          invoiceId: attempt.invoiceId,
        });
      }
    }
    return { status: 200, body: { ok: true, action: "credit", reason: "cancelled" } };
  }

  const decision = decidePayment({
    attempt,
    charge: decisionCharge,
    type,
    status: data.status,
    paymentStatus: data.payment_status,
  });
  if (decision.action === "wait" || decision.action === "ignore") {
    return { status: 200, body: { ok: true, action: decision.action, duplicate: recorded.attempts > 1 } };
  }

  if (decision.action === "apply" || decision.action === "apply_overpaid" || decision.action === "apply_partial") {
    const received = decisionCharge.kes ? String(decisionCharge.kes.amount) : attempt.amountKes;
    try {
      const settled = await input.ledger.reconcileCollection({
        ...common,
        providerRef: collectionRef,
        checkoutId: checkoutRef,
        amountKes: received,
      });
      if (settled && settled.noop) {
        const action = decision.action === "apply_partial" ? "apply_partial" : "apply";
        return { status: 200, body: { ok: true, duplicate: true, action } };
      }
      const appliedCents = toCents(settled && settled.appliedKes) || 0n;
      const excessCents = toCents(settled && settled.excessKes) || 0n;
      await input.ledger.markAttempt(attempt.id, {
        status: "succeeded",
        providerAmount: common.providerAmount,
        providerCurrency: common.providerCurrency,
        feeAmount: common.feeAmount,
        feeCurrency: common.feeCurrency,
        raw: payload,
      });
      const body = { ok: true, action: "apply" };
      if (decision.action === "apply_overpaid") {
        body.overpaid = true;
      } else if (excessCents > 0n && appliedCents === 0n) {
        body.action = "credit";
        body.reason = "collection_excess";
      } else if (decision.action === "apply_partial") {
        body.action = "apply_partial";
      }
      return { status: 200, body };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invoice cannot be paid") || message.includes("draft invoices are not payable")) {
        await input.ledger.recordIssue({
          ...common,
          amountKes: received,
          reason: "invoice cannot be paid",
        });
        return { status: 200, body: { ok: true } };
      }
      throw err;
    }
  }

  const issueAmount = charge.kes ? String(charge.kes.amount) : null;
  await input.ledger.recordIssue({
    ...common,
    amountKes: issueAmount,
    reason: decision.reason || "mismatch",
  });
  await input.ledger.markAttempt(attempt.id, {
    status: "issue",
    providerAmount: common.providerAmount,
    providerCurrency: common.providerCurrency,
    feeAmount: common.feeAmount,
    feeCurrency: common.feeCurrency,
    raw: payload,
  });
  return { status: 200, body: { ok: true, action: "issue", reason: decision.reason } };
}

module.exports = {
  extractCharge,
  collectionReport,
  decidePayment,
  handlePayWebhook,
  minorUnits,
};
