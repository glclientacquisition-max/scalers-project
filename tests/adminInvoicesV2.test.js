const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/invoicesView.ts"));
const now = new Date("2026-10-22T09:00:00Z");
const inv = (o) => ({ id: "1", number: "SCL-1", businessId: "b", businessName: "Biz", status: "open", totalCents: 100000, paidCents: 0,
  dueAt: "2026-10-12T09:00:00Z", issuedAt: "2026-10-01T00:00:00Z", paidAt: null, createdAt: "2026-10-01T00:00:00Z", periodStart: null, periodEnd: null, lines: [], ...o });

test("overdue is derived: open, past due, balance left", async () => {
  const { isOverdue, displayStatus, daysOverdue } = await load();
  assert.equal(isOverdue(inv({}), now), true);
  assert.equal(daysOverdue(inv({}), now), 10);
  assert.equal(isOverdue(inv({ paidCents: 100000 }), now), false);
  assert.equal(isOverdue(inv({ dueAt: "2026-10-30T00:00:00Z" }), now), false);
  assert.equal(displayStatus(inv({ dueAt: "2026-10-30T00:00:00Z" }), now), "Issued");
  assert.equal(displayStatus(inv({ status: "uncollectible" }), now), "Void (uncollectible)");
});

test("opens on Overdue only when there is one", async () => {
  const { defaultInvoiceView } = await load();
  assert.equal(defaultInvoiceView([inv({})], now), "overdue");
  assert.equal(defaultInvoiceView([inv({ status: "paid", paidCents: 100000 })], now), "all");
});

test("totals skip void and draft", async () => {
  const { invoiceTotals } = await load();
  const t = invoiceTotals([inv({ paidCents: 40000 }), inv({ status: "void" }), inv({ status: "draft" })]);
  assert.deepEqual(t, { total: 100000, paid: 40000, balance: 60000 });
});

test("CSV: EAT dates, KSh with decimals, quoted commas", async () => {
  const { invoicesCsv } = await load();
  const csv = invoicesCsv([inv({ businessName: "Kona, Cafe", dueAt: "2026-10-12T22:30:00Z" })], now);
  const [head, row] = csv.trim().split("\n");
  assert.match(head, /^Number,Business,Status/);
  assert.match(row, /^SCL-1,"Kona, Cafe",Overdue,/);
  assert.match(row, /2026-10-13/);
  assert.match(row, /1000\.00,0\.00,1000\.00$/);
});

test("v2 invoices: flag-gated, vendor-free; money actions via /actions", () => {
  assert.match(read("dashboard/src/app/admin/(console)/billing/invoices/page.tsx"), /process\.env\.ADMIN_V2 === "on"/);
  const ui = read("dashboard/src/components/admin/v2/AdminInvoicesV2.tsx");
  const ld = read("dashboard/src/lib/adminInvoicesV2Load.ts");
  assert.match(ui, /\/api\/admin\/billing\/invoices\//);
  assert.doesNotMatch(ui, /"use server"/);
  assert.doesNotMatch(ld, /\.(insert|update|upsert|delete|rpc)\(/);
  for (const s of [ui, read("dashboard/src/lib/ops/invoicesView.ts")]) assert.doesNotMatch(s, /sautikit|bachs|twilio|supabase|prepaid|wallet/i);
});
