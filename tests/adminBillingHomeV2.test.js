const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/billingHomeView.ts"));
const now = new Date("2026-10-22T09:00:00Z");
const inv = (o) => ({ id: "1", number: "SCL-1", businessId: "b", businessName: "Biz", status: "open", totalCents: 100000, paidCents: 0,
  dueAt: "2026-10-12T09:00:00Z", issuedAt: "2026-10-01T00:00:00Z", paidAt: null, createdAt: "2026-10-01T00:00:00Z", periodStart: null, periodEnd: null, lines: [], ...o });

test("month totals use Nairobi month start and skip void and draft", async () => {
  const { billingHomeTotals } = await load();
  const t = billingHomeTotals([
    inv({}),
    inv({ id: "2", status: "paid", paidCents: 100000, paidAt: "2026-09-30T22:00:00Z" }), // 1 Oct 01:00 EAT
    inv({ id: "3", status: "void" }),
    inv({ id: "4", issuedAt: "2026-09-30T20:00:00Z", dueAt: "2026-11-01T00:00:00Z" }), // 30 Sep 23:00 EAT
  ], now);
  assert.equal(t.billedThisMonthCents, 200000);
  assert.equal(t.collectedThisMonthCents, 100000);
  assert.equal(t.outstandingCents, 200000);
  assert.deepEqual([t.overdueCents, t.overdueCount], [100000, 1]);
});

test("who owes: most days late first, one row per business", async () => {
  const { owingBusinesses } = await load();
  const o = owingBusinesses([
    inv({ businessId: "a", businessName: "A", dueAt: "2026-10-20T09:00:00Z", totalCents: 900000 }),
    inv({ id: "2", businessId: "b", businessName: "B", dueAt: "2026-10-02T09:00:00Z" }),
    inv({ id: "3", businessId: "b", businessName: "B", dueAt: "2026-11-02T09:00:00Z" }),
    inv({ id: "4", businessId: "c", businessName: "C", status: "paid", paidCents: 100000 }),
  ], now);
  assert.deepEqual(o.map((b) => [b.businessId, b.openCount, b.oldestLateDays]), [["b", 2, 20], ["a", 1, 2]]);
});

test("Billing home is ADMIN_V2-only, read-only, and names no vendor", () => {
  assert.match(read("dashboard/src/app/admin/(console)/billing/home/page.tsx"), /ADMIN_V2 !== "on"\) notFound\(\)/);
  const ui = read("dashboard/src/components/admin/v2/AdminBillingHomeV2.tsx");
  assert.doesNotMatch(ui, /fetch\(|method: "POST"/);
  for (const s of [ui, read("dashboard/src/lib/ops/billingHomeView.ts")]) assert.doesNotMatch(s, /sautikit|bachs|twilio|supabase|mpesa|daraja/i);
});
