/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { toCents } = require("./money");
const { verifyBachsRequest } = require("./signature");
const { assertLiveTenant, MockPayProvider } = require("./provider");

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
/**
 * A receipt, or a charge id, is what the event named.
 * `ch_<checkout id>` is the placeholder Bachs sends when it has no id of
 * its own. It is returned as-is. Settle treats it as no real collection
 * and does not drop it.
 * @param {Record<string, unknown>} data
 * @param {string | null} checkoutId
 * @returns {string | null}
 */
function collectionIdentity(data, checkoutId) {
  const receipt = receiptOf(data);
  if (receipt) return receipt;
  const chargeId = chargeIdOf(data);
  if (!chargeId) return null;
  if (checkoutId && chargeId === `ch_${checkoutId}`) return chargeId;
  return chargeId;
}

/**
 * The collection's own KES amount. `amount_paid` is the running GET total
 * and is not this amount.
 * @param {Record<string, unknown>} data
 * @returns {string | null}
 */
function eventAmountKes(data) {
  const charge = extractCharge(data || {});
  if (!charge.kes || charge.kes.amount == null || String(charge.kes.amount).trim() === "") return null;
  return String(charge.kes.amount);
}

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
 * Bachs GET checkout is the collected total. `charge.amount_paid` is "paid so far".
 * The session `amount` is the price, not what was collected. A null charge on a
 * successful read means nothing has been collected. A missing `amount_paid`, a
 * thrown read, or a 404 is unreadable: do not guess from the webhook body.
 * @param {object | null} row
 */
function collectedFromCheckout(row) {
  if (!row || typeof row !== "object") return { unreadable: true };
  const charge = row.charge;
  if (!charge || typeof charge !== "object") return { totalKes: "0", cents: 0n };
  const paid = charge.amount_paid;
  if (paid == null || String(paid).trim() === "") return { unreadable: true };
  const currency = String(charge.currency || "KES").trim().toUpperCase();
  if (currency !== "KES") return { currencyIssue: true, currency, amount: String(paid) };
  const cents = toCents(String(paid));
  if (cents == null || cents < 0n) return { unreadable: true };
  return { totalKes: String(paid), cents };
}

/**
 * Total to pass when staff chose book. Live mode uses a fresh GET.
 * A closed gate, or any mode that is not live, books the stored reading.
 * An unreadable fresh read, or a total below the stored reading, does not book.
 * @param {{ live: boolean, storedKes: string | number, fresh?: { unreadable?: boolean, currencyIssue?: boolean, totalKes?: string, cents?: bigint } }} input
 */
function bookTotalForResolve(input) {
  const storedKes = input.storedKes == null || String(input.storedKes).trim() === "" ? "0" : String(input.storedKes);
  if (!input.live) return { ok: true, totalKes: storedKes };
  const fresh = input.fresh;
  if (!fresh || fresh.unreadable || fresh.currencyIssue) {
    return { ok: false, error: "Couldn't read the collected amount. Nothing changed." };
  }
  const storedCents = toCents(storedKes);
  const freshCents = fresh.cents != null ? fresh.cents : toCents(fresh.totalKes);
  if (storedCents == null || freshCents == null || freshCents < 0n) {
    return { ok: false, error: "Couldn't read the collected amount. Nothing changed." };
  }
  if (freshCents < storedCents) {
    return { ok: false, error: "The collected amount is lower than the reading. Nothing changed." };
  }
  const totalKes = fresh.totalKes == null || String(fresh.totalKes).trim() === "" ? storedKes : String(fresh.totalKes);
  return { ok: true, totalKes };
}

function readerFor(input) {
  if (input.provider && typeof input.provider.getCheckout === "function") return input.provider;
  if (!MockPayProvider.sessions) return null;
  return {
    async getCheckout(checkoutId) {
      const row = MockPayProvider.sessions.get(checkoutId);
      if (!row) return null;
      if (row.unreadable) throw new Error("bachs checkout read failed");
      return {
        checkoutId: row.checkoutId,
        status: row.status || "",
        paymentStatus: row.paymentStatus || "",
        charge: row.charge || null,
      };
    },
  };
}

async function readCollected(input, checkoutId) {
  const provider = readerFor(input);
  if (!provider) return { unreadable: true };
  let row;
  try {
    row = await provider.getCheckout(checkoutId);
  } catch {
    return { unreadable: true };
  }
  if (!row) return { unreadable: true };
  return collectedFromCheckout(row);
}

function displacedAttempt(attempt) {
  return (
    attempt.status === "cancelled" ||
    attempt.status === "superseded" ||
    ((attempt.status === "failed" || attempt.status === "pending_unattached") && attempt.livePart !== true)
  );
}

/**
 * The webhook is a trigger. Money comes from getCheckout's cumulative
 * `charge.amount_paid` for this checkout, never from summing event ids.
 * An unreadable Bachs read stores the event and leaves the invoice alone.
 * @param {{ rawBody: string, headers: Record<string, string | undefined>, secret: string, ledger: object, provider?: { getCheckout?: Function }, env?: NodeJS.ProcessEnv, now?: number }} input
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
  const duplicateEvent = recorded.attempts > 1;

  const data = (payload && payload.data) || {};
  const checkoutId = data.checkout_id || data.checkoutId || null;
  const attempt = checkoutId ? await input.ledger.findAttemptByCheckout(String(checkoutId)) : null;
  if (!attempt || !checkoutId) {
    return { status: 200, body: { ok: true, unmatched: true, duplicate: duplicateEvent } };
  }

  const checkoutRef = String(checkoutId);
  const collected = await readCollected(input, checkoutRef);
  if (collected.unreadable) {
    if (typeof input.ledger.markPaymentEventRetry === "function") {
      await input.ledger.markPaymentEventRetry({ provider: "bachs", eventKey: String(eventId) });
    }
    return { status: 200, body: { ok: true, pending: true, action: "retry", duplicate: duplicateEvent } };
  }

  const charge = extractCharge(data);
  const feeMinor = charge.feeAmount == null ? null : minorUnits(charge.feeAmount);
  const settledMinor = charge.settledAmount == null ? null : minorUnits(charge.settledAmount);
  const common = {
    provider: "bachs",
    providerRef: checkoutRef,
    tenantId: attempt.tenantId,
    invoiceId: attempt.invoiceId,
    raw: payload,
    settledAmountMinor: settledMinor,
    settledCurrency: charge.settledCurrency || null,
    feeMinor,
    feeAmount: charge.feeAmount == null ? null : String(charge.feeAmount),
    feeCurrency: charge.feeCurrency || null,
    providerAmount: collected.totalKes || null,
    providerCurrency: collected.currencyIssue ? collected.currency : "KES",
    attemptId: attempt.id,
  };

  if (collected.currencyIssue) {
    await input.ledger.recordIssue({
      ...common,
      amountKes: null,
      reason: "currency",
    });
    if (!displacedAttempt(attempt)) {
      await input.ledger.markAttempt(attempt.id, {
        status: "issue",
        providerAmount: collected.amount,
        providerCurrency: collected.currency,
        raw: payload,
      });
    }
    return { status: 200, body: { ok: true, action: "issue", reason: "currency" } };
  }

  const totalKes = collected.totalKes || "0";
  const totalCents = collected.cents || 0n;

  if (totalCents === 0n) {
    const settle = input.ledger.settleCheckoutReading;
    if (typeof settle === "function") {
      const settled = await settle.call(input.ledger, {
        ...common,
        checkoutId: checkoutRef,
        totalKes,
        identity: collectionIdentity(data, checkoutRef),
        eventAmountKes: eventAmountKes(data),
      });
      if (settled && settled.review) {
        return {
          status: 200,
          body: {
            ok: true,
            action: "issue",
            reason: settled.reason || "collected_total_decreased",
            duplicate: settled.duplicate === true,
          },
        };
      }
    }
    if (type === "checkout.expired" && attempt.status === "pending") {
      await input.ledger.markAttempt(attempt.id, { status: "cancelled", raw: payload });
    } else if (type === "collection.failed" && attempt.status === "pending") {
      await input.ledger.markAttempt(attempt.id, { status: "failed", raw: payload });
    }
    return { status: 200, body: { ok: true, action: "wait", duplicate: duplicateEvent } };
  }

  try {
    assertLiveTenant(attempt.tenantId, input.env);
  } catch (err) {
    const code = err && err.code;
    if (code === "bachs_live_refused") {
      await input.ledger.recordIssue({
        ...common,
        amountKes: totalKes,
        reason: "live_not_allowlisted",
      });
      return { status: 200, body: { ok: true, action: "issue", reason: "live_not_allowlisted" } };
    }
    throw err;
  }

  try {
    const settle = input.ledger.settleCheckoutReading || input.ledger.reconcileCheckoutTotal;
    const settled = await settle.call(input.ledger, {
      ...common,
      checkoutId: checkoutRef,
      totalKes,
      identity: collectionIdentity(data, checkoutRef),
      eventAmountKes: eventAmountKes(data),
    });
    if (settled && settled.review) {
      return {
        status: 200,
        body: {
          ok: true,
          action: "issue",
          reason: settled.reason || "collected_total_short",
          duplicate: settled.duplicate === true,
        },
      };
    }
    if (settled && settled.noop) {
      return { status: 200, body: { ok: true, duplicate: true, action: "apply" } };
    }
    const appliedCents = toCents(settled && settled.appliedKes) || 0n;
    const excessCents = toCents(settled && settled.excessKes) || 0n;
    if (!displacedAttempt(attempt)) {
      await input.ledger.markAttempt(attempt.id, {
        status: "succeeded",
        providerAmount: totalKes,
        providerCurrency: "KES",
        feeAmount: common.feeAmount,
        feeCurrency: common.feeCurrency,
        raw: payload,
      });
    }
    const body = { ok: true, action: "apply" };
    const partCents = toCents(attempt.amountKes);
    const coversPart = partCents == null || totalCents >= partCents;
    if (excessCents > 0n && appliedCents === 0n) {
      body.action = "credit";
      body.reason = "collection_excess";
    } else if (excessCents === 0n && appliedCents > 0n && !coversPart) {
      body.action = "apply_partial";
    }
    if (excessCents > 0n || String(data.status || "").toLowerCase() === "overpaid") {
      body.overpaid = true;
    }
    return { status: 200, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("invoice cannot be paid") || message.includes("draft invoices are not payable")) {
      await input.ledger.recordIssue({
        ...common,
        amountKes: totalKes,
        reason: "invoice cannot be paid",
      });
      return { status: 200, body: { ok: true } };
    }
    throw err;
  }
}

module.exports = {
  extractCharge,
  collectionIdentity,
  eventAmountKes,
  collectionReport,
  collectedFromCheckout,
  bookTotalForResolve,
  decidePayment,
  handlePayWebhook,
  minorUnits,
};
