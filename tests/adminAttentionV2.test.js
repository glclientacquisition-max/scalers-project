const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/attentionView.ts"));
const now = new Date("2026-10-22T09:00:00Z");
const biz = [
  { id: "a", name: "Alpha", status: "active", createdAt: "2026-09-01T00:00:00Z" },
  { id: "w", name: "Wait", status: "waiting", createdAt: "2026-10-18T09:00:00Z" },
  { id: "x", name: "Gone", status: "archived", createdAt: "2026-01-01T00:00:00Z" },
];

test("overdue rows need money owed and a live business", async () => {
  const { buildAttention } = await load();
  const items = buildAttention({
    businesses: biz, now, usage: [], quality: [],
    overdue: [
      { id: "1", tenantId: "a", number: "INV-1", owedCents: 150000, dueAt: "2026-10-12T09:00:00Z" },
      { id: "2", tenantId: "a", number: "INV-2", owedCents: 0, dueAt: "2026-10-12T09:00:00Z" },
      { id: "3", tenantId: "x", number: "INV-3", owedCents: 9000, dueAt: "2026-10-12T09:00:00Z" },
    ],
  });
  const due = items.filter((i) => i.kind === "overdue");
  assert.equal(due.length, 1);
  assert.match(due[0].detail, /INV-1 · KSh 1,500 owed · 10 days late/);
  assert.equal(due[0].href, "/admin/billing/invoices/1");
});

test("waiting businesses show as no number with days waited", async () => {
  const { buildAttention } = await load();
  const [row] = buildAttention({ businesses: biz, now, usage: [], quality: [], overdue: [] });
  assert.equal(row.kind, "no-number");
  assert.match(row.detail, /4 days ago/);
});

test("near limit starts at 80% and skips packages with no minutes", async () => {
  const { buildAttention, NEAR_LIMIT } = await load();
  assert.equal(NEAR_LIMIT, 0.8);
  const items = buildAttention({
    businesses: [biz[0], { ...biz[0], id: "b", name: "Beta" }, { ...biz[0], id: "c", name: "Cee" }], now, quality: [], overdue: [],
    usage: [
      { tenantId: "a", includedMinutes: 100, usedSeconds: 4800, packageName: "S" },
      { tenantId: "b", includedMinutes: 100, usedSeconds: 4740, packageName: "S" },
      { tenantId: "c", includedMinutes: 0, usedSeconds: 9999, packageName: null },
    ],
  });
  assert.deepEqual(items.map((i) => i.businessId), ["a"]);
  assert.match(items[0].detail, /80 of 100 min used · 80%/);
});

test("order: overdue, no number, near limit, quality; worst first inside", async () => {
  const { buildAttention, attentionCounts } = await load();
  const items = buildAttention({
    businesses: biz, now,
    overdue: [
      { id: "1", tenantId: "a", number: "I1", owedCents: 1, dueAt: "2026-10-20T09:00:00Z" },
      { id: "2", tenantId: "a", number: "I2", owedCents: 1, dueAt: "2026-10-01T09:00:00Z" },
    ],
    usage: [{ tenantId: "a", includedMinutes: 10, usedSeconds: 600, packageName: null }],
    quality: [{ tenantId: "a", score: 6.5, reason: "Answer rate down" }],
  });
  assert.deepEqual(items.map((i) => i.kind), ["overdue", "overdue", "no-number", "near-limit", "quality"]);
  assert.equal(items[0].key, "overdue-2");
  assert.equal(attentionCounts(items).overdue, 2);
});

test("v2 Today is flag-gated, read-only and vendor-free", () => {
  const page = read("dashboard/src/app/admin/(console)/page.tsx");
  assert.match(page, /process\.env\.ADMIN_V2 === "on"/);
  const ui = read("dashboard/src/components/admin/v2/AdminAttentionV2.tsx");
  const load = read("dashboard/src/lib/adminAttentionLoad.ts");
  assert.doesNotMatch(ui, /"use server"|method:/);
  assert.deepEqual(ui.match(/fetch\(`[^`]*`/g), ["fetch(`/api/admin/businesses/${bid}/calls`"]);
  assert.doesNotMatch(load, /\.(insert|update|upsert|delete|rpc)\(/);
  for (const src of [ui, read("dashboard/src/lib/ops/attentionView.ts")]) {
    assert.doesNotMatch(src, /sautikit|africa'?s ?talking|bachs|twilio|supabase/i);
  }
});
