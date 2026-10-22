const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/searchView.ts"));

test("number fragment drops the leading 0 and punctuation", async () => {
  const { numberFragment } = await load();
  assert.equal(numberFragment("0709 100 201"), "709100201");
  assert.equal(numberFragment("+254 709"), "254709");
  assert.equal(numberFragment("ki"), null);
  assert.equal(numberFragment("07"), null);
});

test("groups keep fixed order, dedupe, cap and put archived last", async () => {
  const { groupCommandHits, businessHit, callHit, invoiceHit } = await load();
  const hits = [
    callHit({ id: "c1" }),
    businessHit({ id: "a", business_name: "Old", archived: true }),
    businessHit({ id: "b", business_name: "Live", archived: false }),
    businessHit({ id: "b", business_name: "Live", archived: false }),
    invoiceHit({ id: "i", invoice_number: "SCL-1", status: "paid", tenant_id: "b" }),
  ];
  const g = groupCommandHits(hits, 5);
  assert.deepEqual(g.map((x) => x.kind), ["business", "invoice", "call"]);
  assert.deepEqual(g[0].hits.map((h) => h.title), ["Live", "Old"]);
  assert.equal(groupCommandHits(Array.from({ length: 9 }, (_, i) => callHit({ id: `c${i}` })), 5)[0].hits.length, 5);
});

test("hits link to read-only pages and label archived", async () => {
  const { invoiceHit, numberHit, businessHit, isArchived } = await load();
  assert.match(invoiceHit({ id: "i9", tenant_id: "t1", status: "issued" }).href, /^\/admin\/billing\/invoices\?business=t1&view=all&pane=i9$/);
  assert.equal(numberHit({ id: "n", e164: "+254700", status: "available" }).href, "/admin/numbers");
  assert.equal(numberHit({ id: "n", e164: "+254700", status: "available" }).preview, "In the pool");
  assert.equal(businessHit({ id: "x", business_name: "X", number: "pending:x", archived: false }).preview, "No number yet");
  assert.equal(isArchived({ is_active: false }), true);
  assert.equal(isArchived({ archived_at: "2026-10-01" }), true);
  assert.equal(isArchived({ is_active: true, archived_at: null }), false);
});

test("shortcut is Cmd/Ctrl+K, and / only outside fields", async () => {
  const { isPaletteShortcut } = await load();
  assert.equal(isPaletteShortcut({ key: "k", metaKey: true }), true);
  assert.equal(isPaletteShortcut({ key: "K", ctrlKey: true }), true);
  assert.equal(isPaletteShortcut({ key: "/", targetIsField: true }), false);
  assert.equal(isPaletteShortcut({ key: "/" }), true);
  assert.equal(isPaletteShortcut({ key: "k" }), false);
});

test("v2 search is gated, read-only and behind ADMIN_V2", () => {
  const route = read("dashboard/src/app/api/admin/search/route.ts");
  assert.match(route, /isLegacyAuthenticated/);
  assert.match(route, /ADMIN_V2 === "on"/);
  const lib = read("dashboard/src/lib/adminCommandSearch.ts");
  assert.doesNotMatch(lib, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.match(lib, /archived_at/);
  const ui = read("dashboard/src/components/admin/v2/AdminCommandPalette.tsx");
  assert.doesNotMatch(ui, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(read("dashboard/src/lib/ops/searchView.ts"), /sautikit/i);
});
