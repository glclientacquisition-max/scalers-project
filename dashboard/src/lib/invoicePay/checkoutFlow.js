/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { nextPart, splitKes } = require("./money");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until the in-flight attempt has a checkout, or the row is no longer pending.
 * @param {object} ledger
 * @param {{ token: string, amountKes: string, partIndex: number, partCount: number }} attemptInput
 */
async function waitForAttached(ledger, attemptInput) {
  for (let i = 0; i < 40; i += 1) {
    await sleep(25);
    const again = await ledger.createAttempt(attemptInput);
    if (again.checkoutUrl && again.checkoutSessionId) return again;
    if (again.cancel) return again;
    if (!again.inFlight && !again.reused) return again;
  }
  const err = new Error("checkout is still starting");
  err.code = "in_flight";
  throw err;
}

/**
 * Start one hosted checkout for the next unpaid part.
 * The redirect does not mark the invoice paid.
 * A second click while the first session is still being created waits for it.
 * An expired session is cancelled before a new one is minted.
 * @param {{ token: string, origin: string, ledger: object, provider: { createCheckout: Function, cancelCheckout?: Function } }} input
 */
async function startInvoiceCheckout(input) {
  const lookup = await input.ledger.lookup(input.token);
  if (!lookup?.found || lookup.state !== "payable") {
    const err = new Error("not payable");
    err.code = "not_payable";
    throw err;
  }
  const next = nextPart(splitKes(lookup.totalKes), lookup.amountPaidKes);
  if (!next) {
    const err = new Error("nothing due");
    err.code = "nothing_due";
    throw err;
  }

  const attemptInput = {
    token: input.token,
    amountKes: next.amountKes,
    partIndex: next.index,
    partCount: next.count,
  };
  let attempt = await input.ledger.createAttempt(attemptInput);
  if (attempt.cancel) {
    if (typeof input.provider.cancelCheckout === "function" && attempt.checkoutSessionId) {
      try {
        await input.provider.cancelCheckout(attempt.checkoutSessionId);
      } catch {
        /* The attempt is already cancelled. A Bachs cancel failure must not open a second live row. */
      }
    }
    attempt = await input.ledger.createAttempt(attemptInput);
  }
  if (attempt.inFlight) {
    attempt = await waitForAttached(input.ledger, attemptInput);
    if (attempt.cancel) {
      if (typeof input.provider.cancelCheckout === "function" && attempt.checkoutSessionId) {
        try {
          await input.provider.cancelCheckout(attempt.checkoutSessionId);
        } catch {
          /* same as above */
        }
      }
      attempt = await input.ledger.createAttempt(attemptInput);
    }
  }
  if (attempt.reused && attempt.checkoutUrl && attempt.checkoutSessionId) {
    return {
      checkoutUrl: attempt.checkoutUrl,
      checkoutId: attempt.checkoutSessionId,
      reused: true,
    };
  }

  const returnId = attempt.returnId;
  if (!returnId) {
    const err = new Error("missing return id");
    err.code = "return_id";
    throw err;
  }
  const successUrl = `${input.origin}/pay/return/${encodeURIComponent(returnId)}?return=1`;
  const cancelUrl = `${input.origin}/pay/return/${encodeURIComponent(returnId)}`;
  const customer = {};
  if (lookup.ownerEmail) customer.email = lookup.ownerEmail;
  if (lookup.ownerName) customer.name = lookup.ownerName;
  if (lookup.ownerPhone) customer.phone_number = lookup.ownerPhone;
  let created;
  try {
    created = await input.provider.createCheckout({
      amountKes: next.amountKes,
      currency: "KES",
      reference: attempt.id,
      successUrl,
      cancelUrl,
      metadata: {
        invoice_id: lookup.invoiceId,
        attempt_id: attempt.id,
        part_index: String(next.index),
        part_count: String(next.count),
      },
      idempotencyKey: `pay-${attempt.id}`,
      paymentMethodTypes: ["MOMO_KES"],
      expiresInMinutes: 60,
      customer: Object.keys(customer).length ? customer : undefined,
    });
  } catch (err) {
    await input.ledger.markAttempt(attempt.id, { status: "failed" });
    throw err;
  }
  const minutes = 60;
  const expiresAt = created.expiresAt || new Date(Date.now() + minutes * 60 * 1000).toISOString();
  try {
    await input.ledger.attachCheckout(attempt.id, {
      checkoutId: created.checkoutId,
      checkoutUrl: created.checkoutUrl,
      expiresAt,
    });
  } catch (err) {
    await input.ledger.markAttempt(attempt.id, { status: "failed" });
    if (typeof input.provider.cancelCheckout === "function" && created.checkoutId) {
      try {
        await input.provider.cancelCheckout(created.checkoutId);
      } catch {
        /* The attempt is failed. Surface the attach error. */
      }
    }
    throw err;
  }
  return { checkoutUrl: created.checkoutUrl, checkoutId: created.checkoutId, reused: false, reference: attempt.id };
}

module.exports = { startInvoiceCheckout };
