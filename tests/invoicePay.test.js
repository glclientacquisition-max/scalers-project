const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { splitKes, toCents, formatKsh, nextPart } = require("../dashboard/src/lib/invoicePay/money");
const { signBachsBody, verifyBachsRequest } = require("../dashboard/src/lib/invoicePay/signature");
const { MockPayProvider, BachsPayProvider, payProviderFromEnv, SANDBOX_API } = require("../dashboard/src/lib/invoicePay/provider");
const { handlePayWebhook, extractCharge } = require("../dashboard/src/lib/invoicePay/webhook");
const { payView } = require("../dashboard/src/lib/invoicePay/view");
const { startInvoiceCheckout } = require("../dashboard/src/lib/invoicePay/checkoutFlow");
const { reconciliationReport, assertNotProductionUrl } = require("../dashboard/src/lib/invoicePay/reconcile");
const { createMemoryLedger } = require("./invoicePayMemory");

const SECRET = "whsec_test_only";
const NOW = Date.parse("2026-10-18T12:00:00Z");

function seedPayable(totalKes, subtotalKes = "2000.00") {
  const ledger = createMemoryLedger({ now: NOW });
  ledger.seedTenant({ id: "t1", businessName: "Jirani Cleaning", billingEnforcement: "soft" });
  ledger.seedInvoice({
    id: "inv1",
    tenantId: "t1",
    totalKes,
    subtotalKes,
    invoiceNumber: "SC-2026-000042",
    dueAt: "2026-10-24T21:00:00Z",
  });
  const token = ledger.mint("inv1");
  return { ledger, token };
}

describe("money", () => {
  it("rejects a JavaScript number in toCents", () => {
    assert.equal(toCents(1.005), null);
    assert.equal(toCents(1000), null);
    assert.equal(toCents("1000.00"), 100000n);
    assert.equal(toCents("1000.005"), null);
  });
});

describe("Bachs signature", () => {
  it("accepts a hex HMAC of timestamp.raw body", () => {
    const raw = JSON.stringify({ id: "evt_1", type: "collection.succeeded" });
    const signed = signBachsBody(SECRET, raw, "1760000000");
    assert.equal(
      verifyBachsRequest({ rawBody: raw, headers: signed.headers, secret: SECRET, now: 1760000000 * 1000 }),
      true
    );
  });

  it("rejects a wrong secret, a missing signature, and a body that changed", () => {
    const raw = '{"id":"evt_1"}';
    const signed = signBachsBody(SECRET, raw, "1760000000");
    assert.equal(
      verifyBachsRequest({ rawBody: raw, headers: signed.headers, secret: "other", now: 1760000000 * 1000 }),
      false
    );
    assert.equal(verifyBachsRequest({ rawBody: raw, headers: {}, secret: SECRET, now: 1760000000 * 1000 }), false);
    assert.equal(
      verifyBachsRequest({
        rawBody: '{"id":"evt_2"}',
        headers: signed.headers,
        secret: SECRET,
        now: 1760000000 * 1000,
      }),
      false
    );
  });

  it("accepts a signature within 300 seconds and rejects an older one", () => {
    const raw = "{}";
    const sent = 1760000000;
    const signed = signBachsBody(SECRET, raw, sent);
    const within = sent * 1000 + 300 * 1000;
    const past = sent * 1000 + 301 * 1000;
    assert.equal(verifyBachsRequest({ rawBody: raw, headers: signed.headers, secret: SECRET, now: within }), true);
    assert.equal(verifyBachsRequest({ rawBody: raw, headers: signed.headers, secret: SECRET, now: past }), false);
  });

  it("accepts signature v2 when one of the v1 secrets matches", () => {
    const raw = '{"id":"evt_v2"}';
    const timestamp = "1760000000";
    const good = signBachsBody(SECRET, raw, timestamp).signature;
    const headers = {
      "x-bachs-signature-v2": `t=${timestamp},v1=abcd,v1=${good}`,
    };
    assert.equal(
      verifyBachsRequest({ rawBody: raw, headers, secret: SECRET, now: 1760000000 * 1000 }),
      true
    );
  });
});

describe("split payments", () => {
  it("keeps a single part at the M-Pesa cap and splits above it", () => {
    assert.deepEqual(splitKes("150000"), ["150000"]);
    assert.deepEqual(splitKes("150000.00"), ["150000"]);
    assert.deepEqual(splitKes("200000"), ["100000", "100000"]);
    const odd = splitKes("150001");
    assert.equal(odd.length, 2);
    assert.ok(odd.every((part) => toCents(part) <= 15000000n));
    assert.equal(odd.reduce((sum, part) => sum + toCents(part), 0n), toCents("150001"));
    const next = nextPart(odd, "0");
    assert.equal(next.index, 1);
    assert.equal(next.count, 2);
  });

  it("applies each part and marks the invoice paid only when the total is reached", async () => {
    const { ledger, token } = seedPayable("200000.00", "200000.00");
    const provider = new MockPayProvider();
    const first = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.match(first.checkoutUrl, /return=1/);
    assert.match(first.checkoutUrl, /checkout_id=/);

    const checking = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: first.checkoutId, status: "pending", returning: true },
    });
    assert.equal(checking.title, "Checking payment");
    assert.equal(checking.payLabel, null);
    assert.equal(checking.partLabel, "Part 1 of 2");

    const event = provider.paidEvent(first.checkoutId, { secret: SECRET, now: NOW, fee: "3500.00", feeCurrency: "KES", settledAmount: "760.00", settledCurrency: "USD" });
    const applied = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(applied.body.action, "apply");
    assert.equal(ledger.invoices.get("inv1").status, "open");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "100000");
    assert.equal(ledger.payments[0].feeMinor, 350000);
    assert.equal(ledger.payments[0].settledCurrency, "USD");
    assert.equal(ledger.payments[0].settledAmountMinor, 76000);

    const again = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(again.body.duplicate, true);
    assert.equal(ledger.payments.length, 1);
    assert.equal(ledger.events.get(`bachs:${event.payload.id}`).attempts, 2);

    const mid = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: first.checkoutId, status: "succeeded", returning: true },
    });
    assert.equal(mid.title, "Payment received");
    assert.equal(mid.partLabel, "Part 2 of 2");
    assert.equal(mid.payLabel, "Pay KSh 100,000");

    const second = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const secondEvent = provider.paidEvent(second.checkoutId, { secret: SECRET, now: NOW, eventId: "evt_part_2" });
    await handlePayWebhook({ ...secondEvent, secret: SECRET, ledger, now: NOW });
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.payments.length, 2);

    const done = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: second.checkoutId, status: "succeeded", returning: true },
    });
    assert.equal(done.title, "Payment received");
    assert.equal(done.payLabel, null);
    const later = payView({ lookup: await ledger.lookup(token), checkout: null });
    assert.equal(later.title, "Paid");
  });
});

describe("mismatch handling", () => {
  it("does not mark paid when the currency is only USD", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const event = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "18.00",
      currency: "USD",
      eventId: "evt_usd",
    });
    const result = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(result.body.action, "issue");
    assert.equal(result.body.reason, "currency");
    assert.equal(ledger.invoices.get("inv1").status, "open");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "0");
    assert.equal(ledger.payments.filter((p) => p.matchStatus === "issue").length, 0);
    assert.equal(ledger.attempts[0].status, "issue");
  });

  it("does not mark paid when the KES amount differs", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const event = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "2000.00",
      currency: "KES",
      eventId: "evt_short",
    });
    const result = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(result.body.action, "issue");
    assert.equal(result.body.reason, "amount");
    assert.equal(ledger.invoices.get("inv1").status, "open");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "0");
    assert.equal(ledger.payments[0].matchStatus, "issue");
    assert.equal(ledger.payments[0].amountKes, "2000.00");
    const view = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: started.checkoutId, status: "issue", returning: true },
    });
    assert.equal(view.title, "This payment needs a check");
    assert.equal(view.payLabel, "Pay KSh 2,320");
  });

  it("waits when checkout.completed has no KES amount, then applies collection.succeeded once", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const early = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      type: "checkout.completed",
      amountKes: undefined,
      currency: "USD",
      extraData: { amount: "18.00", currency: "USD" },
      eventId: "evt_completed",
    });
    delete early.payload.data.amount;
    // paidEvent already set amount from amountKes undefined, then extraData. Rebuild from payload.
    const waitingBody = JSON.stringify({
      id: "evt_completed",
      type: "checkout.completed",
      data: { checkout_id: started.checkoutId, status: "SUCCEEDED", amount: "18.00", currency: "USD" },
    });
    const waitingSigned = signBachsBody(SECRET, waitingBody, Math.floor(NOW / 1000));
    const waiting = await handlePayWebhook({
      rawBody: waitingBody,
      headers: waitingSigned.headers,
      secret: SECRET,
      ledger,
      now: NOW,
    });
    assert.equal(waiting.body.action, "wait");
    assert.equal(ledger.payments.length, 0);

    const paid = provider.paidEvent(started.checkoutId, { secret: SECRET, now: NOW, eventId: "evt_collected" });
    const applied = await handlePayWebhook({ ...paid, secret: SECRET, ledger, now: NOW });
    assert.equal(applied.body.action, "apply");
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    const replay = await handlePayWebhook({ ...paid, secret: SECRET, ledger, now: NOW });
    assert.equal(replay.body.duplicate, true);
    assert.equal(ledger.payments.length, 1);
  });

  it("does not invent the 3.5% fee", () => {
    const charge = extractCharge({ amount: "1000.00", currency: "KES" });
    assert.equal(charge.feeAmount, null);
  });
});

describe("mock checkout end to end", () => {
  it("stays unpaid on the return until the signed webhook confirms", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const returned = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: started.checkoutId, status: "pending", returning: true },
    });
    assert.equal(returned.state, "checking");
    assert.equal(returned.title, "Checking payment");
    assert.equal(ledger.invoices.get("inv1").status, "open");

    const event = provider.paidEvent(started.checkoutId, { secret: SECRET, now: NOW });
    const confirmed = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.action, "apply");
    const after = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: started.checkoutId, status: "succeeded", returning: true },
    });
    assert.equal(after.title, "Payment received");
    assert.equal(after.totalLabel, "KSh 2,320");
    assert.equal(after.dueLabel, "Due 25 Oct 2026");
    assert.equal(after.vatLabel, undefined);
    assert.equal(ledger.invoices.get("inv1").status, "paid");
  });

  it("refuses a pay link for a beta tenant", () => {
    const ledger = createMemoryLedger({ now: NOW });
    ledger.seedTenant({ id: "t1", businessName: "Beta Shop", billingEnforcement: "off" });
    ledger.seedInvoice({ id: "inv1", tenantId: "t1", totalKes: "1000" });
    assert.throws(() => ledger.mint("inv1"), /beta tenants have no pay link/);
  });
});

describe("provider mode", () => {
  it("uses the mock by default and refuses live mode and live keys", async () => {
    const mock = payProviderFromEnv({});
    assert.ok(mock instanceof MockPayProvider);
    assert.throws(() => payProviderFromEnv({ BACHS_MODE: "live", BACHS_API_KEY: "sk_live_x" }), /refused/);
    assert.throws(() => payProviderFromEnv({ BACHS_MODE: "sandbox", BACHS_API_KEY: "sk_live_x" }), /refused/);
    assert.throws(
      () => payProviderFromEnv({ BACHS_MODE: "sandbox", SUPABASE_URL: "https://fjxcdccgyhnvnnlnovcl.supabase.co" }),
      /production/
    );

    let called = null;
    const fetchImpl = async (url, init) => {
      called = { url, init };
      return {
        ok: true,
        json: async () => ({ checkout_id: "chk_sb", checkout_url: "https://checkout.bachs.io/c/test", status: "open" }),
      };
    };
    const provider = new BachsPayProvider({ apiKey: "sk_sandbox_test", fetchImpl });
    const created = await provider.createCheckout({
      amountKes: "2320.00",
      successUrl: "https://app.scalers.co.ke/pay/pay_x?return=1",
      cancelUrl: "https://app.scalers.co.ke/pay/pay_x",
      reference: "attempt-1",
      metadata: { invoice_id: "inv" },
      idempotencyKey: "pay-attempt-1",
      paymentMethodTypes: ["MOMO_KES"],
    });
    assert.equal(created.checkoutId, "chk_sb");
    assert.equal(called.url, `${SANDBOX_API}/v1/checkout-sessions`);
    const body = JSON.parse(called.init.body);
    assert.deepEqual(body.pricing, { currency: "KES", amount: "2320" });
    assert.deepEqual(body.payment_method_types, ["MOMO_KES"]);
    assert.equal(body.expires_in_minutes, 60);
    assert.equal(body.customer, undefined);
    assert.equal(called.init.headers.Authorization, "Bearer sk_sandbox_test");
    assert.equal(new URL(called.url).host, "sandbox-api.bachs.io");
  });
});

describe("reconciliation report", () => {
  it("lists a pending attempt older than 30 minutes and a provider disagreement, and changes nothing", () => {
    const attempts = [
      {
        id: "a1",
        invoiceId: "inv",
        status: "pending",
        checkoutSessionId: "chk_1",
        createdAt: new Date(NOW - 31 * 60 * 1000).toISOString(),
      },
    ];
    const before = JSON.stringify(attempts);
    const rows = reconciliationReport({
      attempts,
      invoices: [],
      payments: [],
      providerStatuses: { chk_1: "succeeded" },
      now: NOW,
    });
    assert.equal(JSON.stringify(attempts), before);
    assert.ok(rows.some((row) => row.kind === "pending_timeout"));
    assert.ok(rows.some((row) => row.kind === "provider_disagreement"));
    assert.throws(() => assertNotProductionUrl("https://fjxcdccgyhnvnnlnovcl.supabase.co"), /production/);
  });
});

describe("pay page copy", () => {
  it("uses the kit button, KSh, and the two confirmation phrases", () => {
    const card = fs.readFileSync(path.join(__dirname, "../dashboard/src/components/pay/PayCard.tsx"), "utf8");
    const page = fs.readFileSync(path.join(__dirname, "../dashboard/src/app/pay/[token]/page.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(__dirname, "../dashboard/src/app/pay/[token]/PayPanel.tsx"), "utf8");
    assert.match(card, /from "@\/components\/ui\/Button"/);
    assert.doesNotMatch(card, /#[0-9a-fA-F]{3,8}/);
    assert.doesNotMatch(card, /[—–]/);
    assert.doesNotMatch(card, /VAT/);
    assert.doesNotMatch(`${card}\n${page}\n${panel}`, /KES/);
    assert.match(panel, /\/api\/pay\//);
    const payable = payView({
      lookup: {
        found: true,
        state: "payable",
        businessName: "Jirani Cleaning",
        invoiceNumber: "SC-2026-000042",
        totalKes: "2320.00",
        subtotalKes: "2000.00",
        amountPaidKes: "0",
        dueAt: "2026-10-24T21:00:00Z",
      },
    });
    assert.equal(payable.title, "Jirani Cleaning");
    assert.equal(payable.payLabel, "Pay KSh 2,320");
    assert.equal(formatKsh(toCents("150000")), "KSh 150,000");
  });
});

describe("Bachs sandbox fields", () => {
  const { readPayReturn } = require("../dashboard/src/lib/invoicePay/returnUrl");
  const { decidePayment } = require("../dashboard/src/lib/invoicePay/webhook");

  it("reads processing_fee_currency and keeps a query string on the success URL", () => {
    const charge = extractCharge({
      amount: "100.00",
      currency: "KES",
      processing_fee: "3.50",
      processing_fee_currency: "KES",
      fee_currency: "USD",
    });
    assert.equal(charge.feeAmount, "3.50");
    assert.equal(charge.feeCurrency, "KES");
    const provider = new MockPayProvider();
    return provider
      .createCheckout({
        amountKes: "100.00",
        successUrl: "https://app.scalers.co.ke/pay/pay_x?return=1",
        cancelUrl: "https://app.scalers.co.ke/pay/pay_x",
        reference: "attempt-1",
      })
      .then((created) => {
        const url = new URL(created.checkoutUrl);
        assert.equal(url.searchParams.get("return"), "1");
        assert.equal(url.searchParams.get("checkout_id"), created.checkoutId);
        assert.equal((created.checkoutUrl.match(/\?/g) || []).length, 1);
        const event = provider.paidEvent(created.checkoutId, { secret: SECRET, now: NOW, fee: "3.50", feeCurrency: "KES" });
        const payload = JSON.parse(event.rawBody);
        assert.equal(payload.data.processing_fee_currency, "KES");
        assert.equal(payload.data.fee_currency, undefined);
        assert.deepEqual(readPayReturn({ return: `1?checkout_id=${created.checkoutId}` }), {
          return: "1",
          checkout_id: created.checkoutId,
        });
      });
  });

  it("records ACCEPTED and OVERPAID, and applies checkout.completed only when payment_status is paid", async () => {
    const accepted = decidePayment({
      type: "collection.succeeded",
      status: "ACCEPTED",
      paymentStatus: null,
      attempt: { amountKes: "100.00" },
      charge: { kes: { amount: "100.00", currency: "KES" }, other: null },
    });
    assert.equal(accepted.action, "apply");
    const over = decidePayment({
      type: "collection.succeeded",
      status: "OVERPAID",
      attempt: { amountKes: "100.00" },
      charge: { kes: { amount: "150.00", currency: "KES" }, other: null },
    });
    assert.equal(over.action, "apply_overpaid");
    const unpaid = decidePayment({
      type: "checkout.completed",
      status: "SUCCEEDED",
      paymentStatus: "unpaid",
      attempt: { amountKes: "100.00" },
      charge: { kes: { amount: "100.00", currency: "KES" }, other: null },
    });
    assert.equal(unpaid.action, "wait");
    const paid = decidePayment({
      type: "checkout.completed",
      status: "SUCCEEDED",
      paymentStatus: "paid",
      attempt: { amountKes: "100.00" },
      charge: { kes: { amount: "100.00", currency: "KES" }, other: null },
    });
    assert.equal(paid.action, "apply");

    const { ledger, token } = seedPayable("100.00", "100.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const event = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      status: "OVERPAID",
      amountKes: "100.00",
    });
    const applied = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(applied.body.overpaid, true);
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    const rows = reconciliationReport({
      attempts: ledger.attempts,
      invoices: [],
      payments: ledger.payments,
      now: NOW,
    });
    assert.ok(rows.some((row) => row.kind === "overpaid"));
  });

  it("mints a new reference after the checkout expires and sends the customer", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    ledger.tenants.get("t1").alertEmail = "owner@example.com";
    ledger.tenants.get("t1").phone = "+254700000001";
    const seen = [];
    const provider = {
      async createCheckout(request) {
        seen.push(request);
        return {
          checkoutId: `chk_${seen.length}`,
          checkoutUrl: `https://checkout.example/${seen.length}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
    };
    const first = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const again = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(again.reused, true);
    assert.equal(again.checkoutId, first.checkoutId);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].customer.email, "owner@example.com");
    assert.equal(seen[0].customer.phone_number, "+254700000001");
    assert.equal(seen[0].expiresInMinutes, 60);
    ledger.setNow(NOW + 61 * 60 * 1000);
    const fresh = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const previous = ledger.attempts.find((row) => row.checkoutSessionId === first.checkoutId);
    assert.equal(previous.status, "cancelled");
    assert.equal(fresh.reused, false);
    assert.notEqual(fresh.reference, seen[0].reference);
    assert.equal(seen[1].reference, fresh.reference);
    assert.equal(seen[0].successUrl.includes(token), false);
    assert.equal(seen[0].cancelUrl.includes(token), false);
  });

  it("logs the Bachs error code and request id", async () => {
    const lines = [];
    const original = console.error;
    console.error = (line) => lines.push(String(line));
    try {
      const provider = new BachsPayProvider({
        apiKey: "sk_sandbox_test",
        fetchImpl: async () => ({
          ok: false,
          status: 422,
          headers: { get: (name) => (name === "x-request-id" ? "req_123" : null) },
          json: async () => ({ error_code: "amount_invalid", message: "no" }),
        }),
      });
      await assert.rejects(
        provider.createCheckout({
          amountKes: "10.00",
          successUrl: "https://app.scalers.co.ke/pay/x",
          cancelUrl: "https://app.scalers.co.ke/pay/x",
          reference: "ref-1",
          idempotencyKey: "pay-1",
        }),
        /bachs checkout failed/
      );
    } finally {
      console.error = original;
    }
    const logged = lines.join("\n");
    assert.match(logged, /amount_invalid/);
    assert.match(logged, /req_123/);
    assert.doesNotMatch(logged, /sk_sandbox_test/);
  });

  it("reads payment_status from getCheckout and ignores checkout_url", async () => {
    let url = "";
    const provider = new BachsPayProvider({
      apiKey: "sk_sandbox_test",
      fetchImpl: async (input) => {
        url = String(input);
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            checkout_id: "chk_1",
            status: "open",
            payment_status: "paid",
            checkout_url: "https://checkout.bachs.io/secret",
            charge: { id: "ch_1" },
          }),
        };
      },
    });
    const row = await provider.getCheckout("chk_1");
    assert.equal(row.paymentStatus, "paid");
    assert.equal(row.charge.id, "ch_1");
    assert.equal(row.checkoutUrl, undefined);
    assert.equal(row.status, undefined);
    assert.match(url, /\/v1\/checkout-sessions\/chk_1$/);
  });
});
