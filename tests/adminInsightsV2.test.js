const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/insightsView.ts"));
const attn = () => import(path.join(root, "dashboard/src/lib/ops/attentionView.ts"));
const NOW = new Date("2026-10-22T09:00:00Z");
const row = (o = {}) => ({ tenantId: "t1", intent: "price_check", outcome: "info_only", unanswered: false, createdAt: "2026-10-21T09:00:00Z", ...o });
const many = (n, o) => Array.from({ length: n }, () => row(o));

test("privacy floor is 10: counts and shares under it never show as numbers", async () => {
  const { shown, shownShare, FLOOR } = await load();
  assert.equal(FLOOR, 10);
  assert.equal(shown(0), "<10");
  assert.equal(shown(9), "<10");
  assert.equal(shown(10), "10");
  assert.equal(shownShare(9, 100), "—");
  assert.equal(shownShare(10, 40), "25%");
});

test("businesses under 20 calls get no breakdown and no detail", async () => {
  const { buildInsights } = await load();
  const rows = [...many(19, { tenantId: "small" }), ...many(25, { tenantId: "big" })];
  const v = buildInsights(rows, new Map([["small", "S"], ["big", "B"]]), 30);
  const small = v.businesses.find((b) => b.tenantId === "small");
  assert.equal(small.breakdown, false);
  assert.equal(small.topGroup, null);
  assert.equal(v.detail.small, undefined);
  assert.ok(v.detail.big);
  assert.equal(v.businesses.find((b) => b.tenantId === "big").topGroup, "Price questions");
});

test("missed demand: >=10 price or buying missed in 7 days and >=30%", async () => {
  const { missedDemand } = await load();
  const hit = [...many(10, { outcome: "lost" }), ...many(20, { intent: "availability", outcome: "sale_or_order" })];
  assert.deepEqual(missedDemand(hit, NOW).map((m) => [m.missed, m.demand, m.price]), [[10, 30, 10]]);
  // 9 missed: under the floor
  assert.equal(missedDemand(many(9, { unanswered: true }), NOW).length, 0);
  // 10 of 40 = 25%: under the share
  assert.equal(missedDemand([...many(10, { outcome: "callback" }), ...many(30, { outcome: "sale_or_order" })], NOW).length, 0);
  // older than 7 days and non-demand intents do not count
  assert.equal(missedDemand([...many(12, { outcome: "lost", createdAt: "2026-10-10T00:00:00Z" }), ...many(12, { intent: "hours", outcome: "lost" })], NOW).length, 0);
});

test("attention gets a missed-demand row linking to Insights", async () => {
  const { buildAttention, attentionCounts, KIND_LABEL } = await attn();
  const items = buildAttention({
    businesses: [{ id: "t1", name: "Shop", status: "active", createdAt: "2026-01-01T00:00:00Z", packageName: "Starter" }],
    overdue: [], usage: [], quality: [], missed: [{ tenantId: "t1", missed: 12, demand: 30, price: 8 }], now: NOW,
  }).filter((i) => i.kind === "missed-demand");
  assert.equal(items.length, 1);
  assert.equal(items[0].href, "/admin/quality/insights?business=t1&days=7");
  assert.match(items[0].detail, /12 price questions missed this week · 40%/);
  assert.equal(KIND_LABEL["missed-demand"], "Missed demand");
  assert.equal(attentionCounts(items)["missed-demand"], 1);
});

test("no caller data or question text reaches the page; v2 only; read-only", () => {
  const loader = read("dashboard/src/lib/adminInsightsLoad.ts");
  const selects = [...loader.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1]).join(",");
  assert.match(selects, /tenant_id, intent, outcome/);
  assert.doesNotMatch(selects, /caller|from_number|phone|transcript|summary/);
  assert.doesNotMatch(loader, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.match(loader, /unanswered: typeof r\.unanswered_question === "string"/);
  const ui = read("dashboard/src/components/admin/v2/AdminInsightsV2.tsx");
  assert.doesNotMatch(ui, /FactRow|unanswered_question|callerNumber/);
  assert.match(read("dashboard/src/app/admin/(console)/quality/insights/page.tsx"), /ADMIN_V2 !== "on"\) notFound\(\)/);
  assert.doesNotMatch(ui, /framer-motion|rounded-(xl|2xl|3xl)/);
});
