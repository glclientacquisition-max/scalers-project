const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { splitKes, toCents, formatKsh, nextPart } = require("../dashboard/src/lib/invoicePay/money");
const { signBachsBody, verifyBachsRequest } = require("../dashboard/src/lib/invoicePay/signature");
const { MockPayProvider, BachsPayProvider, payProviderFromEnv, SANDBOX_API } = require("../dashboard/src/lib/invoicePay/provider");
const { handlePayWebhook, extractCharge, bookTotalForResolve, bookTotalForReview } = require("../dashboard/src/lib/invoicePay/webhook");
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

async function raceUntilParked(ledger, token, buildCheckout) {
  let creates = 0;
  let releaseAttach;
  const attachGate = new Promise((resolve) => {
    releaseAttach = resolve;
  });
  let signalAttach;
  const attachEntered = new Promise((resolve) => {
    signalAttach = resolve;
  });
  let sawInFlight = false;
  const original = ledger.createAttempt.bind(ledger);
  ledger.createAttempt = async (input) => {
    const row = await original(input);
    if (row.inFlight) sawInFlight = true;
    return row;
  };
  ledger.attachCheckout = async () => {
    signalAttach();
    await attachGate;
    throw new Error("attach failed");
  };
  const provider = {
    async createCheckout() {
      creates += 1;
      return buildCheckout(creates);
    },
    async getCheckout(id) {
      return { checkoutId: id, status: "open", paymentStatus: "unpaid" };
    },
    async cancelCheckout() {
      throw new Error("bachs cancel failed");
    },
  };
  const first = startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
  await attachEntered;
  const second = startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sawInFlight, true);
  releaseAttach();
  await assert.rejects(first, /attach failed/);
  const again = await second;
  return { creates, again };
}

describe("money", () => {
  it("rejects a JavaScript number in toCents", () => {
    assert.equal(toCents(1.005), null);
    assert.equal(toCents(1000), null);
    assert.equal(toCents(-1000), null);
    assert.equal(toCents("1000.00"), 100000n);
    assert.equal(toCents("1000.005"), null);
  });

  it("reads a negative decimal string and floors a pay amount at zero", () => {
    assert.equal(toCents("-1000"), -100000n);
    assert.equal(toCents("-1000.50"), -100050n);
    assert.equal(toCents("-1000.005"), null);
    assert.equal(formatKsh(toCents("-1000")), "KSh -1,000");
    assert.deepEqual(splitKes("-1000"), []);
    assert.deepEqual(splitKes("0"), []);
    assert.equal(nextPart(splitKes("-1000"), "0"), null);
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

  it("rejects a webhook whose signature does not match and does not record it", async () => {
    const { ledger } = seedPayable("10.00", "10.00");
    const raw = JSON.stringify({ id: "evt_bad", type: "collection.succeeded", data: { checkout_id: "chk_x" } });
    const signed = signBachsBody("other-secret", raw, Math.floor(NOW / 1000));
    const rejected = await handlePayWebhook({
      rawBody: raw,
      headers: signed.headers,
      secret: SECRET,
      ledger,
      now: NOW,
    });
    assert.equal(rejected.status, 401);
    assert.equal(ledger.events.size, 0);
    assert.equal(ledger.payments.length, 0);
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
    assert.equal(mid.title, "Part 1 of 2 received, KSh 100,000 still due");
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
    assert.equal(result.body.action, "apply_partial");
    assert.equal(ledger.invoices.get("inv1").status, "open");
    assert.equal(ledger.invoices.get("inv1").amountPaidKes, "2000");
    assert.equal(ledger.payments[0].matchStatus, "partial");
    assert.equal(ledger.payments[0].amountKes, "2000.00");
    const view = payView({
      lookup: await ledger.lookup(token),
      checkout: { id: started.checkoutId, status: "succeeded", returning: true },
    });
    assert.equal(view.title, "KSh 320 still due");
    assert.equal(view.payLabel, "Pay KSh 320");
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
      leaveCheckout: true,
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

  it("opens live mode only when the owner allow flag is set", async () => {
    const { LIVE_API } = require("../dashboard/src/lib/invoicePay/provider");
    const prod = "https://fjxcdccgyhnvnnlnovcl.supabase.co";
    assert.throws(
      () => payProviderFromEnv({ BACHS_MODE: "live", BACHS_API_KEY: "sk_live_x", SUPABASE_URL: prod }),
      /refused/
    );
    assert.throws(
      () =>
        payProviderFromEnv({
          BACHS_MODE: "live",
          BACHS_LIVE_ALLOWED: "false",
          BACHS_API_KEY: "sk_live_x",
          SUPABASE_URL: prod,
        }),
      /refused/
    );
    let called = "";
    const fetchImpl = async (url) => {
      called = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ checkout_id: "chk_live", checkout_url: "https://checkout.bachs.io/c/live", status: "open" }),
      };
    };
    const live = payProviderFromEnv(
      { BACHS_MODE: "live", BACHS_LIVE_ALLOWED: "true", BACHS_API_KEY: "sk_live_x", SUPABASE_URL: prod },
      { fetchImpl }
    );
    assert.ok(live instanceof BachsPayProvider);
    await live.createCheckout({
      amountKes: "10.00",
      successUrl: "https://app.scalers.co.ke/pay/return/ret_1?return=1",
      cancelUrl: "https://app.scalers.co.ke/pay/return/ret_1",
      reference: "attempt-live",
      idempotencyKey: "pay-live",
    });
    assert.equal(called, `${LIVE_API}/v1/checkout-sessions`);
    assert.throws(
      () =>
        payProviderFromEnv({
          BACHS_MODE: "sandbox",
          BACHS_LIVE_ALLOWED: "true",
          SUPABASE_URL: prod,
          BACHS_API_KEY: "sk_test_x",
        }),
      /production/
    );

    const { ledger, token } = seedPayable("10.00", "10.00");
    const tenantId = ledger.invoices.get("inv1").tenantId;
    const provider = new MockPayProvider();
    await assert.rejects(
      startInvoiceCheckout({
        token,
        origin: "https://app.example",
        ledger,
        provider,
        env: {
          BACHS_MODE: "live",
          BACHS_LIVE_ALLOWED: "true",
          BACHS_LIVE_TENANT_ALLOWLIST: "11111111-1111-4111-8111-111111111111",
        },
      }),
      /not open for this business/
    );
    const started = await startInvoiceCheckout({
      token,
      origin: "https://app.example",
      ledger,
      provider,
      env: {
        BACHS_MODE: "live",
        BACHS_LIVE_ALLOWED: "true",
        BACHS_LIVE_TENANT_ALLOWLIST: tenantId,
      },
    });
    assert.equal(started.checkoutId.startsWith("chk_"), true);

    const savedMode = process.env.BACHS_MODE;
    const savedFlag = process.env.BACHS_LIVE_ALLOWED;
    const savedList = process.env.BACHS_LIVE_TENANT_ALLOWLIST;
    try {
      process.env.BACHS_MODE = "live";
      process.env.BACHS_LIVE_ALLOWED = "true";
      for (const list of [undefined, "", "   ", "  ,  "]) {
        if (list === undefined) delete process.env.BACHS_LIVE_TENANT_ALLOWLIST;
        else process.env.BACHS_LIVE_TENANT_ALLOWLIST = list;
        await assert.rejects(
          startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
          /not open for this business/
        );
      }
      process.env.BACHS_LIVE_TENANT_ALLOWLIST = "*";
      const open = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
      assert.equal(open.reused, true);
      delete process.env.BACHS_LIVE_TENANT_ALLOWLIST;
      const refused = await handlePayWebhook({
        ...provider.paidEvent(started.checkoutId, {
          secret: SECRET,
          now: NOW,
          amountKes: "10.00",
          collectedKes: "10.00",
          eventId: "evt_not_listed",
        }),
        secret: SECRET,
        ledger,
        now: NOW,
      });
      assert.equal(refused.body.action, "issue");
      assert.equal(refused.body.reason, "live_not_allowlisted");
      assert.equal(ledger.invoices.get("inv1").amountPaidKes, "0");
      assert.equal(ledger.payments.some((row) => row.matchStatus === "issue"), true);
      assert.equal(ledger.credits.length, 0);
    } finally {
      if (savedMode === undefined) delete process.env.BACHS_MODE;
      else process.env.BACHS_MODE = savedMode;
      if (savedFlag === undefined) delete process.env.BACHS_LIVE_ALLOWED;
      else process.env.BACHS_LIVE_ALLOWED = savedFlag;
      if (savedList === undefined) delete process.env.BACHS_LIVE_TENANT_ALLOWLIST;
      else process.env.BACHS_LIVE_TENANT_ALLOWLIST = savedList;
    }
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
    const credit = payView({
      lookup: {
        found: true,
        state: "payable",
        businessName: "Jirani Cleaning",
        totalKes: "-1000.00",
        amountPaidKes: "0",
      },
    });
    assert.equal(credit.totalLabel, "KSh -1,000");
    assert.equal(credit.payLabel, null);
    assert.equal(credit.state, "unavailable");
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

  it("keeps the open checkout when cancel fails", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    let created = 0;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: `chk_${created}`,
          checkoutUrl: `https://checkout.example/${created}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {
        throw new Error("bachs cancel failed");
      },
      async getCheckout(id) {
        return { checkoutId: id, status: "open", paymentStatus: "unpaid" };
      },
    };
    const first = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.setNow(NOW + 61 * 60 * 1000);
    const again = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(again.checkoutId, first.checkoutId);
    assert.equal(again.reused, true);
    assert.equal(created, 1);
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 1);
  });

  it("blocks a second checkout when the old session cannot be read", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const provider = {
      async createCheckout() {
        return {
          checkoutId: "chk_1",
          checkoutUrl: "https://checkout.example/1",
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {
        throw new Error("bachs cancel failed");
      },
      async getCheckout() {
        throw new Error("bachs checkout read failed");
      },
    };
    await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.setNow(NOW + 61 * 60 * 1000);
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /previous payment still processing/
    );
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "pending");
  });

  it("does not open a second session when cancel succeeds and the checkout is still open", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    let created = 0;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: `chk_${created}`,
          checkoutUrl: `https://checkout.example/${created}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {},
      async getCheckout(id) {
        return { checkoutId: id, status: "open", paymentStatus: "unpaid" };
      },
    };
    const first = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.setNow(NOW + 61 * 60 * 1000);
    const again = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(again.checkoutId, first.checkoutId);
    assert.equal(again.reused, true);
    assert.equal(created, 1);
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "pending");
  });

  it("blocks when cancel succeeds but the session cannot be read", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const provider = {
      async createCheckout() {
        return {
          checkoutId: "chk_1",
          checkoutUrl: "https://checkout.example/1",
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {},
      async getCheckout() {
        throw new Error("bachs checkout read failed");
      },
    };
    await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.setNow(NOW + 61 * 60 * 1000);
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /previous payment still processing/
    );
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "pending");
  });

  it("replaces the attempt only after cancel and a closed session read", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    let created = 0;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: `chk_${created}`,
          checkoutUrl: `https://checkout.example/${created}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {},
      async getCheckout(id) {
        return { checkoutId: id, status: "cancelled", paymentStatus: "" };
      },
    };
    const first = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.setNow(NOW + 61 * 60 * 1000);
    const fresh = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const previous = ledger.attempts.find((row) => row.checkoutSessionId === first.checkoutId);
    assert.equal(previous.status, "cancelled");
    assert.equal(fresh.reused, false);
    assert.equal(created, 2);
  });

  it("keeps an unattached session and reuses it on the next click", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    let created = 0;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: `chk_${created}`,
          checkoutUrl: `https://checkout.example/${created}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {
        throw new Error("bachs cancel failed");
      },
      async getCheckout(id) {
        return { checkoutId: id, status: "open", paymentStatus: "unpaid" };
      },
    };
    ledger.attachCheckout = async () => {
      throw new Error("attach failed");
    };
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /attach failed/
    );
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "pending_unattached");
    assert.equal(ledger.attempts[0].checkoutSessionId, "chk_1");
    const again = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(again.reused, true);
    assert.equal(again.checkoutId, "chk_1");
    assert.equal(created, 1);
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 0);
  });

  it("blocks the next click when an unattached session cannot be read", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    let created = 0;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: "chk_1",
          checkoutUrl: "https://checkout.example/1",
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async cancelCheckout() {
        throw new Error("bachs cancel failed");
      },
      async getCheckout() {
        throw new Error("bachs checkout read failed");
      },
    };
    ledger.attachCheckout = async () => {
      throw new Error("attach failed");
    };
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /attach failed/
    );
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /previous payment still processing/
    );
    assert.equal(created, 1);
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "pending_unattached");
  });

  it("applies a collection on the live unattached attempt and credits a displaced failed one once", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.attempts[0].status = "pending_unattached";
    const live = provider.paidEvent(started.checkoutId, { secret: SECRET, now: NOW, eventId: "evt_live_unattached" });
    const applied = await handlePayWebhook({ ...live, secret: SECRET, ledger, now: NOW });
    assert.equal(applied.body.action, "apply");
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.credits.length, 0);
    const replay = await handlePayWebhook({ ...live, secret: SECRET, ledger, now: NOW });
    assert.equal(replay.body.duplicate, true);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);

    const { ledger: open, token: openToken } = seedPayable("100.00", "100.00");
    const second = new MockPayProvider();
    const firstCheckout = await startInvoiceCheckout({
      token: openToken,
      origin: "https://app.example",
      ledger: open,
      provider: second,
    });
    open.attempts[0].status = "failed";
    open.setNow(NOW + 61 * 60 * 1000);
    await startInvoiceCheckout({ token: openToken, origin: "https://app.example", ledger: open, provider: second });
    const late = second.paidEvent(firstCheckout.checkoutId, { secret: SECRET, now: NOW, eventId: "evt_displaced" });
    const credited = await handlePayWebhook({ ...late, secret: SECRET, ledger: open, now: NOW });
    assert.equal(credited.body.action, "apply");
    assert.equal(open.invoices.get("inv1").status, "paid");
    assert.equal(open.credits.length, 0);
    assert.equal(toCents(open.invoices.get("inv1").amountPaidKes), toCents("100"));
    const again = await handlePayWebhook({ ...late, secret: SECRET, ledger: open, now: NOW });
    assert.equal(again.body.duplicate, true);
    assert.equal(open.credits.length, 0);
    assert.equal(open.payments.filter((row) => row.matchStatus !== "issue").length, 1);
    assert.equal(
      toCents(open.invoices.get("inv1").amountPaidKes) +
        open.credits.reduce((sum, row) => sum + toCents(row.amountKes), 0n),
      toCents("100")
    );
  });

  it("applies a collection on a cancelled attempt to the invoice, and credits only the excess", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    ledger.attempts[0].status = "cancelled";
    const event = provider.paidEvent(started.checkoutId, { secret: SECRET, now: NOW, eventId: "evt_late" });
    const first = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(first.body.action, "apply");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("100"));
    assert.equal(ledger.credits.length, 0);
    const replay = await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    assert.equal(replay.body.duplicate, true);
    assert.equal(ledger.credits.length, 0);
    const extra = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      eventId: "evt_late_more",
      collectedKes: "140.00",
      amountKes: "40.00",
    });
    const excess = await handlePayWebhook({ ...extra, secret: SECRET, ledger, now: NOW });
    assert.equal(excess.body.action, "credit");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("100"));
    assert.equal(ledger.credits.length, 1);
    assert.equal(toCents(ledger.credits[0].amountKes), toCents("40"));
    assert.equal(ledger.credits[0].idempotencyKey.startsWith(`checkout-total:bachs:${started.checkoutId}:`), true);
    const rows = reconciliationReport({
      attempts: ledger.attempts,
      invoices: [],
      payments: ledger.payments,
      credits: ledger.credits,
      now: NOW,
    });
    assert.ok(rows.some((row) => row.kind === "credited_cancelled"));
    assert.ok(!rows.some((row) => row.detail === "Collected on a cancelled checkout with no credit"));
  });

  it("expires a return id after 24 hours", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const fresh = await ledger.lookupReturn(ledger.attempts[0].returnId);
    assert.equal(fresh.found, true);
    assert.equal(fresh.state, "payable");
    ledger.setNow(NOW + 25 * 60 * 60 * 1000);
    const stale = await ledger.lookupReturn(ledger.attempts[0].returnId);
    assert.equal(stale.state, "expired");
    assert.equal(started.reused, false);
  });

  it("does not create again when a waiter sees a parked session and the next create would throw", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const race = await raceUntilParked(ledger, token, async (creates) => {
      if (creates > 1) throw new Error("bachs checkout failed");
      return {
        checkoutId: "chk_1",
        checkoutUrl: "https://checkout.example/1",
        expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
      };
    });
    assert.equal(race.creates, 1);
    assert.equal(race.again.reused, true);
    assert.equal(race.again.checkoutId, "chk_1");
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "pending_unattached");
    assert.equal(ledger.attempts[0].checkoutSessionId, "chk_1");
  });

  it("does not replace a parked session id when a waiter sees it and a second create would succeed", async () => {
    const { ledger, token } = seedPayable("100.00", "100.00");
    const race = await raceUntilParked(ledger, token, async (creates) => ({
      checkoutId: `chk_${creates}`,
      checkoutUrl: `https://checkout.example/${creates}`,
      expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
    }));
    assert.equal(race.creates, 1);
    assert.equal(race.again.checkoutId, "chk_1");
    assert.equal(ledger.attempts[0].status, "pending_unattached");
    assert.equal(ledger.attempts[0].checkoutSessionId, "chk_1");
    await assert.rejects(
      ledger.parkUnattached(ledger.attempts[0].id, {
        checkoutId: "chk_2",
        checkoutUrl: "https://checkout.example/2",
      }),
      /already parked/
    );
    assert.equal(ledger.attempts[0].checkoutSessionId, "chk_1");
  });

  it("reuses an open checkout after an underpay and credits one later collection", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    let created = 0;
    const provider = new MockPayProvider();
    provider.createCheckout = async () => {
      created += 1;
      return {
        checkoutId: `chk_${created}`,
        checkoutUrl: `https://checkout.example/${created}`,
        expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
      };
    };
    provider.getCheckout = async (id) => ({ checkoutId: id, status: "open", paymentStatus: "requires_action" });
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const short = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "2000.00",
      eventId: "evt_short",
    });
    const partial = await handlePayWebhook({ ...short, secret: SECRET, ledger, now: NOW });
    assert.equal(partial.body.action, "apply_partial");
    const same = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "2000.00",
      eventId: "evt_same",
    });
    const duplicate = await handlePayWebhook({ ...same, secret: SECRET, ledger, now: NOW });
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(ledger.credits.length, 0);
    const again = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(again.reused, true);
    assert.equal(again.checkoutId, started.checkoutId);
    assert.equal(created, 1);
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 0);
    const extra = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "320.00",
      collectedKes: "2320.00",
      eventId: "evt_extra",
      chargeId: "ch_rest",
    });
    const credited = await handlePayWebhook({ ...extra, secret: SECRET, ledger, now: NOW });
    assert.equal(credited.body.action, "apply");
    assert.equal(ledger.credits.length, 0);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("2320"));
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.payments.length, 1);
    const replay = await handlePayWebhook({ ...extra, secret: SECRET, ledger, now: NOW });
    assert.equal(replay.body.duplicate, true);
    const smaller = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "100.00",
      eventId: "evt_extra_2",
      chargeId: "ch_rest",
    });
    await handlePayWebhook({ ...smaller, secret: SECRET, ledger, now: NOW });
    assert.equal(ledger.credits.length, 0);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("2320"));
    const afterPaid = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "100.00",
      collectedKes: "2420.00",
      eventId: "evt_after_paid",
      chargeId: "ch_after",
    });
    const excess = await handlePayWebhook({ ...afterPaid, secret: SECRET, ledger, now: NOW });
    assert.equal(excess.body.action, "credit");
    assert.equal(ledger.credits.length, 1);
    assert.equal(toCents(ledger.credits[0].amountKes), toCents("100.00"));
    assert.equal(
      toCents(ledger.invoices.get("inv1").amountPaidKes) + toCents(ledger.credits[0].amountKes),
      toCents("2420")
    );
  });

  it("credits the difference once when a later collection is larger than the partial", async () => {
    const { ledger, token } = seedPayable("2000.00", "2000.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const short = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "1400.00",
      eventId: "evt_1400",
    });
    await handlePayWebhook({ ...short, secret: SECRET, ledger, now: NOW });
    const more = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "2000.00",
      eventId: "evt_2000",
    });
    const credited = await handlePayWebhook({ ...more, secret: SECRET, ledger, now: NOW });
    assert.equal(credited.body.action, "apply");
    assert.equal(ledger.credits.length, 0);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("2000"));
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    await handlePayWebhook({ ...more, secret: SECRET, ledger, now: NOW });
    assert.equal(ledger.credits.length, 0);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("2000"));
    assert.equal(ledger.payments.length, 1);
    assert.equal(toCents(ledger.payments[0].amountKes), toCents("2000"));
  });

  function collected(ledger) {
    const paid = toCents(ledger.invoices.get("inv1").amountPaidKes);
    return ledger.credits.reduce((sum, row) => sum + toCents(row.amountKes), paid);
  }

  async function post(provider, ledger, checkoutId, opts) {
    return handlePayWebhook({
      ...provider.paidEvent(checkoutId, { secret: SECRET, now: NOW, ...opts }),
      secret: SECRET,
      ledger,
      now: NOW,
    });
  }

  it("does not sum two equal event amounts when Bachs' total stays the same", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, { amountKes: "10.00", eventId: "evt_eq_1", chargeId: "ch_a" });
    const placeholder = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      eventId: "evt_eq_2",
      chargeId: `ch_${started.checkoutId}`,
    });
    assert.equal(placeholder.body.action, "issue");
    assert.equal(placeholder.body.reason, "collected_identity_missing");
    const replay = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      eventId: "evt_eq_3",
      chargeId: `ch_${started.checkoutId}`,
    });
    assert.equal(replay.body.duplicate, true);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(ledger.credits.length, 0);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    assert.match(ledger.payments.find((row) => row.matchStatus === "issue").providerRef, new RegExp(`ch_${started.checkoutId}`));
    assert.equal(collected(ledger), toCents("10"));
  });

  it("applies a running Bachs total once, in either event order, and ignores a replay", async () => {
    for (const order of [
      ["checkout.completed", "collection.succeeded"],
      ["collection.succeeded", "checkout.completed"],
    ]) {
      const { ledger, token } = seedPayable("20.00", "20.00");
      const provider = new MockPayProvider();
      const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
      await post(provider, ledger, started.checkoutId, {
        type: order[0],
        amountKes: "10.00",
        collectedKes: "10.00",
        eventId: "evt_order_1",
        extraData: order[0] === "checkout.completed" ? { payment_status: "paid" } : {},
      });
      await post(provider, ledger, started.checkoutId, {
        type: order[1],
        amountKes: "10.00",
        collectedKes: "10.00",
        chargeId: "ch_other",
        eventId: "evt_order_2",
        extraData: order[1] === "checkout.completed" ? { payment_status: "paid" } : { amount_paid: "20.00" },
      });
      assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
      assert.equal(ledger.credits.length, 0);
      assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
      assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
      assert.equal(collected(ledger), toCents("10"));
    }

    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_1",
      eventId: "evt_run_1",
    });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "20.00",
      chargeId: "ch_2",
      eventId: "evt_run_2",
      extraData: { amount_paid: "20.00" },
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(ledger.credits.length, 0);
    assert.equal(ledger.payments.length, 1);
    assert.equal(collected(ledger), toCents("20"));
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "20.00",
      chargeId: "ch_2",
      eventId: "evt_run_replay",
    });
    assert.equal(collected(ledger), toCents("20"));
    assert.equal(ledger.payments.length, 1);
  });

  it("keeps a running total on a larger invoice from being applied twice", async () => {
    const { ledger, token } = seedPayable("30.00", "30.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_1",
      eventId: "evt_30_1",
    });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "20.00",
      chargeId: "ch_2",
      eventId: "evt_30_2",
      extraData: { amount_paid: "20.00" },
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(ledger.credits.length, 0);
    assert.equal(collected(ledger), toCents("20"));
    assert.equal(ledger.payments.length, 1);
  });

  it("applies a higher cumulative total and ignores a later smaller report", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      eventId: "evt_small_1",
      chargeId: "ch_a",
    });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "4.00",
      collectedKes: "14.00",
      eventId: "evt_small_2",
      chargeId: "ch_b",
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("14"));
    assert.equal(ledger.credits.length, 0);
    assert.equal(collected(ledger), toCents("14"));
    await post(provider, ledger, started.checkoutId, {
      amountKes: "1.00",
      collectedKes: "14.00",
      eventId: "evt_small_lower",
      chargeId: "ch_b",
    });
    assert.equal(ledger.credits.length, 0);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("14"));
    assert.equal(collected(ledger), toCents("14"));
    provider.setStatus(started.checkoutId, "expired");
    const remainder = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(toCents(ledger.attempts.find((row) => row.checkoutSessionId === remainder.checkoutId).amountKes), toCents("6"));
  });

  it("serializes two events that both read the same Bachs total", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const first = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "10.00",
      collectedKes: "20.00",
      eventId: "evt_race_1",
      chargeId: "ch_a",
    });
    const second = provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "10.00",
      collectedKes: "20.00",
      eventId: "evt_race_2",
      chargeId: "ch_b",
    });
    await Promise.all([
      handlePayWebhook({ ...first, secret: SECRET, ledger, now: NOW }),
      handlePayWebhook({ ...second, secret: SECRET, ledger, now: NOW }),
    ]);
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(ledger.credits.length, 0);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    assert.equal(toCents(ledger.payments.find((row) => row.matchStatus !== "issue").amountKes), toCents("20"));
    assert.equal(collected(ledger), toCents("20"));
  });

  it("stores an unreadable Bachs read and applies once a later read succeeds", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const unread = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      eventId: "evt_unread",
      unreadable: true,
    });
    assert.equal(unread.body.action, "retry");
    assert.equal(ledger.payments.length, 0);
    assert.equal(ledger.events.size, 1);
    assert.equal([...ledger.events.values()][0].needsRetry, true);
    const later = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      eventId: "evt_later",
      unreadable: false,
    });
    assert.equal(later.body.action, "apply_partial");
    assert.equal(collected(ledger), toCents("10"));
    assert.equal(ledger.payments.length, 1);
  });

  it("opens one review when a new charge id is not covered by the Bachs total", async () => {
    const { checkoutFailure } = require("../dashboard/src/lib/invoicePay/provider");
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_a",
      eventId: "evt_cover_1",
    });
    const second = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_b",
      eventId: "evt_cover_2",
    });
    assert.equal(second.body.action, "issue");
    assert.equal(second.body.reason, "collected_total_short");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(ledger.credits.length, 0);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    const issue = ledger.payments.find((row) => row.matchStatus === "issue");
    assert.equal(issue.raw.get_kes, "10.00");
    assert.equal(issue.raw.seen_kes, "10");
    assert.equal(issue.raw.event.id, "evt_cover_2");
    assert.equal(ledger.alerts.filter((row) => row.action === "checkout_total_review").length, 1);
    const again = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_b",
      eventId: "evt_cover_3",
    });
    assert.equal(again.body.duplicate, true);
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    provider.setStatus(started.checkoutId, "expired");
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /checkout total needs review/
    );
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 0);
    await assert.rejects(
      ledger.resolveCheckoutReview({
        provider: "bachs",
        providerRef: issue.providerRef,
        actor: "ada",
        reason: "Checked the receipt",
      }),
      /resolve choice is required/
    );
    await ledger.resolveCheckoutReview({
      provider: "bachs",
      providerRef: issue.providerRef,
      actor: "ada",
      reason: "Checked the receipt",
      choice: "nothing",
    });
    const resolved = ledger.alerts.find((row) => row.action === "checkout_total_review_resolved");
    assert.equal(resolved.actor, "ada");
    assert.equal(resolved.reason, "Checked the receipt");
    assert.equal(resolved.choice, "nothing");
    const remainder = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const pending = ledger.attempts.filter((row) => row.status === "pending");
    assert.equal(pending.length, 1);
    assert.equal(toCents(pending[0].amountKes), toCents("10"));
    assert.notEqual(remainder.checkoutId, started.checkoutId);
    assert.equal(checkoutFailure(new Error("checkout total needs review")).status, 409);
  });

  it("books a placeholder or blank collection and does not reopen the same amount", async () => {
    for (const identity of ["placeholder", "blank"]) {
      const { ledger, token } = seedPayable("20.00", "20.00");
      const provider = new MockPayProvider();
      const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
      const posted = await post(provider, ledger, started.checkoutId, {
        amountKes: "10.00",
        collectedKes: "10.00",
        eventId: `evt_${identity}`,
        ...(identity === "placeholder"
          ? { chargeId: `ch_${started.checkoutId}` }
          : { extraData: { charge_id: null } }),
      });
      assert.equal(posted.body.action, "issue");
      assert.equal(posted.body.reason, "collected_identity_missing");
      assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), 0n);
      const issue = ledger.payments.find((row) => row.matchStatus === "issue");
      assert.equal(issue.raw.checkout_id, started.checkoutId);
      await assert.rejects(
        ledger.resolveCheckoutReview({
          provider: "bachs",
          providerRef: issue.providerRef,
          actor: "ada",
          reason: "Book the reading",
        }),
        /resolve choice is required/
      );
      assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), 0n);
      await assert.rejects(
        ledger.resolveCheckoutReview({
          provider: "bachs",
          providerRef: issue.providerRef,
          actor: "ada",
          reason: "Book the reading",
          choice: "book",
          totalKes: "9",
        }),
        /collected total fell/
      );
      assert.equal(issue.raw.review_status, "open");
      await ledger.resolveCheckoutReview({
        provider: "bachs",
        providerRef: issue.providerRef,
        actor: "ada",
        reason: "Book the reading",
        choice: "book",
      });
      assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
      assert.equal(ledger.credits.length, 0);
      await ledger.resolveCheckoutReview({
        provider: "bachs",
        providerRef: issue.providerRef,
        actor: "ada",
        reason: "Book the reading again",
        choice: "book",
      });
      assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
      const first = ledger.attempts.find((row) => row.checkoutSessionId === started.checkoutId);
      await ledger.markAttempt(first.id, { status: "succeeded", closedAt: new Date(NOW).toISOString() });
      provider.setStatus(started.checkoutId, "expired");
      const remainder = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
      assert.notEqual(remainder.checkoutId, started.checkoutId);
      const pending = ledger.attempts.find((row) => row.checkoutSessionId === remainder.checkoutId);
      assert.equal(toCents(pending.amountKes), toCents("10"));
    }
  });

  it("nothing collected leaves the books and allows a checkout for the unpaid amount", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      eventId: "evt_none",
      chargeId: `ch_${started.checkoutId}`,
    });
    const issue = ledger.payments.find((row) => row.matchStatus === "issue");
    await ledger.resolveCheckoutReview({
      provider: "bachs",
      providerRef: issue.providerRef,
      actor: "ada",
      reason: "Confirmed nothing collected",
      choice: "nothing",
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), 0n);
    assert.equal(ledger.credits.length, 0);
    const first = ledger.attempts.find((row) => row.checkoutSessionId === started.checkoutId);
    await ledger.markAttempt(first.id, { status: "succeeded", closedAt: new Date(NOW).toISOString() });
    provider.setStatus(started.checkoutId, "expired");
    const again = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.notEqual(again.checkoutId, started.checkoutId);
    const pending = ledger.attempts.find((row) => row.checkoutSessionId === again.checkoutId);
    assert.equal(toCents(pending.amountKes), toCents("20"));
  });

  it("books a placeholder rise above the amount due as a credit", async () => {
    const { ledger, token } = seedPayable("10.00", "10.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "20.00",
      collectedKes: "20.00",
      eventId: "evt_over",
      chargeId: `ch_${started.checkoutId}`,
    });
    const issue = ledger.payments.find((row) => row.matchStatus === "issue");
    await ledger.resolveCheckoutReview({
      provider: "bachs",
      providerRef: issue.providerRef,
      actor: "ada",
      reason: "Book the extra",
      choice: "book",
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    assert.equal(ledger.credits.length, 1);
    assert.equal(toCents(ledger.credits[0].amountKes), toCents("10"));
    assert.equal(ledger.credits[0].reason, "checkout_total");
  });

  it("refuses an unreadable or lower live reading and books the stored total when live is off", () => {
    const stored = bookTotalForResolve({ live: false, storedKes: "10" });
    assert.equal(stored.ok, true);
    assert.equal(stored.totalKes, "10");
    const unread = bookTotalForResolve({ live: true, storedKes: "10", fresh: { unreadable: true } });
    assert.equal(unread.ok, false);
    assert.equal(unread.error, "Couldn't read the collected amount. Nothing changed.");
    const currency = bookTotalForResolve({
      live: true,
      storedKes: "10",
      fresh: { currencyIssue: true, totalKes: "10", cents: 1000n },
    });
    assert.equal(currency.ok, false);
    const lower = bookTotalForResolve({ live: true, storedKes: "10", fresh: { totalKes: "9", cents: 900n } });
    assert.equal(lower.ok, false);
    assert.equal(lower.error, "The collected amount is lower than the reading. Nothing changed.");
    const fresh = bookTotalForResolve({ live: true, storedKes: "10", fresh: { totalKes: "12", cents: 1200n } });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.totalKes, "12");
  });

  it("books a running total when the rise covers the collection, and a per-event amount when it does not", () => {
    const covered = bookTotalForReview({
      kind: "short_rise",
      getKes: "20",
      seenKes: "10",
      eventKes: "10",
      priceKes: "30",
    });
    assert.equal(covered.perEvent, false);
    assert.equal(covered.totalKes, "20");
    const slice = bookTotalForReview({
      kind: "short_rise",
      getKes: "10",
      seenKes: "10",
      eventKes: "10",
      priceKes: "20",
    });
    assert.equal(slice.perEvent, true);
    assert.equal(slice.totalKes, "20");
    const priceEcho = bookTotalForReview({
      kind: "short_rise",
      getKes: "20",
      seenKes: "20",
      eventKes: "20",
      priceKes: "20",
    });
    assert.equal(priceEcho.perEvent, false);
    assert.equal(priceEcho.totalKes, "20");
    const fell = bookTotalForReview({
      kind: "decrease",
      getKes: "10",
      seenKes: "20",
      eventKes: "10",
      priceKes: "20",
      passedKes: "9",
    });
    assert.equal(fell.ok, false);
  });

  it("opens one review when a new receipt is not covered by the Bachs total", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_a",
      eventId: "evt_rcpt_1",
      extraData: { mpesa_receipt: "UBC1" },
    });
    const second = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_b",
      eventId: "evt_rcpt_2",
      extraData: { mpesa_receipt: "UBC2" },
    });
    assert.equal(second.body.action, "issue");
    assert.equal(second.body.reason, "collected_total_short");
    assert.equal(collected(ledger), toCents("10"));
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      eventId: "evt_rcpt_2b",
      extraData: { mpesa_receipt: "UBC2" },
    });
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    const issue = ledger.payments.find((row) => row.matchStatus === "issue");
    await ledger.resolveCheckoutReview({
      provider: "bachs",
      providerRef: issue.providerRef,
      actor: "ada",
      reason: "Second M-Pesa receipt",
      choice: "book",
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(collected(ledger), toCents("20"));
    await ledger.resolveCheckoutReview({
      provider: "bachs",
      providerRef: issue.providerRef,
      actor: "ada",
      reason: "Second M-Pesa receipt again",
      choice: "book",
    });
    assert.equal(collected(ledger), toCents("20"));
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
  });

  it("keeps a credit when the Bachs total falls and writes one review", async () => {
    const { ledger, token } = seedPayable("10.00", "10.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "20.00",
      collectedKes: "20.00",
      chargeId: "ch_high",
      eventId: "evt_high",
    });
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(collected(ledger), toCents("20"));
    const lower = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_high",
      eventId: "evt_lower",
    });
    assert.equal(lower.body.action, "issue");
    assert.equal(lower.body.reason, "collected_total_decreased");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(collected(ledger), toCents("20"));
    assert.equal(toCents(ledger.payments.find((row) => row.providerRef === started.checkoutId).amountKes), toCents("20"));
    const issue = ledger.payments.find((row) => row.matchStatus === "issue");
    assert.equal(issue.raw.get_kes, "10.00");
    assert.equal(issue.raw.seen_kes, "20");
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_high",
      eventId: "evt_lower_2",
    });
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
    assert.equal(ledger.alerts.filter((row) => row.action === "checkout_total_review").length, 1);
  });

  it("still applies a new charge when the Bachs total rises by that amount", async () => {
    const { ledger, token } = seedPayable("30.00", "30.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: "ch_rise_a",
      eventId: "evt_rise_a",
    });
    const second = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "20.00",
      chargeId: "ch_rise_b",
      eventId: "evt_rise_b",
    });
    assert.equal(second.body.action, "apply_partial");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 0);
    assert.equal(collected(ledger), toCents("20"));
    const attempt = ledger.attempts.find((row) => row.checkoutSessionId === started.checkoutId);
    assert.deepEqual(attempt.collectionIds, ["ch_rise_a", "ch_rise_b"]);
  });

  it("reviews a placeholder charge id instead of dropping it", async () => {
    const { collectionIdentity } = require("../dashboard/src/lib/invoicePay/webhook");
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const placeholder = `ch_${started.checkoutId}`;
    assert.equal(collectionIdentity({ charge_id: placeholder }, started.checkoutId), placeholder);
    const rise = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: placeholder,
      eventId: "evt_ph_rise",
    });
    assert.equal(rise.body.action, "issue");
    assert.equal(rise.body.reason, "collected_identity_missing");
    assert.equal(collected(ledger), 0n);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 0);
    const issue = ledger.payments.find((row) => row.matchStatus === "issue");
    assert.match(issue.providerRef, new RegExp(placeholder));
    const again = await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      collectedKes: "10.00",
      chargeId: placeholder,
      eventId: "evt_ph_rise_2",
    });
    assert.equal(again.body.duplicate, true);
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 1);
  });

  it("leaves a zero placeholder read as a wait so an expired checkout can close", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const expired = await post(provider, ledger, started.checkoutId, {
      type: "checkout.expired",
      amountKes: "20.00",
      collectedKes: "0",
      chargeId: `ch_${started.checkoutId}`,
      eventId: "evt_ph_zero",
    });
    assert.equal(expired.body.action, "wait");
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 0);
    assert.equal(ledger.attempts.find((row) => row.checkoutSessionId === started.checkoutId).status, "cancelled");
  });

  it("applies a rise when the event amount is the session price", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const first = await post(provider, ledger, started.checkoutId, {
      amountKes: "20.00",
      collectedKes: "10.00",
      chargeId: "ch_price_a",
      eventId: "evt_price_a",
    });
    assert.equal(first.body.action, "apply_partial");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 0);
    const second = await post(provider, ledger, started.checkoutId, {
      amountKes: "20.00",
      collectedKes: "20.00",
      chargeId: "ch_price_b",
      eventId: "evt_price_b",
    });
    assert.equal(second.body.action, "apply");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(ledger.payments.filter((row) => row.matchStatus === "issue").length, 0);
    const short = await post(provider, ledger, started.checkoutId, {
      amountKes: "5.00",
      collectedKes: "20.00",
      chargeId: "ch_price_c",
      eventId: "evt_price_c",
    });
    assert.equal(short.body.action, "issue");
    assert.equal(short.body.reason, "collected_total_short");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("20"));
    assert.equal(collected(ledger), toCents("20"));
  });

  it("retries a stored unreadable read once in live mode and skips a business that is not allowed", async () => {
    const { retryStoredReads } = require("../dashboard/src/lib/invoicePay/retryReads");
    const { ledger, token } = seedPayable("20.00", "20.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await post(provider, ledger, started.checkoutId, {
      amountKes: "10.00",
      eventId: "evt_retry_me",
      unreadable: true,
    });
    const adapters = {
      listEvents: async () =>
        [...ledger.events.values()]
          .filter((row) => row.needsRetry)
          .map((row) => ({ eventKey: row.eventKey, payload: row.payload })),
      clearRetry: async (eventKey) => {
        const row = ledger.events.get(`bachs:${eventKey}`);
        if (row) row.needsRetry = false;
      },
      findAttempt: (checkoutId) => ledger.findAttemptByCheckout(checkoutId),
      getCheckout: (checkoutId) => provider.getCheckout(checkoutId),
      settle: (input) => ledger.settleCheckoutReading(input),
    };
    const closed = {
      BACHS_MODE: "live",
      BACHS_LIVE_ALLOWED: "true",
      BACHS_API_KEY: "test-live",
      BACHS_LIVE_TENANT_ALLOWLIST: "someone-else",
    };
    const skipped = await retryStoredReads({ ...adapters, env: closed });
    assert.equal(skipped.rows[0].reason, "live_not_allowlisted");
    assert.equal(ledger.payments.length, 0);
    assert.equal([...ledger.events.values()][0].needsRetry, true);
    const stillDark = await retryStoredReads({ ...adapters, env: { BACHS_MODE: "sandbox" } });
    assert.equal(stillDark.rows[0].kind, "retry_unreadable");
    assert.equal([...ledger.events.values()][0].needsRetry, true);
    provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "10.00",
      collectedKes: "10.00",
      eventId: "evt_retry_me",
      unreadable: false,
    });
    const liveEnv = {
      BACHS_MODE: "live",
      BACHS_LIVE_ALLOWED: "true",
      BACHS_API_KEY: "test-live",
      BACHS_LIVE_TENANT_ALLOWLIST: "*",
    };
    const settled = await retryStoredReads({ ...adapters, env: liveEnv });
    assert.equal(settled.rows[0].kind, "retry_settled");
    assert.equal(collected(ledger), toCents("10"));
    assert.equal([...ledger.events.values()][0].needsRetry, false);
    const again = await retryStoredReads({ ...adapters, env: liveEnv });
    assert.equal(again.rows.length, 0);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
  });

  it("sweeps an open live checkout from the running total and skips a business that is not allowed", async () => {
    const { sweepOpenCheckouts } = require("../dashboard/src/lib/invoicePay/retryReads");
    const { ledger, token } = seedPayable("10.00", "10.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    provider.paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "10.00",
      collectedKes: "10.00",
      leaveCheckout: false,
    });
    const attempt = ledger.attempts.find((row) => row.checkoutSessionId === started.checkoutId);
    const adapters = {
      listAttempts: async () => [{
        tenantId: attempt.tenantId,
        invoiceId: attempt.invoiceId,
        checkoutId: started.checkoutId,
      }],
      getCheckout: (checkoutId) => provider.getCheckout(checkoutId),
      settleTotal: (input) => ledger.reconcileCheckoutTotal(input),
    };
    const closed = await sweepOpenCheckouts({
      ...adapters,
      env: { BACHS_MODE: "sandbox", BACHS_API_KEY: "sk_sandbox_x" },
    });
    assert.equal(closed.rows.length, 0);
    assert.equal(collected(ledger), 0n);
    const skipped = await sweepOpenCheckouts({
      ...adapters,
      env: {
        BACHS_MODE: "live",
        BACHS_LIVE_ALLOWED: "true",
        BACHS_API_KEY: "test-live",
        BACHS_LIVE_TENANT_ALLOWLIST: "someone-else",
      },
    });
    assert.equal(skipped.rows[0].reason, "live_not_allowlisted");
    assert.equal(collected(ledger), 0n);
    const liveEnv = {
      BACHS_MODE: "live",
      BACHS_LIVE_ALLOWED: "true",
      BACHS_API_KEY: "test-live",
      BACHS_LIVE_TENANT_ALLOWLIST: "*",
    };
    const settled = await sweepOpenCheckouts({ ...adapters, env: liveEnv });
    assert.equal(settled.rows[0].kind, "sweep_settled");
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(ledger.invoices.get("inv1").status, "paid");
    const again = await sweepOpenCheckouts({ ...adapters, env: liveEnv });
    assert.equal(again.rows[0].noop, true);
    assert.equal(ledger.payments.filter((row) => row.matchStatus !== "issue").length, 1);
  });

  it("reconciles a higher later total so invoice paid plus credits equals the money", async () => {
    const { ledger, token } = seedPayable("10.00", "10.00");
    const provider = new MockPayProvider();
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    for (const [amount, eventId] of [
      ["10.00", "evt_cum_10"],
      ["12.00", "evt_cum_12"],
      ["20.00", "evt_cum_20"],
    ]) {
      await handlePayWebhook({
        ...provider.paidEvent(started.checkoutId, {
          secret: SECRET,
          now: NOW,
          amountKes: amount,
          eventId,
          chargeId: "ch_same",
        }),
        secret: SECRET,
        ledger,
        now: NOW,
      });
    }
    assert.equal(toCents(ledger.invoices.get("inv1").amountPaidKes), toCents("10"));
    assert.equal(collected(ledger), toCents("20"));
    assert.equal(ledger.payments.length, 1);
    assert.equal(toCents(ledger.payments[0].amountKes), toCents("20"));
    await handlePayWebhook({
      ...provider.paidEvent(started.checkoutId, {
        secret: SECRET,
        now: NOW,
        amountKes: "20.00",
        eventId: "evt_cum_replay",
        chargeId: "ch_same",
      }),
      secret: SECRET,
      ledger,
      now: NOW,
    });
    assert.equal(collected(ledger), toCents("20"));
    assert.equal(ledger.credits.length, 2);
  });

  it("reads Bachs after checkout expiry and blocks a new session while it is still open", async () => {
    const { ledger, token } = seedPayable("20.00", "20.00");
    let created = 0;
    let open = true;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: `chk_exp_${created}`,
          checkoutUrl: `https://checkout.example/${created}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async getCheckout(id) {
        return { checkoutId: id, status: open ? "open" : "expired", paymentStatus: "requires_action" };
      },
    };
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    await handlePayWebhook({
      ...new MockPayProvider().paidEvent(started.checkoutId, {
        secret: SECRET,
        now: NOW,
        amountKes: "10.00",
        eventId: "evt_exp",
        chargeId: "ch_exp",
      }),
      secret: SECRET,
      ledger,
      now: NOW,
    });
    ledger.attempts[0].expiresAt = new Date(NOW - 60 * 1000).toISOString();
    assert.equal(ledger.attempts[0].closedAt, null);
    const blocked = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(blocked.reused, true);
    assert.equal(blocked.checkoutId, started.checkoutId);
    assert.equal(created, 1);
    assert.equal(ledger.attempts.filter((row) => row.status === "pending").length, 0);
    assert.equal(ledger.attempts[0].status, "succeeded");
    open = false;
    const fresh = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(created, 2);
    assert.equal(fresh.checkoutId, "chk_exp_2");
    assert.equal(toCents(ledger.attempts[1].amountKes), toCents("10"));
  });

  it("opens a remainder checkout only after the underpaid session is closed", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    let created = 0;
    let open = true;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: `chk_${created}`,
          checkoutUrl: `https://checkout.example/${created}`,
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async getCheckout(id) {
        return { checkoutId: id, status: open ? "open" : "expired", paymentStatus: "requires_action" };
      },
    };
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const event = new MockPayProvider().paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "2000.00",
      eventId: "evt_short_closed",
    });
    await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    open = false;
    const fresh = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    assert.equal(created, 2);
    assert.equal(fresh.reused, false);
    assert.equal(fresh.checkoutId, "chk_2");
    assert.equal(ledger.attempts[0].status, "succeeded");
    assert.equal(ledger.attempts[0].checkoutSessionId, "chk_1");
    assert.ok(new Date(ledger.attempts[0].expiresAt).getTime() < NOW);
    assert.equal(toCents(ledger.attempts[1].amountKes), toCents("320"));
  });

  it("blocks a remainder checkout when the underpaid session cannot be read", async () => {
    const { ledger, token } = seedPayable("2320.00", "2000.00");
    let created = 0;
    const provider = {
      async createCheckout() {
        created += 1;
        return {
          checkoutId: "chk_1",
          checkoutUrl: "https://checkout.example/1",
          expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        };
      },
      async getCheckout() {
        throw new Error("bachs checkout read failed");
      },
    };
    const started = await startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider });
    const event = new MockPayProvider().paidEvent(started.checkoutId, {
      secret: SECRET,
      now: NOW,
      amountKes: "2000.00",
      eventId: "evt_short_unread",
    });
    await handlePayWebhook({ ...event, secret: SECRET, ledger, now: NOW });
    await assert.rejects(
      startInvoiceCheckout({ token, origin: "https://app.example", ledger, provider }),
      /previous payment still processing/
    );
    assert.equal(created, 1);
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].status, "succeeded");
    assert.equal(ledger.attempts[0].checkoutSessionId, "chk_1");
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
    assert.equal(row.status, "open");
    assert.match(url, /\/v1\/checkout-sessions\/chk_1$/);
  });
});

const { assertBachsAllowed, paymentsClosed, checkoutFailure } = require("../dashboard/src/lib/invoicePay/provider");
const { presentPayPage, PAYMENTS_UNAVAILABLE_NOTICE } = require("../dashboard/src/lib/invoicePay/view");
const { listOwnerInvoices } = require("../dashboard/src/lib/invoicePay/invoiceList");

const PROD_CLOSED = {
  BACHS_MODE: "sandbox",
  BACHS_API_KEY: "sk_test_not_live",
  SUPABASE_URL: "https://fjxcdccgyhnvnnlnovcl.supabase.co",
};

function invoiceQuery(result) {
  const q = Promise.resolve(result);
  q.select = () => q;
  q.eq = () => q;
  q.in = () => q;
  q.order = () => q;
  return q;
}

describe("reads while the Bachs gate refuses", () => {
  it("lists invoices while production is refused", async () => {
    assert.equal(paymentsClosed(PROD_CLOSED), true);
    assert.throws(() => assertBachsAllowed(PROD_CLOSED), /production database/);
    const empty = await listOwnerInvoices(
      {
        from() {
          return invoiceQuery({ data: [], error: null });
        },
      },
      "tenant-1"
    );
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.body.invoices, []);
    assert.deepEqual(empty.body.receipts, []);

    const listed = await listOwnerInvoices(
      {
        from(name) {
          if (name === "invoices") {
            return invoiceQuery({
              data: [
                {
                  id: "inv-1",
                  invoice_number: "SCL-2026-000001",
                  status: "paid",
                  total_kes: "7000.00",
                  amount_paid_kes: "7000.00",
                  subtotal_kes: "7000.00",
                },
              ],
              error: null,
            });
          }
          return invoiceQuery({ data: [], error: null });
        },
      },
      "tenant-1"
    );
    assert.equal(listed.ok, true);
    assert.equal(listed.body.invoices[0].number, "SCL-2026-000001");
    assert.equal(listed.body.invoices[0].status, "paid");

    const root = path.join(__dirname, "..");
    const route = fs.readFileSync(path.join(root, "dashboard/src/app/api/billing/invoices/route.ts"), "utf8");
    assert.match(route, /listOwnerInvoices/);
    assert.doesNotMatch(route, /assertBachsAllowed/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "dashboard/src/lib/invoicePay/billingRead.ts"), "utf8"), /assertBachsAllowed/);
    for (const rel of [
      "dashboard/src/app/api/billing/invoices/[id]/route.ts",
      "dashboard/src/app/api/billing/invoices/[id]/pdf/route.ts",
      "dashboard/src/app/api/billing/receipts/[id]/route.ts",
      "dashboard/src/app/api/billing/receipts/[id]/pdf/route.ts",
      "dashboard/src/lib/invoicePay/ledger.ts",
      "dashboard/src/lib/invoicePay/invoiceList.js",
    ]) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, rel), "utf8"), /assertBachsAllowed/, rel);
    }
  });

  it("shows the invalid-link page for an unknown token while production is refused", () => {
    assert.throws(() => assertBachsAllowed(PROD_CLOSED), /production database/);
    const view = presentPayPage(payView({ lookup: { found: false } }), PROD_CLOSED);
    assert.equal(view.state, "missing");
    assert.equal(view.title, "This link is not valid");
    assert.equal(view.payLabel, null);
    assert.equal(view.notice, null);

    const root = path.join(__dirname, "..");
    const load = fs.readFileSync(path.join(root, "dashboard/src/lib/invoicePay/loadPay.ts"), "utf8");
    assert.ok(load.indexOf("ledger.lookup") < load.indexOf("presentPayPage("));
    assert.doesNotMatch(load, /assertBachsAllowed/);
    const payPage = fs.readFileSync(path.join(root, "dashboard/src/app/pay/[token]/page.tsx"), "utf8");
    assert.ok(payPage.indexOf("await connection()") < payPage.indexOf("loadPayView(token"));
    assert.doesNotMatch(payPage, /export const revalidate/);
    assert.doesNotMatch(payPage, /unstable_dynamicStaleTime/);

    const expired = presentPayPage(
      payView({
        lookup: {
          found: true,
          state: "expired",
          businessName: "Jirani Cleaning",
          invoiceNumber: "SCL-2026-000001",
          totalKes: "7000.00",
          amountPaidKes: "0",
          dueAt: "2026-10-24T21:00:00Z",
        },
      }),
      PROD_CLOSED
    );
    assert.equal(expired.title, "This link has expired");
    assert.equal(expired.payLabel, null);
  });

  it("returns payments_unavailable and hides Pay when the gate refuses", () => {
    const payable = presentPayPage(
      payView({
        lookup: {
          found: true,
          state: "payable",
          businessName: "Jirani Cleaning",
          invoiceNumber: "SCL-2026-000042",
          totalKes: "2320.00",
          amountPaidKes: "0",
          dueAt: "2026-10-24T21:00:00Z",
        },
      }),
      PROD_CLOSED
    );
    assert.equal(payable.title, "Jirani Cleaning");
    assert.equal(payable.invoiceNumber, "SCL-2026-000042");
    assert.equal(payable.totalLabel, "KSh 2,320");
    assert.equal(payable.payLabel, null);
    assert.equal(payable.notice, "Online payment isn't available yet. Contact support@scalers.co.ke");
    assert.equal(payable.notice, PAYMENTS_UNAVAILABLE_NOTICE);

    const open = presentPayPage(
      payView({
        lookup: {
          found: true,
          state: "payable",
          businessName: "Jirani Cleaning",
          invoiceNumber: "SCL-2026-000042",
          totalKes: "2320.00",
          amountPaidKes: "0",
        },
      }),
      { BACHS_MODE: "off" }
    );
    assert.equal(open.payLabel, "Pay KSh 2,320");
    assert.equal(open.notice, null);

    const savedMode = process.env.BACHS_MODE;
    const savedKey = process.env.BACHS_API_KEY;
    const savedAllowed = process.env.BACHS_LIVE_ALLOWED;
    const savedUrl = process.env.SUPABASE_URL;
    const savedPublic = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      process.env.BACHS_MODE = "off";
      process.env.BACHS_API_KEY = "sk_test_x";
      delete process.env.BACHS_LIVE_ALLOWED;
      process.env.SUPABASE_URL = "https://fjxcdccgyhnvnnlnovcl.supabase.co";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      assert.equal(paymentsClosed(), true);
      process.env.BACHS_MODE = "live";
      process.env.BACHS_LIVE_ALLOWED = "true";
      assert.equal(paymentsClosed(), false);
    } finally {
      if (savedMode === undefined) delete process.env.BACHS_MODE;
      else process.env.BACHS_MODE = savedMode;
      if (savedKey === undefined) delete process.env.BACHS_API_KEY;
      else process.env.BACHS_API_KEY = savedKey;
      if (savedAllowed === undefined) delete process.env.BACHS_LIVE_ALLOWED;
      else process.env.BACHS_LIVE_ALLOWED = savedAllowed;
      if (savedUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = savedUrl;
      if (savedPublic === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedPublic;
    }

    let caught;
    try {
      payProviderFromEnv(PROD_CLOSED);
    } catch (err) {
      caught = err;
    }
    assert.equal(caught.code, "prod_refused");
    assert.deepEqual(checkoutFailure(caught), { status: 503, error: "payments_unavailable" });
    try {
      payProviderFromEnv({ BACHS_MODE: "live", BACHS_API_KEY: "sk_live_x" });
    } catch (err) {
      caught = err;
    }
    assert.deepEqual(checkoutFailure(caught), { status: 503, error: "payments_unavailable" });
    assert.equal(
      checkoutFailure(Object.assign(new Error("previous payment still processing"), { code: "previous_processing" })).status,
      409
    );

    const root = path.join(__dirname, "..");
    const route = fs.readFileSync(path.join(root, "dashboard/src/app/api/pay/[token]/checkout/route.ts"), "utf8");
    assert.ok(route.indexOf("assertBachsAllowed(env)") < route.indexOf("startInvoiceCheckout({"));
    assert.match(route, /checkoutFailure/);
    const panel = fs.readFileSync(path.join(root, "dashboard/src/app/pay/[token]/PayPanel.tsx"), "utf8");
    assert.match(panel, /payments_unavailable/);
    assert.match(panel, /PAYMENTS_UNAVAILABLE_NOTICE/);
    assert.match(panel, /\/api\/pay\/\$\{encodeURIComponent\(token\)\}/);
    assert.match(panel, /cache: "no-store"/);
    const notice = fs.readFileSync(path.join(root, "dashboard/src/lib/invoicePay/paymentsNotice.js"), "utf8");
    assert.match(notice, /Online payment isn't available yet\. Contact support@scalers\.co\.ke/);
    const provider = fs.readFileSync(path.join(root, "dashboard/src/lib/invoicePay/provider.js"), "utf8");
    assert.match(provider, /function assertBachsAllowed/);
    assert.match(provider, /process\.env\.BACHS_MODE/);
    assert.match(provider, /process\.env\.BACHS_API_KEY/);
    assert.match(provider, /process\.env\.SUPABASE_URL/);
    assert.match(provider, /function publicSupabaseUrlName/);
    // A member access is rewritten to the build-time URL. The name is assembled instead.
    assert.doesNotMatch(provider, /\.NEXT_PUBLIC_/);
    assert.doesNotMatch(provider, /process\.env\.NEXT_PUBLIC/);
    assert.match(provider, /refusing production database/);
    assert.match(provider, /sk_live_/);
    assert.match(provider, /BACHS_MODE=live is refused/);
    const webhook = fs.readFileSync(path.join(root, "dashboard/src/app/api/billing/bachs/webhook/route.ts"), "utf8");
    assert.ok(webhook.indexOf("assertBachsAllowed(env)") < webhook.indexOf("handlePayWebhook({"));
  });
});
