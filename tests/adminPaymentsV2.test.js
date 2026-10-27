const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/paymentsView.ts"));

const pay = (o) => ({
  id: "1",
  businessId: "b",
  businessName: "Biz",
  invoiceId: "inv-1",
  invoiceNumber: "SCL-1",
  amountCents: 100000,
  matchStatus: "matched",
  providerRef: "ref-1",
  paidAt: "2026-10-12T09:00:00Z",
  createdAt: "2026-10-12T09:00:00Z",
  ...o,
});

test("default view prefers needs_check then unmatched", async () => {
  const { defaultPaymentView } = await load();
  assert.equal(defaultPaymentView([pay({ matchStatus: "issue" }), pay({ id: "2", matchStatus: "matched" })]), "needs_check");
  assert.equal(defaultPaymentView([pay({ matchStatus: "unmatched" })]), "unmatched");
  assert.equal(defaultPaymentView([pay({ matchStatus: "matched" })]), "all");
});

test("counts and totals by view", async () => {
  const { paymentCounts, paymentTotals, inPaymentView } = await load();
  const rows = [
    pay({ matchStatus: "issue" }),
    pay({ id: "2", matchStatus: "unmatched", amountCents: 50000 }),
    pay({ id: "3", matchStatus: "partial", amountCents: 25000 }),
    pay({ id: "4", matchStatus: "matched", amountCents: 10000 }),
  ];
  assert.deepEqual(paymentCounts(rows), { needs_check: 1, unmatched: 1, partial: 1, matched: 1, all: 4 });
  assert.equal(inPaymentView(rows[2], "partial"), true);
  assert.deepEqual(paymentTotals(rows.filter((r) => inPaymentView(r, "matched"))), { amount: 10000, count: 1 });
});

test("display status and search", async () => {
  const { displayStatus, matchesPayment, ksh } = await load();
  assert.equal(displayStatus(pay({ matchStatus: "issue" })), "Needs a check");
  assert.equal(ksh(120050), "KSh 1,200.50");
  assert.equal(matchesPayment(pay({ businessName: "Kona Cafe" }), "kona"), true);
  assert.equal(matchesPayment(pay({ invoiceNumber: "SCL-9" }), "SCL-9"), true);
  assert.equal(matchesPayment(pay({}), "zzz"), false);
});

test("Payments v2: list+pane, UnlockCta, honest disabled actions, ADMIN_V2 branch", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminPaymentsV2.tsx");
  const page = read("dashboard/src/app/admin/(console)/billing/payments/page.tsx");
  const ld = read("dashboard/src/lib/adminPaymentsV2Load.ts");
  const dev = read("dashboard/src/app/dev/admin-payments/page.tsx");
  assert.doesNotMatch(ui, /ReasonedSwitch/);
  assert.match(ui, /UnlockCta/);
  assert.match(read("dashboard/src/components/ops/UnlockCta.tsx"), /Unlock to edit/);
  assert.match(ui, /site="payments"/);
  assert.match(ui, /data-payments-table/);
  assert.match(ui, /data-phone-rows/);
  assert.match(ui, /businessPaneHref/);
  assert.match(ui, /data-action="collect"/);
  assert.match(ui, /PAYMENT_ACTION_WHY/);
  assert.doesNotMatch(ui, /fetch\(|"use server"/);
  assert.doesNotMatch(ui, /bg-brand|ReasonedSwitch|bachs|sautikit|twilio/i);
  assert.match(page, /isAdminV2Enabled\(\)[\s\S]*AdminPaymentsV2/);
  assert.match(page, /loadPaymentsV2/);
  assert.doesNotMatch(ld, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.match(dev, /AdminShell[^>]*v2/);
  assert.match(dev, /ADMIN_BILLING_TABS/);
  assert.match(dev, /ADMIN_PAYMENTS/);
});

test("ops loaders replace SkeletonList on listed routes", () => {
  const routes = [
    "businesses", "numbers", "quality", "packages", "billing/invoices", "billing/payments", "billing/home",
    "settings/general", "settings/services", "settings/voices", "settings/audit",
  ];
  for (const r of routes) {
    const s = read(`dashboard/src/app/admin/(console)/${r}/loading.tsx`);
    assert.doesNotMatch(s, /SkeletonList/, r);
    assert.match(s, /OpsLoading/, r);
  }
  assert.doesNotMatch(read("dashboard/src/app/admin/(console)/loading.tsx"), /SkeletonList/);
});

test("split list fills width when pane closed; soft min below 1280", () => {
  const css = read("dashboard/src/styles/ops.css");
  assert.match(css, /min-width: 1280px/);
  assert.match(css, /\.ops-split:has\(\[data-split-pane\]\) \.ops-split-list/);
  assert.match(css, /\.ops-split-list \{\s*flex: 1 1 auto;\s*min-width: 0;/);
});
