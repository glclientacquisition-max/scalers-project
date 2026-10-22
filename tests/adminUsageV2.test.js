const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/usageView.ts"));

const base = (over = {}) => ({
  businessName: "B", packageName: "Starter", periodStart: "2026-09-30T21:00:00Z", periodEnd: "2026-10-31T21:00:00Z",
  includedMinutes: 10, meteredSeconds: 0, onDemandEnabled: true, onDemandOwedKes: null, calls: [], ...over,
});

test("days are EAT, quiet days are 0, running total crosses once", async () => {
  const { buildUsage } = await load();
  const calls = [
    { id: "a", createdAt: "2026-09-30T22:00:00Z", durationSeconds: 300, resolution: null, intent: null }, // 1 Oct EAT
    { id: "b", createdAt: "2026-10-02T20:30:00Z", durationSeconds: 400, resolution: null, intent: null }, // 2 Oct 23:30 EAT
    { id: "c", createdAt: "2026-10-03T08:00:00Z", durationSeconds: 120, resolution: null, intent: null },
  ];
  const v = buildUsage(base({ calls, meteredSeconds: 820 }), "2026-10-03T12:00:00Z");
  assert.deepEqual(v.days.map((d) => d.date), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(v.days.map((d) => d.seconds), [300, 400, 120]);
  assert.deepEqual(v.days.map((d) => d.crossedIncluded), [false, true, false]);
  assert.equal(v.usedMinutes, 13);
  assert.equal(v.onDemandMinutes, 3);
});

test("pace projects to period end and never prices", async () => {
  const { buildUsage, paceLine } = await load();
  const v = buildUsage(base({ includedMinutes: 500, meteredSeconds: 200 * 60 }), "2026-10-10T21:00:00Z");
  assert.equal(v.daysElapsed, 10);
  assert.equal(v.projectedMinutes, 620);
  const line = paceLine(v, true);
  assert.match(line, /620 min/);
  assert.doesNotMatch(line, /KSh/);
  assert.match(paceLine(buildUsage(base({ includedMinutes: 0 }), "2026-10-10T21:00:00Z"), true), /No included minutes/);
});

test("minute labels", async () => {
  const { minLabel, eatTime } = await load();
  assert.equal(minLabel(59), "0 min");
  assert.equal(minLabel(3900), "1 h 05 min");
  assert.equal(eatTime("2026-10-02T20:30:00Z"), "23:30");
});

test("usage page is ADMIN_V2, read-only, no caller numbers", () => {
  const page = read("dashboard/src/app/admin/(console)/businesses/[id]/usage/page.tsx");
  assert.match(page, /ADMIN_V2 !== "on"/);
  assert.match(page, /requireSuperAdmin/);
  const lib = read("dashboard/src/lib/adminUsageV2Load.ts");
  assert.doesNotMatch(lib, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(lib, /from_number|caller_number|caller_phone|"phone/i);
  assert.match(read("dashboard/src/app/admin/(console)/businesses/[id]/usage/loading.tsx"), /UsageSkeleton/);
});

test("invoice and business panes link to usage", () => {
  assert.match(read("dashboard/src/components/admin/v2/AdminInvoicesV2.tsx"), /Usage for this period/);
  assert.match(read("dashboard/src/components/admin/v2/AdminBusinessesV2.tsx"), /\/usage`/);
});

test("loading mirrors the page: 5-column table at row height and the pane, no tall blocks", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/components/admin/v2/UsageSkeleton.tsx"), "utf8");
  assert.match(s, /<SkelTable rows=\{16\} cols=\{\[(\{[^}]*\}, ){4}\{[^}]*\}\]\}/);
  assert.match(s, /<SkelPane /);
  assert.doesNotMatch(s, /OpsSkeleton className="h-(9|28|full)/);
  const k = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/components/ops/Skeletons.tsx"), "utf8");
  assert.match(k, /h-ops-row/);
});
