/**
 * Review tests for the M-Pesa pay path on #780 (cursor/invoice-pay-0c16).
 * These assert the money outcome that must hold before live charges.
 * They fail on the code under review. Do not flip them to test.failing.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { toCents } = require("../dashboard/src/lib/invoicePay/money");
const { signBachsBody } = require("../dashboard/src/lib/invoicePay/signature");
const { handlePayWebhook } = require("../dashboard/src/lib/invoicePay/webhook");
const { startInvoiceCheckout } = require("../dashboard/src/lib/invoicePay/checkoutFlow");
const { payView } = require("../dashboard/src/lib/invoicePay/view");
const { sendClaimedBillingNotices } = require("../src/billing/billingNoticeSend");
const { createMemoryLedger } = require("./invoicePayMemory");

const SECRET = "whsec_review_only";
const NOW = Date.parse("2026-10-18T12:00:00Z");
const ROOT = path.join(__dirname, "..");

function seedPayable(totalKes) {
  const ledger = createMemoryLedger({ now: NOW });
  ledger.seedTenant({ id: "t1", businessName: "Jirani Cleaning", billingEnforcement: "soft" });
  ledger.seedInvoice({
    id: "inv1",
    tenantId: "t1",
    totalKes,
    subtotalKes: totalKes,
    invoiceNumber: "SCL-2026-000042",
    dueAt: "2026-10-24T21:00:00Z",
  });
  return { ledger, token: ledger.mint("inv1") };
}

function providerFactory() {
  let n = 0;
  return {
    count() {
      return n;
    },
    async createCheckout() {
      n += 1;
      return {
        checkoutId: `cs_${n}`,
        checkoutUrl: `https://sandbox-api.bachs.io/c/${n}`,
        expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
      };
    },
  };
}

function signed(payload, now = NOW) {
  const rawBody = JSON.stringify(payload);
  const ts = String(Math.floor(now / 1000));
  return { rawBody, headers: signBachsBody(SECRET, rawBody, ts).headers, secret: SECRET, now };
}

function collectedCents(ledger) {
  return ledger.payments
    .filter((row) => row.matchStatus !== "issue")
    .reduce((sum, row) => sum + toCents(row.amountKes), 0n);
}

describe("pay-link races must not open two live M-Pesa checkouts", () => {
  it("reuses one checkout when Pay is clicked twice before the first session is attached", async () => {
    const { ledger, token } = seedPayable("1000.00");
    let entered = 0;
    let releaseSecond;
    const secondMayStart = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    const provider = {
      async createCheckout() {
        entered += 1;
        const n = entered;
        if (n === 1) {
          releaseSecond();
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return {
          checkoutId: `cs_${n}`,
          checkoutUrl: `https://sandbox-api.bachs.io/c/${n}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
    };
    const firstPromise = startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    await secondMayStart;
    const secondPromise = startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(entered, 1);
    assert.equal(first.checkoutId, second.checkoutId);
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 1);
  });

  it("cancels the expired pending checkout before minting a replacement", async () => {
    const { ledger, token } = seedPayable("1000.00");
    const provider = providerFactory();
    const first = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    ledger.setNow(NOW + 61 * 60 * 1000);
    await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    const previous = ledger.attempts.find((row) => row.checkoutSessionId === first.checkoutId);
    assert.equal(previous.status, "cancelled");
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 1);
  });

  it("does not collect more than the invoice when two checkouts are both paid", async () => {
    const { ledger, token } = seedPayable("1000.00");
    const provider = providerFactory();
    const first = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    ledger.setNow(NOW + 61 * 60 * 1000);
    const second = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    for (const [checkoutId, eventId] of [
      [first.checkoutId, "evt_first"],
      [second.checkoutId, "evt_second"],
    ]) {
      await handlePayWebhook({
        ...signed({
          id: eventId,
          type: "collection.succeeded",
          data: {
            checkout_id: checkoutId,
            status: "SUCCEEDED",
            charged_amount: "1000.00",
            charged_currency: "KES",
          },
        }),
        ledger,
      });
    }
    assert.ok(
      collectedCents(ledger) <= toCents("1000.00"),
      `collected ${collectedCents(ledger)} cents from two checkouts`
    );
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "1000");
  });
});

describe("a collected shilling must reduce the invoice", () => {
  it("applies a SUCCEEDED collection that is one cent over the part and marks the invoice paid", async () => {
    const { ledger, token } = seedPayable("1000.00");
    const provider = providerFactory();
    const checkout = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    const result = await handlePayWebhook({
      ...signed({
        id: "evt_cent",
        type: "collection.succeeded",
        data: {
          checkout_id: checkout.checkoutId,
          status: "SUCCEEDED",
          charged_amount: "1000.01",
          charged_currency: "KES",
        },
      }),
      ledger,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.action, "apply");
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "1000");
  });

  it("credits the shillings received on collection.underpaid", async () => {
    const { ledger, token } = seedPayable("1000.00");
    const provider = providerFactory();
    const checkout = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    const result = await handlePayWebhook({
      ...signed({
        id: "evt_under",
        type: "collection.underpaid",
        data: {
          checkout_id: checkout.checkoutId,
          charged_amount: "400.00",
          charged_currency: "KES",
        },
      }),
      ledger,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.action, "apply_partial");
    assert.equal(ledger.invoices.get("inv1").status, "open");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "400");
  });

  it("applies a later exact KES collection after an earlier issue on the same checkout", async () => {
    const { ledger, token } = seedPayable("1000.00");
    const provider = providerFactory();
    const checkout = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    await handlePayWebhook({
      ...signed({
        id: "evt_usd",
        type: "collection.succeeded",
        data: {
          checkout_id: checkout.checkoutId,
          status: "SUCCEEDED",
          amount: "7.60",
          currency: "USD",
        },
      }),
      ledger,
    });
    const corrected = await handlePayWebhook({
      ...signed({
        id: "evt_kes",
        type: "collection.succeeded",
        data: {
          checkout_id: checkout.checkoutId,
          status: "SUCCEEDED",
          charged_amount: "1000.00",
          charged_currency: "KES",
        },
      }),
      ledger,
    });
    assert.equal(corrected.body.action, "apply");
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "1000");
  });

  it("records a voided invoice collection and answers 200 instead of throwing", async () => {
    const { ledger, token } = seedPayable("1000.00");
    const provider = providerFactory();
    const checkout = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    ledger.reconcileCollection = async () => {
      throw new Error("invoice cannot be paid");
    };
    const result = await handlePayWebhook({
      ...signed({
        id: "evt_void",
        type: "collection.succeeded",
        data: {
          checkout_id: checkout.checkoutId,
          status: "SUCCEEDED",
          charged_amount: "1000.00",
          charged_currency: "KES",
        },
      }),
      ledger,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    const visible = ledger.payments.find((row) => row.providerRef === checkout.checkoutId);
    assert.ok(visible, "the collected shillings must be stored even when the invoice cannot be paid");
    assert.equal(visible.matchStatus, "issue");
  });
});

describe("billing notice sends", () => {
  it("passes the notice idempotency key as the notify ledger key", async () => {
    let seen = null;
    await sendClaimedBillingNotices({
      env: { BILLING_NOTICES_SEND: "on" },
      claim: async () => [
        {
          id: "notice-1",
          channel: "email",
          recipient: "owner@example.com",
          body: "Invoice SCL-2026-000042 is due.",
          title: "Invoice",
          kind: "platform_billing_invoice_issued",
          tenant_id: "t1",
          idempotency_key: "platform_billing_invoice_issued:inv1",
        },
      ],
      settle: async () => {},
      dispatch: async (input) => {
        seen = input;
        return { channel: "email", notifySendId: "send-1" };
      },
    });
    assert.equal(seen.ledger.keyBase, "platform_billing_invoice_issued:inv1");
  });
});

describe("pay attempt SQL", () => {
  it("locks the invoice and treats a pending attempt as in flight before a checkout url exists", () => {
    const pay = fs.readFileSync(path.join(ROOT, "docs/supabase/invoice_pay.sql"), "utf8");
    const session = fs.readFileSync(path.join(ROOT, "docs/supabase/invoice_pay_session.sql"), "utf8");
    const start = session.indexOf("function public.create_invoice_pay_attempt");
    const end = session.indexOf("$$;", start);
    const body = session.slice(start, end);
    assert.match(body, /for update/);
    assert.doesNotMatch(body, /and checkout_url is not null/);
    assert.match(pay, /where status = 'pending'/);
    assert.doesNotMatch(pay, /pending_unattached/);
    assert.match(
      session,
      /create unique index[\s\S]{0,240}payment_attempts[\s\S]{0,240}where status in \('pending', 'pending_unattached'\)/i
    );
  });
});

describe("checkout return and overpay", () => {
  it("credits the extra when checkout.completed is followed by OVERPAID on the same checkout", async () => {
    const { ledger, token } = seedPayable("100.00");
    const provider = providerFactory();
    const checkout = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    await handlePayWebhook({
      ...signed({
        id: "evt_done",
        type: "checkout.completed",
        data: {
          checkout_id: checkout.checkoutId,
          payment_status: "paid",
          charged_amount: "100.00",
          charged_currency: "KES",
        },
      }),
      ledger,
    });
    const over = await handlePayWebhook({
      ...signed({
        id: "evt_over",
        type: "collection.succeeded",
        data: {
          checkout_id: checkout.checkoutId,
          status: "OVERPAID",
          charged_amount: "150.00",
          charged_currency: "KES",
        },
      }),
      ledger,
    });
    assert.equal(over.body.duplicate, undefined);
    assert.equal(over.body.overpaid, true);
    const stored = ledger.payments.find((row) => row.providerRef === checkout.checkoutId);
    assert.equal(stored.amountKes, "150.00");
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "100");
  });

  it("does not put the raw pay token on the Bachs success URL", async () => {
    const { ledger, token } = seedPayable("100.00");
    let successUrl = "";
    const provider = {
      async createCheckout(input) {
        successUrl = input.successUrl;
        return {
          checkoutId: "cs_1",
          checkoutUrl: "https://sandbox-api.bachs.io/c/1",
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
    };
    await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
    });
    assert.equal(successUrl.includes(token), false);
  });

  it("does not show Payment received for a checkout that belongs to another invoice", () => {
    const view = payView({
      lookup: {
        found: true,
        state: "payable",
        businessName: "Jirani Cleaning",
        invoiceNumber: "SCL-2026-000042",
        totalKes: "1000.00",
        amountPaidKes: "0",
        dueAt: null,
      },
      checkout: { id: "cs_other_invoice", status: "succeeded", returning: true },
    });
    assert.notEqual(view.state, "received");
    assert.notEqual(view.title, "Payment received");
  });
});
