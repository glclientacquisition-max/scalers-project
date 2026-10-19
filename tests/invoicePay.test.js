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

  it("accepts the 6 hour retry and rejects an older replay", () => {
    const raw = "{}";
    const sent = 1760000000;
    const signed = signBachsBody(SECRET, raw, sent);
    const sixHours = sent * 1000 + 6 * 60 * 60 * 1000;
    const eightHours = sent * 1000 + 8 * 60 * 60 * 1000;
    assert.equal(verifyBachsRequest({ rawBody: raw, headers: signed.headers, secret: SECRET, now: sixHours }), true);
    assert.equal(verifyBachsRequest({ rawBody: raw, headers: signed.headers, secret: SECRET, now: eightHours }), false);
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
    assert.equal(after.vatLabel, "VAT KSh 320");
    assert.equal(after.dueLabel, "Due 25 Oct 2026");
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
