/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { nextPart, splitKes } = require("./money");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A parked or held session is resumed here. The waiter must not hand it back
 * as a finished row, because the caller would open another checkout.
 * @param {object} input
 * @param {object} attempt
 * @param {object} attemptInput
 */
async function settleLiveSession(input, attempt, attemptInput) {
  if (attempt.held) return resumeHeld(input, attempt, attemptInput);
  return resumeUnattached(input, attempt, attemptInput);
}

/**
 * Poll until the in-flight attempt has a checkout, or the row is no longer pending.
 * A pending_unattached or held row is resumed or blocked. It is not created again.
 * @param {object} input
 * @param {{ token: string, amountKes: string, partIndex: number, partCount: number }} attemptInput
 */
async function waitForAttached(input, attemptInput) {
  for (let i = 0; i < 40; i += 1) {
    await sleep(25);
    const again = await input.ledger.createAttempt(attemptInput);
    if (again.unattached || again.held) return settleLiveSession(input, again, attemptInput);
    if (again.checkoutUrl && again.checkoutSessionId) return again;
    if (again.cancel) return again;
    if (!again.inFlight && !again.reused) return again;
  }
  const err = new Error("checkout is still starting");
  err.code = "in_flight";
  throw err;
}

const CLOSED_CHECKOUT = new Set([
  "cancelled",
  "canceled",
  "expired",
  "complete",
  "completed",
  "failed",
  "succeeded",
  "paid",
]);

function checkoutIsOpen(row) {
  if (!row) return false;
  const status = String(row.status || "").toLowerCase();
  const pay = String(row.paymentStatus || row.payment_status || "").toLowerCase();
  if (CLOSED_CHECKOUT.has(status) || CLOSED_CHECKOUT.has(pay)) return false;
  return true;
}

function stillProcessing() {
  const err = new Error("previous payment still processing");
  err.code = "previous_processing";
  return err;
}

/**
 * @param {{ provider: { getCheckout?: Function } }} input
 * @param {string | null} sessionId
 */
async function readCheckout(input, sessionId) {
  if (!sessionId || typeof input.provider.getCheckout !== "function") {
    return { readable: false, row: null };
  }
  try {
    return { readable: true, row: await input.provider.getCheckout(sessionId) };
  } catch {
    return { readable: false, row: null };
  }
}

/**
 * A session we can still pay is reused when we have its URL. Otherwise the
 * caller is blocked and no second attempt is inserted.
 * @param {object} attempt
 * @param {string} sessionId
 * @param {{ readable: boolean, row: object | null }} read
 */
function reuseOrBlock(attempt, sessionId, read) {
  if (read.readable && checkoutIsOpen(read.row) && attempt.checkoutUrl) {
    return {
      kept: true,
      checkoutUrl: attempt.checkoutUrl,
      checkoutId: sessionId,
      reused: true,
    };
  }
  throw stillProcessing();
}

/**
 * Cancel the old Bachs session, then read it. A successful cancel is not
 * proof the session is void. An open or unreadable session is reused or
 * blocked. A closed session is replaced.
 * @param {{ ledger: object, provider: { cancelCheckout?: Function, getCheckout?: Function } }} input
 * @param {object} attempt
 * @param {object} attemptInput
 */
async function replaceExpiredAttempt(input, attempt, attemptInput) {
  const sessionId = attempt.checkoutSessionId;
  if (sessionId && typeof input.provider.cancelCheckout === "function") {
    try {
      await input.provider.cancelCheckout(sessionId);
    } catch {
      /* Read below. A thrown cancel never opens a second session by itself. */
    }
    const read = await readCheckout(input, sessionId);
    if (!read.readable || checkoutIsOpen(read.row)) {
      return reuseOrBlock(attempt, sessionId, read);
    }
  }
  await input.ledger.markAttempt(attempt.id, { status: "cancelled" });
  return input.ledger.createAttempt(attemptInput);
}

/**
 * The session id is already stored. Read it. Reuse an open checkout, block
 * when it cannot be read, and replace only when the read says it is closed.
 * @param {{ ledger: object, provider: { getCheckout?: Function } }} input
 * @param {object} attempt
 * @param {object} attemptInput
 */
async function resumeUnattached(input, attempt, attemptInput) {
  const sessionId = attempt.checkoutSessionId;
  const read = await readCheckout(input, sessionId);
  if (!read.readable || checkoutIsOpen(read.row)) {
    return reuseOrBlock(attempt, sessionId, read);
  }
  await input.ledger.markAttempt(attempt.id, { status: "cancelled" });
  return input.ledger.createAttempt(attemptInput);
}

/**
 * A succeeded part whose Bachs checkout has not expired stays the live session.
 * An open or unreadable session is reused or blocked. A closed read releases
 * the hold and lets the next call insert the remainder. The succeeded row is
 * not cancelled, and its session id stays so a later collection can be credited.
 * @param {{ ledger: { releaseHeld?: Function, createAttempt: Function }, provider: { getCheckout?: Function } }} input
 * @param {object} attempt
 * @param {object} attemptInput
 */
async function resumeHeld(input, attempt, attemptInput) {
  const sessionId = attempt.checkoutSessionId;
  const read = await readCheckout(input, sessionId);
  if (!read.readable || checkoutIsOpen(read.row)) {
    return reuseOrBlock(attempt, sessionId, read);
  }
  if (typeof input.ledger.releaseHeld === "function") {
    await input.ledger.releaseHeld(attempt.id);
  }
  return input.ledger.createAttempt(attemptInput);
}

function sessionAlreadyStored(attempt) {
  return Boolean(attempt.checkoutSessionId || attempt.unattached || attempt.held);
}

/**
 * Start one hosted checkout for the next unpaid part.
 * The redirect does not mark the invoice paid.
 * A second click while the first session is still being created waits for it.
 * An expired session is cancelled, then read. A session that is still open
 * is reused or blocked, including when cancel returned success.
 * A failed attach keeps the session id on the attempt. The next click reads
 * it and does not open another session while it is still payable.
 * A waiter that sees that parked row reads it too. It does not create again.
 * A thrown create does not mark the row failed while a session id is stored.
 * After a short collection, the succeeded checkout is reused or blocked until
 * a read says it is closed.
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
  if (attempt.unattached || attempt.held) {
    attempt = await settleLiveSession(input, attempt, attemptInput);
    if (attempt.kept) {
      return { checkoutUrl: attempt.checkoutUrl, checkoutId: attempt.checkoutId, reused: true };
    }
  }
  if (attempt.cancel) {
    attempt = await replaceExpiredAttempt(input, attempt, attemptInput);
    if (attempt.kept) {
      return { checkoutUrl: attempt.checkoutUrl, checkoutId: attempt.checkoutId, reused: true };
    }
  }
  if (attempt.inFlight) {
    attempt = await waitForAttached(input, attemptInput);
    if (attempt.kept) {
      return { checkoutUrl: attempt.checkoutUrl, checkoutId: attempt.checkoutId, reused: true };
    }
    if (attempt.cancel) {
      attempt = await replaceExpiredAttempt(input, attempt, attemptInput);
      if (attempt.kept) {
        return { checkoutUrl: attempt.checkoutUrl, checkoutId: attempt.checkoutId, reused: true };
      }
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
    if (!sessionAlreadyStored(attempt)) {
      await input.ledger.markAttempt(attempt.id, { status: "failed" });
    }
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
    const alreadyStored = sessionAlreadyStored(attempt);
    if (!alreadyStored && typeof input.ledger.parkUnattached === "function" && created.checkoutId) {
      try {
        await input.ledger.parkUnattached(attempt.id, {
          checkoutId: created.checkoutId,
          checkoutUrl: created.checkoutUrl,
          expiresAt,
        });
      } catch {
        /* Stay pending when the session id cannot be stored. */
      }
    }
    if (alreadyStored) throw err;
    let cancelFailed = true;
    if (typeof input.provider.cancelCheckout === "function" && created.checkoutId) {
      try {
        await input.provider.cancelCheckout(created.checkoutId);
        cancelFailed = false;
      } catch {
        cancelFailed = true;
      }
    }
    if (!cancelFailed) {
      const read = await readCheckout(input, created.checkoutId);
      if (read.readable && !checkoutIsOpen(read.row)) {
        await input.ledger.markAttempt(attempt.id, { status: "failed" });
        throw err;
      }
    }
    throw err;
  }
  return { checkoutUrl: created.checkoutUrl, checkoutId: created.checkoutId, reused: false, reference: attempt.id };
}

module.exports = { startInvoiceCheckout };
