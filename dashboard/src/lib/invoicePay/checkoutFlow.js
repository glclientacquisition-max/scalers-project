/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { nextPart, splitKes } = require("./money");

/**
 * Start one hosted checkout for the next unpaid part.
 * The redirect does not mark the invoice paid.
 * @param {{ token: string, origin: string, ledger: object, provider: { createCheckout: Function } }} input
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

  const attempt = await input.ledger.createAttempt({
    token: input.token,
    amountKes: next.amountKes,
    partIndex: next.index,
    partCount: next.count,
  });
  if (attempt.checkoutUrl && attempt.checkoutSessionId) {
    return {
      checkoutUrl: attempt.checkoutUrl,
      checkoutId: attempt.checkoutSessionId,
      reused: true,
    };
  }

  const successUrl = `${input.origin}/pay/${encodeURIComponent(input.token)}?return=1`;
  const cancelUrl = `${input.origin}/pay/${encodeURIComponent(input.token)}`;
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
    });
  } catch (err) {
    await input.ledger.markAttempt(attempt.id, { status: "failed" });
    throw err;
  }
  await input.ledger.attachCheckout(attempt.id, {
    checkoutId: created.checkoutId,
    checkoutUrl: created.checkoutUrl,
  });
  return { checkoutUrl: created.checkoutUrl, checkoutId: created.checkoutId, reused: false };
}

module.exports = { startInvoiceCheckout };
